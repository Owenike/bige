create table if not exists public.staff_accrued_leave_monthly_credits (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references public.staff_schedule_periods(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  employee_id uuid not null references public.profiles(id) on delete cascade,
  month_start date not null,
  monthly_days_off integer not null check (monthly_days_off between 8 and 31),
  credited_days numeric(5,1) not null check (credited_days > 0 and credited_days <= 23),
  rule_code text not null default 'MONTHLY_DAYS_OVER_EIGHT'
    check (rule_code = 'MONTHLY_DAYS_OVER_EIGHT'),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(period_id, employee_id)
);

create index if not exists staff_accrued_leave_monthly_credits_employee_month_idx
  on public.staff_accrued_leave_monthly_credits(employee_id, month_start desc);

comment on table public.staff_accrued_leave_monthly_credits is
  'Idempotent monthly credits for BIG E''s rule that Saturday/Sunday days beyond eight become accrued leave.';
comment on column public.staff_employment_profiles.accrued_leave_balance_days is
  'Accrued leave balance. Monthly Saturday/Sunday days beyond eight are credited automatically once per employee and period; managers may adjust usage.';

create or replace function public.apply_staff_accrued_leave_monthly_credit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.staff_employment_profiles
  set accrued_leave_balance_days = least(365, accrued_leave_balance_days + new.credited_days)
  where employee_id = new.employee_id
    and tenant_id = new.tenant_id;

  if not found then
    raise exception 'Employment profile not found for monthly accrued leave credit';
  end if;

  return new;
end;
$$;

drop trigger if exists staff_accrued_leave_monthly_credits_apply_balance
  on public.staff_accrued_leave_monthly_credits;
create trigger staff_accrued_leave_monthly_credits_apply_balance
  after insert on public.staff_accrued_leave_monthly_credits
  for each row execute function public.apply_staff_accrued_leave_monthly_credit();

revoke execute on function public.apply_staff_accrued_leave_monthly_credit()
  from public, anon, authenticated;
grant execute on function public.apply_staff_accrued_leave_monthly_credit() to service_role;

grant select, insert on table public.staff_accrued_leave_monthly_credits to service_role;
grant select on table public.staff_accrued_leave_monthly_credits to authenticated;

alter table public.staff_accrued_leave_monthly_credits enable row level security;

drop policy if exists staff_accrued_leave_monthly_credits_manager_select
  on public.staff_accrued_leave_monthly_credits;
create policy staff_accrued_leave_monthly_credits_manager_select
  on public.staff_accrued_leave_monthly_credits
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.can_manage_staff_operations()
      and exists (
        select 1
        from public.profiles actor
        where actor.id = (select auth.uid())
          and actor.tenant_id = staff_accrued_leave_monthly_credits.tenant_id
      )
    )
  );
