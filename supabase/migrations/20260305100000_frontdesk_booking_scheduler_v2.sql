-- Frontdesk booking scheduler foundations:
-- - coach blocked slots
-- - booking waitlist
-- - booking sync queue (Google sync placeholder)
-- - concrete session_no recording for session_redemptions

alter table public.session_redemptions
  add column if not exists session_no integer check (session_no is null or session_no > 0);

create index if not exists session_redemptions_pass_session_idx
  on public.session_redemptions(tenant_id, pass_id, session_no, created_at desc);

create unique index if not exists session_redemptions_pass_session_unique
  on public.session_redemptions(tenant_id, pass_id, session_no)
  where redeemed_kind = 'pass'
    and pass_id is not null
    and session_no is not null;

create table if not exists public.coach_blocks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  note text,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists coach_blocks_tenant_coach_time_idx
  on public.coach_blocks(tenant_id, coach_id, starts_at, ends_at);

create index if not exists coach_blocks_tenant_branch_status_idx
  on public.coach_blocks(tenant_id, branch_id, status, starts_at desc);

create table if not exists public.booking_waitlist (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  member_id uuid references public.members(id) on delete set null,
  linked_booking_id uuid references public.bookings(id) on delete set null,
  contact_name text not null,
  contact_phone text,
  desired_date date,
  desired_time time,
  note text,
  status text not null default 'pending' check (status in ('pending', 'notified', 'booked', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists booking_waitlist_tenant_date_status_idx
  on public.booking_waitlist(tenant_id, desired_date, status, created_at asc);

create index if not exists booking_waitlist_tenant_member_idx
  on public.booking_waitlist(tenant_id, member_id, created_at desc);

create table if not exists public.booking_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  provider text not null default 'google_calendar',
  event_type text not null default 'upsert',
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  retries integer not null default 0 check (retries >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists booking_sync_jobs_tenant_status_idx
  on public.booking_sync_jobs(tenant_id, status, created_at desc);

create index if not exists booking_sync_jobs_booking_idx
  on public.booking_sync_jobs(tenant_id, booking_id, created_at desc);

alter table public.coach_blocks enable row level security;
alter table public.booking_waitlist enable row level security;
alter table public.booking_sync_jobs enable row level security;

drop policy if exists coach_blocks_tenant_access on public.coach_blocks;
create policy coach_blocks_tenant_access
  on public.coach_blocks
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = coach_blocks.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = coach_blocks.tenant_id
    )
  );

drop policy if exists booking_waitlist_tenant_access on public.booking_waitlist;
create policy booking_waitlist_tenant_access
  on public.booking_waitlist
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = booking_waitlist.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = booking_waitlist.tenant_id
    )
  );

drop policy if exists booking_sync_jobs_tenant_access on public.booking_sync_jobs;
create policy booking_sync_jobs_tenant_access
  on public.booking_sync_jobs
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = booking_sync_jobs.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = booking_sync_jobs.tenant_id
    )
  );

drop function if exists public.redeem_session(uuid, uuid, uuid, uuid, text, uuid, integer, text);

create or replace function public.redeem_session(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_member_id uuid,
  p_redeemed_by uuid,
  p_redeemed_kind text,
  p_pass_id uuid,
  p_quantity integer,
  p_note text,
  p_session_no integer default null
)
returns table (
  redemption_id uuid,
  booking_id uuid,
  member_id uuid,
  redeemed_kind text,
  quantity integer,
  note text,
  created_at timestamptz
)
language plpgsql
set search_path = public
as $$
declare
  v_redemption public.session_redemptions%rowtype;
  v_pass public.entry_passes%rowtype;
  v_quantity integer := greatest(1, coalesce(p_quantity, 1));
  v_session_no integer := null;
  v_match text[];
begin
  if p_tenant_id is null or p_member_id is null then
    raise exception 'invalid_redemption_input';
  end if;

  if p_redeemed_kind not in ('monthly', 'pass') then
    raise exception 'invalid_redeemed_kind';
  end if;

  if p_session_no is not null and p_session_no > 0 then
    v_session_no := p_session_no;
  elsif p_note is not null then
    v_match := regexp_match(p_note, 'session_no:([0-9]+)');
    if array_length(v_match, 1) = 1 then
      v_session_no := nullif(v_match[1], '')::integer;
    end if;
  end if;

  if p_redeemed_kind = 'pass' then
    if p_pass_id is null then
      raise exception 'pass_id_required';
    end if;

    select *
    into v_pass
    from public.entry_passes
    where id = p_pass_id
      and tenant_id = p_tenant_id
      and member_id = p_member_id
    for update;

    if not found then
      raise exception 'pass_not_found';
    end if;

    if coalesce(v_pass.remaining, 0) < v_quantity then
      raise exception 'insufficient_remaining_sessions';
    end if;

    update public.entry_passes
    set remaining = coalesce(remaining, 0) - v_quantity,
        updated_at = now()
    where id = p_pass_id
      and tenant_id = p_tenant_id;
  else
    v_session_no := null;
  end if;

  insert into public.session_redemptions (
    tenant_id,
    booking_id,
    member_id,
    redeemed_by,
    redeemed_kind,
    pass_id,
    session_no,
    quantity,
    note
  )
  values (
    p_tenant_id,
    p_booking_id,
    p_member_id,
    p_redeemed_by,
    p_redeemed_kind,
    p_pass_id,
    v_session_no,
    v_quantity,
    p_note
  )
  returning * into v_redemption;

  if p_booking_id is not null then
    update public.bookings
    set status = 'completed',
        updated_at = now()
    where id = p_booking_id
      and tenant_id = p_tenant_id
      and status in ('booked', 'checked_in');
  end if;

  return query
  select
    v_redemption.id,
    v_redemption.booking_id,
    v_redemption.member_id,
    v_redemption.redeemed_kind,
    v_redemption.quantity,
    v_redemption.note,
    v_redemption.created_at;
end;
$$;
