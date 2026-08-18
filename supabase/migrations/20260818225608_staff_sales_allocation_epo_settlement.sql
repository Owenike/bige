-- Split sales allocations, exact refund reversals, automatic EPO evidence, and
-- optional assistant-manager preparation before manager daily settlement.

alter table public.member_plan_contracts
  add column if not exists sales_origin_coach_id uuid references public.profiles(id) on delete set null,
  add column if not exists sales_origin_kind text;

alter table public.member_plan_contracts
  drop constraint if exists member_plan_contracts_sales_origin_kind_check;
alter table public.member_plan_contracts
  add constraint member_plan_contracts_sales_origin_kind_check
  check (sales_origin_kind is null or sales_origin_kind in ('fa', 'renewal', 'manual'));

comment on column public.member_plan_contracts.sales_origin_coach_id is
  'Immutable source coach snapshot used for the default 50% allocation and EPO rules; later allocation edits do not change it.';
create index if not exists member_plan_contracts_sales_origin_coach_idx
  on public.member_plan_contracts(sales_origin_coach_id)
  where sales_origin_coach_id is not null;

create or replace function public.bige_create_member_contract_v5(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_member_id uuid,
  p_source_booking_id uuid,
  p_full_name text,
  p_phone text,
  p_birth_date date,
  p_email text,
  p_email_unavailable boolean,
  p_plan_mode text,
  p_plan_id uuid,
  p_custom_plan jsonb,
  p_signed_on date,
  p_pin text,
  p_initial_payment bigint,
  p_payment_method text,
  p_installment_count integer,
  p_payment_schedule jsonb,
  p_future_trial_action text,
  p_fa_fee_recipient_profile_id uuid,
  p_fa_fee_recipient_name text,
  p_sales_origin_coach_id uuid,
  p_sales_origin_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contract_result jsonb;
  created_contract_id uuid;
begin
  if p_sales_origin_kind not in ('fa', 'renewal', 'manual') then
    raise exception 'sales_origin_kind_invalid';
  end if;
  if p_sales_origin_coach_id is not null and not exists (
    select 1
    from public.profiles profile
    where profile.id = p_sales_origin_coach_id
      and profile.tenant_id = p_tenant_id
      and profile.is_active = true
      and (
        profile.role in ('coach', 'therapist')
        or profile.position in ('coach', 'coach_team_lead', 'coach_director', 'coach_assistant_manager', 'coach_manager', 'coach_city_manager')
      )
  ) then
    raise exception 'sales_origin_coach_invalid';
  end if;

  contract_result := public.bige_create_member_contract_v4(
    p_tenant_id,
    p_branch_id,
    p_member_id,
    p_source_booking_id,
    p_full_name,
    p_phone,
    p_birth_date,
    p_email,
    p_email_unavailable,
    p_plan_mode,
    p_plan_id,
    p_custom_plan,
    p_signed_on,
    p_pin,
    p_initial_payment,
    p_payment_method,
    p_installment_count,
    p_payment_schedule,
    p_future_trial_action,
    p_fa_fee_recipient_profile_id,
    p_fa_fee_recipient_name
  );

  created_contract_id := (contract_result->>'contractId')::uuid;
  update public.member_plan_contracts
  set sales_origin_coach_id = p_sales_origin_coach_id,
      sales_origin_kind = p_sales_origin_kind,
      updated_at = now()
  where id = created_contract_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'contract_sales_origin_update_failed';
  end if;

  return contract_result || jsonb_build_object(
    'salesOriginCoachId', p_sales_origin_coach_id,
    'salesOriginKind', p_sales_origin_kind
  );
end;
$$;

revoke all on function public.bige_create_member_contract_v5(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, integer, jsonb, text, uuid, text, uuid, text
) from public, anon;
grant execute on function public.bige_create_member_contract_v5(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, text, uuid, jsonb,
  date, text, bigint, text, integer, jsonb, text, uuid, text, uuid, text
) to authenticated;

alter table public.staff_sales_daily_reports
  add column if not exists prepared_by uuid references public.profiles(id) on delete set null,
  add column if not exists prepared_at timestamptz,
  add column if not exists course_snapshot jsonb not null default '{}'::jsonb;

alter table public.staff_sales_events
  add column if not exists contract_id uuid references public.member_plan_contracts(id) on delete set null,
  add column if not exists contract_sessions integer,
  add column if not exists origin_employee_id uuid references public.profiles(id) on delete set null,
  add column if not exists active_allocation_version integer not null default 0,
  add column if not exists allocation_note text;

alter table public.staff_sales_events
  drop constraint if exists staff_sales_events_contract_sessions_check;
alter table public.staff_sales_events
  add constraint staff_sales_events_contract_sessions_check
  check (contract_sessions is null or contract_sessions > 0);
alter table public.staff_sales_events
  drop constraint if exists staff_sales_events_active_allocation_version_check;
alter table public.staff_sales_events
  add constraint staff_sales_events_active_allocation_version_check
  check (active_allocation_version >= 0);
create index if not exists staff_sales_events_contract_idx
  on public.staff_sales_events(contract_id)
  where contract_id is not null;
create index if not exists staff_sales_events_origin_date_idx
  on public.staff_sales_events(tenant_id, origin_employee_id, business_date)
  where origin_employee_id is not null;

-- The original schema required one assigned_employee_id for every approved row.
-- Split allocation events keep that compatibility column null, so remove only
-- the legacy check that references assigned_employee_id.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.staff_sales_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%assigned_employee_id%'
  loop
    execute format('alter table public.staff_sales_events drop constraint %I', constraint_row.conname);
  end loop;
end $$;

create table if not exists public.staff_sales_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  event_id uuid not null references public.staff_sales_events(id) on delete cascade,
  allocation_version integer not null check (allocation_version > 0),
  employee_id uuid not null references public.profiles(id) on delete restrict,
  amount numeric(12,2) not null check (amount <> 0),
  allocation_kind text not null default 'manual'
    check (allocation_kind in ('origin_default', 'manual', 'refund_reversal', 'legacy')),
  source_allocation_id uuid references public.staff_sales_allocations(id) on delete restrict,
  status text not null default 'pending_manager'
    check (status in ('pending_manager', 'approved', 'daily_confirmed', 'cancelled')),
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  daily_report_id uuid references public.staff_sales_daily_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, allocation_version, employee_id)
);

create index if not exists staff_sales_allocations_event_version_idx
  on public.staff_sales_allocations(event_id, allocation_version, status);
create index if not exists staff_sales_allocations_employee_month_idx
  on public.staff_sales_allocations(tenant_id, employee_id, created_at)
  where status in ('pending_manager', 'approved', 'daily_confirmed');
create unique index if not exists staff_sales_allocations_refund_source_idx
  on public.staff_sales_allocations(event_id, source_allocation_id)
  where source_allocation_id is not null and status <> 'cancelled';
create index if not exists staff_sales_allocations_source_allocation_idx
  on public.staff_sales_allocations(source_allocation_id)
  where source_allocation_id is not null;
create index if not exists staff_sales_allocations_daily_report_idx
  on public.staff_sales_allocations(daily_report_id)
  where daily_report_id is not null;

insert into public.staff_sales_allocations (
  tenant_id, branch_id, event_id, allocation_version, employee_id, amount,
  allocation_kind, status, proposed_by, proposed_at, reviewed_by, reviewed_at,
  review_note, daily_report_id, created_at, updated_at
)
select
  event.tenant_id,
  event.branch_id,
  event.id,
  1,
  event.assigned_employee_id,
  event.amount,
  'legacy',
  case
    when event.status = 'daily_confirmed' then 'daily_confirmed'
    when event.status = 'approved' then 'approved'
    else 'pending_manager'
  end,
  event.assigned_by,
  coalesce(event.assigned_at, event.created_at),
  event.reviewed_by,
  event.reviewed_at,
  event.review_note,
  event.daily_report_id,
  event.created_at,
  event.updated_at
from public.staff_sales_events event
where event.assigned_employee_id is not null
  and event.assigned_by is not null
  and event.status in ('pending_manager', 'approved', 'daily_confirmed')
on conflict (event_id, allocation_version, employee_id) do nothing;

update public.staff_sales_events event
set active_allocation_version = 1
where active_allocation_version = 0
  and exists (
    select 1 from public.staff_sales_allocations allocation
    where allocation.event_id = event.id and allocation.allocation_version = 1
  );

alter table public.staff_epo_awards
  drop constraint if exists staff_epo_awards_quantity_check;
alter table public.staff_epo_awards
  add constraint staff_epo_awards_quantity_check
  check (quantity between -100 and 100 and quantity <> 0);
alter table public.staff_epo_awards
  add column if not exists award_type text not null default 'manual',
  add column if not exists rule_key text,
  add column if not exists source_contract_id uuid references public.member_plan_contracts(id) on delete set null,
  add column if not exists source_event_id uuid references public.staff_sales_events(id) on delete set null,
  add column if not exists source_award_id uuid references public.staff_epo_awards(id) on delete restrict,
  add column if not exists calculation jsonb not null default '{}'::jsonb;

alter table public.staff_epo_awards
  drop constraint if exists staff_epo_awards_award_type_check;
alter table public.staff_epo_awards
  add constraint staff_epo_awards_award_type_check
  check (award_type in ('manual', 'contract_threshold', 'daily_top', 'session_load', 'reversal', 'reassignment'));
create unique index if not exists staff_epo_awards_rule_key_idx
  on public.staff_epo_awards(tenant_id, rule_key)
  where rule_key is not null;
create index if not exists staff_epo_awards_source_contract_idx
  on public.staff_epo_awards(source_contract_id)
  where source_contract_id is not null;
create index if not exists staff_epo_awards_source_event_idx
  on public.staff_epo_awards(source_event_id)
  where source_event_id is not null;
create index if not exists staff_epo_awards_source_award_idx
  on public.staff_epo_awards(source_award_id)
  where source_award_id is not null;

create table if not exists public.staff_epo_daily_top_states (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  business_date date not null,
  adjustment_business_date date not null,
  top_amount numeric(12,2) not null default 0 check (top_amount >= 0),
  candidate_employee_ids uuid[] not null default '{}',
  selected_employee_id uuid references public.profiles(id) on delete set null,
  status text not null default 'tie_pending'
    check (status in ('none', 'auto_selected', 'tie_pending', 'assistant_selected', 'manager_selected')),
  active_award_id uuid references public.staff_epo_awards(id) on delete set null,
  source_fingerprint text not null default '',
  decision_by uuid references public.profiles(id) on delete set null,
  decision_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, business_date)
);
create index if not exists staff_epo_daily_top_states_adjustment_idx
  on public.staff_epo_daily_top_states(tenant_id, adjustment_business_date, status);
create index if not exists staff_epo_daily_top_states_active_award_idx
  on public.staff_epo_daily_top_states(active_award_id)
  where active_award_id is not null;

alter table public.staff_sales_allocations enable row level security;
alter table public.staff_epo_daily_top_states enable row level security;
revoke all on table public.staff_sales_allocations from public, anon, authenticated;
revoke all on table public.staff_epo_daily_top_states from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_sales_allocations to service_role;
grant select, insert, update, delete on table public.staff_epo_daily_top_states to service_role;

drop trigger if exists staff_sales_allocations_touch_updated_at on public.staff_sales_allocations;
create trigger staff_sales_allocations_touch_updated_at
before update on public.staff_sales_allocations
for each row execute function public.touch_updated_at();
drop trigger if exists staff_epo_daily_top_states_touch_updated_at on public.staff_epo_daily_top_states;
create trigger staff_epo_daily_top_states_touch_updated_at
before update on public.staff_epo_daily_top_states
for each row execute function public.touch_updated_at();

comment on table public.staff_sales_allocations is
  'Versioned per-coach allocation ledger. Confirmed versions are retained so refunds can reverse the exact original recipients and amounts.';
comment on table public.staff_sales_events is
  'Immutable receipt/refund event header. Current split allocations live in staff_sales_allocations; refunds retain links to the original allocation rows.';
comment on table public.staff_epo_awards is
  'Manual and rule-derived EPO ledger, including negative reversal rows for returned contracts and recalculated daily-top awards.';
comment on table public.staff_epo_daily_top_states is
  'Current pre-allocation daily-top decision. Refunds recalculate the original receipt date; ties remain pending until an assistant proposes or a manager decides.';

create or replace function public.staff_seed_default_allocation_v1(
  p_tenant_id uuid,
  p_event_id uuid,
  p_actor_id uuid,
  p_employee_id uuid,
  p_amount numeric,
  p_remaining_amount numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.staff_sales_events%rowtype;
begin
  select * into target_event
  from public.staff_sales_events
  where id = p_event_id and tenant_id = p_tenant_id
  for update;
  if not found
    or target_event.status <> 'unassigned'
    or target_event.active_allocation_version <> 0
    or target_event.source_type not in ('fa', 'renewal')
  then return false; end if;
  if p_amount <= 0 or round(p_amount + p_remaining_amount, 2) <> round(target_event.amount, 2) then
    raise exception 'default_allocation_amount_invalid';
  end if;
  insert into public.staff_sales_allocations (
    tenant_id, branch_id, event_id, allocation_version, employee_id, amount,
    allocation_kind, status, proposed_by
  ) values (
    p_tenant_id, target_event.branch_id, target_event.id, 1, p_employee_id, round(p_amount, 2),
    'origin_default', 'pending_manager', p_actor_id
  );
  update public.staff_sales_events
  set active_allocation_version = 1,
      allocation_note = format('原成交教練已預設 50%%，尚餘 %s 元待分配', round(p_remaining_amount, 2))
  where id = target_event.id;
  return true;
end;
$$;

create or replace function public.staff_seed_refund_allocations_v1(
  p_tenant_id uuid,
  p_event_id uuid,
  p_actor_id uuid,
  p_allocations jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.staff_sales_events%rowtype;
  now_at timestamptz := now();
  allocation_total numeric(12,2);
begin
  select * into target_event
  from public.staff_sales_events
  where id = p_event_id and tenant_id = p_tenant_id
  for update;
  if not found
    or target_event.status <> 'unassigned'
    or target_event.active_allocation_version <> 0
    or target_event.source_type <> 'refund'
  then return false; end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'refund_allocations_required';
  end if;
  select sum(item.amount) into allocation_total
  from jsonb_to_recordset(p_allocations) as item(employee_id uuid, amount numeric, source_allocation_id uuid);
  if round(allocation_total, 2) <> round(target_event.amount, 2) then
    raise exception 'refund_allocation_total_mismatch';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_allocations) as item(employee_id uuid, amount numeric, source_allocation_id uuid)
    left join public.staff_sales_allocations source
      on source.id = item.source_allocation_id
      and source.tenant_id = p_tenant_id
      and source.employee_id = item.employee_id
      and source.status = 'daily_confirmed'
    where item.amount >= 0 or source.id is null or abs(item.amount) > abs(source.amount)
  ) then raise exception 'refund_source_allocation_invalid'; end if;

  insert into public.staff_sales_allocations (
    tenant_id, branch_id, event_id, allocation_version, employee_id, amount,
    allocation_kind, source_allocation_id, status, proposed_by, reviewed_by,
    reviewed_at, review_note
  )
  select
    p_tenant_id, target_event.branch_id, target_event.id, 1, item.employee_id,
    round(item.amount, 2), 'refund_reversal', item.source_allocation_id, 'approved',
    p_actor_id, p_actor_id, now_at, '依原正式結算分配自動扣回，不可自由改配'
  from jsonb_to_recordset(p_allocations) as item(employee_id uuid, amount numeric, source_allocation_id uuid);
  update public.staff_sales_events
  set status = 'approved', active_allocation_version = 1,
      assigned_employee_id = case when jsonb_array_length(p_allocations) = 1 then (p_allocations->0->>'employee_id')::uuid else null end,
      assigned_by = p_actor_id, assigned_at = now_at,
      approved_by = p_actor_id, approved_at = now_at,
      reviewed_by = p_actor_id, reviewed_at = now_at,
      review_note = '退款已依原分配逐筆扣回',
      allocation_note = '退款分配已鎖定為原分配反沖'
  where id = target_event.id;
  return true;
end;
$$;

create or replace function public.staff_save_sales_allocations_v1(
  p_tenant_id uuid,
  p_event_id uuid,
  p_actor_id uuid,
  p_manager_approved boolean,
  p_allocations jsonb,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.staff_sales_events%rowtype;
  next_version integer;
  allocation_count integer;
  distinct_employee_count integer;
  allocation_total numeric(12,2);
  single_employee_id uuid;
  next_status text := case when p_manager_approved then 'approved' else 'pending_manager' end;
  now_at timestamptz := now();
begin
  select * into target_event
  from public.staff_sales_events
  where id = p_event_id and tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'sales_event_not_found'; end if;
  if target_event.source_type = 'refund' then raise exception 'refund_allocation_locked'; end if;
  if target_event.status in ('daily_confirmed', 'ignored') then raise exception 'sales_event_locked'; end if;
  if jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'sales_allocations_required';
  end if;

  select count(*), count(distinct employee_id), sum(amount), min(employee_id::text)::uuid
  into allocation_count, distinct_employee_count, allocation_total, single_employee_id
  from jsonb_to_recordset(p_allocations) as item(employee_id uuid, amount numeric);
  if allocation_count <> distinct_employee_count then raise exception 'sales_allocation_duplicate_employee'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_allocations) as item(employee_id uuid, amount numeric)
    where item.employee_id is null or item.amount is null or item.amount <= 0
  ) then raise exception 'sales_allocation_amount_invalid'; end if;
  if round(allocation_total, 2) <> round(target_event.amount, 2) then
    raise exception 'sales_allocation_total_mismatch';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_allocations) as item(employee_id uuid, amount numeric)
    left join public.profiles profile
      on profile.id = item.employee_id
      and profile.tenant_id = p_tenant_id
      and profile.is_active = true
      and profile.staff_deleted_at is null
    where profile.id is null
  ) then raise exception 'sales_allocation_employee_invalid'; end if;

  if exists (
    select 1 from public.staff_sales_allocations allocation
    where allocation.event_id = target_event.id
      and allocation.allocation_version = target_event.active_allocation_version
      and allocation.status = 'daily_confirmed'
  ) then raise exception 'sales_allocation_confirmed_locked'; end if;

  update public.staff_sales_allocations
  set status = 'cancelled', review_note = '已由新版分配取代', updated_at = now_at
  where event_id = target_event.id
    and allocation_version = target_event.active_allocation_version
    and status <> 'cancelled';

  next_version := target_event.active_allocation_version + 1;
  insert into public.staff_sales_allocations (
    tenant_id, branch_id, event_id, allocation_version, employee_id, amount,
    allocation_kind, status, proposed_by, reviewed_by, reviewed_at, review_note
  )
  select
    p_tenant_id, target_event.branch_id, target_event.id, next_version,
    item.employee_id, round(item.amount, 2), 'manual', next_status, p_actor_id,
    case when p_manager_approved then p_actor_id else null end,
    case when p_manager_approved then now_at else null end,
    nullif(btrim(p_note), '')
  from jsonb_to_recordset(p_allocations) as item(employee_id uuid, amount numeric);

  update public.staff_sales_events
  set active_allocation_version = next_version,
      allocation_note = nullif(btrim(p_note), ''),
      assigned_employee_id = case when allocation_count = 1 then single_employee_id else null end,
      assigned_by = p_actor_id,
      assigned_at = now_at,
      status = next_status,
      approved_by = case when p_manager_approved then p_actor_id else null end,
      approved_at = case when p_manager_approved then now_at else null end,
      reviewed_by = case when p_manager_approved then p_actor_id else null end,
      reviewed_at = case when p_manager_approved then now_at else null end,
      review_note = null
  where id = target_event.id;

  return jsonb_build_object('eventId', target_event.id, 'allocationVersion', next_version, 'status', next_status);
end;
$$;

create or replace function public.staff_review_sales_allocations_v1(
  p_tenant_id uuid,
  p_event_id uuid,
  p_actor_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.staff_sales_events%rowtype;
  now_at timestamptz := now();
begin
  select * into target_event
  from public.staff_sales_events
  where id = p_event_id and tenant_id = p_tenant_id and status = 'pending_manager'
  for update;
  if not found then raise exception 'pending_sales_event_not_found'; end if;
  if not p_approve and nullif(btrim(p_note), '') is null then raise exception 'review_note_required'; end if;

  update public.staff_sales_allocations
  set status = case when p_approve then 'approved' else 'cancelled' end,
      reviewed_by = p_actor_id,
      reviewed_at = now_at,
      review_note = nullif(btrim(p_note), '')
  where event_id = target_event.id
    and allocation_version = target_event.active_allocation_version
    and status = 'pending_manager';

  update public.staff_sales_events
  set status = case when p_approve then 'approved' else 'rejected' end,
      approved_by = case when p_approve then p_actor_id else null end,
      approved_at = case when p_approve then now_at else null end,
      reviewed_by = p_actor_id,
      reviewed_at = now_at,
      review_note = nullif(btrim(p_note), '')
  where id = target_event.id;
  return jsonb_build_object('eventId', target_event.id, 'approved', p_approve);
end;
$$;

create or replace function public.staff_prepare_daily_settlement_v1(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_business_date date,
  p_actor_id uuid,
  p_sales_snapshot jsonb,
  p_course_snapshot jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_id uuid;
begin
  select id into report_id
  from public.staff_sales_daily_reports
  where tenant_id = p_tenant_id
    and branch_id is not distinct from p_branch_id
    and business_date = p_business_date
  for update;
  if report_id is null then
    insert into public.staff_sales_daily_reports (
      tenant_id, branch_id, business_date, status, snapshot, course_snapshot,
      prepared_by, prepared_at, created_by
    ) values (
      p_tenant_id, p_branch_id, p_business_date, 'draft', p_sales_snapshot, p_course_snapshot,
      p_actor_id, now(), p_actor_id
    ) returning id into report_id;
  else
    if exists (select 1 from public.staff_sales_daily_reports where id = report_id and status = 'confirmed') then
      raise exception 'daily_settlement_already_confirmed';
    end if;
    update public.staff_sales_daily_reports
    set snapshot = p_sales_snapshot,
        course_snapshot = p_course_snapshot,
        prepared_by = p_actor_id,
        prepared_at = now()
    where id = report_id;
  end if;
  return report_id;
end;
$$;

create or replace function public.staff_confirm_daily_settlement_v1(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_business_date date,
  p_actor_id uuid,
  p_sales_snapshot jsonb,
  p_course_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_id uuid;
  closure_id uuid;
  now_at timestamptz := now();
begin
  perform event.id
  from public.staff_sales_events event
  where event.tenant_id = p_tenant_id and event.business_date = p_business_date
  order by event.id
  for update;
  perform award.id
  from public.staff_epo_awards award
  where award.tenant_id = p_tenant_id and award.business_date = p_business_date
  order by award.id
  for update;
  perform top_state.id
  from public.staff_epo_daily_top_states top_state
  where top_state.tenant_id = p_tenant_id
    and (top_state.business_date = p_business_date or top_state.adjustment_business_date = p_business_date)
  order by top_state.id
  for update;

  if coalesce((p_course_snapshot->>'pending')::integer, 0) > 0 then
    raise exception 'daily_courses_pending';
  end if;
  if exists (
    select 1 from public.staff_sales_events event
    where event.tenant_id = p_tenant_id and event.business_date = p_business_date
      and event.status in ('unassigned', 'pending_manager')
  ) then raise exception 'daily_sales_unresolved'; end if;
  if exists (
    select 1 from public.staff_epo_awards award
    where award.tenant_id = p_tenant_id and award.business_date = p_business_date
      and award.status = 'assistant_proposed'
  ) then raise exception 'daily_epo_unresolved'; end if;
  if exists (
    select 1 from public.staff_epo_daily_top_states top_state
    where top_state.tenant_id = p_tenant_id
      and (top_state.business_date = p_business_date or top_state.adjustment_business_date = p_business_date)
      and top_state.status = 'tie_pending'
  ) then raise exception 'daily_top_tie_unresolved'; end if;
  if exists (
    select 1
    from public.staff_sales_events event
    where event.tenant_id = p_tenant_id
      and event.business_date = p_business_date
      and event.status = 'approved'
      and coalesce((
        select round(sum(allocation.amount), 2)
        from public.staff_sales_allocations allocation
        where allocation.event_id = event.id
          and allocation.allocation_version = event.active_allocation_version
          and allocation.status = 'approved'
      ), 0) <> round(event.amount, 2)
  ) then raise exception 'daily_sales_allocation_mismatch'; end if;

  select id into report_id
  from public.staff_sales_daily_reports
  where tenant_id = p_tenant_id
    and branch_id is not distinct from p_branch_id
    and business_date = p_business_date
  for update;
  if report_id is null then
    insert into public.staff_sales_daily_reports (
      tenant_id, branch_id, business_date, status, snapshot, course_snapshot,
      confirmed_by, confirmed_at, created_by
    ) values (
      p_tenant_id, p_branch_id, p_business_date, 'confirmed', p_sales_snapshot, p_course_snapshot,
      p_actor_id, now_at, p_actor_id
    ) returning id into report_id;
  else
    update public.staff_sales_daily_reports
    set status = 'confirmed', snapshot = p_sales_snapshot, course_snapshot = p_course_snapshot,
        confirmed_by = p_actor_id, confirmed_at = now_at,
        reopened_by = null, reopened_at = null, reopen_reason = null
    where id = report_id and status <> 'confirmed';
    if not found then raise exception 'daily_settlement_already_confirmed'; end if;
  end if;

  update public.staff_sales_events
  set status = 'daily_confirmed', daily_report_id = report_id
  where tenant_id = p_tenant_id and business_date = p_business_date and status = 'approved';
  update public.staff_sales_allocations allocation
  set status = 'daily_confirmed', daily_report_id = report_id
  where allocation.tenant_id = p_tenant_id
    and allocation.status = 'approved'
    and exists (
      select 1 from public.staff_sales_events event
      where event.id = allocation.event_id and event.daily_report_id = report_id
        and allocation.allocation_version = event.active_allocation_version
    );
  update public.staff_epo_awards
  set status = 'daily_confirmed', daily_report_id = report_id
  where tenant_id = p_tenant_id and business_date = p_business_date and status = 'manager_approved';

  select id into closure_id
  from public.bige_daily_closures
  where tenant_id = p_tenant_id
    and branch_id is not distinct from p_branch_id
    and business_date = p_business_date
  for update;
  if closure_id is null then
    insert into public.bige_daily_closures (
      tenant_id, branch_id, business_date, status, snapshot, confirmed_by, confirmed_at
    ) values (
      p_tenant_id, p_branch_id, p_business_date, 'confirmed', p_course_snapshot, p_actor_id, now_at
    ) returning id into closure_id;
  else
    update public.bige_daily_closures
    set status = 'confirmed', snapshot = p_course_snapshot,
        confirmed_by = p_actor_id, confirmed_at = now_at,
        reopened_by = null, reopened_at = null, reopen_reason = null
    where id = closure_id;
  end if;
  insert into public.bige_daily_closure_history (
    tenant_id, closure_id, action, snapshot, actor_id
  ) values (p_tenant_id, closure_id, 'confirmed', p_course_snapshot, p_actor_id);

  return jsonb_build_object('reportId', report_id, 'closureId', closure_id, 'confirmedAt', now_at);
end;
$$;

create or replace function public.staff_reopen_daily_settlement_v1(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_business_date date,
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  report_id uuid;
  closure_id uuid;
  course_snapshot jsonb := '{}'::jsonb;
  now_at timestamptz := now();
begin
  if nullif(btrim(p_reason), '') is null then raise exception 'reopen_reason_required'; end if;
  select id into report_id
  from public.staff_sales_daily_reports
  where tenant_id = p_tenant_id
    and branch_id is not distinct from p_branch_id
    and business_date = p_business_date
    and status = 'confirmed'
  for update;
  if report_id is null then raise exception 'confirmed_daily_settlement_not_found'; end if;
  update public.staff_sales_daily_reports
  set status = 'reopened', reopened_by = p_actor_id, reopened_at = now_at, reopen_reason = p_reason
  where id = report_id;
  update public.staff_sales_events
  set status = 'approved', daily_report_id = null
  where daily_report_id = report_id and status = 'daily_confirmed';
  update public.staff_sales_allocations
  set status = 'approved', daily_report_id = null
  where daily_report_id = report_id and status = 'daily_confirmed';
  update public.staff_epo_awards
  set status = 'manager_approved', daily_report_id = null
  where daily_report_id = report_id and status = 'daily_confirmed';

  select id, snapshot into closure_id, course_snapshot
  from public.bige_daily_closures
  where tenant_id = p_tenant_id
    and branch_id is not distinct from p_branch_id
    and business_date = p_business_date
  for update;
  if closure_id is not null then
    update public.bige_daily_closures
    set status = 'reopened', reopened_by = p_actor_id, reopened_at = now_at,
        reopen_reason = p_reason, confirmed_by = null, confirmed_at = null
    where id = closure_id;
    insert into public.bige_daily_closure_history (
      tenant_id, closure_id, action, reason, snapshot, actor_id
    ) values (p_tenant_id, closure_id, 'reopened', p_reason, course_snapshot, p_actor_id);
  end if;
  return jsonb_build_object('reportId', report_id, 'closureId', closure_id, 'reopenedAt', now_at);
end;
$$;

revoke all on function public.staff_seed_default_allocation_v1(uuid, uuid, uuid, uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.staff_seed_refund_allocations_v1(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.staff_save_sales_allocations_v1(uuid, uuid, uuid, boolean, jsonb, text) from public, anon, authenticated;
revoke all on function public.staff_review_sales_allocations_v1(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.staff_prepare_daily_settlement_v1(uuid, uuid, date, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.staff_confirm_daily_settlement_v1(uuid, uuid, date, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.staff_reopen_daily_settlement_v1(uuid, uuid, date, uuid, text) from public, anon, authenticated;
grant execute on function public.staff_seed_default_allocation_v1(uuid, uuid, uuid, uuid, numeric, numeric) to service_role;
grant execute on function public.staff_seed_refund_allocations_v1(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.staff_save_sales_allocations_v1(uuid, uuid, uuid, boolean, jsonb, text) to service_role;
grant execute on function public.staff_review_sales_allocations_v1(uuid, uuid, uuid, boolean, text) to service_role;
grant execute on function public.staff_prepare_daily_settlement_v1(uuid, uuid, date, uuid, jsonb, jsonb) to service_role;
grant execute on function public.staff_confirm_daily_settlement_v1(uuid, uuid, date, uuid, jsonb, jsonb) to service_role;
grant execute on function public.staff_reopen_daily_settlement_v1(uuid, uuid, date, uuid, text) to service_role;
