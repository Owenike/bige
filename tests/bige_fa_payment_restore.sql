begin;

do $$
<<test_block>>
declare
  tenant_id uuid := '14000000-0000-4000-8000-000000000001';
  branch_id uuid := '14000000-0000-4000-8000-000000000002';
  manager_id uuid := '14000000-0000-4000-8000-000000000003';
  prospect_id uuid := '14000000-0000-4000-8000-000000000004';
  formal_member_id uuid := '14000000-0000-4000-8000-000000000005';
  plan_id uuid := '14000000-0000-4000-8000-000000000006';
  prospect_booking_id uuid := '14000000-0000-4000-8000-000000000007';
  formal_booking_id uuid := '14000000-0000-4000-8000-000000000008';
  create_result jsonb;
  restore_result jsonb;
  prospect_contract_id uuid;
  formal_contract_id uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    manager_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'fa-payment-restore@test.local',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'FA PAYMENT RESTORE TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'FA PAYMENT RESTORE TEST', 'FAPR', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active,
    employee_number, department, position
  ) values (
    manager_id, tenant_id, branch_id, 'manager', 'FA Restore Manager', true,
    'E999998', 'coaching', 'coach_manager'
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, phone_normalized, email,
    email_unavailable, birth_date, status, is_prospect, member_code
  ) values
  (
    prospect_id, tenant_id, branch_id, 'FA Prospect', '0914999001', '0914999001',
    'fa-prospect@test.local', false, '1990-01-01', 'active', true, null
  ),
  (
    formal_member_id, tenant_id, branch_id, 'Existing Formal Member', '0914999002',
    '0914999002', 'formal-member@test.local', false, '1990-01-02', 'active',
    false, 'E899998'
  );

  insert into public.member_plan_catalog (
    id, tenant_id, branch_id, code, name, plan_type, fulfillment_kind,
    default_duration_days, default_quantity, price_amount, is_active,
    fitness_plan_kind, total_sessions, course_allocations, fitness_visible
  ) values (
    plan_id, tenant_id, branch_id, 'fa_restore_10', 'FA Restore 10',
    'coach_pack', 'none', 65, 10, 10000, true, 'pt_fixed', 10,
    '{"weight_training":10,"relaxation":0,"reformer_pilates":0}'::jsonb,
    true
  );

  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, is_bige_schedule, operation_kind,
    course_type, trial_stage, operation_idempotency_key
  ) values
  (
    prospect_booking_id, tenant_id, branch_id, prospect_id, manager_id,
    'FA Prospect', now() - interval '3 hours', now() - interval '1 hour',
    'booked', true, 'trial', 'weight_training', 'FA1', 'test:fa-restore:prospect'
  ),
  (
    formal_booking_id, tenant_id, branch_id, formal_member_id, manager_id,
    'Existing Formal FA', now() - interval '6 hours', now() - interval '4 hours',
    'booked', true, 'trial', 'weight_training', 'FA1', 'test:fa-restore:formal'
  );

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  create_result := public.bige_create_member_contract(
    tenant_id, branch_id, prospect_id, prospect_booking_id,
    'FA Prospect', '0914999001', '1990-01-01', 'fa-prospect@test.local', false,
    plan_id, current_date, '123456', 10000, 'ecpay', '[]'::jsonb, 'none'
  );
  prospect_contract_id := (create_result->>'contractId')::uuid;

  if not exists (
    select 1 from public.bige_contract_payments
    where contract_id = prospect_contract_id
      and method = 'ecpay'
      and status = 'recorded'
  ) then
    raise exception 'ECPay FA payment was not recorded';
  end if;

  if not exists (
    select 1 from public.audit_logs
    where action = 'trial_converted_to_member'
      and target_id = prospect_contract_id::text
      and payload->>'memberWasProspectBeforeConversion' = 'true'
      and payload->>'memberCodeBeforeConversion' is null
  ) then
    raise exception 'prospect conversion snapshot was not recorded';
  end if;

  restore_result := public.bige_restore_fa_conversion(prospect_booking_id);
  if coalesce((restore_result->>'memberRevertedToProspect')::boolean, false) is not true then
    raise exception 'restored FA did not return its member to prospect state';
  end if;

  if not exists (
    select 1 from public.members
    where id = prospect_id
      and is_prospect = true
      and member_code is null
      and attendance_pin_hash is null
      and attendance_pin_set_at is null
  ) then
    raise exception 'restored prospect still has formal-member identity fields';
  end if;

  if not exists (
    select 1 from public.member_plan_contracts
    where id = prospect_contract_id and status = 'canceled' and payment_status = 'refunded'
  ) or not exists (
    select 1 from public.bige_contract_payments
    where contract_id = prospect_contract_id and status = 'voided'
  ) or not exists (
    select 1 from public.bookings
    where id = prospect_booking_id
      and status = 'booked'
      and converted_at is null
      and converted_contract_id is null
  ) then
    raise exception 'FA restore did not reverse the contract, payment, and booking atomically';
  end if;

  create_result := public.bige_create_member_contract(
    tenant_id, branch_id, formal_member_id, formal_booking_id,
    'Existing Formal Member', '0914999002', '1990-01-02', 'formal-member@test.local', false,
    plan_id, current_date, '654321', 10000, 'ecpay_installment', '[]'::jsonb, 'none'
  );
  formal_contract_id := (create_result->>'contractId')::uuid;

  if not exists (
    select 1 from public.bige_contract_payments
    where contract_id = formal_contract_id
      and method = 'ecpay_installment'
      and status = 'recorded'
  ) then
    raise exception 'ECPay installment FA payment was not recorded';
  end if;

  restore_result := public.bige_restore_fa_conversion(formal_booking_id);
  if coalesce((restore_result->>'memberRevertedToProspect')::boolean, false) is true then
    raise exception 'an existing formal member was incorrectly reverted to a prospect';
  end if;
  if not exists (
    select 1 from public.members
    where id = formal_member_id
      and is_prospect = false
      and member_code = 'E899998'
  ) then
    raise exception 'existing formal-member identity was not preserved';
  end if;

  begin
    perform public.bige_create_member_contract(
      tenant_id, branch_id, prospect_id, prospect_booking_id,
      'FA Prospect', '0914999001', '1990-01-01', 'fa-prospect@test.local', false,
      plan_id, current_date, '123456', 10000, 'invalid_method', '[]'::jsonb, 'none'
    );
    raise exception 'an invalid payment method unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'invalid_payment_method' then
        raise;
      end if;
  end;
end;
$$;

rollback;
