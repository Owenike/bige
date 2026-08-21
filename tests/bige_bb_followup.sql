begin;

do $$
declare
  test_tenant_id uuid := '1b000000-0000-4000-8000-000000000001';
  test_branch_id uuid := '1b000000-0000-4000-8000-000000000002';
  test_manager_id uuid := '1b000000-0000-4000-8000-000000000003';
  test_member_id uuid := '1b000000-0000-4000-8000-000000000004';
  test_trial_id uuid := '1b000000-0000-4000-8000-000000000005';
  test_ineligible_trial_id uuid := '1b000000-0000-4000-8000-000000000006';
  test_original_fa_id uuid := '1b000000-0000-4000-8000-000000000007';
  test_plan_id uuid := '1b000000-0000-4000-8000-000000000008';
  created_result jsonb;
  replay_result jsonb;
  contract_result jsonb;
  bb_booking_id uuid;
  bb_contract_id uuid;
  first_scheduled_at timestamptz;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    test_manager_id, '00000000-0000-0000-0000-000000000000', 'authenticated',
    'authenticated', 'bb-followup-manager@test.local', '', now(), '{}'::jsonb,
    '{}'::jsonb, now(), now()
  );

  insert into public.tenants (id, name, status)
  values (test_tenant_id, 'BB FOLLOWUP TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (test_branch_id, test_tenant_id, 'BB FOLLOWUP TEST', 'BBFT', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, english_name, is_active,
    employee_number, department, position
  ) values (
    test_manager_id, test_tenant_id, test_branch_id, 'coach', 'BB 測試經理', 'BB Manager', true,
    'E999995', 'coaching', 'coach_manager'
  );

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, phone_normalized, email,
    email_unavailable, birth_date, status, is_prospect
  ) values (
    test_member_id, test_tenant_id, test_branch_id, 'BB Followup Member', '0918999501',
    '0918999501', 'bb-followup-member@test.local', false, '1990-01-01', 'active', true
  );

  insert into public.member_plan_catalog (
    id, tenant_id, branch_id, code, name, plan_type, fulfillment_kind,
    default_duration_days, default_quantity, price_amount, is_active,
    fitness_plan_kind, total_sessions, course_allocations, fitness_visible
  ) values (
    test_plan_id, test_tenant_id, test_branch_id, 'bb_followup_10', 'BB Followup 10',
    'coach_pack', 'none', 65, 10, 10000, true, 'pt_fixed', 10,
    '{"weight_training":10,"relaxation":0,"reformer_pilates":0}'::jsonb,
    true
  );

  insert into public.trial_bookings (
    id, tenant_id, name, phone, service, preferred_time, payment_method, payment_status,
    amount, currency, source, booking_status, member_id, appointment_date,
    appointment_time, booking_coach
  ) values
  (
    test_trial_id, test_tenant_id, 'BB Followup Trial', '0918999501', 'weight_training',
    'weekday_morning', 'cash_on_site', 'pending_cash', 880, 'TWD', 'website',
    'completed', test_member_id, '2026-08-01', '10:00', 'BB Manager'
  ),
  (
    test_ineligible_trial_id, test_tenant_id, 'BB Ineligible Trial', '0918999501', 'weight_training',
    'weekday_morning', 'cash_on_site', 'pending_cash', 880, 'TWD', 'website',
    'scheduled', test_member_id, null, null, null
  );

  select scheduled_at into first_scheduled_at
  from public.trial_bookings
  where id = test_trial_id;
  if first_scheduled_at is null then
    raise exception 'first successful FA scheduling time was not captured';
  end if;
  update public.trial_bookings
  set booking_coach = 'BB Manager', appointment_time = '10:30'
  where id = test_trial_id;
  if (select scheduled_at from public.trial_bookings where id = test_trial_id)
     is distinct from first_scheduled_at then
    raise exception 'rescheduling changed the first successful FA scheduling time';
  end if;

  insert into public.bookings (
    id, tenant_id, branch_id, member_id, coach_id, service_name,
    starts_at, ends_at, status, is_bige_schedule, operation_kind, course_type,
    trial_stage, trial_booking_id, trial_conversion_outcome, operation_result,
    completed_at, operation_idempotency_key
  ) values (
    test_original_fa_id, test_tenant_id, test_branch_id, test_member_id, test_manager_id,
    '重量訓練 FA1', '2026-08-01 10:00:00+08', '2026-08-01 12:00:00+08',
    'completed', true, 'trial', 'weight_training', 'FA1', test_trial_id,
    'not_converted', 'completed', '2026-08-01 12:00:00+08',
    'test:bb-followup:original-fa'
  );

  perform set_config('request.jwt.claim.sub', test_manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  created_result := public.bige_create_bb_schedule_booking_v1(
    test_tenant_id, test_branch_id, test_trial_id, test_manager_id,
    '2099-01-05 10:00:00+08', '2099-01-05 11:00:00+08',
    'BB regression test', 'test:bb-followup:create'
  );
  bb_booking_id := (created_result->>'bookingId')::uuid;

  if coalesce((created_result->>'replayed')::boolean, true) then
    raise exception 'first BB schedule creation was unexpectedly replayed';
  end if;
  if not exists (
    select 1 from public.bookings booking
    where booking.id = bb_booking_id
      and booking.operation_kind = 'bb'
      and booking.service_name = 'BB 回訪'
      and booking.member_id = test_member_id
      and booking.trial_booking_id = test_trial_id
      and booking.coach_id = test_manager_id
      and booking.course_type is null
      and booking.trial_stage is null
      and booking.bb_conversion_outcome is null
      and extract(epoch from (booking.ends_at - booking.starts_at)) / 60 = 60
  ) then
    raise exception 'BB schedule shape or original FA binding is incorrect';
  end if;

  replay_result := public.bige_create_bb_schedule_booking_v1(
    test_tenant_id, test_branch_id, test_trial_id, test_manager_id,
    '2099-01-05 10:00:00+08', '2099-01-05 11:00:00+08',
    'BB regression test', 'test:bb-followup:create'
  );
  if not coalesce((replay_result->>'replayed')::boolean, false)
     or (replay_result->>'bookingId')::uuid is distinct from bb_booking_id then
    raise exception 'BB schedule idempotency did not replay the original booking';
  end if;

  begin
    perform public.bige_create_bb_schedule_booking_v1(
      test_tenant_id, test_branch_id, test_trial_id, test_manager_id,
      '2099-01-06 10:00:00+08', '2099-01-06 11:00:00+08',
      null, 'test:bb-followup:duplicate-active'
    );
    raise exception 'a second active BB for the same FA unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'bb_active_followup_exists' then raise; end if;
  end;

  begin
    perform public.bige_create_bb_schedule_booking_v1(
      test_tenant_id, test_branch_id, test_trial_id, test_manager_id,
      '2099-01-06 10:00:00+08', '2099-01-06 10:45:00+08',
      null, 'test:bb-followup:invalid-duration'
    );
    raise exception 'invalid BB duration unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'invalid_bb_duration' then raise; end if;
  end;

  begin
    perform public.bige_create_bb_schedule_booking_v1(
      test_tenant_id, test_branch_id, test_ineligible_trial_id, test_manager_id,
      '2099-01-07 10:00:00+08', '2099-01-07 11:00:00+08',
      null, 'test:bb-followup:ineligible-source'
    );
    raise exception 'BB without a completed non-converted FA unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'bb_completed_non_converted_fa_required' then raise; end if;
  end;

  perform public.bige_complete_bb_outcome_v1(bb_booking_id, 'not_converted');
  if not exists (
    select 1 from public.bookings booking
    where booking.id = bb_booking_id
      and booking.status = 'completed'
      and booking.operation_result = 'completed'
      and booking.bb_conversion_outcome = 'not_converted'
      and booking.converted_at is null
      and booking.converted_contract_id is null
  ) then
    raise exception 'completed BB no-sale result was not stored separately';
  end if;

  perform public.bige_restore_bb_no_sale_v1(bb_booking_id);
  if not exists (
    select 1 from public.bookings booking
    where booking.id = bb_booking_id
      and booking.status = 'booked'
      and booking.operation_result is null
      and booking.bb_conversion_outcome is null
      and booking.completed_at is null
  ) then
    raise exception 'BB no-sale correction did not restore the pending result';
  end if;
  perform public.bige_complete_bb_outcome_v1(bb_booking_id, 'not_converted');

  contract_result := public.bige_create_bb_member_contract_v1(
    test_tenant_id, test_branch_id, test_member_id, bb_booking_id,
    'BB Followup Member', '0918999501', '1990-01-01',
    'bb-followup-member@test.local', false, 'builtin', test_plan_id, null,
    current_date, '123456', 5000,
    '[{"amount":5000,"method":"cash"}]'::jsonb,
    '[]'::jsonb
  );
  bb_contract_id := (contract_result->>'contractId')::uuid;

  if not exists (
    select 1 from public.bookings booking
    where booking.id = bb_booking_id
      and booking.status = 'completed'
      and booking.operation_result = 'completed'
      and booking.bb_conversion_outcome = 'converted'
      and booking.converted_at is not null
      and booking.converted_contract_id = bb_contract_id
  ) or not exists (
    select 1 from public.member_plan_contracts contract
    where contract.id = bb_contract_id
      and contract.member_id = test_member_id
      and contract.source_trial_booking_id = test_trial_id
      and contract.converted_from_booking_id = bb_booking_id
      and contract.sales_origin_coach_id = test_manager_id
      and contract.sales_origin_kind = 'bb'
  ) or not exists (
    select 1 from public.bige_contract_payments payment
    where payment.contract_id = bb_contract_id
      and payment.source_booking_id = bb_booking_id
      and payment.amount = 5000
      and payment.method = 'cash'
      and payment.status = 'recorded'
  ) then
    raise exception 'BB conversion did not require and link the formal contract payment flow';
  end if;

  if exists (
    select 1 from public.staff_epo_awards award
    where award.tenant_id = test_tenant_id
      and award.calculation->>'sourceBookingId' = bb_booking_id::text
  ) then
    raise exception 'BB visit unexpectedly produced EPO';
  end if;

  begin
    perform public.bige_create_bb_schedule_booking_v1(
      test_tenant_id, test_branch_id, test_trial_id, test_manager_id,
      '2099-01-08 10:00:00+08', '2099-01-08 11:00:00+08',
      null, 'test:bb-followup:after-conversion'
    );
    raise exception 'a BB after conversion unexpectedly succeeded';
  exception
    when others then
      if sqlerrm <> 'bb_source_already_converted' then raise; end if;
  end;

  update public.bige_contract_payments
  set status = 'voided', voided_by = test_manager_id, voided_at = now(),
      void_reason = 'BB lifecycle regression setup'
  where contract_id = bb_contract_id;
  update public.member_plan_contracts
  set unlocked_sessions = 0, remaining_sessions = 0, payment_status = 'unpaid'
  where id = bb_contract_id;

  perform public.bige_restore_bb_conversion_v1(bb_booking_id);
  if not exists (
    select 1 from public.bookings booking
    where booking.id = bb_booking_id
      and booking.status = 'completed'
      and booking.bb_conversion_outcome = 'not_converted'
      and booking.converted_at is null
      and booking.converted_contract_id is null
  ) or not exists (
    select 1 from public.member_plan_contracts contract
    where contract.id = bb_contract_id
      and contract.status = 'canceled'
      and contract.unlocked_sessions = 0
      and contract.remaining_sessions = 0
  ) then
    raise exception 'BB conversion correction did not close the contract and restore no-sale';
  end if;

  created_result := public.bige_create_bb_schedule_booking_v1(
    test_tenant_id, test_branch_id, test_trial_id, test_manager_id,
    '2099-01-09 10:00:00+08', '2099-01-09 11:00:00+08',
    null, 'test:bb-followup:after-restored-conversion'
  );
  if not exists (
    select 1 from public.bookings booking
    where booking.id = (created_result->>'bookingId')::uuid
      and booking.status = 'booked'
      and booking.operation_kind = 'bb'
  ) then
    raise exception 'BB source did not reopen after an audited conversion correction';
  end if;
end;
$$;

rollback;
