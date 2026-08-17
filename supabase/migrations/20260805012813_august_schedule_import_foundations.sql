-- Foundations for the one-time August coach schedule import.
-- This migration is intentionally additive and does not alter student self-training data.

create extension if not exists pgcrypto;

create table if not exists public.bige_schedule_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  source_filename text not null,
  source_sha256 text not null,
  source_period_start date not null,
  source_period_end date not null,
  status text not null default 'dry_run',
  total_rows integer not null default 0,
  succeeded_rows integer not null default 0,
  failed_rows integer not null default 0,
  skipped_rows integer not null default 0,
  backup_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bige_schedule_import_batches_period_check
    check (source_period_end >= source_period_start),
  constraint bige_schedule_import_batches_status_check
    check (status in ('dry_run', 'ready', 'running', 'partial', 'completed', 'failed', 'rolled_back')),
  constraint bige_schedule_import_batches_counts_check
    check (
      total_rows >= 0 and succeeded_rows >= 0 and failed_rows >= 0 and skipped_rows >= 0
    )
);

create index if not exists bige_schedule_import_batches_tenant_created_idx
  on public.bige_schedule_import_batches(tenant_id, created_at desc);

create table if not exists public.bige_schedule_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.bige_schedule_import_batches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_row_key text not null,
  source_sheet text not null default '蝮質”?',
  source_date date,
  source_time time,
  source_coach text,
  source_value text,
  item_kind text not null,
  status text not null default 'pending',
  normalized_payload jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  target_type text,
  target_id uuid,
  attempt_count integer not null default 0,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bige_schedule_import_rows_kind_check
    check (item_kind in ('booking', 'trial_booking', 'note', 'business_day', 'member', 'skipped')),
  constraint bige_schedule_import_rows_status_check
    check (status in ('pending', 'validated', 'succeeded', 'failed', 'skipped')),
  constraint bige_schedule_import_rows_attempt_check check (attempt_count >= 0),
  unique(batch_id, source_row_key)
);

create index if not exists bige_schedule_import_rows_batch_status_idx
  on public.bige_schedule_import_rows(batch_id, status, source_date, source_time);

create table if not exists public.bige_member_legacy_numbers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  legacy_number text not null,
  source text not null default 'legacy_schedule_import',
  import_batch_id uuid references public.bige_schedule_import_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bige_member_legacy_numbers_value_check
    check (legacy_number ~ '^[0-9]+$'),
  unique(tenant_id, member_id),
  unique(tenant_id, legacy_number, member_id)
);

create index if not exists bige_member_legacy_numbers_search_idx
  on public.bige_member_legacy_numbers(tenant_id, legacy_number);

create or replace function public.enforce_bige_legacy_number_share_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  shared_count integer;
begin
  select count(distinct member_id)
    into shared_count
  from public.bige_member_legacy_numbers
  where tenant_id = new.tenant_id
    and legacy_number = new.legacy_number
    and id is distinct from new.id;

  if shared_count >= 2 then
    raise exception 'legacy_number_share_limit_exceeded';
  end if;

  return new;
end;
$$;

drop trigger if exists bige_member_legacy_numbers_share_limit
  on public.bige_member_legacy_numbers;
create trigger bige_member_legacy_numbers_share_limit
before insert or update of tenant_id, legacy_number, member_id
on public.bige_member_legacy_numbers
for each row execute function public.enforce_bige_legacy_number_share_limit();

create table if not exists public.bige_business_day_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  business_date date not null,
  is_closed boolean not null default false,
  closure_label text,
  frontdesk_name text,
  source text not null default 'manual',
  import_batch_id uuid references public.bige_schedule_import_batches(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bige_business_day_settings_closure_label_check
    check (closure_label is null or char_length(btrim(closure_label)) between 1 and 80),
  constraint bige_business_day_settings_frontdesk_name_check
    check (frontdesk_name is null or char_length(btrim(frontdesk_name)) between 1 and 80),
  unique(tenant_id, business_date)
);

create index if not exists bige_business_day_settings_tenant_date_idx
  on public.bige_business_day_settings(tenant_id, business_date);

alter table public.bookings
  add column if not exists import_batch_id uuid
    references public.bige_schedule_import_batches(id) on delete set null,
  add column if not exists import_row_key text,
  add column if not exists requires_contract_followup boolean not null default false;

create unique index if not exists bookings_bige_import_row_unique
  on public.bookings(tenant_id, import_row_key)
  where import_row_key is not null;

alter table public.bige_schedule_notes
  add column if not exists import_batch_id uuid
    references public.bige_schedule_import_batches(id) on delete set null,
  add column if not exists import_row_key text,
  add column if not exists source text not null default 'manual';

create unique index if not exists bige_schedule_notes_import_row_unique
  on public.bige_schedule_notes(tenant_id, import_row_key)
  where import_row_key is not null;

alter table public.trial_bookings
  add column if not exists import_batch_id uuid
    references public.bige_schedule_import_batches(id) on delete set null,
  add column if not exists import_row_key text,
  add column if not exists exclude_from_marketing_stats boolean not null default false;

create unique index if not exists trial_bookings_import_row_unique
  on public.trial_bookings(import_row_key)
  where import_row_key is not null;

alter table public.bookings
  drop constraint if exists bookings_course_type_check;
alter table public.bookings
  add constraint bookings_course_type_check
  check (
    course_type is null
    or course_type in (
      'weight_training',
      'relaxation',
      'reformer_pilates',
      'sports_cupping',
      'fascia_knife',
      'onsite_assessment'
    )
  );

alter table public.trial_bookings
  drop constraint if exists trial_bookings_source_check;
alter table public.trial_bookings
  add constraint trial_bookings_source_check
  check (
    source in (
      'website',
      'official_line',
      'walk_in',
      'phone_booking',
      'br',
      'legacy_schedule_import'
    )
  );

alter table public.bige_schedule_import_batches enable row level security;
alter table public.bige_schedule_import_rows enable row level security;
alter table public.bige_member_legacy_numbers enable row level security;
alter table public.bige_business_day_settings enable row level security;

drop policy if exists bige_schedule_import_batches_tenant_read
  on public.bige_schedule_import_batches;
create policy bige_schedule_import_batches_tenant_read
  on public.bige_schedule_import_batches for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role in ('manager', 'frontdesk')
    )
  );

drop policy if exists bige_schedule_import_rows_tenant_read
  on public.bige_schedule_import_rows;
create policy bige_schedule_import_rows_tenant_read
  on public.bige_schedule_import_rows for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role in ('manager', 'frontdesk')
    )
  );

drop policy if exists bige_member_legacy_numbers_tenant_read
  on public.bige_member_legacy_numbers;
create policy bige_member_legacy_numbers_tenant_read
  on public.bige_member_legacy_numbers for select
  to authenticated
  using (
    public.is_platform_admin()
    or (public.current_is_active() and tenant_id = public.current_tenant_id())
  );

drop policy if exists bige_business_day_settings_tenant_read
  on public.bige_business_day_settings;
create policy bige_business_day_settings_tenant_read
  on public.bige_business_day_settings for select
  to authenticated
  using (
    public.is_platform_admin()
    or (public.current_is_active() and tenant_id = public.current_tenant_id())
  );

grant select on table public.bige_schedule_import_batches to authenticated;
grant select on table public.bige_schedule_import_rows to authenticated;
grant select on table public.bige_member_legacy_numbers to authenticated;
grant select on table public.bige_business_day_settings to authenticated;

grant all on table public.bige_schedule_import_batches to service_role;
grant all on table public.bige_schedule_import_rows to service_role;
grant all on table public.bige_member_legacy_numbers to service_role;
grant all on table public.bige_business_day_settings to service_role;

comment on table public.bige_schedule_import_batches is
  'One-time schedule import batch, including pre-import backup and aggregate audit data.';
comment on table public.bige_schedule_import_rows is
  'Row-level schedule import audit. Failed rows remain retryable without duplicating successful rows.';
comment on table public.bige_member_legacy_numbers is
  'Legacy workbook member number. A number may be shared by at most two distinct formal members.';
comment on table public.bige_business_day_settings is
  'Facility closure and daily frontdesk display settings. Independent from daily report closure records.';

-- Preserve all validation in the existing booking RPC. The three newly introduced
-- course types do not consume shared reformer/relaxation equipment, so they can be
-- validated through the weight-training path and then receive their real type.
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
    return public.bige_create_schedule_booking(
      p_tenant_id,
      p_branch_id,
      p_member_id,
      p_trial_booking_id,
      p_coach_id,
      p_operation_kind,
      p_course_type,
      p_starts_at,
      p_ends_at,
      p_note,
      p_group_id,
      p_idempotency_key
    );
  end if;

  result := public.bige_create_schedule_booking(
    p_tenant_id,
    p_branch_id,
    p_member_id,
    p_trial_booking_id,
    p_coach_id,
    p_operation_kind,
    'weight_training',
    p_starts_at,
    p_ends_at,
    p_note,
    p_group_id,
    p_idempotency_key
  );

  booking_id := (result ->> 'bookingId')::uuid;

  select course_type
    into stored_course_type
  from public.bookings
  where id = booking_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'schedule_booking_not_found';
  end if;

  if coalesce((result ->> 'replayed')::boolean, false)
     and stored_course_type <> p_course_type then
    raise exception 'idempotency_key_conflict';
  end if;

  service_label := case p_course_type
    when 'sports_cupping' then '????'
    when 'fascia_knife' then '蝑??'
    when 'onsite_assessment' then '?曉閰摯'
  end;

  if not coalesce((result ->> 'replayed')::boolean, false) then
    update public.bookings
    set course_type = p_course_type,
        service_name = service_label,
        updated_at = now()
    where id = booking_id;

    update public.audit_logs
    set payload = jsonb_set(
      coalesce(payload, '{}'::jsonb),
      '{courseType}',
      to_jsonb(p_course_type),
      true
    )
    where tenant_id = p_tenant_id
      and action = 'bige_schedule_booking_created'
      and target_type = 'booking'
      and target_id = booking_id::text;
  end if;

  return result;
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
    return public.bige_reschedule_schedule_booking(
      p_booking_id,
      p_branch_id,
      p_coach_id,
      p_course_type,
      p_starts_at,
      p_ends_at,
      p_note
    );
  end if;

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
    when 'sports_cupping' then '????'
    when 'fascia_knife' then '蝑??'
    when 'onsite_assessment' then '?曉閰摯'
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

  return result;
end;
$$;

revoke all on function public.bige_reschedule_schedule_booking_v2(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) from public, anon;
grant execute on function public.bige_reschedule_schedule_booking_v2(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) to authenticated, service_role;

;
