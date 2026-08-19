begin;

do $$
declare
  tenant_id uuid := '1a000000-0000-4000-8000-000000000001';
  branch_id uuid := '1a000000-0000-4000-8000-000000000002';
  manager_id uuid := '1a000000-0000-4000-8000-000000000003';
  contact_owner_id uuid := '1a000000-0000-4000-8000-000000000004';
  fa_member_id uuid := '1a000000-0000-4000-8000-000000000005';
  direct_member_id uuid := '1a000000-0000-4000-8000-000000000006';
  plan_id uuid := '1a000000-0000-4000-8000-000000000007';
  trial_booking_id uuid := '1a000000-0000-4000-8000-000000000008';
  fa_booking_id uuid := '1a000000-0000-4000-8000-000000000009';
  created_contract_id uuid;
  create_result jsonb;
  unique_phone_blocked boolean := false;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    manager_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'fa-shared-contact-manager@test.local', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'FA SHARED CONTACT TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'FA SHARED CONTACT TEST', 'FASC', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, english_name, is_active,
    employee_number, department, position
  ) values (
    manager_id, tenant_id, branch_id, 'manager', '共用手機測試經理', 'Shared Contact Manager',
    true, 'E999989', 'coaching', 'coach_manager'
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, phone_normalized, email,
    email_unavailable, birth_date, status, is_prospect, member_code
  ) values
  (
    contact_owner_id, tenant_id, branch_id, 'Shared Contact Owner', '0917999001',
    '0917999001', 'shared-owner@test.local', false, '1990-01-01', 'active',
    false, 'E899989'
  ),
  (
    fa_member_id, tenant_id, branch_id, 'Imported FA Member', null, null, null,
    true, null, 'active', false, 'E899988'
  ),
  (
    direct_member_id, tenant_id, branch_id, 'Direct Contract Member', null, null,
    null, true, '1990-01-03', 'active', false, 'E899987'
  );

  insert into public.member_plan_catalog (
    id, tenant_id, branch_id, code, name, plan_type, fulfillment_kind,
    default_duration_days, default_quantity, price_amount, is_active,
    fitness_plan_kind, total_sessions, course_allocations, fitness_visible
  ) values (
    plan_id, tenant_id, branch_id, 'fa_shared_contact_10', 'FA Shared Contact 10',
    'coach_pack', 'none', 65, 10, 10000, true, 'pt_fixed', 10,
    '{"weight_training":10,"relaxation":0,"reformer_pilates":0}'::jsonb,
    true
  );

  insert into public.trial_bookings (
    id, name, phone, service, preferred_time, payment_method, payment_status,
    amount, currency, source, booking_status, member_id
  ) values (
    trial_booking_id, 'Imported FA Member', '0917999001', 'weight_training',
    'weekday_evening', 'cash_on_site', 'pending_cash', 880, 'TWD',
    'legacy_schedule_import', 'scheduled', fa_member_id
  );

  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, is_bige_schedule, operation_kind,
    course_type, trial_stage, trial_booking_id, operation_idempotency_key
  ) values (
    fa_booking_id, tenant_id, branch_id, fa_member_id, manager_id,
    'FA Shared Contact', now() - interval '3 hours', now() - interval '1 hour',
    'booked', true, 'trial', 'weight_training', 'FA1', trial_booking_id,
    'test:fa-shared-contact'
  );

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  create_result := public.bige_create_member_contract_v5(
    tenant_id, branch_id, fa_member_id, fa_booking_id,
    'Imported FA Member', '0917999001', null, null, true,
    'builtin', plan_id, null, current_date, '123456', 1000,
    'cash', null, '[]'::jsonb, 'none', manager_id,
    'Shared Contact Manager', manager_id, 'fa'
  );
  created_contract_id := (create_result->>'contractId')::uuid;

  if not exists (
    select 1
    from public.members
    where id = fa_member_id
      and phone is null
      and phone_normalized is null
      and member_code = 'E899988'
  ) then
    raise exception 'FA conversion overwrote the imported member with a shared contact phone';
  end if;

  if not exists (
    select 1
    from public.members
    where id = contact_owner_id
      and phone = '0917999001'
      and phone_normalized = '0917999001'
  ) then
    raise exception 'FA conversion changed the existing shared contact owner';
  end if;

  if not exists (
    select 1
    from public.member_plan_contracts
    where id = created_contract_id
      and member_id = fa_member_id
      and converted_from_booking_id = fa_booking_id
      and status = 'active'
  ) or not exists (
    select 1
    from public.bige_contract_payments
    where contract_id = created_contract_id
      and amount = 1000
      and status = 'recorded'
  ) or not exists (
    select 1
    from public.bookings
    where id = fa_booking_id
      and converted_contract_id = created_contract_id
      and status = 'completed'
      and fa_fee_recipient_profile_id = manager_id
  ) then
    raise exception 'FA shared-contact conversion did not create its contract, payment, and completed outcome';
  end if;

  begin
    perform public.bige_create_member_contract_v5(
      tenant_id, branch_id, direct_member_id, null,
      'Direct Contract Member', '0917999001', '1990-01-03', null, true,
      'builtin', plan_id, null, current_date, '654321', 0,
      'cash', null, '[]'::jsonb, 'none', null, null, null, 'manual'
    );
  exception
    when unique_violation then
      unique_phone_blocked := true;
  end;

  if not unique_phone_blocked then
    raise exception 'direct contract unexpectedly bypassed primary phone uniqueness';
  end if;
end;
$$;

rollback;
