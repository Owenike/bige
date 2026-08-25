begin;

-- Batch deletion is deliberately service-role only. The API performs the
-- organization permission check, while this function owns the atomic lock,
-- final state/payment checks, soft deletion, and durable batch audit.
create or replace function public.bige_delete_schedule_bookings_batch_v1(
  p_tenant_id uuid,
  p_member_id uuid,
  p_booking_ids uuid[],
  p_actor_id uuid,
  p_allow_paid boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_count integer;
  distinct_count integer;
  matched_count integer;
  affected_count integer;
  deleted_items jsonb;
  result jsonb;
  replay_result jsonb;
  changed_at timestamptz := clock_timestamp();
begin
  requested_count := coalesce(cardinality(p_booking_ids), 0);
  if requested_count < 1 or requested_count > 62 then
    raise exception 'invalid_batch_delete_count';
  end if;
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) < 8 then
    raise exception 'idempotency_key_required';
  end if;

  select count(distinct booking_id)
  into distinct_count
  from unnest(p_booking_ids) as requested(booking_id);
  if distinct_count <> requested_count then
    raise exception 'duplicate_batch_delete_booking';
  end if;

  if not exists (
    select 1
    from public.profiles actor
    where actor.id = p_actor_id
      and actor.is_active = true
      and (actor.tenant_id = p_tenant_id or actor.role = 'platform_admin')
  ) then
    raise exception 'forbidden';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_tenant_id::text || ':monthly-batch-delete:' || p_idempotency_key,
      0
    )
  );

  select audit.payload -> 'result'
  into replay_result
  from public.audit_logs audit
  where audit.tenant_id = p_tenant_id
    and audit.action = 'bige_schedule_batch_deleted'
    and audit.target_type = 'member'
    and audit.target_id = p_member_id::text
    and audit.payload ->> 'idempotencyKey' = p_idempotency_key
  order by audit.created_at desc
  limit 1;
  if replay_result is not null then
    return replay_result || jsonb_build_object('replayed', true);
  end if;

  -- Lock in primary-key order to keep concurrent batch operations deadlock-safe.
  perform booking.id
  from public.bookings booking
  where booking.tenant_id = p_tenant_id
    and booking.id = any(p_booking_ids)
  order by booking.id
  for update;

  select count(*)
  into matched_count
  from public.bookings booking
  where booking.tenant_id = p_tenant_id
    and booking.id = any(p_booking_ids)
    and booking.member_id = p_member_id
    and booking.is_bige_schedule = true
    and booking.status in ('pending', 'confirmed', 'booked')
    and booking.starts_at > changed_at
    and coalesce(booking.operation_idempotency_key, '') not like 'legacy-august:%';
  if matched_count <> requested_count then
    raise exception 'schedule_batch_delete_state_changed';
  end if;

  if not coalesce(p_allow_paid, false) and exists (
    select 1
    from public.bookings booking
    where booking.tenant_id = p_tenant_id
      and booking.id = any(p_booking_ids)
      and (
        exists (
          select 1
          from public.bige_contract_payments payment
          where payment.tenant_id = p_tenant_id
            and payment.source_booking_id = booking.id
            and payment.status = 'recorded'
        )
        or (
          booking.converted_contract_id is not null
          and exists (
            select 1
            from public.bige_contract_payments payment
            where payment.tenant_id = p_tenant_id
              and payment.contract_id = booking.converted_contract_id
              and payment.source_booking_id is null
              and payment.status = 'recorded'
          )
        )
      )
  ) then
    raise exception 'paid_schedule_booking_manager_required';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', booking.id,
      'branchId', booking.branch_id,
      'coachId', booking.coach_id,
      'operationKind', booking.operation_kind,
      'courseType', booking.course_type,
      'startsAt', booking.starts_at,
      'endsAt', booking.ends_at
    )
    order by booking.starts_at, booking.id
  )
  into deleted_items
  from public.bookings booking
  where booking.tenant_id = p_tenant_id
    and booking.id = any(p_booking_ids);

  update public.bookings booking
  set status = 'cancelled',
      operation_result = 'cancelled',
      status_reason = 'schedule_trash_deleted',
      cancelled_at = changed_at,
      status_updated_at = changed_at,
      updated_at = changed_at
  where booking.tenant_id = p_tenant_id
    and booking.id = any(p_booking_ids)
    and booking.status in ('pending', 'confirmed', 'booked');
  get diagnostics affected_count = row_count;
  if affected_count <> requested_count then
    raise exception 'schedule_batch_delete_state_changed';
  end if;

  result := jsonb_build_object(
    'memberId', p_member_id,
    'deletedCount', affected_count,
    'bookingIds', to_jsonb(p_booking_ids),
    'items', coalesce(deleted_items, '[]'::jsonb),
    'changedAt', changed_at,
    'replayed', false
  );

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
    p_actor_id,
    'bige_schedule_batch_deleted',
    'member',
    p_member_id::text,
    null,
    jsonb_build_object(
      'idempotencyKey', p_idempotency_key,
      'requestedCount', requested_count,
      'allOrNone', true,
      'result', result
    )
  );

  return result;
end;
$$;

revoke all on function public.bige_delete_schedule_bookings_batch_v1(
  uuid, uuid, uuid[], uuid, boolean, text
) from public, anon, authenticated;
grant execute on function public.bige_delete_schedule_bookings_batch_v1(
  uuid, uuid, uuid[], uuid, boolean, text
) to service_role;

-- Shift and leave markers describe the coach's day. They remain visible as a
-- warning but are not appointments. Actual bookings, TO markers, and manual
-- notes continue to be hard conflicts at the trigger/concurrency boundary.
create or replace function public.enforce_bige_schedule_single_entry_cell()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cell_start timestamptz;
  cell_end timestamptz;
  lock_key text;
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
    if coalesce(new.operation_idempotency_key, '') like 'legacy-august:%' then
      return new;
    end if;

    if exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
        and booking.id <> new.id
        and coalesce(booking.operation_idempotency_key, '') not like 'legacy-august:%'
        and tstzrange(booking.starts_at, booking.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) or exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and note.source is distinct from 'legacy_schedule_import'
        and btrim(coalesce(note.content, '')) not in ('早', '晚', '休')
        and btrim(coalesce(note.content, '')) !~
          '^\d{1,2}:\d{2}[[:space:]]*[-–—][[:space:]]*\d{1,2}:\d{2}$'
        and tstzrange(note.starts_at, note.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'schedule_time_overlap' using errcode = '23505';
    end if;
  else
    if new.source = 'legacy_schedule_import' then
      return new;
    end if;

    if exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and note.source is distinct from 'legacy_schedule_import'
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
        and coalesce(booking.operation_idempotency_key, '') not like 'legacy-august:%'
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
        and note.source is distinct from 'legacy_schedule_import'
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
        and coalesce(booking.operation_idempotency_key, '') not like 'legacy-august:%'
        and tstzrange(booking.starts_at, booking.ends_at, '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception 'schedule_time_overlap' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_bige_schedule_single_entry_cell()
  from public, anon, authenticated;
grant execute on function public.enforce_bige_schedule_single_entry_cell()
  to service_role;

commit;
