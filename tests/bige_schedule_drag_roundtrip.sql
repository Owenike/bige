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
  source_fa_slot timestamptz := ((current_date + 3)::timestamp + time '09:00') at time zone 'Asia/Taipei';
  target_pair_slot timestamptz := ((current_date + 3)::timestamp + time '11:00') at time zone 'Asia/Taipei';
  leading_fa_source_slot timestamptz := ((current_date + 3)::timestamp + time '13:00') at time zone 'Asia/Taipei';
  leading_fa_target_slot timestamptz := ((current_date + 3)::timestamp + time '19:00') at time zone 'Asia/Taipei';
  booking_a_id uuid;
  booking_b_id uuid;
  cancelled_source_fa_id uuid;
  source_fa_id uuid;
  cancelled_target_a_id uuid;
  cancelled_target_b_id uuid;
  target_a_id uuid;
  target_b_id uuid;
  leading_fa_id uuid;
  following_target_id uuid;
  first_swap jsonb;
  second_swap jsonb;
  undo_swap jsonb;
  deleted_slot_move jsonb;
  cancelled_history_swap jsonb;
  leading_fa_move jsonb;
  leading_fa_undo jsonb;
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

  -- Match the schedule trash flow: the row remains available for history and
  -- restore, but disappears from the board and must no longer occupy its slot.
  update public.bookings
  set status = 'cancelled',
      operation_result = 'cancelled',
      status_reason = 'schedule_trash_deleted',
      cancelled_at = now(),
      status_updated_at = now(),
      updated_at = now()
  where id = booking_b_id;

  deleted_slot_move := public.bige_drag_schedule_booking(
    tenant_id, booking_a_id, coach_a_id, slot_a, 'move'
  );

  if not exists (
    select 1 from public.bookings
    where id = booking_a_id
      and coach_id = coach_a_id
      and starts_at = slot_a
      and status = 'booked'
      and is_bige_schedule = true
  ) then
    raise exception 'booking did not move into the trash-deleted slot';
  end if;

  if not exists (
    select 1 from public.bookings
    where id = booking_b_id
      and coach_id = coach_a_id
      and starts_at = slot_a
      and status = 'cancelled'
      and status_reason = 'schedule_trash_deleted'
      and is_bige_schedule = true
  ) then
    raise exception 'trash-deleted booking history was not preserved';
  end if;

  if deleted_slot_move ->> 'mode' <> 'move'
     or (deleted_slot_move ->> 'movedCount')::integer <> 1 then
    raise exception 'deleted-slot move result metadata is incomplete';
  end if;

  begin
    perform public.bige_restore_cancelled_schedule_booking(booking_b_id);
    raise exception 'restoring into the newly occupied slot should remain blocked';
  exception
    when unique_violation then
      if sqlerrm not in ('schedule_time_overlap', 'schedule_cell_occupied') then
        raise;
      end if;
  end;

  begin
    perform public.bige_create_schedule_booking(
      tenant_id, branch_id, member_b_id, null, coach_a_id,
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

  -- Reproduce the production failure: cancelled historical rows share the
  -- source and target cells with one active two-hour FA and two active PTs.
  -- They must remain stored for history without entering the swap window.
  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_b_id, null, coach_a_id,
    'trial', 'reformer_pilates', source_fa_slot, source_fa_slot + interval '2 hours',
    null, null, 'test:drag-roundtrip:cancelled-source-fa'
  );
  select id into cancelled_source_fa_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:cancelled-source-fa';
  update public.bookings
  set status = 'cancelled',
      operation_result = 'cancelled',
      status_reason = null,
      cancelled_at = now(),
      status_updated_at = now(),
      updated_at = now()
  where id = cancelled_source_fa_id;

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_a_id, null, coach_a_id,
    'trial', 'reformer_pilates', source_fa_slot, source_fa_slot + interval '2 hours',
    null, null, 'test:drag-roundtrip:active-source-fa'
  );
  select id into source_fa_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:active-source-fa';

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_a_id, null, coach_b_id,
    'pt', 'weight_training', target_pair_slot, target_pair_slot + interval '1 hour',
    null, null, 'test:drag-roundtrip:cancelled-target-a'
  );
  select id into cancelled_target_a_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:cancelled-target-a';
  update public.bookings
  set status = 'cancelled',
      operation_result = 'cancelled',
      status_reason = null,
      cancelled_at = now(),
      status_updated_at = now(),
      updated_at = now()
  where id = cancelled_target_a_id;

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_b_id, null, coach_b_id,
    'pt', 'weight_training', target_pair_slot, target_pair_slot + interval '1 hour',
    null, null, 'test:drag-roundtrip:cancelled-target-b'
  );
  select id into cancelled_target_b_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:cancelled-target-b';
  update public.bookings
  set status = 'cancelled',
      operation_result = 'cancelled',
      status_reason = null,
      cancelled_at = now(),
      status_updated_at = now(),
      updated_at = now()
  where id = cancelled_target_b_id;

  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_a_id, null, coach_b_id,
    'pt', 'weight_training', target_pair_slot, target_pair_slot + interval '1 hour',
    null, null, 'test:drag-roundtrip:active-target-a'
  );
  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_b_id, null, coach_b_id,
    'pt', 'reformer_pilates', target_pair_slot + interval '1 hour', target_pair_slot + interval '2 hours',
    null, null, 'test:drag-roundtrip:active-target-b'
  );
  select id into target_a_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:active-target-a';
  select id into target_b_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:active-target-b';

  cancelled_history_swap := public.bige_drag_schedule_booking(
    tenant_id, source_fa_id, coach_b_id, target_pair_slot, 'swap'
  );

  if not exists (
    select 1 from public.bookings
    where id = source_fa_id
      and coach_id = coach_b_id
      and starts_at = target_pair_slot
      and ends_at = target_pair_slot + interval '2 hours'
      and status = 'booked'
  ) or not exists (
    select 1 from public.bookings
    where id = target_a_id
      and coach_id = coach_a_id
      and starts_at = source_fa_slot
      and status = 'booked'
  ) or not exists (
    select 1 from public.bookings
    where id = target_b_id
      and coach_id = coach_a_id
      and starts_at = source_fa_slot + interval '1 hour'
      and status = 'booked'
  ) then
    raise exception 'cancelled history prevented the active FA/PT swap';
  end if;

  if exists (
    select 1 from public.bookings
    where id in (cancelled_source_fa_id, cancelled_target_a_id, cancelled_target_b_id)
      and (
        status <> 'cancelled'
        or (id = cancelled_source_fa_id and (coach_id <> coach_a_id or starts_at <> source_fa_slot))
        or (id in (cancelled_target_a_id, cancelled_target_b_id)
            and (coach_id <> coach_b_id or starts_at <> target_pair_slot))
      )
  ) then
    raise exception 'cancelled booking history changed during the active swap';
  end if;

  if cancelled_history_swap ->> 'mode' <> 'swap'
     or (cancelled_history_swap ->> 'movedCount')::integer <> 3
     or (cancelled_history_swap ->> 'cancelledCount')::integer <> 0 then
    raise exception 'cancelled-history swap result metadata is incomplete';
  end if;

  -- An FA dropped into an empty 19:00 cell keeps its two-hour record, but the
  -- coach's existing 20:00 class remains in place and outside the move set.
  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_a_id, null, coach_a_id,
    'trial', 'reformer_pilates', leading_fa_source_slot,
    leading_fa_source_slot + interval '2 hours',
    null, null, 'test:drag-roundtrip:leading-fa'
  );
  perform public.bige_create_schedule_booking(
    tenant_id, branch_id, member_b_id, null, coach_b_id,
    'pt', 'weight_training', leading_fa_target_slot + interval '1 hour',
    leading_fa_target_slot + interval '2 hours',
    null, null, 'test:drag-roundtrip:following-target'
  );
  select id into leading_fa_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:leading-fa';
  select id into following_target_id from public.bookings
  where operation_idempotency_key = 'test:drag-roundtrip:following-target';

  leading_fa_move := public.bige_drag_schedule_booking(
    tenant_id, leading_fa_id, coach_b_id, leading_fa_target_slot, 'move'
  );

  if not exists (
    select 1 from public.bookings
    where id = leading_fa_id
      and coach_id = coach_b_id
      and starts_at = leading_fa_target_slot
      and ends_at = leading_fa_target_slot + interval '2 hours'
      and status = 'booked'
      and is_bige_schedule = true
  ) then
    raise exception 'FA did not move into the empty leading hour';
  end if;
  if not exists (
    select 1 from public.bookings
    where id = following_target_id
      and coach_id = coach_b_id
      and starts_at = leading_fa_target_slot + interval '1 hour'
      and status = 'booked'
      and is_bige_schedule = true
  ) then
    raise exception 'FA move changed the following-hour booking';
  end if;
  if leading_fa_move ->> 'mode' <> 'move'
     or (leading_fa_move ->> 'movedCount')::integer <> 1
     or (leading_fa_move ->> 'cancelledCount')::integer <> 0
     or jsonb_array_length(leading_fa_move -> 'items') <> 1 then
    raise exception 'leading FA move included the following-hour booking';
  end if;

  leading_fa_undo := public.bige_undo_schedule_booking_move(
    tenant_id, (leading_fa_move ->> 'operationId')::uuid
  );
  if not exists (
    select 1 from public.bookings
    where id = leading_fa_id
      and coach_id = coach_a_id
      and starts_at = leading_fa_source_slot
      and ends_at = leading_fa_source_slot + interval '2 hours'
  ) or not exists (
    select 1 from public.bookings
    where id = following_target_id
      and coach_id = coach_b_id
      and starts_at = leading_fa_target_slot + interval '1 hour'
  ) then
    raise exception 'undo did not restore only the FA';
  end if;
  if leading_fa_undo ->> 'originalOperationId' <> leading_fa_move ->> 'operationId' then
    raise exception 'leading FA undo metadata is incomplete';
  end if;
end;
$$;

rollback;
