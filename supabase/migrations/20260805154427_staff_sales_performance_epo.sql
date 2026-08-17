-- Daily coach sales allocation, EPO review, and automatic course-fee payroll.
-- These tables are intentionally server-route-only because they contain salary data.

alter table public.staff_permission_overrides
  drop constraint if exists staff_permission_overrides_permission_key_check;
alter table public.staff_permission_overrides
  add constraint staff_permission_overrides_permission_key_check check (permission_key in (
    'create_employee', 'edit_employee', 'suspend_employee',
    'manage_schedule', 'publish_schedule', 'review_leave_requests',
    'manage_attendance', 'view_team_schedule', 'view_team_salary',
    'calculate_payroll', 'close_payroll', 'manage_insurance',
    'assign_supervisor', 'manage_permissions', 'export_schedule',
    'allocate_sales_performance', 'approve_sales_performance',
    'manage_epo', 'confirm_daily_sales_report'
  ));
create table if not exists public.staff_sales_daily_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  business_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'reopened')),
  snapshot jsonb not null default '{}'::jsonb,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  reopened_by uuid references public.profiles(id) on delete set null,
  reopened_at timestamptz,
  reopen_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_sales_daily_reports_scope_idx
  on public.staff_sales_daily_reports(
    tenant_id,
    coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid),
    business_date
  );
create index if not exists staff_sales_daily_reports_month_idx
  on public.staff_sales_daily_reports(tenant_id, business_date desc, status);
create table if not exists public.staff_sales_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  business_date date not null,
  source_type text not null
    check (source_type in ('fa', 'renewal', 'final_payment', 'refund', 'manual_adjustment')),
  source_key text not null,
  source_table text not null,
  source_id uuid,
  source_occurred_at timestamptz not null,
  member_id uuid references public.members(id) on delete set null,
  member_name_snapshot text,
  contract_number text,
  label text not null,
  amount numeric(12,2) not null check (amount <> 0),
  status text not null default 'unassigned'
    check (status in ('unassigned', 'pending_manager', 'approved', 'daily_confirmed', 'rejected', 'ignored')),
  assigned_employee_id uuid references public.profiles(id) on delete set null,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  daily_report_id uuid references public.staff_sales_daily_reports(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id, source_key),
  check (
    status in ('unassigned', 'rejected', 'ignored')
    or (assigned_employee_id is not null and assigned_by is not null and assigned_at is not null)
  ),
  check (source_type = 'refund' or amount > 0),
  check (source_type <> 'refund' or amount < 0)
);
create index if not exists staff_sales_events_daily_idx
  on public.staff_sales_events(tenant_id, business_date, status);
create index if not exists staff_sales_events_employee_month_idx
  on public.staff_sales_events(tenant_id, assigned_employee_id, business_date)
  where status in ('pending_manager', 'approved', 'daily_confirmed');
create table if not exists public.staff_epo_awards (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  business_date date not null,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  quantity integer not null default 1 check (quantity between 1 and 100),
  reason text not null check (char_length(btrim(reason)) between 2 and 1000),
  status text not null default 'assistant_proposed'
    check (status in ('assistant_proposed', 'manager_approved', 'daily_confirmed', 'rejected', 'cancelled')),
  proposed_by uuid not null references public.profiles(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  daily_report_id uuid references public.staff_sales_daily_reports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_epo_awards_daily_idx
  on public.staff_epo_awards(tenant_id, business_date, status);
create index if not exists staff_epo_awards_employee_month_idx
  on public.staff_epo_awards(tenant_id, employee_id, business_date)
  where status in ('assistant_proposed', 'manager_approved', 'daily_confirmed');
alter table public.staff_sales_daily_reports enable row level security;
alter table public.staff_sales_events enable row level security;
alter table public.staff_epo_awards enable row level security;
revoke all on table public.staff_sales_daily_reports from public, anon, authenticated;
revoke all on table public.staff_sales_events from public, anon, authenticated;
revoke all on table public.staff_epo_awards from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_sales_daily_reports to service_role;
grant select, insert, update, delete on table public.staff_sales_events to service_role;
grant select, insert, update, delete on table public.staff_epo_awards to service_role;
drop trigger if exists staff_sales_daily_reports_touch_updated_at on public.staff_sales_daily_reports;
create trigger staff_sales_daily_reports_touch_updated_at
before update on public.staff_sales_daily_reports
for each row execute function public.touch_updated_at();
drop trigger if exists staff_sales_events_touch_updated_at on public.staff_sales_events;
create trigger staff_sales_events_touch_updated_at
before update on public.staff_sales_events
for each row execute function public.touch_updated_at();
drop trigger if exists staff_epo_awards_touch_updated_at on public.staff_epo_awards;
create trigger staff_epo_awards_touch_updated_at
before update on public.staff_epo_awards
for each row execute function public.touch_updated_at();
comment on table public.staff_sales_events is
  'One whole-event coach allocation for FA, renewal, final payment, refund, or manual adjustment. Refunds are negative on refund date.';
comment on table public.staff_epo_awards is
  'Manual daily EPO opportunity ledger. Assistant proposals require manager review; manager awards are reconfirmed by daily report.';
comment on table public.staff_sales_daily_reports is
  'Manager daily confirmation snapshot that freezes approved sales allocations and EPO awards for payroll reporting.';
