begin;

-- Shift indicators and the system-generated assistant TO marker describe the
-- coach's day. They are not user-entered appointments and must not make an FA
-- or course look like non-draggable free text.
do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef(
    'public.bige_drag_schedule_booking(uuid,uuid,uuid,timestamp with time zone,text)'::regprocedure
  );

  patched := replace(
    definition,
    $old$    from public.bige_schedule_notes note
    where note.tenant_id = p_tenant_id
      and ($old$,
    $new$    from public.bige_schedule_notes note
    where note.tenant_id = p_tenant_id
      and coalesce(note.system_kind, '') <> 'fa_assistant_to'
      and btrim(coalesce(note.content, '')) not in ('早', '晚', '休')
      and ($new$
  );

  if patched = definition and position(
    $needle$    from public.bige_schedule_notes note
    where note.tenant_id = p_tenant_id
      and coalesce(note.system_kind, '') <> 'fa_assistant_to'
      and btrim(coalesce(note.content, '')) not in ('早', '晚', '休')
      and ($needle$ in definition
  ) = 0 then
    raise exception 'bige_drag_schedule_booking initial note guard was not found';
  end if;
  definition := patched;

  patched := replace(
    definition,
    $old$    join public.bige_schedule_notes note
      on note.tenant_id = moved.tenant_id
     and note.coach_id = moved.coach_id$old$,
    $new$    join public.bige_schedule_notes note
      on note.tenant_id = moved.tenant_id
     and coalesce(note.system_kind, '') <> 'fa_assistant_to'
     and btrim(coalesce(note.content, '')) not in ('早', '晚', '休')
     and note.coach_id = moved.coach_id$new$
  );

  if patched = definition and position(
    $needle$    join public.bige_schedule_notes note
      on note.tenant_id = moved.tenant_id
     and coalesce(note.system_kind, '') <> 'fa_assistant_to'
     and btrim(coalesce(note.content, '')) not in ('早', '晚', '休')
     and note.coach_id = moved.coach_id$needle$ in definition
  ) = 0 then
    raise exception 'bige_drag_schedule_booking final note guard was not found';
  end if;

  execute patched;
end;
$$;

do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef('public.enforce_bige_schedule_single_entry_cell()'::regprocedure);
  patched := replace(
    definition,
    $old$        and note.system_kind is null
        and note.starts_at >= cell_start$old$,
    $new$        and note.system_kind is null
        and btrim(coalesce(note.content, '')) not in ('早', '晚', '休')
        and note.starts_at >= cell_start$new$
  );

  if patched = definition and position(
    $needle$btrim(coalesce(note.content, '')) not in ('早', '晚', '休')$needle$ in definition
  ) = 0 then
    raise exception 'schedule single-cell note guard was not found';
  end if;

  execute patched;
end;
$$;

commit;
