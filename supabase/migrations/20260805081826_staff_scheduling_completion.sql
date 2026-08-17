-- Complete the employee scheduling domain with precise re-signing, configurable
-- rule overrides, granular staff permissions, bonus inputs and insurance inputs.

alter table public.staff_schedule_rule_results
  add column if not exists override_reason text,
  add column if not exists overridden_by uuid references public.profiles(id) on delete set null,
  add column if not exists overridden_at timestamptz;
alter table public.staff_schedule_acknowledgements
  add column if not exists carried_forward_from_id uuid references public.staff_schedule_acknowledgements(id) on delete set null,
  add column if not exists content_sha256 text,
  add column if not exists device_information jsonb not null default '{}'::jsonb;
alter table public.staff_schedule_acknowledgements
  drop constraint if exists staff_schedule_acknowledgements_status_check;
alter table public.staff_schedule_acknowledgements
  add constraint staff_schedule_acknowledgements_status_check
  check (status in ('signed', 'objected', 'superseded', 'carried_forward'));
alter table public.staff_schedule_acknowledgements
  drop constraint if exists staff_schedule_acknowledgements_check;
alter table public.staff_schedule_acknowledgements
  add constraint staff_schedule_acknowledgements_check
  check (
    (status = 'signed' and checkbox_confirmed and signature_object_path is not null and signed_at is not null)
    or (status = 'objected' and objection_reason is not null)
    or (status = 'carried_forward' and carried_forward_from_id is not null and signed_at is not null)
    or status = 'superseded'
  );
create table if not exists public.staff_permission_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null check (permission_key in (
    'create_employee', 'edit_employee', 'suspend_employee',
    'manage_schedule', 'publish_schedule', 'review_leave_requests',
    'manage_attendance', 'view_team_schedule', 'view_team_salary',
    'calculate_payroll', 'close_payroll', 'manage_insurance',
    'assign_supervisor', 'manage_permissions', 'export_schedule'
  )),
  allowed boolean not null,
  reason text not null,
  configured_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(employee_id, permission_key)
);
create index if not exists staff_permission_overrides_tenant_employee_idx
  on public.staff_permission_overrides(tenant_id, employee_id);
create index if not exists staff_permission_overrides_configured_by_idx
  on public.staff_permission_overrides(configured_by);
create index if not exists staff_schedule_acknowledgements_carried_forward_idx
  on public.staff_schedule_acknowledgements(carried_forward_from_id)
  where carried_forward_from_id is not null;
create index if not exists staff_schedule_rule_results_overridden_by_idx
  on public.staff_schedule_rule_results(overridden_by)
  where overridden_by is not null;
alter table public.staff_insurance_enrollments
  add column if not exists provided_by_company boolean not null default true,
  add column if not exists voluntary_pension_rate numeric(6,5) not null default 0 check (voluntary_pension_rate between 0 and 0.06),
  add column if not exists employer_pension_rate numeric(6,5) not null default 0.06 check (employer_pension_rate between 0 and 1),
  add column if not exists change_reason text;
create table if not exists public.staff_payroll_bonus_entries (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references public.staff_payroll_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  bonus_type text not null check (bonus_type in ('course_fee', 'performance', 'allowance', 'other')),
  label text not null,
  quantity numeric(14,4),
  rate numeric(14,4),
  amount numeric(12,2) not null check (amount >= 0),
  source_note text,
  status text not null default 'approved' check (status in ('draft', 'approved', 'cancelled', 'paid')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists staff_payroll_bonus_entries_period_employee_idx
  on public.staff_payroll_bonus_entries(payroll_period_id, employee_id, status);
create index if not exists staff_payroll_bonus_entries_tenant_employee_idx
  on public.staff_payroll_bonus_entries(tenant_id, employee_id);
create index if not exists staff_payroll_bonus_entries_employee_idx
  on public.staff_payroll_bonus_entries(employee_id);
create index if not exists staff_payroll_bonus_entries_approved_by_idx
  on public.staff_payroll_bonus_entries(approved_by)
  where approved_by is not null;
create index if not exists staff_payroll_bonus_entries_created_by_idx
  on public.staff_payroll_bonus_entries(created_by);
create index if not exists staff_attendance_daily_rows_tenant_employee_date_idx
  on public.staff_attendance_daily_rows(tenant_id, employee_id, work_date, created_at desc);
create index if not exists staff_attendance_anomalies_tenant_employee_date_status_idx
  on public.staff_attendance_anomalies(tenant_id, employee_id, work_date, status);
create index if not exists staff_leave_requests_tenant_employee_date_status_idx
  on public.staff_leave_requests(tenant_id, employee_id, starts_at, status);
create index if not exists staff_schedule_rule_results_version_open_idx
  on public.staff_schedule_rule_results(version_id, severity, passed)
  where passed = false;
alter table public.staff_permission_overrides enable row level security;
alter table public.staff_payroll_bonus_entries enable row level security;
drop policy if exists staff_permission_overrides_manager_select on public.staff_permission_overrides;
create policy staff_permission_overrides_manager_select
  on public.staff_permission_overrides for select to authenticated
  using (
    (select public.is_platform_admin())
    or (
      (select public.can_final_approve_staff_operations())
      and tenant_id = (select tenant_id from public.profiles where id = (select auth.uid()))
    )
  );
drop policy if exists staff_permission_overrides_manager_write on public.staff_permission_overrides;
create policy staff_permission_overrides_manager_write
  on public.staff_permission_overrides for all to authenticated
  using (
    (select public.is_platform_admin())
    or (
      (select public.can_final_approve_staff_operations())
      and tenant_id = (select tenant_id from public.profiles where id = (select auth.uid()))
    )
  )
  with check (
    (select public.is_platform_admin())
    or (
      (select public.can_final_approve_staff_operations())
      and tenant_id = (select tenant_id from public.profiles where id = (select auth.uid()))
    )
  );
drop policy if exists staff_payroll_bonus_entries_manager_all on public.staff_payroll_bonus_entries;
create policy staff_payroll_bonus_entries_manager_all
  on public.staff_payroll_bonus_entries for all to authenticated
  using (
    (select public.is_platform_admin())
    or (
      (select public.can_final_approve_staff_operations())
      and tenant_id = (select tenant_id from public.profiles where id = (select auth.uid()))
    )
  )
  with check (
    (select public.is_platform_admin())
    or (
      (select public.can_final_approve_staff_operations())
      and tenant_id = (select tenant_id from public.profiles where id = (select auth.uid()))
    )
  );
drop policy if exists staff_payroll_bonus_entries_self_select on public.staff_payroll_bonus_entries;
create policy staff_payroll_bonus_entries_self_select
  on public.staff_payroll_bonus_entries for select to authenticated
  using (employee_id = (select auth.uid()) and status in ('approved', 'paid'));
-- These tables are intentionally server-route only. This keeps the granular
-- permission checks in one audited authorization path and prevents a signed-in
-- client from bypassing them through the Data API. Explicit service-role grants
-- also opt the new tables into the Data API after the 2026 exposure change.
revoke all on table public.staff_permission_overrides from anon, authenticated;
revoke all on table public.staff_payroll_bonus_entries from anon, authenticated;
grant select, insert, update, delete on table public.staff_permission_overrides to service_role;
grant select, insert, update, delete on table public.staff_payroll_bonus_entries to service_role;
drop trigger if exists staff_permission_overrides_touch_updated_at on public.staff_permission_overrides;
create trigger staff_permission_overrides_touch_updated_at
before update on public.staff_permission_overrides
for each row execute function public.touch_updated_at();
drop trigger if exists staff_payroll_bonus_entries_touch_updated_at on public.staff_payroll_bonus_entries;
create trigger staff_payroll_bonus_entries_touch_updated_at
before update on public.staff_payroll_bonus_entries
for each row execute function public.touch_updated_at();
comment on table public.staff_permission_overrides is
  'Per-account staff-operation grants and denials. Server authorization always resolves these before role defaults.';
comment on table public.staff_payroll_bonus_entries is
  'Approved monthly course fees, bonuses and allowances included in the payroll snapshot.';
