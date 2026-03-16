create extension if not exists btree_gist;

create table if not exists public.coach_branch_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, coach_id, branch_id)
);

create index if not exists coach_branch_links_tenant_branch_idx
  on public.coach_branch_links(tenant_id, branch_id, is_active, created_at desc);

create unique index if not exists coach_branch_links_primary_uidx
  on public.coach_branch_links(tenant_id, coach_id)
  where is_primary = true and is_active = true;

create table if not exists public.coach_recurring_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  timezone text not null default 'Asia/Taipei',
  effective_from date,
  effective_until date,
  is_active boolean not null default true,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  check (effective_until is null or effective_from is null or effective_until >= effective_from)
);

create index if not exists coach_recurring_schedules_tenant_lookup_idx
  on public.coach_recurring_schedules(tenant_id, coach_id, branch_id, is_active, day_of_week);

create index if not exists coach_recurring_schedules_effective_idx
  on public.coach_recurring_schedules(tenant_id, effective_from, effective_until);

alter table public.coach_blocks
  add column if not exists block_type text not null default 'blocked'
  check (block_type in ('time_off', 'blocked', 'offsite', 'other'));

create index if not exists coach_blocks_tenant_type_idx
  on public.coach_blocks(tenant_id, coach_id, block_type, starts_at desc);

alter table public.bookings
  add column if not exists occupied_starts_at timestamptz,
  add column if not exists occupied_ends_at timestamptz,
  add column if not exists coach_conflict_scope text;

create index if not exists bookings_tenant_coach_occupied_idx
  on public.bookings(tenant_id, coach_id, occupied_starts_at, occupied_ends_at);

create or replace function public.resolve_booking_service_timing(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_service_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns table (
  duration_minutes integer,
  pre_buffer_minutes integer,
  post_buffer_minutes integer
)
language plpgsql
set search_path = public
as $$
declare
  v_service public.services%rowtype;
begin
  select *
  into v_service
  from public.services s
  where s.tenant_id = p_tenant_id
    and coalesce(s.deleted_at, 'infinity'::timestamptz) = 'infinity'::timestamptz
    and s.is_active = true
    and lower(s.name) = lower(coalesce(p_service_name, ''))
    and (s.branch_id = p_branch_id or s.branch_id is null)
  order by
    case when s.branch_id = p_branch_id then 0 else 1 end,
    s.updated_at desc nulls last,
    s.created_at desc
  limit 1;

  if found then
    return query
    select
      greatest(1, coalesce(v_service.duration_minutes, greatest(1, ceil(extract(epoch from (p_ends_at - p_starts_at)) / 60.0)::integer))),
      greatest(0, coalesce(v_service.pre_buffer_minutes, 0)),
      greatest(0, coalesce(v_service.post_buffer_minutes, 0));
    return;
  end if;

  return query
  select
    greatest(1, ceil(extract(epoch from (p_ends_at - p_starts_at)) / 60.0)::integer),
    0,
    0;
end;
$$;

create or replace function public.resolve_booking_conflict_scope(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_coach_id uuid
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_settings public.store_booking_settings%rowtype;
begin
  if p_coach_id is null then
    return null;
  end if;

  select *
  into v_settings
  from public.store_booking_settings s
  where s.tenant_id = p_tenant_id
    and (s.branch_id = p_branch_id or s.branch_id is null)
  order by case when s.branch_id = p_branch_id then 0 else 1 end, s.updated_at desc nulls last
  limit 1;

  if found and coalesce(v_settings.cross_store_therapist_enabled, false) then
    return p_coach_id::text;
  end if;

  if p_branch_id is null then
    return p_coach_id::text;
  end if;

  return concat(p_coach_id::text, '::', p_branch_id::text);
end;
$$;

create or replace function public.set_booking_schedule_fields()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_timing record;
begin
  if new.starts_at is null or new.ends_at is null then
    new.occupied_starts_at := new.starts_at;
    new.occupied_ends_at := new.ends_at;
    new.coach_conflict_scope := public.resolve_booking_conflict_scope(new.tenant_id, new.branch_id, new.coach_id);
    return new;
  end if;

  select *
  into v_timing
  from public.resolve_booking_service_timing(new.tenant_id, new.branch_id, new.service_name, new.starts_at, new.ends_at)
  limit 1;

  new.occupied_starts_at := new.starts_at - make_interval(mins => greatest(0, coalesce(v_timing.pre_buffer_minutes, 0)));
  new.occupied_ends_at := new.ends_at + make_interval(mins => greatest(0, coalesce(v_timing.post_buffer_minutes, 0)));
  new.coach_conflict_scope := public.resolve_booking_conflict_scope(new.tenant_id, new.branch_id, new.coach_id);
  return new;
end;
$$;

drop trigger if exists bookings_set_schedule_fields on public.bookings;
create trigger bookings_set_schedule_fields
before insert or update of branch_id, coach_id, service_name, starts_at, ends_at, status
on public.bookings
for each row
execute function public.set_booking_schedule_fields();

update public.bookings
set updated_at = updated_at
where occupied_starts_at is null
   or occupied_ends_at is null
   or coach_conflict_scope is null;

alter table public.bookings
  drop constraint if exists bookings_coach_occupancy_excl;

alter table public.bookings
  add constraint bookings_coach_occupancy_excl
  exclude using gist (
    tenant_id with =,
    coach_conflict_scope with =,
    tstzrange(occupied_starts_at, occupied_ends_at, '[)') with &&
  )
  where (
    coach_conflict_scope is not null
    and occupied_starts_at is not null
    and occupied_ends_at is not null
    and status in ('pending', 'confirmed', 'booked', 'checked_in')
  );

alter table public.coach_branch_links enable row level security;
alter table public.coach_recurring_schedules enable row level security;

drop policy if exists coach_branch_links_tenant_access on public.coach_branch_links;
create policy coach_branch_links_tenant_access
  on public.coach_branch_links
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  );

drop policy if exists coach_recurring_schedules_tenant_access on public.coach_recurring_schedules;
create policy coach_recurring_schedules_tenant_access
  on public.coach_recurring_schedules
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  );

drop trigger if exists coach_branch_links_touch_updated_at on public.coach_branch_links;
create trigger coach_branch_links_touch_updated_at
before update on public.coach_branch_links
for each row
execute function public.touch_updated_at();

drop trigger if exists coach_recurring_schedules_touch_updated_at on public.coach_recurring_schedules;
create trigger coach_recurring_schedules_touch_updated_at
before update on public.coach_recurring_schedules
for each row
execute function public.touch_updated_at();

insert into public.coach_branch_links (tenant_id, coach_id, branch_id, is_primary, is_active)
select distinct p.tenant_id, p.id, p.branch_id, true, true
from public.profiles p
where p.role in ('coach', 'therapist')
  and p.tenant_id is not null
  and p.branch_id is not null
on conflict (tenant_id, coach_id, branch_id) do update
set is_primary = excluded.is_primary,
    is_active = true,
    updated_at = now();

insert into public.coach_branch_links (tenant_id, coach_id, branch_id, is_primary, is_active)
select distinct b.tenant_id, b.coach_id, b.branch_id, false, true
from public.bookings b
where b.coach_id is not null
  and b.branch_id is not null
on conflict (tenant_id, coach_id, branch_id) do update
set is_active = true,
    updated_at = now();

insert into public.coach_branch_links (tenant_id, coach_id, branch_id, is_primary, is_active)
select distinct s.tenant_id, s.coach_id, s.branch_id, false, true
from public.coach_slots s
where s.branch_id is not null
on conflict (tenant_id, coach_id, branch_id) do update
set is_active = true,
    updated_at = now();
