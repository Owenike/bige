begin;

create or replace function public.bige_undo_schedule_booking_move(
  p_tenant_id uuid,
  p_operation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  actor public.profiles%rowtype;
  move_log public.audit_logs%rowtype;
  before_snapshot jsonb := '[]'::jsonb;
  after_snapshot jsonb := '[]'::jsonb;
  result_snapshot jsonb := '[]'::jsonb;
  affected_ids uuid[] := '{}'::uuid[];
  undo_operation_id uuid := gen_random_uuid();
  operated_at timestamptz;
  business_date text;
begin
  select * into actor
  from public.profiles
  where id = auth.uid()
    and is_active = true;

  if not found or not public.bige_profile_can_manage_schedule(actor) then
    raise exception 'schedule_move_undo_forbidden';
  end if;

  if actor.role <> 'platform_admin' and actor.tenant_id is distinct from p_tenant_id then
    raise exception 'forbidden';
  end if;

  select * into move_log
  from public.audit_logs audit
  where audit.tenant_id = p_tenant_id
    and audit.actor_id = actor.id
    and audit.target_type = 'schedule_operation'
    and audit.target_id = p_operation_id::text
    and audit.action in (
      'bige_schedule_drag_move',
      'bige_schedule_drag_swap',
      'bige_schedule_drag_overwrite'
    )
  order by audit.created_at desc
  limit 1
  for update;

  if not found then
    raise exception 'schedule_move_undo_not_found';
  end if;

  if exists (
    select 1
    from public.audit_logs audit
    where audit.tenant_id = p_tenant_id
      and audit.action = 'bige_schedule_drag_undo'
      and audit.target_type = 'schedule_operation'
      and audit.target_id = p_operation_id::text
  ) then
    raise exception 'schedule_move_already_undone';
  end if;

  operated_at := coalesce(
    nullif(move_log.payload ->> 'operatedAt', '')::timestamptz,
    move_log.created_at
  );
  -- The UI offers undo for 10 seconds. A small server allowance prevents a
  -- click at the end of that window from expiring while the request is in flight.
  if operated_at < now() - interval '20 seconds' then
    raise exception 'schedule_move_undo_expired';
  end if;

  before_snapshot := coalesce(move_log.payload -> 'sourceBefore', '[]'::jsonb)
    || coalesce(move_log.payload -> 'targetBefore', '[]'::jsonb);
  after_snapshot := coalesce(move_log.payload -> 'after', '[]'::jsonb);

  select coalesce(array_agg((item ->> 'id')::uuid), '{}'::uuid[])
  into affected_ids
  from jsonb_array_elements(before_snapshot) item;

  if cardinality(affected_ids) = 0 or jsonb_array_length(after_snapshot) = 0 then
    raise exception 'schedule_move_undo_snapshot_invalid';
  end if;

  business_date := to_char(
    ((before_snapshot -> 0 ->> 'startsAt')::timestamptz) at time zone 'Asia/Taipei',
    'YYYY-MM-DD'
  );
  perform pg_advisory_xact_lock(
    hashtextextended('bige-schedule-drag:' || p_tenant_id::text || ':' || business_date, 0)
  );

  -- Refuse a stale undo if any affected booking has changed since the move.
  if exists (
    select 1
    from jsonb_array_elements(after_snapshot) item
    left join public.bookings booking
      on booking.id = (item ->> 'id')::uuid
     and booking.tenant_id = p_tenant_id
    where booking.id is null
       or booking.coach_id is distinct from (item ->> 'coachId')::uuid
       or booking.starts_at is distinct from (item ->> 'startsAt')::timestamptz
       or booking.ends_at is distinct from (item ->> 'endsAt')::timestamptz
       or booking.status is distinct from item ->> 'status'
       or booking.is_bige_schedule is distinct from ((item ->> 'status') <> 'cancelled')
  ) then
    raise exception 'schedule_move_undo_conflict';
  end if;

  if exists (
    select 1
    from public.session_redemptions redemption
    where redemption.booking_id = any(affected_ids)
  ) then
    raise exception 'schedule_move_undo_conflict';
  end if;

  -- Remove all affected rows from the live board while restoring their exact
  -- pre-operation positions. This keeps the single-cell constraint atomic.
  update public.bookings
  set is_bige_schedule = false,
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = any(affected_ids);

  update public.bookings booking
  set coach_id = (item ->> 'coachId')::uuid,
      starts_at = (item ->> 'startsAt')::timestamptz,
      ends_at = (item ->> 'endsAt')::timestamptz,
      status = item ->> 'status',
      operation_result = case
        when item ->> 'status' in ('pending', 'confirmed', 'booked') then null
        else booking.operation_result
      end,
      status_reason = case
        when item ->> 'status' in ('pending', 'confirmed', 'booked') then null
        else booking.status_reason
      end,
      cancelled_at = case
        when item ->> 'status' in ('pending', 'confirmed', 'booked') then null
        else booking.cancelled_at
      end,
      status_updated_at = now(),
      updated_at = now()
  from jsonb_array_elements(before_snapshot) item
  where booking.tenant_id = p_tenant_id
    and booking.id = (item ->> 'id')::uuid;

  if exists (
    select 1
    from public.bookings left_booking
    join public.bookings right_booking
      on left_booking.coach_id = right_booking.coach_id
     and left_booking.id::text < right_booking.id::text
     and tstzrange(left_booking.starts_at, left_booking.ends_at, '[)')
       && tstzrange(right_booking.starts_at, right_booking.ends_at, '[)')
    where left_booking.id = any(affected_ids)
      and right_booking.id = any(affected_ids)
  ) then
    raise exception 'schedule_move_undo_conflict';
  end if;

  if exists (
    select 1
    from public.bookings restored
    join public.bookings existing
      on existing.tenant_id = restored.tenant_id
     and existing.coach_id = restored.coach_id
     and existing.is_bige_schedule = true
     and not (existing.id = any(affected_ids))
     and tstzrange(existing.starts_at, existing.ends_at, '[)')
       && tstzrange(restored.starts_at, restored.ends_at, '[)')
    where restored.id = any(affected_ids)
  ) then
    raise exception 'schedule_move_undo_conflict';
  end if;

  if exists (
    select 1
    from public.bookings restored
    join public.bige_schedule_notes note
      on note.tenant_id = restored.tenant_id
     and coalesce(note.system_kind, '') <> 'fa_assistant_to'
     and btrim(coalesce(note.content, '')) not in ('早', '晚', '休')
     and note.coach_id = restored.coach_id
     and tstzrange(note.starts_at, note.ends_at, '[)')
       && tstzrange(restored.starts_at, restored.ends_at, '[)')
    where restored.id = any(affected_ids)
  ) then
    raise exception 'schedule_move_undo_conflict';
  end if;

  update public.bookings
  set is_bige_schedule = true,
      updated_at = now()
  where tenant_id = p_tenant_id
    and id = any(affected_ids);

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
  where booking.tenant_id = p_tenant_id
    and booking.id = any(affected_ids);

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
    'bige_schedule_drag_undo',
    'schedule_operation',
    p_operation_id::text,
    null,
    jsonb_build_object(
      'operationId', undo_operation_id,
      'originalOperationId', p_operation_id,
      'originalMode', move_log.payload ->> 'mode',
      'before', after_snapshot,
      'after', result_snapshot,
      'operatedAt', now()
    )
  );

  return jsonb_build_object(
    'operationId', undo_operation_id,
    'originalOperationId', p_operation_id,
    'items', result_snapshot
  );
end;
$$;

revoke all on function public.bige_undo_schedule_booking_move(uuid, uuid)
from public, anon;

grant execute on function public.bige_undo_schedule_booking_move(uuid, uuid)
to authenticated;

commit;
