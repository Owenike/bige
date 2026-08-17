begin;

do $$
<<test_block>>
declare
  tenant_id uuid := '12000000-0000-4000-8000-000000000001';
  branch_id uuid := '22000000-0000-4000-8000-000000000001';
  manager_id uuid := '32000000-0000-4000-8000-000000000001';
  coach_a_id uuid := '32000000-0000-4000-8000-000000000002';
  coach_b_id uuid := '32000000-0000-4000-8000-000000000003';
  member_a_id uuid := '42000000-0000-4000-8000-000000000001';
  member_b_id uuid := '42000000-0000-4000-8000-000000000002';
  slot_a timestamptz := ((current_date + 3)::timestamp + time '15:00') at time zone 'Asia/Taipei';
  slot_b timestamptz := ((current_date + 3)::timestamp + time '17:00') at time zone 'Asia/Taipei';
  booking_a_id uuid;
  booking_b_id uuid;
  first_swap jsonb;
  second_swap jsonb;
  undo_swap jsonb;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  )
  values
    (manager_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'drag-roundtrip-manager@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (coach_a_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'drag-roundtrip-a@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (coach_b_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'drag-roundtrip-b@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.tenants (id, name, status)
  values (tenant_id, 'BIG E DRAG ROUNDTRIP TEST', 'active');

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (branch_id, tenant_id, 'DRAG ROUNDTRIP TEST', 'DRT', true);

  insert into public.profiles (
    id, tenant_id, branch_id, role, display_name, is_active, department, position
  )
  values
    (manager_id, tenant_id, branch_id, 'manager', 'Drag Roundtrip Manager', true, null, null),
    (coach_a_id, tenant_id, branch_id, 'coach', 'Coach A', true, 'coaching', 'coach'),
    (coach_b_id, tenant_id, branch_id, 'coach', 'Coach B', true, 'coaching', 'coach');

  insert into public.members (
    id, tenant_id, store_id, full_name, phone, email, birth_date, status
  )
  values
    (member_a_id, tenant_id, branch_id, 'Drag Member A', '0911888801', 'drag-member-a@test.local', '1990-01-01', 'active'),
    (member_b_id, tenant_id, branch_id, 'Drag Member B', '0911888802', 'drag-member-b@test.local', '1990-01-02', 'active');

  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_a_id, null, coach_a_id,
    'pt', 'weight_training', slot_a, slot_a + interval '1 hour',
    null, null, 'test:drag-roundtrip:a'
  );
  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_b_id, null, coach_b_id,
    'pt', 'weight_training', slot_b, slot_b + interval '1 hour',
    null, null, 'test:drag-roundtrip:b'
  );

  select id into booking_a_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:a';
  select id into booking_b_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:b';

  first_swap := public.bige_drag_schedule_booking(
    tenant_id, booking_a_id, coach_b_id, slot_b, 'swap'
  );

  if not exists (
    select 1 from public.bookings
    where id = booking_a_id and coach_id = coach_b_id and starts_at = slot_b
  ) or not exists (
    select 1 from public.bookings
    where id = booking_b_id and coach_id = coach_a_id and starts_at = slot_a
  ) then
    raise exception 'first swap did not exchange both bookings';
  end if;

  second_swap := public.bige_drag_schedule_booking(
    tenant_id, booking_a_id, coach_a_id, slot_a, 'swap'
  );

  if not exists (
    select 1 from public.bookings
    where id = booking_a_id and coach_id = coach_a_id and starts_at = slot_a
  ) or not exists (
    select 1 from public.bookings
    where id = booking_b_id and coach_id = coach_b_id and starts_at = slot_b
  ) then
    raise exception 'second swap did not restore the original positions';
  end if;

  if exists (
    select 1 from public.bookings
    where id in (booking_a_id, booking_b_id)
      and (
        occupied_starts_at is not null
        or occupied_ends_at is not null
        or coach_conflict_scope is not null
      )
  ) then
    raise exception 'BIGE bookings retained stale coach occupancy after roundtrip';
  end if;

  undo_swap := public.bige_undo_schedule_booking_move(
    tenant_id, (second_swap ->> 'operationId')::uuid
  );

  if not exists (
    select 1 from public.bookings
    where id = booking_a_id and coach_id = coach_b_id and starts_at = slot_b
  ) or not exists (
    select 1 from public.bookings
    where id = booking_b_id and coach_id = coach_a_id and starts_at = slot_a
  ) then
    raise exception 'undo did not restore the pre-roundtrip swap';
  end if;

  if first_swap ->> 'mode' <> 'swap'
     or second_swap ->> 'mode' <> 'swap'
     or undo_swap ->> 'originalOperationId' <> second_swap ->> 'operationId' then
    raise exception 'drag or undo result metadata is incomplete';
  end if;

  begin
    perform public.bige_create_schedule_booking(
      tenant_id, branch_id, member_a_id, null, coach_a_id,
      'pt', 'weight_training', slot_a, slot_a + interval '1 hour',
      null, null, 'test:drag-roundtrip:true-conflict'
    );
    raise exception 'a real booking conflict should remain blocked';
  exception
    when unique_violation then
      if sqlerrm <> 'schedule_time_overlap' then
        raise;
      end if;
  end;
end;
$$;

rollback;
