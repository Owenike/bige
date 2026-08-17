begin;

-- Business rules:
--   * Weight-training groups have no per-coach head-count limit.
--   * Relaxation and reformer Pilates keep the historical two-room threshold,
--     but exceeding it is now a visible classroom warning rather than a write
--     rejection.
--   * One coach still cannot teach different course types at the same time.
create or replace function public.bige_create_schedule_booking(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_member_id uuid,
  p_trial_booking_id uuid,
  p_coach_id uuid,
  p_operation_kind text,
  p_course_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text,
  p_group_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  member_row public.members%rowtype;
  trial_row public.trial_bookings%rowtype;
  existing_booking public.bookings%rowtype;
  created_booking public.bookings%rowtype;
  local_start timestamp;
  local_end timestamp;
  local_day date;
  overlap_count integer;
  completed_trials integer;
  computed_stage text;
  normalized_phone text;
  group_course text;
  existing_group_id uuid;
  warnings jsonb := '[]'::jsonb;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk') then
    raise exception 'forbidden';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from p_tenant_id then
    raise exception 'forbidden';
  end if;

  if p_operation_kind not in ('pt', 'trial') then
    raise exception 'invalid_operation_kind';
  end if;

  if p_course_type not in ('weight_training', 'relaxation', 'reformer_pilates') then
    raise exception 'invalid_course_type';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_time_range';
  end if;

  local_start := p_starts_at at time zone 'Asia/Taipei';
  local_end := p_ends_at at time zone 'Asia/Taipei';
  local_day := local_start::date;

  if local_start::time < time '09:00'
     or local_end > (local_day + 1)::timestamp
     or extract(minute from local_start)::integer not in (0, 30)
     or extract(second from local_start)::integer <> 0
     or extract(minute from local_end)::integer not in (0, 30)
     or extract(second from local_end)::integer <> 0 then
    raise exception 'outside_business_hours';
  end if;

  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'idempotency_key_required';
  end if;

  select * into existing_booking
  from public.bookings
  where tenant_id = p_tenant_id
    and operation_idempotency_key = p_idempotency_key
  limit 1;

  if found then
    return jsonb_build_object(
      'bookingId', existing_booking.id,
      'memberId', existing_booking.member_id,
      'trialStage', existing_booking.trial_stage,
      'warnings', '[]'::jsonb,
      'replayed', true
    );
  end if;

  if p_operation_kind = 'trial' and p_member_id is null then
    if p_trial_booking_id is null then
      raise exception 'trial_source_required';
    end if;

    select * into trial_row
    from public.trial_bookings
    where id = p_trial_booking_id
    for update;

    if not found then
      raise exception 'trial_booking_not_found';
    end if;

    if trial_row.member_id is not null then
      p_member_id := trial_row.member_id;
    else
      normalized_phone := regexp_replace(coalesce(trial_row.phone, ''), '[^0-9]', '', 'g');

      select * into member_row
      from public.members
      where tenant_id = p_tenant_id
        and phone_normalized = normalized_phone
      order by created_at
      limit 1
      for update;

      if not found then
        insert into public.members (
          tenant_id, store_id, full_name, phone, phone_normalized, birth_date,
          lead_source, status, portal_status, is_prospect, email_unavailable
        ) values (
          p_tenant_id, p_branch_id, trial_row.name, trial_row.phone,
          normalized_phone, trial_row.birthday,
          coalesce(trial_row.source, 'trial_booking'), 'active',
          'pending_activation', true, true
        )
        returning * into member_row;
      end if;

      p_member_id := member_row.id;

      update public.trial_bookings
      set member_id = p_member_id,
          updated_at = now()
      where id = p_trial_booking_id;
    end if;
  end if;

  select * into member_row
  from public.members
  where id = p_member_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'member_not_found';
  end if;

  -- Lock order remains coach -> member -> classroom pool so concurrent writes
  -- cannot bypass group/type validation or report a stale warning count.
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_coach_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_member_id::text, 0));
  if p_course_type in ('relaxation', 'reformer_pilates') then
    perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':classroom', 0));
  end if;

  select min(course_type), min(group_id::text)::uuid
    into group_course, existing_group_id
  from public.bookings
  where tenant_id = p_tenant_id
    and coach_id = p_coach_id
    and is_bige_schedule = true
    and status in ('pending', 'confirmed', 'booked', 'checked_in')
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if group_course is not null and group_course <> p_course_type then
    raise exception 'group_course_type_mismatch';
  end if;

  if p_group_id is not null and exists (
    select 1
    from public.bookings
    where tenant_id = p_tenant_id
      and group_id = p_group_id
      and is_bige_schedule = true
      and course_type <> p_course_type
  ) then
    raise exception 'group_course_type_mismatch';
  end if;

  select count(*) into overlap_count
  from public.bookings
  where tenant_id = p_tenant_id
    and coach_id = p_coach_id
    and status in ('pending', 'confirmed', 'booked', 'checked_in')
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if p_course_type <> 'weight_training' and overlap_count >= 3 then
    raise exception 'coach_capacity_exceeded';
  end if;

  if exists (
    select 1
    from public.bookings
    where tenant_id = p_tenant_id
      and member_id = p_member_id
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'member_time_conflict';
  end if;

  if p_course_type in ('relaxation', 'reformer_pilates') then
    select count(*) into overlap_count
    from public.bookings
    where tenant_id = p_tenant_id
      and is_bige_schedule = true
      and course_type in ('relaxation', 'reformer_pilates')
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

    if overlap_count >= 2 then
      warnings := jsonb_build_array(jsonb_build_object(
        'code', 'classroom_conflict',
        'message', '放鬆／器械皮拉提斯教室時段重疊，請確認教室安排',
        'existingCount', overlap_count,
        'resultingCount', overlap_count + 1
      ));
    end if;
  end if;

  computed_stage := null;
  if p_operation_kind = 'trial' then
    select count(*) into completed_trials
    from public.bookings
    where member_id = p_member_id
      and is_bige_schedule = true
      and operation_kind = 'trial'
      and operation_result = 'completed';

    computed_stage := case
      when completed_trials = 0 then 'FA1'
      when completed_trials = 1 then 'FA2'
      else 'FAN'
    end;
  end if;

  insert into public.bookings (
    tenant_id, branch_id, member_id, coach_id, service_name, starts_at, ends_at,
    status, note, customer_name, customer_phone, source, payment_status,
    booking_payment_mode, created_by, is_bige_schedule, operation_kind,
    course_type, trial_stage, trial_booking_id, group_id,
    operation_idempotency_key, coach_conflict_scope, occupied_starts_at,
    occupied_ends_at
  ) values (
    p_tenant_id, p_branch_id, p_member_id, p_coach_id,
    case p_course_type
      when 'weight_training' then '重訓'
      when 'relaxation' then '放鬆'
      else '器械皮拉提斯'
    end,
    p_starts_at, p_ends_at, 'booked', nullif(btrim(coalesce(p_note, '')), ''),
    member_row.full_name, member_row.phone, 'staff', 'unpaid', 'package', actor.id,
    true, p_operation_kind, p_course_type, computed_stage, p_trial_booking_id,
    coalesce(p_group_id, existing_group_id, gen_random_uuid()), p_idempotency_key,
    null, null, null
  )
  returning * into created_booking;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id, actor.id, 'bige_schedule_booking_created', 'booking',
    created_booking.id::text, null,
    jsonb_build_object(
      'operationKind', p_operation_kind,
      'courseType', p_course_type,
      'trialStage', computed_stage,
      'coachId', p_coach_id,
      'memberId', p_member_id,
      'startsAt', p_starts_at,
      'endsAt', p_ends_at,
      'warnings', warnings
    )
  );

  return jsonb_build_object(
    'bookingId', created_booking.id,
    'memberId', created_booking.member_id,
    'trialStage', created_booking.trial_stage,
    'groupId', created_booking.group_id,
    'warnings', warnings,
    'replayed', false
  );
end;
$$;

create or replace function public.bige_reschedule_schedule_booking(
  p_booking_id uuid,
  p_branch_id uuid,
  p_coach_id uuid,
  p_course_type text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  target public.bookings%rowtype;
  local_start timestamp;
  local_end timestamp;
  local_day date;
  overlap_count integer;
  group_course text;
  existing_group_id uuid;
  warnings jsonb := '[]'::jsonb;
begin
  select * into actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk') then
    raise exception 'forbidden';
  end if;

  select * into target
  from public.bookings
  where id = p_booking_id
    and is_bige_schedule = true
  for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from target.tenant_id then
    raise exception 'forbidden';
  end if;

  if target.status not in ('pending', 'confirmed', 'booked', 'checked_in') then
    raise exception 'booking_not_reschedulable';
  end if;

  if p_course_type not in ('weight_training', 'relaxation', 'reformer_pilates') then
    raise exception 'invalid_course_type';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'invalid_time_range';
  end if;

  local_start := p_starts_at at time zone 'Asia/Taipei';
  local_end := p_ends_at at time zone 'Asia/Taipei';
  local_day := local_start::date;

  if local_start::time < time '09:00'
     or local_end > (local_day + 1)::timestamp
     or extract(minute from local_start)::integer not in (0, 30)
     or extract(second from local_start)::integer <> 0
     or extract(minute from local_end)::integer not in (0, 30)
     or extract(second from local_end)::integer <> 0 then
    raise exception 'outside_business_hours';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target.tenant_id::text || ':' || p_coach_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(target.tenant_id::text || ':' || target.member_id::text, 0));
  if p_course_type in ('relaxation', 'reformer_pilates') then
    perform pg_advisory_xact_lock(hashtextextended(target.tenant_id::text || ':classroom', 0));
  end if;

  select min(course_type), min(group_id::text)::uuid
    into group_course, existing_group_id
  from public.bookings
  where tenant_id = target.tenant_id
    and id <> target.id
    and coach_id = p_coach_id
    and is_bige_schedule = true
    and status in ('pending', 'confirmed', 'booked', 'checked_in')
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if group_course is not null and group_course <> p_course_type then
    raise exception 'group_course_type_mismatch';
  end if;

  select count(*) into overlap_count
  from public.bookings
  where tenant_id = target.tenant_id
    and id <> target.id
    and coach_id = p_coach_id
    and status in ('pending', 'confirmed', 'booked', 'checked_in')
    and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

  if p_course_type <> 'weight_training' and overlap_count >= 3 then
    raise exception 'coach_capacity_exceeded';
  end if;

  if exists (
    select 1
    from public.bookings
    where tenant_id = target.tenant_id
      and id <> target.id
      and member_id = target.member_id
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'member_time_conflict';
  end if;

  if p_course_type in ('relaxation', 'reformer_pilates') then
    select count(*) into overlap_count
    from public.bookings
    where tenant_id = target.tenant_id
      and id <> target.id
      and is_bige_schedule = true
      and course_type in ('relaxation', 'reformer_pilates')
      and status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)');

    if overlap_count >= 2 then
      warnings := jsonb_build_array(jsonb_build_object(
        'code', 'classroom_conflict',
        'message', '放鬆／器械皮拉提斯教室時段重疊，請確認教室安排',
        'existingCount', overlap_count,
        'resultingCount', overlap_count + 1
      ));
    end if;
  end if;

  update public.bookings
  set branch_id = coalesce(p_branch_id, branch_id),
      coach_id = p_coach_id,
      service_name = case p_course_type
        when 'weight_training' then '重訓'
        when 'relaxation' then '放鬆'
        else '器械皮拉提斯'
      end,
      course_type = p_course_type,
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      note = nullif(btrim(coalesce(p_note, '')), ''),
      group_id = coalesce(existing_group_id, gen_random_uuid()),
      updated_at = now()
  where id = target.id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    target.tenant_id, actor.id, 'bige_schedule_booking_rescheduled', 'booking',
    target.id::text, null,
    jsonb_build_object(
      'previousCoachId', target.coach_id,
      'coachId', p_coach_id,
      'previousStartsAt', target.starts_at,
      'startsAt', p_starts_at,
      'previousEndsAt', target.ends_at,
      'endsAt', p_ends_at,
      'previousCourseType', target.course_type,
      'courseType', p_course_type,
      'warnings', warnings
    )
  );

  return jsonb_build_object(
    'bookingId', target.id,
    'memberId', target.member_id,
    'trialStage', target.trial_stage,
    'groupId', coalesce(existing_group_id, target.group_id),
    'warnings', warnings,
    'rescheduled', true
  );
end;
$$;

-- Permit multiple same-course booking rows in one coach/time slot. Notes still
-- reserve the whole range, and mixed course types remain a hard conflict.
create or replace function public.enforce_bige_schedule_single_entry_cell()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cell_start timestamptz;
  cell_end timestamptz;
  lock_key text;
  overlap_count integer;
begin
  cell_start := date_trunc('hour', new.starts_at at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
  cell_end := cell_start + interval '1 hour';
  lock_key := new.tenant_id::text || ':' || new.coach_id::text || ':' ||
    ((new.starts_at at time zone 'Asia/Taipei')::date)::text;

  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  if new.ends_at <= new.starts_at then
    raise exception 'invalid_time_range';
  end if;

  if tg_table_name = 'bookings' then
    if new.status not in ('pending', 'confirmed', 'booked', 'checked_in') then
      return new;
    end if;

    if exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and tstzrange(note.starts_at, note.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'schedule_time_overlap' using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
        and booking.id <> new.id
        and booking.course_type <> new.course_type
        and tstzrange(booking.starts_at, booking.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'group_course_type_mismatch';
    end if;

    if new.course_type <> 'weight_training' then
      select count(*) into overlap_count
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
        and booking.id <> new.id
        and tstzrange(booking.starts_at, booking.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)');

      if overlap_count >= 3 then
        raise exception 'coach_capacity_exceeded';
      end if;
    end if;
  else
    if exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and note.starts_at >= cell_start
        and note.starts_at < cell_end
        and note.id <> new.id
    ) or exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
        and booking.starts_at >= cell_start
        and booking.starts_at < cell_end
    ) then
      raise exception 'schedule_cell_occupied' using errcode = '23505';
    end if;

    if exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and note.id <> new.id
        and tstzrange(note.starts_at, note.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) or exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
        and tstzrange(booking.starts_at, booking.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'schedule_time_overlap' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_bige_single_entry_cell on public.bookings;
create trigger bookings_bige_single_entry_cell
before insert or update of tenant_id, coach_id, starts_at, ends_at, status, is_bige_schedule, course_type
on public.bookings
for each row
when (new.is_bige_schedule = true)
execute function public.enforce_bige_schedule_single_entry_cell();

revoke all on function public.bige_create_schedule_booking(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) from public, anon;
grant execute on function public.bige_create_schedule_booking(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) to authenticated, service_role;

revoke all on function public.bige_reschedule_schedule_booking(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.bige_reschedule_schedule_booking(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) to authenticated, service_role;

revoke all on function public.enforce_bige_schedule_single_entry_cell() from public, anon;
grant execute on function public.enforce_bige_schedule_single_entry_cell() to authenticated, service_role;

commit;
