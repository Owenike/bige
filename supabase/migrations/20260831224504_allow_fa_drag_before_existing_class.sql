begin;

-- An FA remains a two-hour operational record because its second hour drives
-- the assistant-manager TO workflow. For schedule-cell occupancy during an
-- empty-slot drag, however, the source coach only owns the first hour. This
-- lets a 19:00 FA move in front of an existing 20:00 class without moving,
-- cancelling, or visually replacing that following class.
do $migration$
declare
  function_sql text;
  patched_sql text;
begin
  function_sql := pg_get_functiondef(
    'public.bige_drag_schedule_booking(uuid,uuid,uuid,timestamp with time zone,text)'::regprocedure
  );

  if position('source_uses_single_cell boolean' in function_sql) > 0
     or position('source_is_legacy boolean := false' in function_sql) = 0 then
    raise exception 'bige_drag_schedule_booking FA source state is not in the expected form';
  end if;

  patched_sql := regexp_replace(
    function_sql,
    $pattern$source_is_legacy boolean := false;[[:space:]]+begin$pattern$,
    $replacement$source_is_legacy boolean := false;
  source_is_fa boolean := false;
  source_uses_single_cell boolean := false;
begin$replacement$
  );

  patched_sql := regexp_replace(
    patched_sql,
    $pattern$source_is_legacy := coalesce\(source_booking\.operation_idempotency_key, ''\) like 'legacy-august:%';$pattern$,
    $replacement$source_is_legacy := coalesce(source_booking.operation_idempotency_key, '') like 'legacy-august:%';
  source_is_fa := source_booking.operation_kind = 'trial';$replacement$
  );

  patched_sql := regexp_replace(
    patched_sql,
    $pattern$if found then[[:space:]]+target_anchor := target_primary\.starts_at;[[:space:]]+end if;[[:space:]]+[[:space:]]+if source_booking\.coach_id = p_target_coach_id$pattern$,
    $replacement$if found then
    target_anchor := target_primary.starts_at;
  end if;

  source_uses_single_cell := source_is_fa and (
    target_primary.id is null
    or exists (
      select 1
      from public.bookings following
      where following.tenant_id = p_tenant_id
        and following.coach_id = source_booking.coach_id
        and following.is_bige_schedule = true
        and following.status <> 'cancelled'
        and coalesce(following.operation_idempotency_key, '') not like 'legacy-august:%'
        and following.id <> source_booking.id
        and following.starts_at >= source_booking.starts_at + interval '1 hour'
        and following.starts_at < source_booking.ends_at
    )
  );

  if source_booking.coach_id = p_target_coach_id$replacement$
  );

  patched_sql := regexp_replace(
    patched_sql,
    $pattern$span_seconds := greatest\([[:space:]]+extract\(epoch from \(source_booking\.ends_at - source_booking\.starts_at\)\),[[:space:]]+case[[:space:]]+when target_primary\.id is null then 0[[:space:]]+else extract\(epoch from \(target_primary\.ends_at - target_primary\.starts_at\)\)[[:space:]]+end[[:space:]]+\);$pattern$,
    $replacement$span_seconds := greatest(
    case
      when source_uses_single_cell then least(
        extract(epoch from (source_booking.ends_at - source_booking.starts_at)),
        3600
      )
      else extract(epoch from (source_booking.ends_at - source_booking.starts_at))
    end,
    case
      when target_primary.id is null then 0
      else extract(epoch from (target_primary.ends_at - target_primary.starts_at))
    end
  );$replacement$
  );

  patched_sql := regexp_replace(
    patched_sql,
    $pattern$coalesce\(max\(extract\(epoch from \(booking\.ends_at - source_anchor\)\)\), 0\)$pattern$,
    $replacement$coalesce(max(
        case
          when source_uses_single_cell and booking.id = source_booking.id then least(
            extract(epoch from (booking.ends_at - source_anchor)),
            3600
          )
          else extract(epoch from (booking.ends_at - source_anchor))
        end
      ), 0)$replacement$
  );

  patched_sql := regexp_replace(
    patched_sql,
    $pattern$if target_window_end > local_day_end or source_window_end > local_day_end then$pattern$,
    $replacement$if target_window_end > local_day_end
     or source_window_end > local_day_end
     or target_anchor + (source_booking.ends_at - source_booking.starts_at) > local_day_end then$replacement$
  );

  if regexp_count(
    patched_sql,
    $pattern$tstzrange\(moved\.starts_at, moved\.ends_at, '\[\)'\)$pattern$
  ) <> 2 then
    raise exception 'bige_drag_schedule_booking moved range count changed';
  end if;
  patched_sql := regexp_replace(
    patched_sql,
    $pattern$tstzrange\(moved\.starts_at, moved\.ends_at, '\[\)'\)$pattern$,
    $replacement$tstzrange(
       moved.starts_at,
       case
         when source_uses_single_cell and moved.id = source_booking.id
           then least(moved.ends_at, moved.starts_at + interval '1 hour')
         else moved.ends_at
       end,
       '[)'
     )$replacement$,
    'g'
  );

  if patched_sql = function_sql
     or position('source_uses_single_cell boolean := false' in patched_sql) = 0
     or position('target_primary.id is null' in patched_sql) = 0
     or position('then least(moved.ends_at, moved.starts_at + interval ''1 hour'')' in patched_sql) = 0
     or position('target_anchor + (source_booking.ends_at - source_booking.starts_at) > local_day_end' in patched_sql) = 0 then
    raise exception 'bige_drag_schedule_booking FA single-cell patch failed';
  end if;

  execute patched_sql;
end;
$migration$;

do $migration$
declare
  function_sql text;
  patched_sql text;
begin
  function_sql := pg_get_functiondef(
    'public.enforce_bige_schedule_single_entry_cell()'::regprocedure
  );

  if position('new_occupancy_ends_at timestamptz' in function_sql) > 0 then
    raise exception 'enforce_bige_schedule_single_entry_cell already has FA occupancy support';
  end if;

  patched_sql := regexp_replace(
    function_sql,
    $pattern$lock_key text;[[:space:]]+begin$pattern$,
    $replacement$lock_key text;
  new_occupancy_ends_at timestamptz;
begin$replacement$
  );
  patched_sql := regexp_replace(
    patched_sql,
    $pattern$if new\.ends_at <= new\.starts_at then[[:space:]]+raise exception 'invalid_time_range';[[:space:]]+end if;[[:space:]]+[[:space:]]+if tg_table_name = 'bookings' then$pattern$,
    $replacement$if new.ends_at <= new.starts_at then
    raise exception 'invalid_time_range';
  end if;

  new_occupancy_ends_at := new.ends_at;
  if tg_table_name = 'bookings' then
    if new.operation_kind = 'trial' then
      new_occupancy_ends_at := least(new.ends_at, new.starts_at + interval '1 hour');
    end if;
  end if;

  if tg_table_name = 'bookings' then$replacement$
  );

  if regexp_count(
    patched_sql,
    $pattern$tstzrange\(booking\.starts_at, booking\.ends_at, '\[\)'\)$pattern$
  ) <> 2 or regexp_count(
    patched_sql,
    $pattern$tstzrange\(new\.starts_at, new\.ends_at, '\[\)'\)$pattern$
  ) <> 4 then
    raise exception 'enforce_bige_schedule_single_entry_cell range count changed';
  end if;

  patched_sql := regexp_replace(
    patched_sql,
    $pattern$tstzrange\(booking\.starts_at, booking\.ends_at, '\[\)'\)$pattern$,
    $replacement$tstzrange(
          booking.starts_at,
          case
            when booking.operation_kind = 'trial'
              then least(booking.ends_at, booking.starts_at + interval '1 hour')
            else booking.ends_at
          end,
          '[)'
        )$replacement$,
    'g'
  );
  patched_sql := regexp_replace(
    patched_sql,
    $pattern$tstzrange\(new\.starts_at, new\.ends_at, '\[\)'\)$pattern$,
    $replacement$tstzrange(new.starts_at, new_occupancy_ends_at, '[)')$replacement$,
    'g'
  );

  if patched_sql = function_sql
     or position('new_occupancy_ends_at timestamptz' in patched_sql) = 0
     or regexp_count(
       patched_sql,
       $pattern$when booking\.operation_kind = 'trial'$pattern$
     ) <> 2
     or regexp_count(
       patched_sql,
       $pattern$tstzrange\(new\.starts_at, new_occupancy_ends_at, '\[\)'\)$pattern$
     ) <> 4 then
    raise exception 'enforce_bige_schedule_single_entry_cell FA occupancy patch failed';
  end if;

  execute patched_sql;
end;
$migration$;

do $migration$
declare
  function_sql text;
  patched_sql text;
begin
  function_sql := pg_get_functiondef(
    'public.bige_undo_schedule_booking_move(uuid,uuid)'::regprocedure
  );

  if regexp_count(
    function_sql,
    $pattern$tstzrange\(restored\.starts_at, restored\.ends_at, '\[\)'\)$pattern$
  ) <> 2 then
    raise exception 'bige_undo_schedule_booking_move restored range count changed';
  end if;

  patched_sql := regexp_replace(
    function_sql,
    $pattern$tstzrange\(restored\.starts_at, restored\.ends_at, '\[\)'\)$pattern$,
    $replacement$tstzrange(
       restored.starts_at,
       case
         when restored.operation_kind = 'trial'
           then least(restored.ends_at, restored.starts_at + interval '1 hour')
         else restored.ends_at
       end,
       '[)'
     )$replacement$,
    'g'
  );

  if patched_sql = function_sql
     or regexp_count(
       patched_sql,
       $pattern$when restored\.operation_kind = 'trial'$pattern$
     ) <> 2 then
    raise exception 'bige_undo_schedule_booking_move FA occupancy patch failed';
  end if;

  execute patched_sql;
end;
$migration$;

commit;
