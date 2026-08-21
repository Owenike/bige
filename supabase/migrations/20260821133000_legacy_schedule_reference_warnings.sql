begin;

-- Rows imported from the August paper appointment book are visual references.
-- They must remain visible on the board, but they must never prevent a manager
-- from creating or rescheduling the operational booking in BIG E.

create or replace function public.bige_append_legacy_reference_warning(
  p_result jsonb,
  p_coach_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_id_value uuid;
  tenant_id_value uuid;
  member_id_value uuid;
  reference_count integer := 0;
  existing_warnings jsonb := '[]'::jsonb;
begin
  booking_id_value := nullif(p_result ->> 'bookingId', '')::uuid;
  if booking_id_value is null then
    return p_result;
  end if;

  select booking.tenant_id, booking.member_id
  into tenant_id_value, member_id_value
  from public.bookings booking
  where booking.id = booking_id_value;

  if not found then
    return p_result;
  end if;

  select
    (
      select count(*)
      from public.bookings reference_booking
      where reference_booking.tenant_id = tenant_id_value
        and reference_booking.id <> booking_id_value
        and reference_booking.is_bige_schedule = true
        and reference_booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
        and coalesce(reference_booking.operation_idempotency_key, '') like 'legacy-august:%'
        and (
          reference_booking.coach_id = p_coach_id
          or reference_booking.member_id = member_id_value
        )
        and tstzrange(reference_booking.starts_at, reference_booking.ends_at, '[)')
          && tstzrange(p_starts_at, p_ends_at, '[)')
    ) + (
      select count(*)
      from public.bige_schedule_notes reference_note
      where reference_note.tenant_id = tenant_id_value
        and reference_note.coach_id = p_coach_id
        and reference_note.source = 'legacy_schedule_import'
        and tstzrange(reference_note.starts_at, reference_note.ends_at, '[)')
          && tstzrange(p_starts_at, p_ends_at, '[)')
    )
  into reference_count;

  if reference_count <= 0 then
    return p_result;
  end if;

  existing_warnings := case
    when jsonb_typeof(p_result -> 'warnings') = 'array' then p_result -> 'warnings'
    else '[]'::jsonb
  end;

  return jsonb_set(
    p_result,
    '{warnings}',
    existing_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'legacy_schedule_reference_conflict',
      'message', '同時段有舊預約本資料，僅供對照，不阻擋本次安排',
      'existingCount', reference_count
    )),
    true
  );
end;
$$;

revoke all on function public.bige_append_legacy_reference_warning(
  jsonb, uuid, timestamptz, timestamptz
) from public, anon, authenticated;

-- The board-level trigger is the final concurrency guard. Imported reference
-- rows may overlap anything, and operational rows ignore imported references.
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

-- Keep BB exclusive against operational rows while excluding appointment-book
-- references in both directions.
create or replace function public.bige_enforce_bb_exclusive_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_bige_schedule is distinct from true
     or new.status not in ('pending', 'confirmed', 'booked', 'checked_in')
     or coalesce(new.operation_idempotency_key, '') like 'legacy-august:%' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      new.tenant_id::text || ':' || new.coach_id::text || ':' ||
      ((new.starts_at at time zone 'Asia/Taipei')::date)::text,
      0
    )
  );

  if new.operation_kind = 'bb' and exists (
    select 1
    from public.bookings booking
    where booking.tenant_id = new.tenant_id
      and booking.id <> new.id
      and booking.coach_id = new.coach_id
      and booking.is_bige_schedule = true
      and coalesce(booking.operation_idempotency_key, '') not like 'legacy-august:%'
      and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(booking.starts_at, booking.ends_at, '[)')
        && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'schedule_time_overlap' using errcode = '23505';
  end if;

  if new.operation_kind <> 'bb' and exists (
    select 1
    from public.bookings booking
    where booking.tenant_id = new.tenant_id
      and booking.id <> new.id
      and booking.coach_id = new.coach_id
      and booking.is_bige_schedule = true
      and coalesce(booking.operation_idempotency_key, '') not like 'legacy-august:%'
      and booking.operation_kind = 'bb'
      and booking.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(booking.starts_at, booking.ends_at, '[)')
        && tstzrange(new.starts_at, new.ends_at, '[)')
  ) then
    raise exception 'schedule_time_overlap' using errcode = '23505';
  end if;

  return new;
end;
$$;

revoke all on function public.bige_enforce_bb_exclusive_schedule()
  from public, anon, authenticated;
grant execute on function public.bige_enforce_bb_exclusive_schedule()
  to service_role;

-- Preserve the established RPCs and only remove imported reference rows from
-- their hard-conflict queries. Fail the migration if the expected definitions
-- have changed so a future schema edit cannot be silently patched incorrectly.
do $migration$
declare
  function_sql text;
  patched_sql text;
begin
  function_sql := pg_get_functiondef(
    'public.bige_create_schedule_booking(uuid,uuid,uuid,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,text,uuid,text)'::regprocedure
  );
  if position('legacy-august:%' in function_sql) > 0 then
    raise exception 'bige_create_schedule_booking_already_patched';
  end if;

  patched_sql := replace(
    function_sql,
    E'    and coach_id = p_coach_id\n    and is_bige_schedule = true',
    E'    and coach_id = p_coach_id\n    and coalesce(operation_idempotency_key, '''') not like ''legacy-august:%''\n    and is_bige_schedule = true'
  );
  patched_sql := replace(
    patched_sql,
    E'      and group_id = p_group_id\n      and is_bige_schedule = true',
    E'      and group_id = p_group_id\n      and coalesce(operation_idempotency_key, '''') not like ''legacy-august:%''\n      and is_bige_schedule = true'
  );
  patched_sql := replace(
    patched_sql,
    E'    and coach_id = p_coach_id\n    and status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')',
    E'    and coach_id = p_coach_id\n    and coalesce(operation_idempotency_key, '''') not like ''legacy-august:%''\n    and status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')'
  );
  patched_sql := replace(
    patched_sql,
    E'      and member_id = p_member_id\n      and status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')',
    E'      and member_id = p_member_id\n      and coalesce(operation_idempotency_key, '''') not like ''legacy-august:%''\n      and status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')'
  );

  if patched_sql = function_sql
     or position('legacy-august:%' in patched_sql) = 0 then
    raise exception 'bige_create_schedule_booking_patch_failed';
  end if;
  execute patched_sql;

  function_sql := pg_get_functiondef(
    'public.bige_reschedule_schedule_booking(uuid,uuid,uuid,text,timestamp with time zone,timestamp with time zone,text)'::regprocedure
  );
  if position('legacy-august:%' in function_sql) > 0 then
    raise exception 'bige_reschedule_schedule_booking_already_patched';
  end if;

  patched_sql := replace(
    function_sql,
    E'    and coach_id = p_coach_id\n    and is_bige_schedule = true',
    E'    and coach_id = p_coach_id\n    and coalesce(operation_idempotency_key, '''') not like ''legacy-august:%''\n    and is_bige_schedule = true'
  );
  patched_sql := replace(
    patched_sql,
    E'    and coach_id = p_coach_id\n    and status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')',
    E'    and coach_id = p_coach_id\n    and coalesce(operation_idempotency_key, '''') not like ''legacy-august:%''\n    and status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')'
  );
  patched_sql := replace(
    patched_sql,
    E'      and member_id = target.member_id\n      and status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')',
    E'      and member_id = target.member_id\n      and coalesce(operation_idempotency_key, '''') not like ''legacy-august:%''\n      and status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')'
  );

  if patched_sql = function_sql
     or position('legacy-august:%' in patched_sql) = 0 then
    raise exception 'bige_reschedule_schedule_booking_patch_failed';
  end if;
  execute patched_sql;

  function_sql := pg_get_functiondef(
    'public.bige_create_bb_schedule_booking_v1(uuid,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text,text)'::regprocedure
  );
  if position('legacy-august:%' in function_sql) > 0 then
    raise exception 'bige_create_bb_schedule_booking_v1_already_patched';
  end if;

  patched_sql := replace(
    function_sql,
    E'      and booking.coach_id = p_coach_id\n      and booking.status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')',
    E'      and booking.coach_id = p_coach_id\n      and coalesce(booking.operation_idempotency_key, '''') not like ''legacy-august:%''\n      and booking.status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')'
  );
  patched_sql := replace(
    patched_sql,
    E'      and booking.member_id = member_row.id\n      and booking.status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')',
    E'      and booking.member_id = member_row.id\n      and coalesce(booking.operation_idempotency_key, '''') not like ''legacy-august:%''\n      and booking.status in (''pending'', ''confirmed'', ''booked'', ''checked_in'')'
  );

  if patched_sql = function_sql
     or position('legacy-august:%' in patched_sql) = 0 then
    raise exception 'bige_create_bb_schedule_booking_v1_patch_failed';
  end if;
  execute patched_sql;
end;
$migration$;

-- Dragging an operational row onto an imported reference must treat the
-- reference as empty board space. Imported rows themselves remain read-only.
do $migration$
declare
  function_sql text;
  patched_sql text;
begin
  function_sql := pg_get_functiondef(
    'public.bige_drag_schedule_booking(uuid,uuid,uuid,timestamp with time zone,text)'::regprocedure
  );
  if position('legacy_schedule_reference_read_only' in function_sql) > 0 then
    raise exception 'bige_drag_schedule_booking_already_patched';
  end if;

  patched_sql := replace(
    function_sql,
    E'  if not found then\n    raise exception ''schedule_booking_not_found'';\n  end if;\n\n  if source_booking.status',
    E'  if not found then\n    raise exception ''schedule_booking_not_found'';\n  end if;\n\n  if coalesce(source_booking.operation_idempotency_key, '''') like ''legacy-august:%'' then\n    raise exception ''legacy_schedule_reference_read_only'';\n  end if;\n\n  if source_booking.status'
  );
  patched_sql := replace(
    patched_sql,
    E'    and booking.is_bige_schedule = true',
    E'    and booking.is_bige_schedule = true\n    and coalesce(booking.operation_idempotency_key, '''') not like ''legacy-august:%'''
  );
  patched_sql := replace(
    patched_sql,
    E'     and existing.is_bige_schedule = true',
    E'     and existing.is_bige_schedule = true\n     and coalesce(existing.operation_idempotency_key, '''') not like ''legacy-august:%'''
  );
  patched_sql := replace(
    patched_sql,
    E'    where note.tenant_id = p_tenant_id\n      and coalesce(note.system_kind, '''') <> ''fa_assistant_to''',
    E'    where note.tenant_id = p_tenant_id\n      and note.source is distinct from ''legacy_schedule_import''\n      and coalesce(note.system_kind, '''') <> ''fa_assistant_to'''
  );
  patched_sql := replace(
    patched_sql,
    E'      on note.tenant_id = moved.tenant_id\n     and coalesce(note.system_kind, '''') <> ''fa_assistant_to''',
    E'      on note.tenant_id = moved.tenant_id\n     and note.source is distinct from ''legacy_schedule_import''\n     and coalesce(note.system_kind, '''') <> ''fa_assistant_to'''
  );
  patched_sql := replace(
    patched_sql,
    E'  return jsonb_build_object(\n    ''operationId'', operation_id,\n    ''mode'', p_mode,\n    ''movedCount'', moved_count,\n    ''cancelledCount'', cancelled_count,\n    ''items'', result_snapshot\n  );',
    E'  return public.bige_append_legacy_reference_warning(\n    jsonb_build_object(\n      ''bookingId'', source_booking.id,\n      ''operationId'', operation_id,\n      ''mode'', p_mode,\n      ''movedCount'', moved_count,\n      ''cancelledCount'', cancelled_count,\n      ''items'', result_snapshot\n    ),\n    p_target_coach_id,\n    target_anchor,\n    target_anchor + (source_booking.ends_at - source_booking.starts_at)\n  );'
  );

  if patched_sql = function_sql
     or position('legacy_schedule_reference_read_only' in patched_sql) = 0
     or position('bige_append_legacy_reference_warning' in patched_sql) = 0 then
    raise exception 'bige_drag_schedule_booking_patch_failed';
  end if;
  execute patched_sql;
end;
$migration$;

-- Keep the v2 wrappers stable and append the reference warning after the
-- operational booking has been successfully created or rescheduled.
create or replace function public.bige_create_schedule_booking_v2(
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
  result jsonb;
  booking_id uuid;
  stored_course_type text;
  service_label text;
begin
  if p_operation_kind = 'bb' then
    if p_member_id is not null or p_trial_booking_id is null or p_course_type is not null then
      raise exception 'invalid_bb_schedule_input';
    end if;
    result := public.bige_create_bb_schedule_booking_v1(
      p_tenant_id, p_branch_id, p_trial_booking_id, p_coach_id,
      p_starts_at, p_ends_at, p_note, p_idempotency_key
    );
    return public.bige_append_legacy_reference_warning(
      result, p_coach_id, p_starts_at, p_ends_at
    );
  end if;

  if p_operation_kind not in ('pt', 'trial') then raise exception 'invalid_operation_kind'; end if;
  if p_course_type not in (
    'weight_training', 'relaxation', 'reformer_pilates',
    'sports_cupping', 'fascia_knife', 'onsite_assessment'
  ) then raise exception 'invalid_course_type'; end if;

  if p_course_type in ('weight_training', 'relaxation', 'reformer_pilates') then
    result := public.bige_create_schedule_booking(
      p_tenant_id, p_branch_id, p_member_id, p_trial_booking_id, p_coach_id,
      p_operation_kind, p_course_type, p_starts_at, p_ends_at, p_note,
      p_group_id, p_idempotency_key
    );
  else
    result := public.bige_create_schedule_booking(
      p_tenant_id, p_branch_id, p_member_id, p_trial_booking_id, p_coach_id,
      p_operation_kind, 'weight_training', p_starts_at, p_ends_at, p_note,
      p_group_id, p_idempotency_key
    );
    booking_id := (result ->> 'bookingId')::uuid;
    select course_type into stored_course_type
    from public.bookings
    where id = booking_id and tenant_id = p_tenant_id
    for update;
    if not found then raise exception 'schedule_booking_not_found'; end if;
    if coalesce((result ->> 'replayed')::boolean, false)
       and stored_course_type <> p_course_type then
      raise exception 'idempotency_key_conflict';
    end if;

    service_label := case p_course_type
      when 'sports_cupping' then '運動拔罐'
      when 'fascia_knife' then '筋膜刀'
      when 'onsite_assessment' then '現場評估'
    end;
    if not coalesce((result ->> 'replayed')::boolean, false) then
      update public.bookings
      set course_type = p_course_type, service_name = service_label, updated_at = now()
      where id = booking_id;
      update public.audit_logs
      set payload = jsonb_set(coalesce(payload, '{}'::jsonb), '{courseType}', to_jsonb(p_course_type), true)
      where tenant_id = p_tenant_id
        and action = 'bige_schedule_booking_created'
        and target_type = 'booking'
        and target_id = booking_id::text;
    end if;
  end if;

  return public.bige_append_legacy_reference_warning(
    result, p_coach_id, p_starts_at, p_ends_at
  );
end;
$$;

revoke all on function public.bige_create_schedule_booking_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) from public, anon;
grant execute on function public.bige_create_schedule_booking_v2(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) to authenticated, service_role;

create or replace function public.bige_reschedule_schedule_booking_v2(
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
  result jsonb;
  tenant_id_value uuid;
  service_label text;
begin
  if p_course_type not in (
    'weight_training',
    'relaxation',
    'reformer_pilates',
    'sports_cupping',
    'fascia_knife',
    'onsite_assessment'
  ) then
    raise exception 'invalid_course_type';
  end if;

  if p_course_type in ('weight_training', 'relaxation', 'reformer_pilates') then
    result := public.bige_reschedule_schedule_booking(
      p_booking_id,
      p_branch_id,
      p_coach_id,
      p_course_type,
      p_starts_at,
      p_ends_at,
      p_note
    );
  else
    result := public.bige_reschedule_schedule_booking(
      p_booking_id,
      p_branch_id,
      p_coach_id,
      'weight_training',
      p_starts_at,
      p_ends_at,
      p_note
    );

    service_label := case p_course_type
      when 'sports_cupping' then '運動拔罐'
      when 'fascia_knife' then '筋膜刀'
      when 'onsite_assessment' then '現場評估'
    end;

    update public.bookings
    set course_type = p_course_type,
        service_name = service_label,
        updated_at = now()
    where id = p_booking_id
    returning tenant_id into tenant_id_value;

    if not found then
      raise exception 'schedule_booking_not_found';
    end if;

    update public.audit_logs
    set payload = jsonb_set(
      coalesce(payload, '{}'::jsonb),
      '{courseType}',
      to_jsonb(p_course_type),
      true
    )
    where tenant_id = tenant_id_value
      and target_type = 'booking'
      and target_id = p_booking_id::text
      and action in ('bige_schedule_booking_rescheduled', 'bige_schedule_booking_updated');
  end if;

  return public.bige_append_legacy_reference_warning(
    result, p_coach_id, p_starts_at, p_ends_at
  );
end;
$$;

revoke all on function public.bige_reschedule_schedule_booking_v2(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.bige_reschedule_schedule_booking_v2(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) to authenticated, service_role;

commit;
