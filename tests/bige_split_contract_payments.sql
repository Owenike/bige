begin;

do $$
<<split_payment_test>>
declare
  tenant_id uuid := '20000000-0000-4000-8000-000000000001';
  branch_id uuid := '20000000-0000-4000-8000-000000000002';
  assistant_id uuid := '20000000-0000-4000-8000-000000000003';
  member_id uuid := '20000000-0000-4000-8000-000000000004';
  contract_id uuid := '20000000-0000-4000-8000-000000000005';
  booking_id uuid := '20000000-0000-4000-8000-000000000006';
  create_member_id uuid := '20000000-0000-4000-8000-000000000007';
  create_booking_id uuid := '20000000-0000-4000-8000-000000000008';
  plan_id uuid := '20000000-0000-4000-8000-000000000009';
  created_contract_id uuid;
  conflict_detected boolean := false;
  result jsonb;
  replay jsonb;
  create_result jsonb;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    assistant_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'split-payment-assistant@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'SPLIT PAYMENT TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'SPLIT PAYMENT TEST', 'SPLITPAY', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active,
    employee_number, department, position
  ) values (
    assistant_id, tenant_id, branch_id, 'supervisor', 'Split Payment Assistant', true,
    'E999944', 'coaching', 'coach_assistant_manager'
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, status, is_prospect, member_code
  ) values
  (member_id, tenant_id, branch_id, 'Split Payment Member', 'active', false, 'E899944'),
  (create_member_id, tenant_id, branch_id, 'Split Payment Create Member', 'active', false, 'E899943');

  insert into public.member_plan_catalog (
    id, tenant_id, branch_id, code, name, plan_type, fulfillment_kind,
    default_duration_days, default_quantity, price_amount, is_active,
    fitness_plan_kind, total_sessions, course_allocations, fitness_visible
  ) values (
    plan_id, tenant_id, branch_id, 'split_payment_10', 'Split Payment 10',
    'coach_pack', 'none', 65, 10, 10000, true, 'pt_fixed', 10,
    '{"weight_training":10,"relaxation":0,"reformer_pilates":0}'::jsonb,
    true
  );

  insert into public.member_plan_contracts (
    id, tenant_id, branch_id, member_id, contract_number, status,
    starts_at, ends_at, total_sessions, total_amount, unlocked_sessions,
    used_sessions, remaining_sessions, payment_status
  ) values (
    contract_id, tenant_id, branch_id, member_id, 'SPLIT-PAY-01', 'pending',
    now(), now() + interval '65 days', 10, 10000, 0, 0, 0, 'unpaid'
  );

  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, is_bige_schedule, operation_kind,
    course_type, operation_idempotency_key
  ) values
  (
    booking_id, tenant_id, branch_id, member_id, assistant_id, 'Future PT Payment',
    now() + interval '1 day', now() + interval '1 day 1 hour', 'booked', true, 'pt',
    'weight_training', 'test:split-payment-booking'
  ),
  (
    create_booking_id, tenant_id, branch_id, create_member_id, assistant_id,
    'Future PT Contract Payment', now() + interval '2 days',
    now() + interval '2 days 1 hour', 'booked', true, 'pt',
    'weight_training', 'test:split-payment-create-booking'
  );

  perform set_config('request.jwt.claim.sub', assistant_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  result := public.bige_record_contract_payments_v1(
    contract_id,
    booking_id,
    null,
    'deposit',
    '[
      {"amount": 3000, "method": "cash"},
      {"amount": 5000, "method": "ecpay_installment", "installmentCount": 6}
    ]'::jsonb,
    now(),
    'test:split-payment:receipt',
    'split payment regression'
  );

  if (result->>'totalAmount')::bigint <> 8000
     or (select count(*) from public.bige_contract_payments payment where payment.contract_id = split_payment_test.contract_id) <> 2
     or (select sum(payment.amount) from public.bige_contract_payments payment where payment.contract_id = split_payment_test.contract_id and payment.status = 'recorded') <> 8000
     or not exists (
       select 1 from public.bige_contract_payments payment
       where payment.contract_id = split_payment_test.contract_id
         and payment.source_booking_id = split_payment_test.booking_id
         and payment.amount = 3000 and payment.method = 'cash'
     )
     or not exists (
       select 1 from public.bige_contract_payments payment
       where payment.contract_id = split_payment_test.contract_id
         and payment.source_booking_id = split_payment_test.booking_id
         and payment.amount = 5000 and payment.method = 'ecpay_installment' and payment.installment_count = 6
     )
     or not exists (
       select 1 from public.member_plan_contracts
       where id = split_payment_test.contract_id
         and unlocked_sessions = 8 and remaining_sessions = 8
         and payment_status = 'deposit_paid' and status = 'active'
     )
     or (select count(*) from public.member_plan_ledger ledger where ledger.contract_id = split_payment_test.contract_id and ledger.source_type = 'grant') <> 1
  then
    raise exception 'split payment did not preserve rows, source booking, or one aggregate unlock';
  end if;

  replay := public.bige_record_contract_payments_v1(
    contract_id,
    booking_id,
    null,
    'deposit',
    '[
      {"amount": 3000, "method": "cash"},
      {"amount": 5000, "method": "ecpay_installment", "installmentCount": 6}
    ]'::jsonb,
    now(),
    'test:split-payment:receipt',
    'split payment regression'
  );

  if coalesce((replay->>'replayed')::boolean, false) is not true
     or (select count(*) from public.bige_contract_payments payment where payment.contract_id = split_payment_test.contract_id) <> 2
     or (select count(*) from public.member_plan_ledger ledger where ledger.contract_id = split_payment_test.contract_id and ledger.source_type = 'grant') <> 1
  then
    raise exception 'split payment replay created duplicate rows or unlocks';
  end if;

  begin
    perform public.bige_record_contract_payments_v1(
      contract_id,
      booking_id,
      null,
      'deposit',
      '[
        {"amount": 4000, "method": "cash"},
        {"amount": 4000, "method": "ecpay_installment", "installmentCount": 6}
      ]'::jsonb,
      now(),
      'test:split-payment:receipt',
      'changed replay must fail'
    );
  exception
    when others then
      if sqlerrm = 'idempotency_key_conflict' then
        conflict_detected := true;
      else
        raise;
      end if;
  end;
  if not conflict_detected then
    raise exception 'changed split payment replay unexpectedly succeeded';
  end if;

  create_result := public.bige_create_member_contract_v6(
    tenant_id, branch_id, create_member_id, null,
    'Split Payment Create Member', '0912999943', '1990-01-01', null, true,
    'builtin', plan_id, null, current_date, '123456', 8000,
    '[
      {"amount": 3000, "method": "cash"},
      {"amount": 5000, "method": "bank_transfer"}
    ]'::jsonb,
    '[]'::jsonb, 'none', null, null, assistant_id, 'manual', create_booking_id
  );
  created_contract_id := (create_result->>'contractId')::uuid;

  if (select count(*) from public.bige_contract_payments payment where payment.contract_id = created_contract_id) <> 2
     or (select sum(payment.amount) from public.bige_contract_payments payment where payment.contract_id = created_contract_id and payment.status = 'recorded') <> 8000
     or not exists (
       select 1 from public.bige_contract_payments payment
       where payment.contract_id = created_contract_id
         and payment.source_booking_id = create_booking_id
         and payment.amount = 3000 and payment.method = 'cash'
     )
     or not exists (
       select 1 from public.bige_contract_payments payment
       where payment.contract_id = created_contract_id
         and payment.source_booking_id = create_booking_id
         and payment.amount = 5000 and payment.method = 'bank_transfer'
     )
     or not exists (
       select 1 from public.member_plan_contracts
       where id = created_contract_id
         and unlocked_sessions = 8 and remaining_sessions = 8
         and payment_status = 'deposit_paid' and status = 'active'
     )
     or (select count(*) from public.member_plan_ledger ledger where ledger.contract_id = created_contract_id and ledger.source_type = 'grant') <> 1
  then
    raise exception 'contract creation did not preserve split tenders or one aggregate unlock';
  end if;
end;
$$;

rollback;
