create table if not exists public.staff_schedule_selection_overrides (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  is_open boolean not null default true,
  reason text,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(period_id, employee_id)
);

create index if not exists staff_schedule_selection_overrides_employee_idx
  on public.staff_schedule_selection_overrides(employee_id, period_id)
  where is_open = true;

alter table public.staff_schedule_selection_overrides enable row level security;

drop policy if exists staff_schedule_selection_overrides_manager_all
  on public.staff_schedule_selection_overrides;
create policy staff_schedule_selection_overrides_manager_all
  on public.staff_schedule_selection_overrides
  for all
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.can_manage_staff_operations()
      and exists (
        select 1
        from public.profiles actor
        where actor.id = (select auth.uid())
          and actor.tenant_id = staff_schedule_selection_overrides.tenant_id
      )
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.can_manage_staff_operations()
      and exists (
        select 1
        from public.profiles actor
        where actor.id = (select auth.uid())
          and actor.tenant_id = staff_schedule_selection_overrides.tenant_id
      )
    )
  );

revoke all on table public.staff_schedule_selection_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_schedule_selection_overrides to service_role;

drop trigger if exists staff_schedule_selection_overrides_touch_updated_at
  on public.staff_schedule_selection_overrides;
create trigger staff_schedule_selection_overrides_touch_updated_at
before update on public.staff_schedule_selection_overrides
for each row execute function public.touch_updated_at();

comment on table public.staff_schedule_selection_overrides is
  'Per-employee catch-up access for time-off selection after the shared selection window closes.';

-- Employee 15 joined after the September draft existed. Open only this employee's
-- catch-up selection; every other employee keeps the existing closed state.
insert into public.staff_schedule_selection_overrides (
  period_id,
  tenant_id,
  employee_id,
  is_open,
  reason,
  updated_by
)
select
  period.id,
  period.tenant_id,
  employee.id,
  true,
  '2026-09 catch-up selection requested for employee E000015',
  period.created_by
from public.staff_schedule_periods period
join public.profiles employee
  on employee.tenant_id = period.tenant_id
 and employee.employee_number = 'E000015'
 and employee.is_active = true
 and employee.staff_deleted_at is null
where period.month_start = date '2026-09-01'
  and (
    period.branch_id is null
    or employee.branch_id is null
    or employee.branch_id = period.branch_id
  )
on conflict (period_id, employee_id) do update
set is_open = true,
    reason = excluded.reason,
    updated_by = excluded.updated_by,
    updated_at = now();

-- Make the exceptional opening discoverable from employee 15's notification
-- center, using the same target URL and dedupe key as the manager action.
insert into public.in_app_notifications (
  tenant_id,
  branch_id,
  recipient_user_id,
  recipient_role,
  status,
  severity,
  event_type,
  title,
  message,
  target_type,
  target_id,
  action_url,
  dedupe_key,
  created_by
)
select
  period.tenant_id,
  period.branch_id,
  employee.id,
  employee.role,
  'unread',
  'info',
  'staff_schedule_selection_override_opened',
  '2026 年 9 月已單獨開放選休',
  '主管已為您單獨開放 2026 年 9 月選休，請進入班表頁完成並儲存。',
  'staff_schedule_period',
  period.id::text,
  '/staff/schedule?month=2026-09',
  'staff-schedule-selection-override:' || period.id::text || ':' || employee.id::text,
  period.created_by
from public.staff_schedule_periods period
join public.profiles employee
  on employee.tenant_id = period.tenant_id
 and employee.employee_number = 'E000015'
 and employee.is_active = true
 and employee.staff_deleted_at is null
where period.month_start = date '2026-09-01'
  and (
    period.branch_id is null
    or employee.branch_id is null
    or employee.branch_id = period.branch_id
  )
on conflict (recipient_user_id, dedupe_key) where dedupe_key is not null do nothing;
