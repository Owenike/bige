-- BIG E employee scheduling, attendance review, signatures, leave, and payroll.
-- This module is intentionally separate from member/course booking schedules.

create extension if not exists pgcrypto;
create or replace function public.can_manage_staff_operations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        p.role in ('platform_admin', 'manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
        or p.position in (
          'general_affairs_assistant_manager',
          'general_affairs_manager',
          'coach_assistant_manager',
          'coach_manager',
          'coach_city_manager'
        )
      )
  );
$$;
create or replace function public.can_final_approve_staff_operations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and (
        p.role in ('platform_admin', 'manager', 'branch_manager', 'store_owner', 'store_manager')
        or p.position in ('general_affairs_manager', 'coach_manager', 'coach_city_manager')
      )
  );
$$;
revoke all on function public.can_manage_staff_operations() from public;
revoke all on function public.can_final_approve_staff_operations() from public;
grant execute on function public.can_manage_staff_operations() to authenticated, service_role;
grant execute on function public.can_final_approve_staff_operations() to authenticated, service_role;
create table if not exists public.staff_employment_profiles (
  employee_id uuid primary key references public.profiles(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  employment_type text not null default 'full_time'
    check (employment_type in ('full_time', 'part_time')),
  pay_basis text not null default 'monthly'
    check (pay_basis in ('monthly', 'hourly')),
  work_group text not null default 'coach'
    check (work_group in ('frontdesk', 'coach', 'other')),
  monthly_salary numeric(12,2) not null default 29500 check (monthly_salary >= 0),
  hourly_rate numeric(12,2) not null default 196 check (hourly_rate >= 0),
  default_shift_code text not null default 'COACH_MIDDLE',
  is_original_early_shift boolean not null default false,
  can_cover_early_shift boolean not null default false,
  counts_toward_middle_limit boolean not null default true,
  insurance_status text not null default 'pending'
    check (insurance_status in ('pending', 'complete', 'not_applicable')),
  effective_from date not null default current_date,
  effective_to date,
  configured_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create index if not exists staff_employment_profiles_tenant_idx
  on public.staff_employment_profiles(tenant_id, branch_id, work_group);
create table if not exists public.staff_shift_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  code text not null,
  label text not null,
  starts_at time not null,
  ends_at time not null,
  crosses_midnight boolean not null default false,
  break_minutes integer not null default 0 check (break_minutes between 0 and 480),
  paid_break boolean not null default false,
  break_hidden_from_employee boolean not null default true,
  counts_toward_middle_limit boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_shift_templates_tenant_branch_code_idx
  on public.staff_shift_templates(tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), code);
create table if not exists public.staff_schedule_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  selection_opens_at timestamptz not null,
  selection_closes_at timestamptz not null,
  preferred_days_required integer not null default 8 check (preferred_days_required between 0 and 15),
  middle_preference_daily_limit integer not null default 2 check (middle_preference_daily_limit between 0 and 20),
  reminder_starts_on integer not null default 15 check (reminder_starts_on between 1 and 28),
  compile_starts_on integer not null default 21 check (compile_starts_on between 1 and 28),
  target_publish_on integer not null default 26 check (target_publish_on between 1 and 28),
  week_starts_on integer not null default 1 check (week_starts_on = 1),
  status text not null default 'selection_open'
    check (status in ('selection_open', 'selection_closed', 'drafting', 'assistant_review', 'manager_review', 'published', 'archived')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (selection_closes_at > selection_opens_at)
);
create unique index if not exists staff_schedule_periods_tenant_branch_month_idx
  on public.staff_schedule_periods(tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), month_start);
create table if not exists public.staff_facility_closures (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  closure_date date not null,
  title text not null default '館休',
  counts_as_preferred_day boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(period_id, closure_date)
);
create table if not exists public.staff_holiday_calendar (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  holiday_date date not null,
  holiday_name text not null,
  holiday_kind text not null default 'statutory'
    check (holiday_kind in ('statutory', 'makeup', 'company')),
  applies_to_all boolean not null default true,
  source_label text,
  source_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists staff_holiday_calendar_scope_date_idx
  on public.staff_holiday_calendar(
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    holiday_date,
    holiday_kind
  );
create table if not exists public.staff_time_off_preferences (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'locked', 'superseded')),
  submitted_at timestamptz,
  last_edited_at timestamptz not null default now(),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_id, employee_id)
);
create table if not exists public.staff_time_off_preference_dates (
  id uuid primary key default gen_random_uuid(),
  preference_id uuid not null references public.staff_time_off_preferences(id) on delete cascade,
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  requested_date date not null,
  source text not null default 'employee' check (source in ('employee', 'facility_closure', 'supervisor')),
  is_locked boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(preference_id, requested_date)
);
create index if not exists staff_time_off_preference_dates_capacity_idx
  on public.staff_time_off_preference_dates(period_id, requested_date, employee_id);
create table if not exists public.staff_schedule_versions (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft'
    check (status in ('draft', 'assistant_review', 'manager_review', 'published', 'superseded', 'cancelled')),
  change_summary text,
  based_on_version_id uuid references public.staff_schedule_versions(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  published_by uuid references public.profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_id, version_number)
);
create table if not exists public.staff_schedule_entries (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.staff_schedule_versions(id) on delete cascade,
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  entry_kind text not null check (entry_kind in ('work', 'off')),
  shift_template_id uuid references public.staff_shift_templates(id) on delete set null,
  shift_code text,
  shift_label text,
  starts_at time,
  ends_at time,
  crosses_midnight boolean not null default false,
  break_minutes integer not null default 0 check (break_minutes between 0 and 480),
  paid_break boolean not null default false,
  break_starts_at time,
  break_hidden_from_employee boolean not null default true,
  counts_toward_middle_limit boolean not null default false,
  off_kind text check (off_kind is null or off_kind in (
    'regular_day_off', 'rest_day', 'facility_closure', 'preferred_off', 'national_holiday',
    'holiday_adjustment', 'annual_leave', 'sick_leave', 'personal_leave',
    'family_care_leave', 'marriage_leave', 'bereavement_leave', 'official_leave', 'other_leave'
  )),
  source text not null default 'generated'
    check (source in ('generated', 'preference', 'facility_closure', 'supervisor', 'leave', 'holiday_adjustment')),
  source_reference_id uuid,
  internal_note text,
  employee_visible_note text,
  requires_resign boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(version_id, employee_id, work_date),
  check (
    (entry_kind = 'work' and starts_at is not null and ends_at is not null and off_kind is null)
    or (entry_kind = 'off' and starts_at is null and ends_at is null and off_kind is not null)
  )
);
create index if not exists staff_schedule_entries_employee_date_idx
  on public.staff_schedule_entries(employee_id, work_date, version_id);
create index if not exists staff_schedule_entries_period_date_idx
  on public.staff_schedule_entries(period_id, work_date, entry_kind);
create table if not exists public.staff_schedule_rule_results (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.staff_schedule_versions(id) on delete cascade,
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid references public.profiles(id) on delete cascade,
  work_date date,
  rule_code text not null,
  severity text not null check (severity in ('info', 'warning', 'blocking')),
  passed boolean not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  overridden_by uuid references public.profiles(id) on delete set null,
  override_reason text,
  overridden_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists staff_schedule_rule_results_version_idx
  on public.staff_schedule_rule_results(version_id, passed, severity);
create table if not exists public.staff_schedule_approvals (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.staff_schedule_versions(id) on delete cascade,
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stage text not null check (stage in ('assistant_manager', 'manager')),
  decision text not null check (decision in ('approved', 'rejected', 'returned')),
  reason text,
  decided_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null default now(),
  unique(version_id, stage)
);
create table if not exists public.staff_holiday_adjustments (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.staff_schedule_versions(id) on delete cascade,
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  holiday_date date not null,
  holiday_name text not null,
  original_shift_summary text not null,
  adjusted_day_off date not null,
  status text not null default 'draft' check (status in ('draft', 'manager_approved', 'employee_signed', 'superseded')),
  arranged_by uuid not null references public.profiles(id) on delete restrict,
  manager_approved_by uuid references public.profiles(id) on delete set null,
  manager_approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(version_id, employee_id, holiday_date),
  check (adjusted_day_off <> holiday_date)
);
create table if not exists public.staff_schedule_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.staff_schedule_versions(id) on delete cascade,
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('signed', 'objected', 'superseded')),
  checkbox_confirmed boolean not null default false,
  statement_snapshot text not null,
  schedule_snapshot jsonb not null default '[]'::jsonb,
  holiday_adjustment_snapshot jsonb not null default '[]'::jsonb,
  signature_object_path text,
  signature_sha256 text,
  objection_reason text,
  signed_at timestamptz,
  submitted_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  unique(version_id, employee_id),
  check (
    (status = 'signed' and checkbox_confirmed and signature_object_path is not null and signed_at is not null)
    or (status = 'objected' and objection_reason is not null)
    or status = 'superseded'
  )
);
create table if not exists public.staff_leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  leave_type text not null check (leave_type in (
    'annual', 'sick', 'personal', 'family_care', 'marriage', 'bereavement', 'official', 'other'
  )),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_minutes integer not null check (duration_minutes > 0),
  unit text not null check (unit in ('full_day', 'half_day', 'hourly', 'actual')),
  reason text,
  proof_required boolean not null default false,
  proof_due_at timestamptz,
  status text not null default 'assistant_review'
    check (status in ('draft', 'assistant_review', 'manager_review', 'approved', 'rejected', 'adjustment_proposed', 'withdrawn')),
  assistant_decision text check (assistant_decision is null or assistant_decision in ('approved', 'rejected', 'returned', 'adjustment_proposed')),
  assistant_reason text,
  assistant_decided_by uuid references public.profiles(id) on delete set null,
  assistant_decided_at timestamptz,
  manager_decision text check (manager_decision is null or manager_decision in ('approved', 'rejected', 'returned', 'adjustment_proposed')),
  manager_reason text,
  manager_decided_by uuid references public.profiles(id) on delete set null,
  manager_decided_at timestamptz,
  proposed_starts_at timestamptz,
  proposed_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists staff_leave_requests_employee_time_idx
  on public.staff_leave_requests(employee_id, starts_at desc);
create table if not exists public.staff_leave_attachments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.staff_leave_requests(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  object_path text not null,
  file_name text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 15728640),
  sha256 text,
  uploaded_at timestamptz not null default now()
);
create table if not exists public.staff_attendance_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  file_name text not null,
  file_sha256 text not null,
  period_start date,
  period_end date,
  status text not null default 'preview'
    check (status in ('uploading', 'preview', 'notifications_sent', 'assistant_review', 'manager_review', 'completed', 'failed')),
  row_count integer not null default 0 check (row_count >= 0),
  imported_by uuid not null references public.profiles(id) on delete restrict,
  imported_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique(tenant_id, file_sha256)
);
create table if not exists public.staff_attendance_daily_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.staff_attendance_import_batches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid references public.profiles(id) on delete set null,
  employee_number_raw text,
  employee_name_raw text,
  work_date date not null,
  punch_times timestamptz[] not null default '{}',
  first_punch_at timestamptz,
  last_punch_at timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  mapping_status text not null default 'matched' check (mapping_status in ('matched', 'unmatched', 'ambiguous')),
  created_at timestamptz not null default now(),
  unique(batch_id, employee_number_raw, work_date)
);
create table if not exists public.staff_attendance_anomalies (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.staff_attendance_import_batches(id) on delete cascade,
  daily_row_id uuid not null references public.staff_attendance_daily_rows(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid references public.profiles(id) on delete set null,
  work_date date not null,
  anomaly_type text not null check (anomaly_type in (
    'missing_in', 'missing_out', 'no_punch', 'late', 'early_leave', 'late_clock_out',
    'off_day_punch', 'multiple_punches', 'out_of_order', 'unmatched_employee'
  )),
  scheduled_at timestamptz,
  actual_at timestamptz,
  variance_minutes integer,
  raw_punches jsonb not null default '[]'::jsonb,
  supervisor_selected boolean not null default false,
  status text not null default 'preview'
    check (status in ('preview', 'employee_response', 'assistant_review', 'manager_review', 'resolved', 'dismissed')),
  resolution text check (resolution is null or resolution in (
    'personal_activity_confirmed', 'worked_overtime', 'corrected_punch', 'leave', 'late', 'early_leave', 'other', 'dismissed'
  )),
  resolution_minutes integer,
  supervisor_note text,
  manager_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(daily_row_id, anomaly_type)
);
create index if not exists staff_attendance_anomalies_employee_idx
  on public.staff_attendance_anomalies(employee_id, work_date, status);
create table if not exists public.staff_attendance_response_packages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  batch_id uuid not null references public.staff_attendance_import_batches(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'signed', 'assistant_review', 'manager_review', 'resolved')),
  statement_snapshot text not null,
  signature_object_path text,
  signature_sha256 text,
  signed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(batch_id, employee_id)
);
create table if not exists public.staff_attendance_package_items (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.staff_attendance_response_packages(id) on delete cascade,
  anomaly_id uuid not null references public.staff_attendance_anomalies(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(package_id, anomaly_id)
);
create table if not exists public.staff_attendance_responses (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.staff_attendance_response_packages(id) on delete cascade,
  anomaly_id uuid not null references public.staff_attendance_anomalies(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  response text not null check (response in ('confirm_as_shown', 'confirm_personal_activity', 'content_incorrect')),
  actual_work_minutes integer check (actual_work_minutes is null or actual_work_minutes >= 0),
  explanation text,
  created_at timestamptz not null default now(),
  unique(package_id, anomaly_id),
  check (response <> 'content_incorrect' or explanation is not null)
);
create table if not exists public.staff_attendance_reviews (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.staff_attendance_response_packages(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stage text not null check (stage in ('assistant_manager', 'manager')),
  decision text not null check (decision in ('approved', 'rejected', 'returned')),
  reason text,
  decided_by uuid not null references public.profiles(id) on delete restrict,
  decided_at timestamptz not null default now(),
  unique(package_id, stage)
);
create table if not exists public.staff_payroll_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete cascade,
  month_start date not null check (month_start = date_trunc('month', month_start)::date),
  base_pay_date date not null,
  bonus_pay_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'attendance_review', 'manager_review', 'closed', 'reopened')),
  unresolved_warning_count integer not null default 0 check (unresolved_warning_count >= 0),
  insurance_incomplete_count integer not null default 0 check (insurance_incomplete_count >= 0),
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz,
  close_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists staff_payroll_periods_tenant_branch_month_idx
  on public.staff_payroll_periods(tenant_id, coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), month_start);
create table if not exists public.staff_payroll_statements (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references public.staff_payroll_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  employment_snapshot jsonb not null default '{}'::jsonb,
  attendance_snapshot jsonb not null default '{}'::jsonb,
  regular_minutes integer not null default 0 check (regular_minutes >= 0),
  overtime_minutes integer not null default 0 check (overtime_minutes >= 0),
  base_pay numeric(12,2) not null default 0,
  overtime_pay numeric(12,2) not null default 0,
  leave_deduction numeric(12,2) not null default 0,
  labor_insurance_employee numeric(12,2) not null default 0,
  health_insurance_employee numeric(12,2) not null default 0,
  pension_employee numeric(12,2) not null default 0,
  withholding_tax numeric(12,2) not null default 0,
  bonus_total numeric(12,2) not null default 0,
  adjustment_total numeric(12,2) not null default 0,
  gross_pay numeric(12,2) not null default 0,
  deduction_total numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'issued', 'corrected', 'disputed')),
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_period_id, employee_id)
);
create table if not exists public.staff_payroll_line_items (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.staff_payroll_statements(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  item_type text not null check (item_type in ('earning', 'deduction', 'bonus', 'insurance', 'tax', 'adjustment')),
  code text not null,
  label text not null,
  quantity numeric(14,4),
  rate numeric(14,4),
  amount numeric(12,2) not null,
  source_type text,
  source_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create table if not exists public.staff_payroll_corrections (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.staff_payroll_statements(id) on delete cascade,
  payroll_period_id uuid not null references public.staff_payroll_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null,
  difference_amount numeric(12,2) not null,
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  status text not null default 'draft' check (status in ('draft', 'manager_approved', 'employee_signed', 'paid', 'cancelled')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  manager_approved_by uuid references public.profiles(id) on delete set null,
  manager_approved_at timestamptz,
  signature_object_path text,
  signature_sha256 text,
  employee_signed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.staff_payroll_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  statement_id uuid not null references public.staff_payroll_statements(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  action text not null check (action in ('read', 'disputed')),
  dispute_reason text,
  acted_at timestamptz not null default now(),
  unique(statement_id, employee_id),
  check (action <> 'disputed' or dispute_reason is not null)
);
create table if not exists public.staff_statutory_rate_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  rate_type text not null check (rate_type in (
    'minimum_hourly_wage', 'minimum_monthly_wage', 'labor_insurance', 'health_insurance', 'pension', 'overtime_multiplier'
  )),
  effective_from date not null,
  effective_to date,
  configuration jsonb not null,
  source_label text,
  source_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);
create unique index if not exists staff_statutory_rate_versions_scope_idx
  on public.staff_statutory_rate_versions(coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), rate_type, effective_from);
create table if not exists public.staff_insurance_enrollments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  insurance_type text not null check (insurance_type in ('labor', 'employment', 'occupational_accident', 'health', 'pension')),
  insured_salary numeric(12,2),
  employee_dependents integer not null default 0 check (employee_dependents >= 0),
  enrolled_from date,
  enrolled_to date,
  status text not null default 'pending' check (status in ('pending', 'active', 'ended', 'not_applicable')),
  notes text,
  configured_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, insurance_type),
  check (enrolled_to is null or enrolled_from is null or enrolled_to >= enrolled_from)
);
-- Private buckets. Files are uploaded through authenticated server routes using scoped paths.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('staff-leave-proofs', 'staff-leave-proofs', false, 15728640, array['image/jpeg','image/png','image/webp','application/pdf']),
  ('staff-signatures', 'staff-signatures', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
-- RLS: employees see only their own personal records; authorized supervisors see their tenant.
do $$
declare
  table_name text;
  scoped_tables text[] := array[
    'staff_employment_profiles',
    'staff_time_off_preferences',
    'staff_time_off_preference_dates',
    'staff_schedule_entries',
    'staff_holiday_adjustments',
    'staff_schedule_acknowledgements',
    'staff_leave_requests',
    'staff_leave_attachments',
    'staff_attendance_daily_rows',
    'staff_attendance_anomalies',
    'staff_attendance_response_packages',
    'staff_attendance_package_items',
    'staff_attendance_responses',
    'staff_payroll_statements',
    'staff_payroll_corrections',
    'staff_payroll_acknowledgements',
    'staff_insurance_enrollments'
  ];
begin
  foreach table_name in array scoped_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_self_select', table_name);
    execute format(
      'create policy %I on public.%I for select using (
        public.is_platform_admin()
        or employee_id = auth.uid()
        or (
          public.can_manage_staff_operations()
          and exists (
            select 1 from public.profiles actor
            where actor.id = auth.uid() and actor.tenant_id = %I.tenant_id
          )
        )
      )',
      table_name || '_self_select', table_name, table_name
    );
    execute format('drop policy if exists %I on public.%I', table_name || '_manager_all', table_name);
    execute format(
      'create policy %I on public.%I for all using (
        public.is_platform_admin()
        or (
          public.can_manage_staff_operations()
          and exists (
            select 1 from public.profiles actor
            where actor.id = auth.uid() and actor.tenant_id = %I.tenant_id
          )
        )
      ) with check (
        public.is_platform_admin()
        or (
          public.can_manage_staff_operations()
          and exists (
            select 1 from public.profiles actor
            where actor.id = auth.uid() and actor.tenant_id = %I.tenant_id
          )
        )
      )',
      table_name || '_manager_all', table_name, table_name, table_name
    );
  end loop;
end $$;
-- Employee-owned insert/update operations. Detailed time windows are also enforced by APIs.
create policy staff_time_off_preferences_self_insert
  on public.staff_time_off_preferences for insert
  with check (employee_id = auth.uid());
create policy staff_time_off_preferences_self_update
  on public.staff_time_off_preferences for update
  using (employee_id = auth.uid()) with check (employee_id = auth.uid());
create policy staff_time_off_preference_dates_self_insert
  on public.staff_time_off_preference_dates for insert
  with check (employee_id = auth.uid());
create policy staff_time_off_preference_dates_self_delete
  on public.staff_time_off_preference_dates for delete
  using (employee_id = auth.uid() and is_locked = false);
create policy staff_schedule_acknowledgements_self_insert
  on public.staff_schedule_acknowledgements for insert
  with check (employee_id = auth.uid());
create policy staff_leave_requests_self_insert
  on public.staff_leave_requests for insert
  with check (employee_id = auth.uid());
create policy staff_leave_requests_self_update
  on public.staff_leave_requests for update
  using (employee_id = auth.uid() and status in ('draft', 'assistant_review'))
  with check (employee_id = auth.uid());
create policy staff_leave_attachments_self_insert
  on public.staff_leave_attachments for insert
  with check (employee_id = auth.uid());
create policy staff_attendance_responses_self_insert
  on public.staff_attendance_responses for insert
  with check (employee_id = auth.uid());
create policy staff_payroll_acknowledgements_self_insert
  on public.staff_payroll_acknowledgements for insert
  with check (employee_id = auth.uid());
-- Tenant operational tables are supervisor-only. Employees receive period/version metadata
-- through server routes that disclose only the minimum needed for their own schedule.
do $$
declare
  table_name text;
  manager_tables text[] := array[
    'staff_shift_templates',
    'staff_schedule_periods',
    'staff_facility_closures',
    'staff_holiday_calendar',
    'staff_schedule_versions',
    'staff_schedule_rule_results',
    'staff_schedule_approvals',
    'staff_attendance_import_batches',
    'staff_attendance_reviews',
    'staff_payroll_periods',
    'staff_payroll_line_items',
    'staff_statutory_rate_versions'
  ];
begin
  foreach table_name in array manager_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', table_name || '_manager_all', table_name);
    execute format(
      'create policy %I on public.%I for all using (
        public.is_platform_admin()
        or (
          public.can_manage_staff_operations()
          and exists (
            select 1 from public.profiles actor
            where actor.id = auth.uid()
              and (%I.tenant_id is null or actor.tenant_id = %I.tenant_id)
          )
        )
      ) with check (
        public.is_platform_admin()
        or (
          public.can_manage_staff_operations()
          and exists (
            select 1 from public.profiles actor
            where actor.id = auth.uid()
              and (%I.tenant_id is null or actor.tenant_id = %I.tenant_id)
          )
        )
      )',
      table_name || '_manager_all', table_name,
      table_name, table_name, table_name, table_name
    );
  end loop;
end $$;
-- Keep updated_at values reliable for audit and signature invalidation logic.
do $$
declare
  table_name text;
  touched_tables text[] := array[
    'staff_employment_profiles', 'staff_shift_templates', 'staff_schedule_periods',
    'staff_time_off_preferences', 'staff_schedule_versions', 'staff_schedule_entries',
    'staff_holiday_adjustments', 'staff_leave_requests', 'staff_attendance_anomalies',
    'staff_attendance_response_packages', 'staff_payroll_periods', 'staff_payroll_statements',
    'staff_payroll_corrections', 'staff_insurance_enrollments'
  ];
begin
  foreach table_name in array touched_tables loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_touch_updated_at', table_name);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      table_name || '_touch_updated_at', table_name
    );
  end loop;
end $$;
-- Storage access is limited to a user's own folder: <tenant>/<user>/<file>.
drop policy if exists staff_leave_proofs_self_read on storage.objects;
create policy staff_leave_proofs_self_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'staff-leave-proofs'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.can_manage_staff_operations()
    )
  );
drop policy if exists staff_signatures_self_read on storage.objects;
create policy staff_signatures_self_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'staff-signatures'
    and (
      (storage.foldername(name))[2] = auth.uid()::text
      or public.can_manage_staff_operations()
    )
  );
drop policy if exists staff_leave_proofs_self_insert on storage.objects;
create policy staff_leave_proofs_self_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'staff-leave-proofs'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
drop policy if exists staff_signatures_self_insert on storage.objects;
create policy staff_signatures_self_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'staff-signatures'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
comment on table public.staff_schedule_periods is
  'Employee schedule month. Monday-Sunday cycle; preferences close on the 20th 23:59 Asia/Taipei.';
comment on table public.staff_schedule_rule_results is
  'Persisted legal/staffing checks. Blocking failures prevent formal publication unless a rule explicitly permits manager override.';
comment on table public.staff_attendance_daily_rows is
  'Immutable normalized copy of imported punch-clock data; raw_payload preserves the source Excel values.';
comment on table public.staff_payroll_corrections is
  'Post-close correction slip. Original closed payroll snapshots remain immutable.';
