begin;
-- A manually entered TO already satisfies the assistant-manager placeholder.
-- Preserve that note, do not create a duplicate system marker, and do not
-- report it as a conflict. Other notes and active bookings remain conflicts.
create or replace function public.bige_sync_fa_assistant_to_slot(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_second_hour timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  assistant public.profiles%rowtype;
  source_ids uuid[];
  is_off boolean := false;
  has_manual_to boolean := false;
  has_conflict boolean := false;
begin
  if p_tenant_id is null or p_second_hour is null then
    return;
  end if;

  select p.* into assistant
  from public.profiles p
  where p.tenant_id = p_tenant_id
    and p.is_active = true
    and p.department = 'coaching'
    and p.position = 'coach_assistant_manager'
    and (p_branch_id is null or p.branch_id is null or p.branch_id = p_branch_id)
  order by (p.branch_id is not distinct from p_branch_id) desc, p.created_at asc
  limit 1;

  if not found then
    return;
  end if;

  delete from public.bige_schedule_notes
  where tenant_id = p_tenant_id
    and coach_id = assistant.id
    and starts_at = p_second_hour
    and system_kind = 'fa_assistant_to';

  select array_agg(b.id order by b.id)
  into source_ids
  from public.bookings b
  where b.tenant_id = p_tenant_id
    and b.is_bige_schedule = true
    and b.operation_kind = 'trial'
    and b.status in ('pending', 'confirmed', 'booked', 'checked_in')
    and b.starts_at + interval '1 hour' = p_second_hour
    and b.coach_id <> assistant.id
    and (p_branch_id is null or b.branch_id is not distinct from p_branch_id);

  if coalesce(array_length(source_ids, 1), 0) = 0 then
    return;
  end if;

  select exists (
    select 1
    from public.bige_schedule_notes n
    where n.tenant_id = p_tenant_id
      and n.coach_id = assistant.id
      and encode(convert_to(trim(n.content), 'UTF8'), 'hex') = 'e4bc91'
      and (n.starts_at at time zone 'Asia/Taipei')::date =
          (p_second_hour at time zone 'Asia/Taipei')::date
      and n.system_kind is null
  ) into is_off;

  if is_off then
    return;
  end if;

  select exists (
    select 1
    from public.bige_schedule_notes n
    where n.tenant_id = p_tenant_id
      and n.coach_id = assistant.id
      and n.system_kind is null
      and upper(trim(n.content)) = 'TO'
      and tstzrange(n.starts_at, n.ends_at, '[)') &&
          tstzrange(p_second_hour, p_second_hour + interval '1 hour', '[)')
  ) into has_manual_to;

  if has_manual_to then
    return;
  end if;

  select exists (
    select 1
    from public.bookings b
    where b.tenant_id = p_tenant_id
      and b.coach_id = assistant.id
      and b.is_bige_schedule = true
      and b.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and tstzrange(b.starts_at, b.ends_at, '[)') &&
          tstzrange(p_second_hour, p_second_hour + interval '1 hour', '[)')
  ) or exists (
    select 1
    from public.bige_schedule_notes n
    where n.tenant_id = p_tenant_id
      and n.coach_id = assistant.id
      and n.system_kind is null
      and upper(trim(n.content)) <> 'TO'
      and encode(convert_to(trim(n.content), 'UTF8'), 'hex')
          not in ('e697a9', 'e6999a', 'e4bc91')
      and tstzrange(n.starts_at, n.ends_at, '[)') &&
          tstzrange(p_second_hour, p_second_hour + interval '1 hour', '[)')
  ) into has_conflict;

  if has_conflict then
    if not exists (
      select 1 from public.audit_logs a
      where a.tenant_id = p_tenant_id
        and a.action = 'bige_fa_assistant_to_conflict'
        and a.target_type = 'schedule_slot'
        and a.target_id = assistant.id::text || ':' || p_second_hour::text
        and a.created_at > now() - interval '1 day'
    ) then
      insert into public.audit_logs (
        tenant_id, actor_id, action, target_type, target_id, reason, payload
      ) values (
        p_tenant_id,
        auth.uid(),
        'bige_fa_assistant_to_conflict',
        'schedule_slot',
        assistant.id::text || ':' || p_second_hour::text,
        'assistant_manager_slot_occupied',
        jsonb_build_object('sourceBookingIds', source_ids, 'startsAt', p_second_hour)
      );
    end if;
    return;
  end if;

  insert into public.bige_schedule_notes (
    tenant_id, branch_id, coach_id, starts_at, ends_at, content,
    created_by, updated_by, source, system_kind, source_booking_ids, metadata
  ) values (
    p_tenant_id,
    p_branch_id,
    assistant.id,
    p_second_hour,
    p_second_hour + interval '1 hour',
    'TO',
    auth.uid(),
    auth.uid(),
    'system',
    'fa_assistant_to',
    source_ids,
    jsonb_build_object('reason', 'fa_second_hour', 'sourceCount', array_length(source_ids, 1))
  );
end;
$$;
-- Re-evaluate current and future FA slots so existing manual TO notes stop
-- appearing as conflicts immediately after this migration is applied.
do $$
declare
  slot record;
begin
  for slot in
    select distinct
      b.tenant_id,
      b.branch_id,
      b.starts_at + interval '1 hour' as second_hour
    from public.bookings b
    where b.is_bige_schedule = true
      and b.operation_kind = 'trial'
      and b.status in ('pending', 'confirmed', 'booked', 'checked_in')
      and (b.starts_at at time zone 'Asia/Taipei')::date >=
          (now() at time zone 'Asia/Taipei')::date
  loop
    perform public.bige_sync_fa_assistant_to_slot(
      slot.tenant_id, slot.branch_id, slot.second_hour
    );
  end loop;
end;
$$;
revoke all on function public.bige_sync_fa_assistant_to_slot(uuid, uuid, timestamptz)
  from public, anon;
grant execute on function public.bige_sync_fa_assistant_to_slot(uuid, uuid, timestamptz)
  to authenticated, service_role;
commit;
