begin;

do $$
<<paid_schedule_test>>
declare
  tenant_id uuid := '23000000-0000-4000-8000-000000000001';
  branch_id uuid := '23000000-0000-4000-8000-000000000002';
  manager_id uuid := '23000000-0000-4000-8000-000000000003';
  assistant_id uuid := '23000000-0000-4000-8000-000000000004';
  frontdesk_id uuid := '23000000-0000-4000-8000-000000000005';
  platform_admin_id uuid := '23000000-0000-4000-8000-000000000006';
  member_id uuid := '23000000-0000-4000-8000-000000000007';
  contract_id uuid := '23000000-0000-4000-8000-000000000008';
  frontdesk_booking_id uuid := '23000000-0000-4000-8000-000000000009';
  assistant_booking_id uuid := '23000000-0000-4000-8000-000000000010';
  platform_booking_id uuid := '23000000-0000-4000-8000-000000000011';
  unpaid_booking_id uuid := '23000000-0000-4000-8000-000000000012';
  frontdesk_payment_id uuid := '23000000-0000-4000-8000-000000000013';
  split_booking_id uuid := '23000000-0000-4000-8000-000000000016';
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  (
    manager_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'paid-cell-manager@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  ),
  (
    assistant_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'paid-cell-assistant@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  ),
  (
    frontdesk_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'paid-cell-frontdesk@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  ),
  (
    platform_admin_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'paid-cell-platform@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'PAID SCHEDULE ACCESS TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'PAID SCHEDULE ACCESS TEST', 'PAIDCELL', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active,
    employee_number, department, position
  ) values
  (
    manager_id, tenant_id, branch_id, 'manager', 'Paid Cell Manager', true,
    'E999951', 'coaching', 'coach_manager'
  ),
  (
    assistant_id, tenant_id, branch_id, 'supervisor', 'Paid Cell Assistant', true,
    'E999952', 'coaching', 'coach_assistant_manager'
  ),
  (
    frontdesk_id, tenant_id, branch_id, 'frontdesk', 'Paid Cell Frontdesk', true,
    'E999953', 'general_affairs', 'frontdesk'
  ),
  (
    platform_admin_id, tenant_id, branch_id, 'platform_admin', 'Paid Cell Platform Admin', true,
    'E999954', null, null
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, status, is_prospect, member_code
  ) values (
    member_id, tenant_id, branch_id, 'Paid Schedule Member', 'active', false, 'E899951'
  );

  insert into public.member_plan_contracts (
    id, tenant_id, branch_id, member_id, contract_number, status,
    starts_at, ends_at, total_sessions, total_amount, unlocked_sessions,
    used_sessions, remaining_sessions, payment_status
  ) values (
    contract_id, tenant_id, branch_id, member_id, 'PAID-CELL-01', 'active',
    now(), now() + interval '365 days', 48, 100000, 48, 0, 48, 'settled'
  );

  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, is_bige_schedule, operation_kind,
    course_type, operation_idempotency_key
  ) values
  (
    frontdesk_booking_id, tenant_id, branch_id, member_id, assistant_id,
    'Paid PT Frontdesk Guard', now() + interval '1 day', now() + interval '1 day 1 hour',
    'booked', true, 'pt', 'weight_training', 'test:paid-cell-frontdesk'
  ),
  (
    assistant_booking_id, tenant_id, branch_id, member_id, assistant_id,
    'Paid Renewal Assistant', now() + interval '2 days', now() + interval '2 days 1 hour',
    'booked', true, 'pt', 'weight_training', 'test:paid-cell-assistant'
  ),
  (
    platform_booking_id, tenant_id, branch_id, member_id, assistant_id,
    'Paid FA Platform Admin', now() + interval '3 days', now() + interval '3 days 2 hours',
    'booked', true, 'trial', null, 'test:paid-cell-platform'
  ),
  (
    unpaid_booking_id, tenant_id, branch_id, member_id, assistant_id,
    'Unpaid PT', now() + interval '4 days', now() + interval '4 days 1 hour',
    'booked', true, 'pt', 'weight_training', 'test:unpaid-cell-frontdesk'
  ),
  (
    split_booking_id, tenant_id, branch_id, member_id, assistant_id,
    'Initial Split Payment', now() + interval '5 days', now() + interval '5 days 1 hour',
    'booked', true, 'pt', 'weight_training', 'test:initial-split-frontdesk'
  );

  insert into public.bige_contract_payments (
    id, tenant_id, contract_id, source_booking_id, payment_kind, amount,
    method, status, paid_at, idempotency_key, recorded_by
  ) values
  (
    frontdesk_payment_id, tenant_id, contract_id, frontdesk_booking_id,
    'deposit', 10000, 'cash', 'recorded', now(), 'test:paid-cell:frontdesk', manager_id
  ),
  (
    '23000000-0000-4000-8000-000000000014', tenant_id, contract_id,
    assistant_booking_id, 'balance', 10000, 'bank_transfer', 'recorded', now(),
    'test:paid-cell:assistant', manager_id
  ),
  (
    '23000000-0000-4000-8000-000000000015', tenant_id, contract_id,
    platform_booking_id, 'installment', 10000, 'card_terminal', 'recorded', now(),
    'test:paid-cell:platform', manager_id
  );

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', frontdesk_id::text, true);

  perform public.bige_record_contract_payments_v1(
    contract_id,
    split_booking_id,
    null,
    'balance',
    '[{"amount":1000,"method":"cash","installmentCount":null},{"amount":1000,"method":"bank_transfer","installmentCount":null}]'::jsonb,
    now(),
    'test:paid-cell:initial-split',
    'initial split payment remains available to frontdesk'
  );
  if (
    select count(*)
    from public.bige_contract_payments
    where source_booking_id = split_booking_id
      and status = 'recorded'
  ) <> 2 then
    raise exception 'frontdesk initial split payment was unexpectedly blocked';
  end if;

  begin
    update public.bookings
    set status = 'cancelled', status_reason = 'schedule_trash_deleted'
    where id = frontdesk_booking_id;
    raise exception 'frontdesk unexpectedly deleted a paid schedule cell';
  exception
    when others then
      if sqlerrm <> 'paid_schedule_booking_manager_required' then raise; end if;
  end;

  begin
    update public.bige_contract_payments
    set amount = 12000
    where id = frontdesk_payment_id;
    raise exception 'frontdesk unexpectedly changed a paid schedule amount';
  exception
    when others then
      if sqlerrm <> 'paid_schedule_booking_manager_required' then raise; end if;
  end;

  begin
    insert into public.bige_contract_payments (
      tenant_id, contract_id, source_booking_id, payment_kind, amount,
      method, status, idempotency_key, recorded_by
    ) values (
      tenant_id, contract_id, frontdesk_booking_id, 'balance', 1000,
      'cash', 'recorded', 'test:paid-cell:second-frontdesk', frontdesk_id
    );
    raise exception 'frontdesk unexpectedly added a second amount to a paid schedule cell';
  exception
    when others then
      if sqlerrm <> 'paid_schedule_booking_manager_required' then raise; end if;
  end;

  update public.bookings
  set status = 'cancelled', status_reason = 'schedule_trash_deleted'
  where id = unpaid_booking_id;
  if not exists (
    select 1 from public.bookings
    where id = unpaid_booking_id and status = 'cancelled'
  ) then
    raise exception 'frontdesk could not delete an unpaid schedule cell';
  end if;

  perform set_config('request.jwt.claim.sub', assistant_id::text, true);
  update public.bookings
  set status = 'cancelled', status_reason = 'schedule_drag_overwrite'
  where id = assistant_booking_id;
  insert into public.bige_contract_payments (
    tenant_id, contract_id, source_booking_id, payment_kind, amount,
    method, status, idempotency_key, recorded_by
  ) values (
    tenant_id, contract_id, frontdesk_booking_id, 'balance', 1000,
    'cash', 'recorded', 'test:paid-cell:second-assistant', assistant_id
  );

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  update public.bige_contract_payments
  set amount = 11000
  where id = frontdesk_payment_id;

  perform set_config('request.jwt.claim.sub', platform_admin_id::text, true);
  update public.bookings
  set status = 'cancelled', status_reason = 'schedule_trash_deleted'
  where id = platform_booking_id;
  update public.bige_contract_payments
  set amount = 12000
  where id = frontdesk_payment_id;

  if not exists (
    select 1 from public.bookings
    where id = assistant_booking_id
      and status = 'cancelled'
      and status_reason = 'schedule_drag_overwrite'
  ) or not exists (
    select 1 from public.bookings
    where id = platform_booking_id
      and status = 'cancelled'
      and status_reason = 'schedule_trash_deleted'
  ) or not exists (
    select 1 from public.bige_contract_payments
    where id = frontdesk_payment_id and amount = 12000
  ) then
    raise exception 'manager, assistant manager, or platform admin paid-cell access failed';
  end if;
end;
$$;

rollback;
