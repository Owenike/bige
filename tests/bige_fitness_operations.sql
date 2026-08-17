begin;

do $$
<<test_block>>
declare
  tenant_id uuid := '10000000-0000-4000-8000-000000000001';
  branch_id uuid := '20000000-0000-4000-8000-000000000001';
  manager_id uuid := '30000000-0000-4000-8000-000000000001';
  coach_a uuid := '30000000-0000-4000-8000-000000000002';
  coach_b uuid := '30000000-0000-4000-8000-000000000003';
  coach_c uuid := '30000000-0000-4000-8000-000000000004';
  member_a uuid := '40000000-0000-4000-8000-000000000001';
  member_b uuid := '40000000-0000-4000-8000-000000000002';
  member_c uuid := '40000000-0000-4000-8000-000000000003';
  member_d uuid := '40000000-0000-4000-8000-000000000004';
  member_e uuid := '40000000-0000-4000-8000-000000000005';
  plan_id uuid := '50000000-0000-4000-8000-000000000001';
  contract_result jsonb;
  payment_result jsonb;
  schedule_start timestamptz := ((current_date + 1)::timestamp + time '09:00') at time zone 'Asia/Taipei';
  contract_id uuid;
  test_booking_id uuid;
  reschedule_booking_id uuid;
  reschedule_result jsonb;
  completion_result jsonb;
  extension_result jsonb;
  reversal_result jsonb;
  redemption_count integer;
  contract_row public.member_plan_contracts%rowtype;
  member_row public.members%rowtype;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (manager_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (coach_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach-a@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (coach_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach-b@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (coach_c, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach-c@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.tenants (id, name, status)
  values (tenant_id, 'BIG E TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'TEST BRANCH', 'TEST', true);

  insert into public.profiles (id, tenant_id, branch_id, role, display_name, is_active)
  values
    (manager_id, tenant_id, branch_id, 'manager', 'Manager', true),
    (coach_a, tenant_id, branch_id, 'coach', 'Coach A', true),
    (coach_b, tenant_id, branch_id, 'coach', 'Coach B', true),
    (coach_c, tenant_id, branch_id, 'coach', 'Coach C', true);

  insert into public.members (id, tenant_id, store_id, full_name, phone, email, birth_date, status)
  values
    (member_a, tenant_id, branch_id, 'Member A', '0911000001', 'a@test.local', '1990-01-01', 'active'),
    (member_b, tenant_id, branch_id, 'Member B', '0911000002', 'b@test.local', '1990-01-02', 'active'),
    (member_c, tenant_id, branch_id, 'Member C', '0911000003', 'c@test.local', '1990-01-03', 'active'),
    (member_d, tenant_id, branch_id, 'Member D', '0911000004', 'd@test.local', '1990-01-04', 'active'),
    (member_e, tenant_id, branch_id, 'Member E', '0911000005', 'e@test.local', '1990-01-05', 'active');

  insert into public.member_plan_catalog (
    id, tenant_id, branch_id, code, name, plan_type, fulfillment_kind,
    default_duration_days, default_quantity, price_amount, is_active,
    fitness_plan_kind, total_sessions, course_allocations, fitness_visible
  )
  values (
    plan_id, tenant_id, branch_id, 'pt_36', '36 Sessions', 'coach_pack', 'none',
    156, 36, 53568, true,
    'pt_fixed', 36,
    '{"weight_training":20,"relaxation":8,"reformer_pilates":8}'::jsonb,
    true
  );

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_a, null, coach_a, 'pt', 'weight_training',
    schedule_start, schedule_start + interval '1 hour', null, null, 'test:coach-capacity:1'
  );
  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_b, null, coach_b, 'pt', 'weight_training',
    schedule_start, schedule_start + interval '1 hour', null, null, 'test:coach-capacity:2'
  );
  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_c, null, coach_c, 'pt', 'weight_training',
    schedule_start, schedule_start + interval '1 hour', null, null, 'test:coach-capacity:3'
  );

  if (
    select count(*)
    from public.bookings booking
    where booking.tenant_id = test_block.tenant_id
      and booking.starts_at = schedule_start
      and booking.course_type = 'weight_training'
  ) <> 3 then
    raise exception 'weight training should allow multiple coaches in one time slot';
  end if;

  if (
    select count(*)
    from public.bookings booking
    where booking.tenant_id = test_block.tenant_id
      and booking.coach_id = coach_a
      and booking.starts_at = schedule_start
  ) <> 1 then
    raise exception 'one coach should have only one member in one time slot';
  end if;

  begin
    perform public.bige_create_schedule_booking(
      tenant_id, branch_id, member_d, null, coach_a, 'pt', 'weight_training',
      schedule_start, schedule_start + interval '1 hour', null, null, 'test:coach-capacity:blocked'
    );
  exception
    when unique_violation then
      if sqlerrm <> 'schedule_time_overlap' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from public.bookings
    where operation_idempotency_key = 'test:coach-capacity:blocked'
  ) then
    raise exception 'one coach must not accept a second member in the same time slot';
  end if;

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_c, null, coach_a, 'pt', 'weight_training',
    schedule_start + interval '1 hour', schedule_start + interval '2 hours', null, null, 'test:reschedule-source'
  );

  select id into reschedule_booking_id
  from public.bookings
  where operation_idempotency_key = 'test:reschedule-source';

  reschedule_result := public.bige_reschedule_schedule_booking(
    reschedule_booking_id,
    branch_id,
    coach_b,
    'weight_training',
    schedule_start + interval '5 hours',
    schedule_start + interval '6 hours',
    'Rescheduled safely'
  );
  if coalesce((reschedule_result->>'rescheduled')::boolean, false) is not true then
    raise exception 'reschedule did not complete';
  end if;
  if not exists (
    select 1
    from public.bookings
    where id = reschedule_booking_id
      and coach_id = coach_b
      and starts_at = schedule_start + interval '5 hours'
      and note = 'Rescheduled safely'
  ) then
    raise exception 'reschedule did not persist the new slot';
  end if;

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_d, null, coach_b, 'pt', 'reformer_pilates',
    schedule_start + interval '2 hours', schedule_start + interval '3 hours', null, null, 'test:shared-capacity:1'
  );
  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_e, null, coach_a, 'pt', 'relaxation',
    schedule_start + interval '2 hours', schedule_start + interval '3 hours', null, null, 'test:shared-capacity:2'
  );

  reschedule_result := public.bige_create_schedule_booking(
    tenant_id, branch_id, member_a, null, coach_c, 'pt', 'relaxation',
    schedule_start + interval '2 hours', schedule_start + interval '3 hours', null, null, 'test:classroom-conflict:3'
  );
  if not coalesce(reschedule_result->'warnings', '[]'::jsonb) @>
    '[{"code":"classroom_conflict"}]'::jsonb then
    raise exception 'third classroom booking should succeed with a classroom_conflict warning';
  end if;

  contract_result := public.bige_create_member_contract(
    tenant_id, branch_id, member_a, null,
    'Member A', '0911000001', '1990-01-01', 'a@test.local', false,
    plan_id, current_date, '123456', 1488, 'cash', '[]'::jsonb, 'none'
  );
  contract_id := (contract_result->>'contractId')::uuid;

  select * into contract_row from public.member_plan_contracts where id = contract_id;
  select * into member_row from public.members where id = member_a;

  if member_row.member_code !~ '^E[0-9]{6}$' then
    raise exception 'unexpected member code: %', member_row.member_code;
  end if;
  if contract_row.unlocked_sessions <> 1 then
    raise exception 'initial payment should unlock one session';
  end if;
  if contract_row.extension_limit_days <> 63 then
    raise exception '36-session extension limit should be 63 days';
  end if;
  if ((contract_row.ends_at at time zone 'Asia/Taipei')::date - contract_row.signed_on) <> 156 then
    raise exception '36-session validity should be 156 days';
  end if;

  payment_result := public.bige_record_contract_payment(
    contract_id, null, 'installment', 1000, 'cash', now(), 'test:payment:1', null
  );
  if (payment_result->>'unlockedSessions')::integer <> 1 then
    raise exception 'sub-threshold payment must not unlock another session';
  end if;

  payment_result := public.bige_record_contract_payment(
    contract_id, null, 'installment', 500, 'cash', now(), 'test:payment:2', null
  );
  if (payment_result->>'unlockedSessions')::integer <> 2 then
    raise exception 'cumulative payment should unlock the second session';
  end if;

  select id into test_booking_id
  from public.bookings
  where operation_idempotency_key = 'test:coach-capacity:1';

  update public.bookings
  set starts_at = now() - interval '15 minutes',
      ends_at = now() + interval '15 minutes',
      status = 'booked'
  where id = test_booking_id;

  completion_result := public.bige_complete_schedule_booking(test_booking_id, '123456');
  if coalesce((completion_result->>'completed')::boolean, false) is not true then
    raise exception 'PIN completion did not complete';
  end if;

  completion_result := public.bige_complete_schedule_booking(test_booking_id, '123456');
  if coalesce((completion_result->>'replayed')::boolean, false) is not true then
    raise exception 'duplicate completion should replay';
  end if;

  select count(*) into redemption_count
  from public.session_redemptions
  where booking_id = test_booking_id;
  if redemption_count <> 1 then
    raise exception 'booking must have exactly one redemption';
  end if;

  update public.member_plan_contracts
  set ends_at = ((current_date + 21)::timestamp at time zone 'Asia/Taipei')
  where id = contract_id;

  extension_result := public.bige_extend_contract(
    contract_id,
    10,
    'Test extension',
    'test/signature.png',
    'Member acknowledges extension',
    'Member A',
    now()
  );
  if (extension_result->>'cumulativeExtensionDays')::integer <> 10 then
    raise exception 'extension cumulative days incorrect';
  end if;

  for payment_result in
    select to_jsonb(p)
    from public.bige_contract_payments p
    where p.contract_id = contract_row.id
    order by p.paid_at desc, p.created_at desc
  loop
    reversal_result := public.bige_reverse_contract_payment(
      (payment_result->>'id')::uuid,
      'refund',
      'Test refund'
    );
  end loop;

  if reversal_result->>'contractStatus' <> 'frozen' then
    raise exception 'contract should freeze when used sessions exceed refunded unlock';
  end if;
end;
$$;

rollback;
