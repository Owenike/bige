-- BIG E daily fitness operations.
-- This migration is additive: existing bookings, trial booking, payment and check-in
-- flows keep their current columns and behavior.

create extension if not exists pgcrypto;

create sequence if not exists public.bige_member_code_seq
  as bigint
  start with 1
  increment by 1
  no cycle;

do $$
declare
  highest_code bigint;
begin
  select max(substring(member_code from 2)::bigint)
    into highest_code
  from public.members
  where member_code ~ '^E[0-9]{6}$';

  if highest_code is null then
    perform setval('public.bige_member_code_seq', 1, false);
  else
    perform setval('public.bige_member_code_seq', highest_code, true);
  end if;
end;
$$;

create or replace function public.next_bige_member_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value bigint;
begin
  next_value := nextval('public.bige_member_code_seq');
  return 'E' || lpad(next_value::text, 6, '0');
end;
$$;

revoke all on function public.next_bige_member_code() from public, anon, authenticated;

alter table public.members
  add column if not exists is_prospect boolean not null default false,
  add column if not exists email_unavailable boolean not null default false,
  add column if not exists phone_normalized text,
  add column if not exists attendance_pin_hash text,
  add column if not exists attendance_pin_set_at timestamptz,
  add column if not exists attendance_pin_reset_required boolean not null default false,
  add column if not exists primary_coach_id uuid references public.profiles(id) on delete set null;

update public.members
set phone_normalized = regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
where phone_normalized is null;

create unique index if not exists members_member_code_unique
  on public.members(member_code)
  where member_code is not null;

create index if not exists members_tenant_member_code_search_idx
  on public.members(tenant_id, member_code)
  where member_code is not null;

create index if not exists members_tenant_phone_normalized_search_idx
  on public.members(tenant_id, phone_normalized)
  where phone_normalized is not null and phone_normalized <> '';

create index if not exists members_tenant_name_search_idx
  on public.members(tenant_id, lower(full_name));

alter table public.profiles
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_reset_required_at timestamptz,
  add column if not exists staff_email_verified_at timestamptz;

alter table public.member_plan_catalog
  add column if not exists fitness_plan_kind text not null default 'legacy',
  add column if not exists total_sessions integer,
  add column if not exists course_allocations jsonb not null default '{}'::jsonb,
  add column if not exists validity_bonus_days integer not null default 30,
  add column if not exists fitness_visible boolean not null default false,
  add column if not exists version integer not null default 1,
  add column if not exists supersedes_plan_id uuid references public.member_plan_catalog(id) on delete set null;

alter table public.member_plan_catalog
  drop constraint if exists member_plan_catalog_fitness_plan_kind_check;
alter table public.member_plan_catalog
  add constraint member_plan_catalog_fitness_plan_kind_check
  check (fitness_plan_kind in ('legacy', 'pt_fixed', 'pt_custom'));

alter table public.member_plan_catalog
  drop constraint if exists member_plan_catalog_total_sessions_check;
alter table public.member_plan_catalog
  add constraint member_plan_catalog_total_sessions_check
  check (total_sessions is null or total_sessions > 0);

alter table public.member_plan_catalog
  drop constraint if exists member_plan_catalog_validity_bonus_days_check;
alter table public.member_plan_catalog
  add constraint member_plan_catalog_validity_bonus_days_check
  check (validity_bonus_days >= 0);

create index if not exists member_plan_catalog_fitness_visible_idx
  on public.member_plan_catalog(tenant_id, fitness_visible, is_active, created_at desc);

alter table public.member_plan_contracts
  add column if not exists contract_number text,
  add column if not exists signed_on date,
  add column if not exists total_sessions integer,
  add column if not exists total_amount bigint,
  add column if not exists unlocked_sessions integer not null default 0,
  add column if not exists used_sessions integer not null default 0,
  add column if not exists course_allocations jsonb not null default '{}'::jsonb,
  add column if not exists course_used jsonb not null default '{}'::jsonb,
  add column if not exists payment_status text not null default 'unpaid',
  add column if not exists extension_limit_days integer not null default 0,
  add column if not exists extension_used_days integer not null default 0,
  add column if not exists original_ends_at timestamptz,
  add column if not exists source_trial_booking_id uuid references public.trial_bookings(id) on delete set null,
  add column if not exists converted_from_booking_id uuid references public.bookings(id) on delete set null;

alter table public.member_plan_contracts
  drop constraint if exists member_plan_contracts_fitness_session_counts_check;
alter table public.member_plan_contracts
  add constraint member_plan_contracts_fitness_session_counts_check
  check (
    (total_sessions is null or total_sessions > 0)
    and unlocked_sessions >= 0
    and used_sessions >= 0
    and (total_sessions is null or unlocked_sessions <= total_sessions)
    and (total_sessions is null or used_sessions <= total_sessions)
  );

alter table public.member_plan_contracts
  drop constraint if exists member_plan_contracts_total_amount_check;
alter table public.member_plan_contracts
  add constraint member_plan_contracts_total_amount_check
  check (total_amount is null or total_amount >= 0);

alter table public.member_plan_contracts
  drop constraint if exists member_plan_contracts_payment_status_check;
alter table public.member_plan_contracts
  add constraint member_plan_contracts_payment_status_check
  check (payment_status in ('unpaid', 'deposit_paid', 'partially_paid', 'settled', 'overdue', 'refunded'));

create unique index if not exists member_plan_contracts_contract_number_unique
  on public.member_plan_contracts(contract_number)
  where contract_number is not null;

create index if not exists member_plan_contracts_member_expiry_idx
  on public.member_plan_contracts(member_id, ends_at, status);

alter table public.bookings
  add column if not exists is_bige_schedule boolean not null default false,
  add column if not exists operation_kind text,
  add column if not exists course_type text,
  add column if not exists trial_stage text,
  add column if not exists operation_result text,
  add column if not exists trial_booking_id uuid references public.trial_bookings(id) on delete set null,
  add column if not exists group_id uuid,
  add column if not exists reminder_status text not null default 'pending',
  add column if not exists reminder_updated_at timestamptz,
  add column if not exists reminder_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists converted_at timestamptz,
  add column if not exists converted_contract_id uuid references public.member_plan_contracts(id) on delete set null,
  add column if not exists operation_idempotency_key text;

alter table public.bookings
  drop constraint if exists bookings_operation_kind_check;
alter table public.bookings
  add constraint bookings_operation_kind_check
  check (operation_kind is null or operation_kind in ('pt', 'trial'));

alter table public.bookings
  drop constraint if exists bookings_course_type_check;
alter table public.bookings
  add constraint bookings_course_type_check
  check (course_type is null or course_type in ('weight_training', 'relaxation', 'reformer_pilates'));

alter table public.bookings
  drop constraint if exists bookings_trial_stage_check;
alter table public.bookings
  add constraint bookings_trial_stage_check
  check (trial_stage is null or trial_stage in ('FA1', 'FA2', 'FAN'));

alter table public.bookings
  drop constraint if exists bookings_operation_result_check;
alter table public.bookings
  add constraint bookings_operation_result_check
  check (operation_result is null or operation_result in ('completed', 'cancelled', 'no_show', 'rescheduled'));

alter table public.bookings
  drop constraint if exists bookings_reminder_status_check;
alter table public.bookings
  add constraint bookings_reminder_status_check
  check (reminder_status in ('pending', 'reached', 'no_answer', 'retry'));

create unique index if not exists bookings_operation_idempotency_unique
  on public.bookings(tenant_id, operation_idempotency_key)
  where operation_idempotency_key is not null;

create index if not exists bookings_bige_daily_board_idx
  on public.bookings(tenant_id, starts_at, coach_id)
  where is_bige_schedule = true;

create index if not exists bookings_bige_member_history_idx
  on public.bookings(member_id, operation_kind, status, starts_at desc)
  where is_bige_schedule = true;

create index if not exists bookings_bige_trial_source_idx
  on public.bookings(trial_booking_id, starts_at desc)
  where is_bige_schedule = true and trial_booking_id is not null;

alter table public.trial_bookings
  add column if not exists member_id uuid references public.members(id) on delete set null;

create index if not exists trial_bookings_member_idx
  on public.trial_bookings(member_id, created_at desc)
  where member_id is not null;

create table if not exists public.bige_schedule_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  content text not null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bige_schedule_notes_time_check check (ends_at > starts_at),
  constraint bige_schedule_notes_content_check check (char_length(btrim(content)) between 1 and 300)
);

create index if not exists bige_schedule_notes_board_idx
  on public.bige_schedule_notes(tenant_id, starts_at, coach_id);

create table if not exists public.bige_trial_call_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  status text not null,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bige_trial_call_logs_status_check check (status in ('pending', 'reached', 'no_answer', 'retry'))
);

create index if not exists bige_trial_call_logs_booking_idx
  on public.bige_trial_call_logs(booking_id, created_at desc);

create table if not exists public.bige_contract_payment_schedule (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.member_plan_contracts(id) on delete cascade,
  sequence_no integer not null,
  payment_kind text not null,
  due_on date not null,
  due_amount bigint not null,
  paid_amount bigint not null default 0,
  status text not null default 'unpaid',
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bige_contract_payment_schedule_sequence_check check (sequence_no > 0),
  constraint bige_contract_payment_schedule_kind_check check (payment_kind in ('deposit', 'balance', 'installment')),
  constraint bige_contract_payment_schedule_amount_check check (due_amount > 0 and paid_amount >= 0),
  constraint bige_contract_payment_schedule_status_check check (status in ('unpaid', 'partial', 'paid', 'overdue', 'voided')),
  unique(contract_id, sequence_no)
);

create index if not exists bige_contract_payment_schedule_due_idx
  on public.bige_contract_payment_schedule(tenant_id, status, due_on);

create table if not exists public.bige_contract_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.member_plan_contracts(id) on delete cascade,
  schedule_item_id uuid references public.bige_contract_payment_schedule(id) on delete set null,
  payment_kind text not null,
  amount bigint not null,
  method text not null,
  status text not null default 'recorded',
  paid_at timestamptz not null default now(),
  source_payment_id uuid references public.payments(id) on delete set null,
  idempotency_key text not null,
  note text,
  recorded_by uuid references public.profiles(id) on delete set null,
  voided_by uuid references public.profiles(id) on delete set null,
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  constraint bige_contract_payments_kind_check check (payment_kind in ('deposit', 'balance', 'installment')),
  constraint bige_contract_payments_amount_check check (amount > 0),
  constraint bige_contract_payments_method_check check (method in ('cash', 'bank_transfer', 'card_terminal', 'acpay', 'other')),
  constraint bige_contract_payments_status_check check (status in ('recorded', 'voided', 'refunded')),
  unique(tenant_id, idempotency_key)
);

create index if not exists bige_contract_payments_contract_idx
  on public.bige_contract_payments(contract_id, paid_at desc);

create table if not exists public.bige_contract_extensions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.member_plan_contracts(id) on delete cascade,
  old_ends_at timestamptz not null,
  new_ends_at timestamptz not null,
  extension_days integer not null,
  cumulative_extension_days integer not null,
  reason text not null,
  signature_path text not null,
  signature_statement text not null,
  signed_member_name text not null,
  signed_at timestamptz not null,
  approved_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint bige_contract_extensions_days_check check (extension_days > 0 and cumulative_extension_days > 0),
  constraint bige_contract_extensions_dates_check check (new_ends_at > old_ends_at or new_ends_at > created_at)
);

create index if not exists bige_contract_extensions_contract_idx
  on public.bige_contract_extensions(contract_id, created_at desc);

create table if not exists public.bige_daily_closures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  business_date date not null,
  status text not null default 'pending',
  revision integer not null default 1,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  reopened_by uuid references public.profiles(id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bige_daily_closures_status_check check (status in ('pending', 'confirmed', 'reopened')),
  unique(tenant_id, branch_id, business_date)
);

create index if not exists bige_daily_closures_pending_idx
  on public.bige_daily_closures(tenant_id, status, business_date desc);

create table if not exists public.bige_daily_closure_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  closure_id uuid not null references public.bige_daily_closures(id) on delete cascade,
  action text not null,
  reason text,
  snapshot jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint bige_daily_closure_history_action_check check (action in ('created', 'confirmed', 'reopened', 'updated'))
);

create index if not exists bige_daily_closure_history_closure_idx
  on public.bige_daily_closure_history(closure_id, created_at desc);

create unique index if not exists session_redemptions_booking_once_idx
  on public.session_redemptions(booking_id)
  where booking_id is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bige-contract-signatures',
  'bige-contract-signatures',
  false,
  1048576,
  array['image/png', 'image/jpeg']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.bige_schedule_notes enable row level security;
alter table public.bige_trial_call_logs enable row level security;
alter table public.bige_contract_payment_schedule enable row level security;
alter table public.bige_contract_payments enable row level security;
alter table public.bige_contract_extensions enable row level security;
alter table public.bige_daily_closures enable row level security;
alter table public.bige_daily_closure_history enable row level security;

drop policy if exists bige_schedule_notes_tenant_access on public.bige_schedule_notes;
create policy bige_schedule_notes_tenant_access
  on public.bige_schedule_notes for all
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role in ('manager', 'frontdesk', 'coach')
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role in ('manager', 'frontdesk', 'coach')
    )
  );

drop policy if exists bige_trial_call_logs_tenant_access on public.bige_trial_call_logs;
create policy bige_trial_call_logs_tenant_read
  on public.bige_trial_call_logs for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role in ('manager', 'frontdesk')
    )
  );
create policy bige_trial_call_logs_tenant_insert
  on public.bige_trial_call_logs for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role in ('manager', 'frontdesk')
    )
  );

drop policy if exists bige_contract_payment_schedule_tenant_access on public.bige_contract_payment_schedule;
create policy bige_contract_payment_schedule_tenant_read
  on public.bige_contract_payment_schedule for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role in ('manager', 'frontdesk')
    )
  );

drop policy if exists bige_contract_payments_tenant_access on public.bige_contract_payments;
create policy bige_contract_payments_tenant_read
  on public.bige_contract_payments for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role in ('manager', 'frontdesk')
    )
  );

drop policy if exists bige_contract_extensions_tenant_access on public.bige_contract_extensions;
create policy bige_contract_extensions_tenant_read
  on public.bige_contract_extensions for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role in ('manager', 'frontdesk')
    )
  );

drop policy if exists bige_daily_closures_tenant_access on public.bige_daily_closures;
create policy bige_daily_closures_tenant_access
  on public.bige_daily_closures for all
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role = 'manager'
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role = 'manager'
    )
  );

drop policy if exists bige_daily_closure_history_tenant_access on public.bige_daily_closure_history;
create policy bige_daily_closure_history_tenant_read
  on public.bige_daily_closure_history for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role = 'manager'
    )
  );
create policy bige_daily_closure_history_tenant_insert
  on public.bige_daily_closure_history for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
      and (public.current_profile()).role = 'manager'
    )
  );

drop policy if exists bige_contract_signatures_read on storage.objects;
create policy bige_contract_signatures_read
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'bige-contract-signatures'
    and (
      public.is_platform_admin()
      or public.current_is_active()
    )
  );

grant select, insert, update, delete on table public.bige_schedule_notes to authenticated;
grant select, insert on table public.bige_trial_call_logs to authenticated;
grant select on table public.bige_contract_payment_schedule to authenticated;
grant select on table public.bige_contract_payments to authenticated;
grant select on table public.bige_contract_extensions to authenticated;
grant select, insert, update on table public.bige_daily_closures to authenticated;
grant select, insert on table public.bige_daily_closure_history to authenticated;

grant all on table public.bige_schedule_notes to service_role;
grant all on table public.bige_trial_call_logs to service_role;
grant all on table public.bige_contract_payment_schedule to service_role;
grant all on table public.bige_contract_payments to service_role;
grant all on table public.bige_contract_extensions to service_role;
grant all on table public.bige_daily_closures to service_role;
grant all on table public.bige_daily_closure_history to service_role;

-- Legacy plans stay available to their existing code paths, but never appear in
-- the new PT plan picker.
update public.member_plan_catalog
set fitness_visible = false,
    fitness_plan_kind = 'legacy'
where fitness_plan_kind = 'legacy';
