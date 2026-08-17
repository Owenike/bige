begin;

do $$
declare
  tenant_id uuid := '15000000-0000-4000-8000-000000000001';
  branch_id uuid := '15000000-0000-4000-8000-000000000002';
  manager_id uuid := '15000000-0000-4000-8000-000000000003';
  prospect_id uuid := '15000000-0000-4000-8000-000000000004';
  direct_member_id uuid := '15000000-0000-4000-8000-000000000005';
  plan_id uuid := '15000000-0000-4000-8000-000000000006';
  fa_booking_id uuid := '15000000-0000-4000-8000-000000000007';
  create_result jsonb;
  payment_result jsonb;
  fa_contract_id uuid;
  direct_contract_id uuid;
  expected_today date := (now() at time zone 'Asia/Taipei')::date;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    manager_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'fa-signing-installments@test.local',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

  insert into public.tenants (id, name, status)
  values (tenant_id, 'FA SIGNING INSTALLMENT TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'FA SIGNING INSTALLMENT TEST', 'FASI', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active,
    employee_number, department, position
  ) values (
    manager_id, tenant_id, branch_id, 'manager', 'FA Signing Manager', true,
    'E999997', 'coaching', 'coach_manager'
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, phone_normalized, email,
    email_unavailable, birth_date, status, is_prospect, member_code
  ) values
  (
    prospect_id, tenant_id, branch_id, 'FA Signing Prospect', '0915999001',
    '0915999001', 'fa-signing@test.local', false, '1990-01-01', 'active', true, null
  ),
  (
    direct_member_id, tenant_id, branch_id, 'Direct Signing Member', '0915999002',
    '0915999002', 'direct-signing@test.local', false, '1990-01-02', 'active',
    false, 'E899997'
  );

  insert into public.member_plan_catalog (
    id, tenant_id, branch_id, code, name, plan_type, fulfillment_kind,
    default_duration_days, default_quantity, price_amount, is_active,
    fitness_plan_kind, total_sessions, course_allocations, fitness_visible
  ) values (
    plan_id, tenant_id, branch_id, 'fa_signing_10', 'FA Signing 10',
    'coach_pack', 'none', 65, 10, 10000, true, 'pt_fixed', 10,
    '{"weight_training":10,"relaxation":0,"reformer_pilates":0}'::jsonb,
    true
  );

  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, is_bige_schedule, operation_kind,
    course_type, trial_stage, operation_idempotency_key
  ) values (
    fa_booking_id, tenant_id, branch_id, prospect_id, manager_id,
    'FA Signing', now() - interval '3 hours', now() - interval '1 hour',
    'booked', true, 'trial', 'weight_training', 'FA1', 'test:fa-signing'
  );

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  begin
    perform public.bige_create_member_contract_v3(
      tenant_id, branch_id, prospect_id, fa_booking_id,
      'FA Signing Prospect', '0915999001', '1990-01-01', 'fa-signing@test.local', false,
      'builtin', plan_id, null, current_date, '123456', 0,
      'cash', null, '[]'::jsonb, 'none'
    );
    raise exception 'zero-payment FA conversion unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'fa_initial_payment_required' then
        raise;
      end if;
  end;

  begin
    perform public.bige_create_member_contract_v3(
      tenant_id, branch_id, prospect_id, fa_booking_id,
      'FA Signing Prospect', '0915999001', '1990-01-01', 'fa-signing@test.local', false,
      'builtin', plan_id, null, current_date, '123456', 999,
      'cash', null, '[]'::jsonb, 'none'
    );
    raise exception 'under-minimum FA conversion unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'fa_initial_payment_required' then
        raise;
      end if;
  end;

  begin
    perform public.bige_create_member_contract_v3(
      tenant_id, branch_id, prospect_id, fa_booking_id,
      'FA Signing Prospect', '0915999001', '1990-01-01', 'fa-signing@test.local', false,
      'builtin', plan_id, null, current_date, '123456', 10001,
      'cash', null, '[]'::jsonb, 'none'
    );
    raise exception 'over-total FA conversion unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'payment_amount_exceeds_contract_balance' then
        raise;
      end if;
  end;

  create_result := public.bige_create_member_contract_v3(
    tenant_id, branch_id, prospect_id, fa_booking_id,
    'FA Signing Prospect', '0915999001', '1990-01-01', 'fa-signing@test.local', false,
    'builtin', plan_id, null, '2020-01-02', '123456', 10000,
    'ecpay_installment', 12, '[]'::jsonb, 'none'
  );
  fa_contract_id := (create_result->>'contractId')::uuid;

  if (create_result->>'signedOn')::date <> expected_today
     or not exists (
       select 1 from public.member_plan_contracts
       where id = fa_contract_id and signed_on = expected_today
     ) then
    raise exception 'FA signing date was not locked to the current Taiwan date';
  end if;

  if not exists (
    select 1 from public.bige_contract_payments
    where contract_id = fa_contract_id
      and method = 'ecpay_installment'
      and installment_count = 12
      and status = 'recorded'
  ) then
    raise exception 'FA ECPay installment count was not stored';
  end if;

  create_result := public.bige_create_member_contract_v3(
    tenant_id, branch_id, direct_member_id, null,
    'Direct Signing Member', '0915999002', '1990-01-02', 'direct-signing@test.local', false,
    'builtin', plan_id, null, '2020-02-03', '654321', 0,
    'cash', null, '[]'::jsonb, 'none'
  );
  direct_contract_id := (create_result->>'contractId')::uuid;

  if not exists (
    select 1 from public.member_plan_contracts
    where id = direct_contract_id and signed_on = '2020-02-03'
  ) then
    raise exception 'non-FA signing date was unexpectedly overridden';
  end if;

  if exists (
    select 1 from public.bige_contract_payments
    where contract_id = direct_contract_id and status = 'recorded'
  ) then
    raise exception 'zero-payment direct contract unexpectedly created a payment';
  end if;

  payment_result := public.bige_record_contract_payment_v2(
    direct_contract_id, null, 'installment', 1000, 'ecpay_installment', 6,
    now(), 'test:ecpay-installment:record-payment', 'SQL regression test'
  );

  if not exists (
    select 1 from public.bige_contract_payments
    where id = (payment_result->>'paymentId')::uuid
      and method = 'ecpay_installment'
      and installment_count = 6
  ) then
    raise exception 'follow-up ECPay installment count was not stored';
  end if;

  begin
    perform public.bige_create_member_contract_v3(
      tenant_id, branch_id, prospect_id, fa_booking_id,
      'FA Signing Prospect', '0915999001', '1990-01-01', 'fa-signing@test.local', false,
      'builtin', plan_id, null, current_date, '123456', 10000,
      'ecpay_installment', null, '[]'::jsonb, 'none'
    );
    raise exception 'missing installment count unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'invalid_installment_count' then
        raise;
      end if;
  end;

  begin
    perform public.bige_record_contract_payment_v2(
      direct_contract_id, null, 'balance', 1000, 'cash', 3,
      now(), 'test:invalid-cash-installments', null
    );
    raise exception 'cash payment with installment count unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'installment_count_not_allowed' then
        raise;
      end if;
  end;
end;
$$;

rollback;
