begin;

-- Imported appointment-book bookings remain advisory rows: they do not occupy
-- a formal schedule cell and formal bookings continue to ignore them. Managers
-- may now drag an active imported booking itself. When an imported row overlaps
-- a formal booking at its source, only the imported row is moved.
do $migration$
declare
  function_sql text;
  patched_sql text;
  source_filter_count integer;
  source_window_guard_count integer;
  moved_conflict_guard_count integer;
  patched_source_filter_count integer;
  patched_source_window_guard_count integer;
  patched_moved_conflict_guard_count integer;
begin
  function_sql := pg_get_functiondef(
    'public.bige_drag_schedule_booking(uuid,uuid,uuid,timestamp with time zone,text)'::regprocedure
  );

  if regexp_count(function_sql, $pattern$legacy_schedule_reference_read_only$pattern$) <> 1
     or position('source_is_legacy boolean' in function_sql) > 0 then
    raise exception 'bige_drag_schedule_booking legacy source guard is not in the expected state';
  end if;

  patched_sql := regexp_replace(
    function_sql,
    $pattern$cancelled_count integer := 0;[[:space:]]+begin$pattern$,
    $replacement$cancelled_count integer := 0;
  source_is_legacy boolean := false;
begin$replacement$
  );
  patched_sql := regexp_replace(
    patched_sql,
    $pattern$if coalesce\(source_booking\.operation_idempotency_key, ''\) like 'legacy-august:%' then[[:space:]]+raise exception 'legacy_schedule_reference_read_only';[[:space:]]+end if;$pattern$,
    $replacement$source_is_legacy := coalesce(source_booking.operation_idempotency_key, '') like 'legacy-august:%';$replacement$
  );

  source_filter_count := regexp_count(
    patched_sql,
    $pattern$and booking\.coach_id = source_booking\.coach_id[[:space:]]+and booking\.is_bige_schedule = true[[:space:]]+and coalesce\(booking\.operation_idempotency_key, ''\) not like 'legacy-august:%'[[:space:]]+and booking\.status <> 'cancelled'$pattern$
  );
  if source_filter_count <> 2 then
    raise exception 'bige_drag_schedule_booking source scan count changed: %', source_filter_count;
  end if;

  patched_sql := regexp_replace(
    patched_sql,
    $pattern$and booking\.coach_id = source_booking\.coach_id[[:space:]]+and booking\.is_bige_schedule = true[[:space:]]+and coalesce\(booking\.operation_idempotency_key, ''\) not like 'legacy-august:%'[[:space:]]+and booking\.status <> 'cancelled'$pattern$,
    $replacement$and booking.coach_id = source_booking.coach_id
      and booking.is_bige_schedule = true
      and booking.status <> 'cancelled'
      and (
        (
          source_is_legacy
          and booking.id = source_booking.id
        )
        or (
          not source_is_legacy
          and coalesce(booking.operation_idempotency_key, '') not like 'legacy-august:%'
        )
      )$replacement$,
    'g'
  );

  source_window_guard_count := regexp_count(
    patched_sql,
    $pattern$\([[:space:]]*(note|booking)\.coach_id = source_booking\.coach_id[[:space:]]+and$pattern$
  );
  if source_window_guard_count <> 2 then
    raise exception 'bige_drag_schedule_booking source window count changed: %', source_window_guard_count;
  end if;
  patched_sql := regexp_replace(
    patched_sql,
    $pattern$\([[:space:]]+note\.coach_id = source_booking\.coach_id$pattern$,
    $replacement$(
          not source_is_legacy
          and note.coach_id = source_booking.coach_id$replacement$,
    'g'
  );
  patched_sql := regexp_replace(
    patched_sql,
    $pattern$\([[:space:]]+booking\.coach_id = source_booking\.coach_id$pattern$,
    $replacement$(
          not source_is_legacy
          and booking.coach_id = source_booking.coach_id$replacement$,
    'g'
  );

  moved_conflict_guard_count := regexp_count(
    patched_sql,
    $pattern$where moved\.id = any\(moving_ids\)$pattern$
  );
  if moved_conflict_guard_count <> 2 then
    raise exception 'bige_drag_schedule_booking moved conflict count changed: %', moved_conflict_guard_count;
  end if;
  patched_sql := replace(
    patched_sql,
    E'    where moved.id = any(moving_ids)',
    E'    where moved.id = any(moving_ids)\n      and (not source_is_legacy or moved.id <> source_booking.id)'
  );

  patched_source_filter_count := regexp_count(
    patched_sql,
    $pattern$source_is_legacy[[:space:]]+and booking\.id = source_booking\.id$pattern$
  );
  patched_source_window_guard_count := regexp_count(
    patched_sql,
    $pattern$not source_is_legacy[[:space:]]+and (note|booking)\.coach_id = source_booking\.coach_id$pattern$
  );
  patched_moved_conflict_guard_count := regexp_count(
    patched_sql,
    $pattern$not source_is_legacy or moved\.id <> source_booking\.id$pattern$
  );
  if patched_sql = function_sql
     or position('source_is_legacy boolean := false' in patched_sql) = 0
     or position('raise exception ''legacy_schedule_reference_read_only''' in patched_sql) > 0
     or patched_source_filter_count <> 2
     or patched_source_window_guard_count <> 2
     or patched_moved_conflict_guard_count <> 2 then
    raise exception
      'bige_drag_schedule_booking legacy source patch failed (changed %, variable %, readonly %, source filters %, source windows %, moved conflicts %)',
      patched_sql <> function_sql,
      position('source_is_legacy boolean := false' in patched_sql),
      position('raise exception ''legacy_schedule_reference_read_only''' in patched_sql),
      patched_source_filter_count,
      patched_source_window_guard_count,
      patched_moved_conflict_guard_count;
  end if;

  execute patched_sql;
end;
$migration$;

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
