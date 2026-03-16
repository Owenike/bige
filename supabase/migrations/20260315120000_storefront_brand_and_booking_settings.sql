-- Phase 1 foundations for sports massage storefront + booking rules.
-- Scope:
-- - storefront brand content per tenant / branch
-- - branch booking settings with deposit toggles
-- - additive booking / service columns for later phases
-- - booking status log trigger
-- - role expansion for store_owner / store_manager / therapist / customer

do $$
begin
  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'store_owner'
  ) then
    alter type public.app_role add value 'store_owner';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'store_manager'
  ) then
    alter type public.app_role add value 'store_manager';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'therapist'
  ) then
    alter type public.app_role add value 'therapist';
  end if;

  if not exists (
    select 1
    from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'app_role' and e.enumlabel = 'customer'
  ) then
    alter type public.app_role add value 'customer';
  end if;
end $$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.services
  add column if not exists branch_id uuid references public.branches(id) on delete set null,
  add column if not exists description text,
  add column if not exists price_amount numeric(12, 2) not null default 0,
  add column if not exists pre_buffer_minutes integer not null default 0 check (pre_buffer_minutes >= 0),
  add column if not exists post_buffer_minutes integer not null default 0 check (post_buffer_minutes >= 0),
  add column if not exists requires_deposit boolean not null default false,
  add column if not exists deposit_calculation_type text not null default 'fixed' check (deposit_calculation_type in ('fixed', 'percent')),
  add column if not exists deposit_value numeric(12, 2) not null default 0,
  add column if not exists sort_order integer not null default 0,
  add column if not exists deleted_at timestamptz;

create index if not exists services_tenant_branch_active_idx
  on public.services(tenant_id, branch_id, is_active, sort_order, created_at desc);

alter table public.bookings
  add column if not exists customer_name text,
  add column if not exists customer_phone text,
  add column if not exists customer_note text,
  add column if not exists public_reference text default concat('BK-', upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  add column if not exists source text not null default 'staff' check (source in ('staff', 'public', 'member', 'import')),
  add column if not exists payment_status text not null default 'unpaid' check (
    payment_status in ('unpaid', 'deposit_pending', 'deposit_paid', 'fully_paid', 'refunded', 'partially_refunded')
  ),
  add column if not exists payment_method text,
  add column if not exists deposit_required_amount numeric(12, 2) not null default 0,
  add column if not exists deposit_paid_amount numeric(12, 2) not null default 0,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists status_reason text,
  add column if not exists status_updated_at timestamptz not null default now(),
  add column if not exists confirmed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists rescheduled_from_booking_id uuid references public.bookings(id) on delete set null,
  add column if not exists rescheduled_to_booking_id uuid references public.bookings(id) on delete set null;

alter table public.bookings
  drop constraint if exists bookings_status_check;

alter table public.bookings
  add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'booked', 'checked_in', 'completed', 'cancelled', 'no_show'));

create unique index if not exists bookings_public_reference_uidx
  on public.bookings(tenant_id, public_reference)
  where public_reference is not null;

create index if not exists bookings_tenant_payment_status_idx
  on public.bookings(tenant_id, payment_status, starts_at desc);

create table if not exists public.store_booking_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  scope_key text generated always as (coalesce(branch_id::text, '__tenant__')) stored,
  deposits_enabled boolean not null default false,
  deposit_required_mode text not null default 'optional' check (deposit_required_mode in ('optional', 'required')),
  deposit_calculation_type text not null default 'fixed' check (deposit_calculation_type in ('fixed', 'percent')),
  deposit_value numeric(12, 2) not null default 0,
  allow_customer_reschedule boolean not null default true,
  allow_customer_cancel boolean not null default true,
  latest_cancel_hours integer not null default 24 check (latest_cancel_hours between 0 and 720),
  latest_reschedule_hours integer not null default 12 check (latest_reschedule_hours between 0 and 720),
  notifications_enabled boolean not null default true,
  reminder_day_before_enabled boolean not null default true,
  reminder_hour_before_enabled boolean not null default true,
  deposit_reminder_enabled boolean not null default false,
  cross_store_therapist_enabled boolean not null default false,
  booking_window_days integer not null default 30 check (booking_window_days between 1 and 365),
  min_advance_minutes integer not null default 90 check (min_advance_minutes between 0 and 10080),
  slot_interval_minutes integer not null default 30 check (slot_interval_minutes in (5, 10, 15, 20, 30, 45, 60)),
  timezone text not null default 'Asia/Taipei',
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, scope_key)
);

create index if not exists store_booking_settings_tenant_branch_idx
  on public.store_booking_settings(tenant_id, branch_id, updated_at desc);

create table if not exists public.storefront_brand_contents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  scope_key text generated always as (coalesce(branch_id::text, '__tenant__')) stored,
  brand_name text not null default '',
  hero_title text not null default '',
  hero_subtitle text not null default '',
  hero_image_url text not null default '',
  mobile_feature_image_url text not null default '',
  intro_title text not null default '',
  intro_body text not null default '',
  services_section_title text not null default '',
  services_section_subtitle text not null default '',
  booking_notice_title text not null default '',
  booking_notice_body text not null default '',
  contact_title text not null default '',
  contact_body text not null default '',
  contact_phone text not null default '',
  contact_email text not null default '',
  contact_address text not null default '',
  contact_line text not null default '',
  cta_primary_label text not null default 'Book Now',
  cta_secondary_label text not null default 'Learn More',
  about_section_enabled boolean not null default true,
  team_section_enabled boolean not null default true,
  portfolio_section_enabled boolean not null default false,
  contact_section_enabled boolean not null default true,
  custom_nav_items jsonb not null default '[]'::jsonb,
  business_hours jsonb not null default '[]'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  visual_preferences jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, scope_key)
);

create index if not exists storefront_brand_contents_tenant_branch_idx
  on public.storefront_brand_contents(tenant_id, branch_id, updated_at desc);

create table if not exists public.storefront_brand_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  kind text not null check (kind in ('hero', 'mobile_feature', 'gallery', 'logo', 'other')),
  bucket_name text not null default 'storefront-assets',
  storage_path text not null,
  public_url text not null,
  alt_text text,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists storefront_brand_assets_tenant_branch_kind_idx
  on public.storefront_brand_assets(tenant_id, branch_id, kind, created_at desc);

create table if not exists public.booking_status_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  reason text,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists booking_status_logs_tenant_booking_idx
  on public.booking_status_logs(tenant_id, booking_id, created_at desc);

create or replace function public.log_booking_status_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.booking_status_logs (
      tenant_id,
      booking_id,
      from_status,
      to_status,
      actor_id,
      reason,
      payload
    )
    values (
      new.tenant_id,
      new.id,
      null,
      new.status,
      coalesce(auth.uid(), new.created_by),
      'booking_created',
      jsonb_build_object(
        'starts_at', new.starts_at,
        'ends_at', new.ends_at,
        'coach_id', new.coach_id,
        'branch_id', new.branch_id
      )
    );
    return new;
  end if;

  if old.status is distinct from new.status then
    new.status_updated_at = now();
    if new.status = 'confirmed' then
      new.confirmed_at = coalesce(new.confirmed_at, now());
    elsif new.status = 'completed' then
      new.completed_at = coalesce(new.completed_at, now());
    elsif new.status = 'cancelled' then
      new.cancelled_at = coalesce(new.cancelled_at, now());
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.write_booking_status_log()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.booking_status_logs (
      tenant_id,
      booking_id,
      from_status,
      to_status,
      actor_id,
      reason,
      note,
      payload
    )
    values (
      new.tenant_id,
      new.id,
      old.status,
      new.status,
      coalesce(auth.uid(), new.created_by),
      coalesce(new.status_reason, 'status_changed'),
      new.note,
      jsonb_build_object(
        'starts_at', new.starts_at,
        'ends_at', new.ends_at,
        'coach_id', new.coach_id,
        'branch_id', new.branch_id,
        'payment_status', new.payment_status
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_status_before_change on public.bookings;
create trigger bookings_status_before_change
before insert or update on public.bookings
for each row
execute function public.log_booking_status_change();

drop trigger if exists bookings_status_after_change on public.bookings;
create trigger bookings_status_after_change
after update of status on public.bookings
for each row
when (old.status is distinct from new.status)
execute function public.write_booking_status_log();

drop trigger if exists store_booking_settings_touch_updated_at on public.store_booking_settings;
create trigger store_booking_settings_touch_updated_at
before update on public.store_booking_settings
for each row
execute function public.touch_updated_at();

drop trigger if exists storefront_brand_contents_touch_updated_at on public.storefront_brand_contents;
create trigger storefront_brand_contents_touch_updated_at
before update on public.storefront_brand_contents
for each row
execute function public.touch_updated_at();

drop trigger if exists storefront_brand_assets_touch_updated_at on public.storefront_brand_assets;
create trigger storefront_brand_assets_touch_updated_at
before update on public.storefront_brand_assets
for each row
execute function public.touch_updated_at();

alter table public.store_booking_settings enable row level security;
alter table public.storefront_brand_contents enable row level security;
alter table public.storefront_brand_assets enable row level security;
alter table public.booking_status_logs enable row level security;

drop policy if exists store_booking_settings_access on public.store_booking_settings;
create policy store_booking_settings_access
  on public.store_booking_settings
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  );

drop policy if exists storefront_brand_contents_access on public.storefront_brand_contents;
create policy storefront_brand_contents_access
  on public.storefront_brand_contents
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  );

drop policy if exists storefront_brand_assets_access on public.storefront_brand_assets;
create policy storefront_brand_assets_access
  on public.storefront_brand_assets
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  );

drop policy if exists booking_status_logs_access on public.booking_status_logs;
create policy booking_status_logs_access
  on public.booking_status_logs
  for select
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  );

drop policy if exists booking_status_logs_insert_access on public.booking_status_logs;
create policy booking_status_logs_insert_access
  on public.booking_status_logs
  for insert
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  );
