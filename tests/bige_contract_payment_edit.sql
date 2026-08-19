begin;

do $$
<<payment_edit_test>>
declare
  tenant_id uuid := '19000000-0000-4000-8000-000000000001';
  branch_id uuid := '19000000-0000-4000-8000-000000000002';
  manager_id uuid := '19000000-0000-4000-8000-000000000003';
  assistant_id uuid := '19000000-0000-4000-8000-000000000004';
  frontdesk_id uuid := '19000000-0000-4000-8000-000000000005';
  member_id uuid := '19000000-0000-4000-8000-000000000006';
  contract_id uuid := '19000000-0000-4000-8000-000000000007';
  schedule_id uuid := '19000000-0000-4000-8000-000000000008';
  payment_id uuid := '19000000-0000-4000-8000-000000000009';
  result jsonb;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  (
    manager_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'payment-edit-manager@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  ),
  (
    assistant_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'payment-edit-assistant@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  ),
  (
    frontdesk_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'payment-edit-frontdesk@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'PAYMENT EDIT TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'PAYMENT EDIT TEST', 'PAYEDIT', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active,
    employee_number, department, position
  ) values
  (
    manager_id, tenant_id, branch_id, 'manager', 'Payment Edit Manager', true,
    'E999941', 'coaching', 'coach_manager'
  ),
  (
    assistant_id, tenant_id, branch_id, 'supervisor', 'Payment Edit Assistant', true,
    'E999942', 'coaching', 'coach_assistant_manager'
  ),
  (
    frontdesk_id, tenant_id, branch_id, 'frontdesk', 'Payment Edit Frontdesk', true,
    'E999943', 'general_affairs', 'frontdesk'
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, status, is_prospect, member_code
  ) values (
    member_id, tenant_id, branch_id, 'Payment Edit Member', 'active', false, 'E899941'
  );

  insert into public.member_plan_contracts (
    id, tenant_id, branch_id, member_id, contract_number, status,
    starts_at, ends_at, total_sessions, total_amount, unlocked_sessions,
    used_sessions, remaining_sessions, payment_status
  ) values (
    contract_id, tenant_id, branch_id, member_id, 'PAYEDIT-TEST-01', 'active',
    now(), now() + interval '365 days', 48, 66624, 48, 3, 45, 'settled'
  );

  insert into public.bige_contract_payment_schedule (
    id, tenant_id, contract_id, sequence_no, payment_kind, due_on,
    due_amount, paid_amount, status, created_by
  ) values (
    schedule_id, tenant_id, contract_id, 1, 'deposit', current_date,
    66624, 66624, 'paid', manager_id
  );

  insert into public.bige_contract_payments (
    id, tenant_id, contract_id, schedule_item_id, payment_kind, amount,
    method, status, paid_at, idempotency_key, note, recorded_by
  ) values (
    payment_id, tenant_id, contract_id, schedule_id, 'deposit', 66624,
    'other', 'recorded', now(), 'test:payment-edit:legacy', 'legacy import', manager_id
  );

  perform set_config('request.jwt.claim.sub', assistant_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  result := public.bige_update_contract_payment(
    payment_id, 'deposit', 20000, 'bank_transfer', null, 'recorded',
    'corrected legacy receipt', 'correct imported paid amount'
  );

  if (result->>'outstandingBalance')::bigint <> 46624
     or not exists (
       select 1
       from public.bige_contract_payments
       where id = payment_id
         and amount = 20000
         and method = 'bank_transfer'
         and status = 'recorded'
     )
     or not exists (
       select 1
       from public.member_plan_contracts
       where id = contract_id
         and unlocked_sessions = 14
         and used_sessions = 3
         and remaining_sessions = 11
         and payment_status = 'deposit_paid'
         and status = 'active'
     )
     or not exists (
       select 1
       from public.bige_contract_payment_schedule
       where id = schedule_id
         and paid_amount = 20000
         and status = 'partial'
     ) then
    raise exception 'assistant payment edit did not recalculate the contract and schedule';
  end if;

  if not exists (
    select 1
    from public.member_plan_ledger ledger
    where ledger.contract_id = payment_edit_test.contract_id
      and ledger.reference_id = payment_id::text
      and ledger.source_type = 'refund_reversal'
      and ledger.delta_sessions = -34
  ) or not exists (
    select 1
    from public.audit_logs audit
    where audit.target_type = 'bige_contract_payment'
      and audit.target_id = payment_id::text
      and audit.action = 'fitness_contract_payment_updated'
      and audit.actor_id = assistant_id
  ) then
    raise exception 'payment edit did not create ledger and audit records';
  end if;

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  result := public.bige_update_contract_payment(
    payment_id, 'deposit', 20000, 'bank_transfer', null, 'refunded',
    'corrected legacy receipt', 'manager refund correction'
  );

  if (result->>'outstandingBalance')::bigint <> 66624
     or not exists (
       select 1
       from public.member_plan_contracts
       where id = contract_id
         and unlocked_sessions = 0
         and remaining_sessions = 0
         and payment_status = 'refunded'
         and status = 'frozen'
     ) then
    raise exception 'manager payment status edit did not recalculate the contract';
  end if;

  perform set_config('request.jwt.claim.sub', frontdesk_id::text, true);
  begin
    perform public.bige_update_contract_payment(
      payment_id, 'deposit', 20000, 'cash', null, 'recorded', null,
      'frontdesk should be rejected'
    );
    raise exception 'frontdesk unexpectedly edited an existing payment';
  exception
    when others then
      if sqlerrm <> 'manager_required' then
        raise;
      end if;
  end;
end;
$$;

rollback;
