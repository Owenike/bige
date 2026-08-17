begin;

create or replace function public.bige_drag_schedule_booking(
  p_tenant_id uuid,
  p_source_booking_id uuid,
  p_target_coach_id uuid,
  p_target_starts_at timestamptz,
  p_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  source_booking public.bookings%rowtype;
  target_coach public.profiles%rowtype;
  target_primary public.bookings%rowtype;
  target_anchor timestamptz;
  source_anchor timestamptz;
  source_window_end timestamptz;
  target_window_end timestamptz;
  local_day_end timestamptz;
  span_seconds numeric;
  expanded_span_seconds numeric;
  source_ids uuid[] := '{}'::uuid[];
  target_ids uuid[] := '{}'::uuid[];
  moving_ids uuid[] := '{}'::uuid[];
  all_affected_ids uuid[] := '{}'::uuid[];
  source_snapshot jsonb := '[]'::jsonb;
  target_snapshot jsonb := '[]'::jsonb;
  result_snapshot jsonb := '[]'::jsonb;
  operation_id uuid := gen_random_uuid();
  moved_count integer := 0;
  cancelled_count integer := 0;
begin
  if p_mode not in ('move', 'swap', 'overwrite') then
    raise exception 'invalid_schedule_move_mode';
  end if;

  select * into actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found then
    raise exception 'unauthorized';
  end if;

  if actor.role not in (
    'platform_admin',
    'manager',
    'supervisor',
    'branch_manager',
    'store_owner',
    'store_manager',
    'frontdesk'
  ) and not (
    actor.department = 'coaching'
    and actor.position in ('coach_manager', 'coach_city_manager', 'coach_assistant_manager')
  ) then
    raise exception 'schedule_drag_forbidden';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from p_tenant_id then
    raise exception 'forbidden';
  end if;

  select * into source_booking
  from public.bookings
  where id = p_source_booking_id
    and tenant_id = p_tenant_id
    and is_bige_schedule = true
  for update;

  if not found then
    raise exception 'schedule_booking_not_found';
  end if;

  if source_booking.status not in ('pending', 'confirmed', 'booked') then
    raise exception 'schedule_booking_locked';
  end if;

  if exists (
    select 1
    from public.session_redemptions redemption
    where redemption.booking_id = source_booking.id
  ) then
    raise exception 'schedule_booking_redeemed';
  end if;

  select * into target_coach
  from public.profiles
  where id = p_target_coach_id
    and tenant_id = p_tenant_id
    and is_active = true
    and (role in ('coach', 'therapist') or department = 'coaching');

  if not found then
    raise exception 'schedule_target_coach_not_found';
  end if;

  if actor.role = 'frontdesk'
     and actor.branch_id is not null
     and target_coach.branch_id is not null
     and target_coach.branch_id is distinct from actor.branch_id then
    raise exception 'branch_scope_denied';
  end if;

  source_anchor := source_booking.starts_at;
  target_anchor := p_target_starts_at;

  select * into target_primary
  from public.bookings booking
  where booking.tenant_id = p_tenant_id
    and booking.coach_id = p_target_coach_id
    and booking.is_bige_schedule = true
    and p_target_starts_at >= booking.starts_at
    and p_target_starts_at < booking.ends_at
  order by booking.starts_at, booking.created_at
  limit 1
  for update;

  if found then
    target_anchor := target_primary.starts_at;
  end if;

  if source_booking.coach_id = p_target_coach_id
     and target_anchor = source_anchor then
    raise exception 'schedule_move_same_slot';
  end if;

  if to_char(source_anchor at time zone 'Asia/Taipei', 'YYYY-MM-DD')
     <> to_char(target_anchor at time zone 'Asia/Taipei', 'YYYY-MM-DD') then
    raise exception 'schedule_move_same_day_only';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'bige-schedule-drag:' || p_tenant_id::text || ':' ||
      to_char(source_anchor at time zone 'Asia/Taipei', 'YYYY-MM-DD'),
      0
    )
  );

  if extract(minute from source_anchor at time zone 'Asia/Taipei')
     <> extract(minute from target_anchor at time zone 'Asia/Taipei') then
    raise exception 'schedule_move_alignment_mismatch';
  end if;

  if extract(minute from target_anchor at time zone 'Asia/Taipei') not in (0, 30)
     or extract(second from target_anchor at time zone 'Asia/Taipei') <> 0 then
    raise exception 'outside_business_hours';
  end if;

  if extract(hour from target_anchor at time zone 'Asia/Taipei') < 9 then
    raise exception 'outside_business_hours';
  end if;

  span_seconds := greatest(
    extract(epoch from (source_booking.ends_at - source_booking.starts_at)),
    case
      when target_primary.id is null then 0
      else extract(epoch from (target_primary.ends_at - target_primary.starts_at))
    end
  );

  -- Expand both sides together so a two-hour FA exchanges with every occupied
  -- slot in the matching two-hour window. Longer adjacent entries expand the
  -- window again instead of being split or partially overwritten.
  loop
    source_window_end := source_anchor + make_interval(secs => span_seconds::double precision);
    target_window_end := target_anchor + make_interval(secs => span_seconds::double precision);

    select greatest(
      span_seconds,
      coalesce(max(extract(epoch from (booking.ends_at - source_anchor))), 0)
    ) into expanded_span_seconds
    from public.bookings booking
    where booking.tenant_id = p_tenant_id
      and booking.coach_id = source_booking.coach_id
      and booking.is_bige_schedule = true
      and booking.starts_at >= source_anchor
      and booking.starts_at < source_window_end;

    select greatest(
      expanded_span_seconds,
      coalesce(max(extract(epoch from (booking.ends_at - target_anchor))), 0)
    ) into expanded_span_seconds
    from public.bookings booking
    where booking.tenant_id = p_tenant_id
      and booking.coach_id = p_target_coach_id
      and booking.is_bige_schedule = true
      and booking.starts_at >= target_anchor
      and booking.starts_at < target_window_end;

    exit when expanded_span_seconds <= span_seconds;
    span_seconds := expanded_span_seconds;
  end loop;

  source_window_end := source_anchor + make_interval(secs => span_seconds::double precision);
  target_window_end := target_anchor + make_interval(secs => span_seconds::double precision);
  local_day_end := (
    date_trunc('day', target_anchor at time zone 'Asia/Taipei') + interval '1 day'
  ) at time zone 'Asia/Taipei';

  if target_window_end > local_day_end or source_window_end > local_day_end then
    raise exception 'schedule_move_outside_day';
  end if;

  if exists (
    select 1
    from public.bige_schedule_notes note
    where note.tenant_id = p_tenant_id
      and btrim(coalesce(note.content, '')) not in ('早', '晚', '休')
      and (
        (
          note.coach_id = source_booking.coach_id
          and tstzrange(note.starts_at, note.ends_at, '[)')
            && tstzrange(source_anchor, source_window_end, '[)')
        )
        or (
          note.coach_id = p_target_coach_id
          and tstzrange(note.starts_at, note.ends_at, '[)')
            && tstzrange(target_anchor, target_window_end, '[)')
        )
      )
  ) then
    raise exception 'schedule_note_not_draggable';
  end if;

  if exists (
    select 1
    from public.bookings booking
    where booking.tenant_id = p_tenant_id
      and booking.is_bige_schedule = true
      and (
        (
          booking.coach_id = source_booking.coach_id
          and booking.starts_at >= source_anchor
          and booking.starts_at < source_window_end
        )
        or (
          booking.coach_id = p_target_coach_id
          and booking.starts_at >= target_anchor
          and booking.starts_at < target_window_end
        )
      )
      and (
        booking.status not in ('pending', 'confirmed', 'booked')
        or exists (
          select 1
          from public.session_redemptions redemption
          where redemption.booking_id = booking.id
        )
      )
  ) then
    raise exception 'schedule_booking_locked';
  end if;

  select
    coalesce(array_agg(booking.id order by booking.starts_at), '{}'::uuid[]),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', booking.id,
          'coachId', booking.coach_id,
          'startsAt', booking.starts_at,
          'endsAt', booking.ends_at,
          'status', booking.status
        ) order by booking.starts_at
      ),
      '[]'::jsonb
    )
  into source_ids, source_snapshot
  from public.bookings booking
  where booking.tenant_id = p_tenant_id
    and booking.coach_id = source_booking.coach_id
    and booking.is_bige_schedule = true
    and booking.starts_at >= source_anchor
    and booking.starts_at < source_window_end;

  select
    coalesce(array_agg(booking.id order by booking.starts_at), '{}'::uuid[]),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', booking.id,
          'coachId', booking.coach_id,
          'startsAt', booking.starts_at,
          'endsAt', booking.ends_at,
          'status', booking.status
        ) order by booking.starts_at
      ),
      '[]'::jsonb
    )
  into target_ids, target_snapshot
  from public.bookings booking
  where booking.tenant_id = p_tenant_id
    and booking.coach_id = p_target_coach_id
    and booking.is_bige_schedule = true
    and booking.starts_at >= target_anchor
    and booking.starts_at < target_window_end
    and not (booking.id = any(source_ids));

  if p_mode = 'move' and cardinality(target_ids) > 0 then
    raise exception 'schedule_move_conflict';
  end if;

  if p_mode in ('swap', 'overwrite') and cardinality(target_ids) = 0 then
    raise exception 'schedule_move_target_empty';
  end if;

  all_affected_ids := source_ids || target_ids;

  -- Temporarily remove affected rows from the live board. This makes the
  -- multi-row exchange compatible with the single-entry-cell trigger while
  -- retaining full transaction rollback on any later validation failure.
  update public.bookings
  set is_bige_schedule = false,
      updated_at = now()
  where id = any(all_affected_ids);

  if p_mode = 'overwrite' then
    update public.bookings
    set status = 'cancelled',
        operation_result = 'cancelled',
        status_reason = 'schedule_drag_overwrite',
        cancelled_at = coalesce(cancelled_at, now()),
        status_updated_at = now(),
        updated_at = now()
    where id = any(target_ids);
    cancelled_count := cardinality(target_ids);
  end if;

  update public.bookings
  set coach_id = p_target_coach_id,
      starts_at = starts_at + (target_anchor - source_anchor),
      ends_at = ends_at + (target_anchor - source_anchor),
      updated_at = now()
  where id = any(source_ids);

  moving_ids := source_ids;

  if p_mode = 'swap' then
    update public.bookings
    set coach_id = source_booking.coach_id,
        starts_at = starts_at + (source_anchor - target_anchor),
        ends_at = ends_at + (source_anchor - target_anchor),
        updated_at = now()
    where id = any(target_ids);
    moving_ids := source_ids || target_ids;
  end if;

  if exists (
    select 1
    from public.bookings left_booking
    join public.bookings right_booking
      on left_booking.coach_id = right_booking.coach_id
     and left_booking.id::text < right_booking.id::text
     and tstzrange(left_booking.starts_at, left_booking.ends_at, '[)')
       && tstzrange(right_booking.starts_at, right_booking.ends_at, '[)')
    where left_booking.id = any(moving_ids)
      and right_booking.id = any(moving_ids)
  ) then
    raise exception 'schedule_move_internal_conflict';
  end if;

  if exists (
    select 1
    from public.bookings moved
    join public.bookings existing
      on existing.tenant_id = moved.tenant_id
     and existing.coach_id = moved.coach_id
     and existing.is_bige_schedule = true
     and not (existing.id = any(all_affected_ids))
     and tstzrange(existing.starts_at, existing.ends_at, '[)')
       && tstzrange(moved.starts_at, moved.ends_at, '[)')
    where moved.id = any(moving_ids)
  ) then
    raise exception 'schedule_move_conflict';
  end if;

  if exists (
    select 1
    from public.bookings moved
    join public.bige_schedule_notes note
      on note.tenant_id = moved.tenant_id
     and btrim(coalesce(note.content, '')) not in ('早', '晚', '休')
     and note.coach_id = moved.coach_id
     and tstzrange(note.starts_at, note.ends_at, '[)')
       && tstzrange(moved.starts_at, moved.ends_at, '[)')
    where moved.id = any(moving_ids)
  ) then
    raise exception 'schedule_note_not_draggable';
  end if;

  update public.bookings
  set is_bige_schedule = true,
      updated_at = now()
  where id = any(moving_ids);

  moved_count := cardinality(moving_ids);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', booking.id,
        'coachId', booking.coach_id,
        'startsAt', booking.starts_at,
        'endsAt', booking.ends_at,
        'status', booking.status
      ) order by booking.starts_at
    ),
    '[]'::jsonb
  ) into result_snapshot
  from public.bookings booking
  where booking.id = any(all_affected_ids);

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    target_type,
    target_id,
    reason,
    payload
  ) values (
    p_tenant_id,
    actor.id,
    'bige_schedule_drag_' || p_mode,
    'schedule_operation',
    operation_id::text,
    null,
    jsonb_build_object(
      'operationId', operation_id,
      'sourceBookingId', source_booking.id,
      'mode', p_mode,
      'sourceCoachId', source_booking.coach_id,
      'sourceStartsAt', source_anchor,
      'targetCoachId', p_target_coach_id,
      'targetStartsAt', target_anchor,
      'sourceBefore', source_snapshot,
      'targetBefore', target_snapshot,
      'after', result_snapshot,
      'movedCount', moved_count,
      'cancelledCount', cancelled_count,
      'operatedAt', now()
    )
  );

  insert into public.audit_logs (
    tenant_id,
    actor_id,
    action,
    target_type,
    target_id,
    reason,
    payload
  )
  select
    p_tenant_id,
    actor.id,
    case
      when booking.status = 'cancelled' and not booking.is_bige_schedule
        then 'bige_schedule_booking_overwritten'
      else 'bige_schedule_booking_moved'
    end,
    'booking',
    booking.id::text,
    null,
    jsonb_build_object(
      'operationId', operation_id,
      'mode', p_mode,
      'coachId', booking.coach_id,
      'startsAt', booking.starts_at,
      'endsAt', booking.ends_at,
      'operatedAt', now()
    )
  from public.bookings booking
  where booking.id = any(all_affected_ids);

  return jsonb_build_object(
    'operationId', operation_id,
    'mode', p_mode,
    'movedCount', moved_count,
    'cancelledCount', cancelled_count,
    'items', result_snapshot
  );
end;
$$;

revoke all on function public.bige_drag_schedule_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text
) from public, anon;

grant execute on function public.bige_drag_schedule_booking(
  uuid,
  uuid,
  uuid,
  timestamptz,
  text
) to authenticated;

commit;
