begin;
-- Keep the schedule permission rule in one place. Employee 01 and 06 are
-- explicit operators; coaching team leads and above may also manage it.
create or replace function public.bige_profile_can_manage_schedule(p_actor public.profiles)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    p_actor.is_active = true
    and (
      p_actor.role = 'platform_admin'
      or upper(coalesce(p_actor.employee_number, '')) in ('E000001', 'E000006')
      or (
        p_actor.department = 'coaching'
        and p_actor.position in (
          'coach_team_lead',
          'coach_director',
          'coach_assistant_manager',
          'coach_manager',
          'coach_city_manager'
        )
      )
      or (
        p_actor.department is null
        and p_actor.position is null
        and p_actor.role in (
          'manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'
        )
      )
    );
$$;
revoke all on function public.bige_profile_can_manage_schedule(public.profiles) from public, anon;
grant execute on function public.bige_profile_can_manage_schedule(public.profiles) to authenticated, service_role;
-- Upgrade the existing RPC permission checks without duplicating their
-- booking/contract business rules.
do $$
declare
  definition text;
  patched text;
begin
  definition := pg_get_functiondef(
    'public.bige_create_schedule_booking(uuid,uuid,uuid,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,text,uuid,text)'::regprocedure
  );
  patched := replace(
    definition,
    $old$if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk') then
    raise exception 'forbidden';
  end if;$old$,
    $new$if not found or not public.bige_profile_can_manage_schedule(actor) then
    raise exception 'forbidden';
  end if;$new$
  );
  if patched = definition then
    raise exception 'bige_create_schedule_booking permission block was not found';
  end if;
  execute patched;
end;
$$;
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
    $old$if actor.role not in (
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
  end if;$old$,
    $new$if not public.bige_profile_can_manage_schedule(actor) then
    raise exception 'schedule_drag_forbidden';
  end if;$new$
  );
  if patched = definition then
    raise exception 'bige_drag_schedule_booking permission block was not found';
  end if;
  execute patched;
end;
$$;
-- Add marker metadata before rebuilding the cell constraint function because
-- that function references these columns at creation time.
alter table public.bige_schedule_notes
  add column if not exists system_kind text,
  add column if not exists source_booking_ids uuid[] not null default '{}'::uuid[],
  add column if not exists metadata jsonb not null default '{}'::jsonb;
-- A cancelled cell remains visible for history, but it must not prevent a
-- replacement class or FA from being scheduled in the same hour.
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
  lock_key := new.tenant_id::text || ':' || new.coach_id::text || ':' || cell_start::text;

  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));

  if tg_table_name = 'bookings' then
    if lower(coalesce(new.status, '')) in ('cancelled', 'canceled') then
      return new;
    end if;

    if exists (
      select 1
      from public.bookings booking
      where booking.tenant_id = new.tenant_id
        and booking.coach_id = new.coach_id
        and booking.is_bige_schedule = true
        and lower(coalesce(booking.status, '')) not in ('cancelled', 'canceled')
        and booking.starts_at >= cell_start
        and booking.starts_at < cell_end
        and booking.id <> new.id
    ) or exists (
      select 1
      from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and note.system_kind is null
        and note.starts_at >= cell_start
        and note.starts_at < cell_end
    ) then
      raise exception 'schedule_cell_occupied' using errcode = '23505';
    end if;
  else
    -- System-generated FA markers must never make a real booking/note slot
    -- unusable. When a human writes in that cell, retire the marker first.
    if new.system_kind is null then
      delete from public.bige_schedule_notes note
      where note.tenant_id = new.tenant_id
        and note.coach_id = new.coach_id
        and note.system_kind = 'fa_assistant_to'
        and note.starts_at >= cell_start
        and note.starts_at < cell_end;
    end if;

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
        and lower(coalesce(booking.status, '')) not in ('cancelled', 'canceled')
        and booking.starts_at >= cell_start
        and booking.starts_at < cell_end
    ) then
      raise exception 'schedule_cell_occupied' using errcode = '23505';
    end if;
  end if;

  return new;
end;
$$;
alter table public.bige_schedule_notes
  drop constraint if exists bige_schedule_notes_system_kind_check;
alter table public.bige_schedule_notes
  add constraint bige_schedule_notes_system_kind_check
  check (system_kind is null or system_kind in ('fa_assistant_to'));
create unique index if not exists bige_schedule_notes_fa_assistant_to_unique
  on public.bige_schedule_notes(tenant_id, coach_id, starts_at, system_kind)
  where system_kind = 'fa_assistant_to';
-- Rebuild the assistant-manager TO marker for one second-hour slot. A real
-- class or manual note always wins. Multiple simultaneous FAs share one marker.
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
  source_coach_ids uuid[];
  is_off boolean := false;
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

  select
    array_agg(b.id order by b.id),
    array_agg(distinct b.coach_id)
  into source_ids, source_coach_ids
  from public.bookings b
  where b.tenant_id = p_tenant_id
    and b.is_bige_schedule = true
    and b.operation_kind = 'trial'
    and b.status in ('pending', 'confirmed', 'booked', 'checked_in')
    and b.starts_at + interval '1 hour' = p_second_hour
    and (p_branch_id is null or b.branch_id is not distinct from p_branch_id);

  if coalesce(array_length(source_ids, 1), 0) = 0
     or assistant.id = any(source_coach_ids) then
    return;
  end if;

  select exists (
    select 1
    from public.bige_schedule_notes n
    where n.tenant_id = p_tenant_id
      and n.coach_id = assistant.id
      and n.content = '休'
      and (n.starts_at at time zone 'Asia/Taipei')::date =
          (p_second_hour at time zone 'Asia/Taipei')::date
      and n.system_kind is null
  ) into is_off;

  if is_off then
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
create or replace function public.bige_sync_fa_assistant_to_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE', 'DELETE')
     and old.is_bige_schedule = true
     and old.operation_kind = 'trial' then
    perform public.bige_sync_fa_assistant_to_slot(
      old.tenant_id, old.branch_id, old.starts_at + interval '1 hour'
    );
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and new.is_bige_schedule = true
     and new.operation_kind = 'trial' then
    perform public.bige_sync_fa_assistant_to_slot(
      new.tenant_id, new.branch_id, new.starts_at + interval '1 hour'
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_bige_sync_fa_assistant_to on public.bookings;
create trigger bookings_bige_sync_fa_assistant_to
after insert or update or delete
on public.bookings
for each row
execute function public.bige_sync_fa_assistant_to_trigger();
revoke all on function public.bige_sync_fa_assistant_to_slot(uuid, uuid, timestamptz) from public, anon;
revoke all on function public.bige_sync_fa_assistant_to_trigger() from public, anon;
grant execute on function public.bige_sync_fa_assistant_to_slot(uuid, uuid, timestamptz) to authenticated, service_role;
-- Staff usage telemetry. Only server-side/service-role code writes these
-- tables; managers receive a summarized view through the application API.
create table if not exists public.staff_login_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  employee_number text,
  event_type text not null default 'login',
  user_agent text,
  ip_address text,
  created_at timestamptz not null default now(),
  constraint staff_login_events_type_check check (event_type in ('login', 'login_failed', 'logout'))
);
create index if not exists staff_login_events_tenant_created_idx
  on public.staff_login_events(tenant_id, created_at desc);
create index if not exists staff_login_events_profile_created_idx
  on public.staff_login_events(profile_id, created_at desc);
create table if not exists public.staff_page_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  path text not null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer not null default 0,
  user_agent text,
  constraint staff_page_sessions_duration_check check (duration_seconds >= 0)
);
create index if not exists staff_page_sessions_tenant_started_idx
  on public.staff_page_sessions(tenant_id, started_at desc);
create index if not exists staff_page_sessions_profile_started_idx
  on public.staff_page_sessions(profile_id, started_at desc);
alter table public.staff_login_events enable row level security;
alter table public.staff_page_sessions enable row level security;
revoke all on table public.staff_login_events from public, anon, authenticated;
revoke all on table public.staff_page_sessions from public, anon, authenticated;
grant all on table public.staff_login_events to service_role;
grant all on table public.staff_page_sessions to service_role;
commit;
