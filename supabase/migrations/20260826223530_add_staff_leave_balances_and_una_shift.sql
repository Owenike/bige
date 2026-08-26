alter table public.staff_employment_profiles
  add column if not exists annual_leave_balance_days numeric(5,1) not null default 0,
  add column if not exists accrued_leave_balance_days numeric(5,1) not null default 0;

alter table public.staff_employment_profiles
  drop constraint if exists staff_employment_profiles_annual_leave_balance_days_check,
  drop constraint if exists staff_employment_profiles_accrued_leave_balance_days_check;

alter table public.staff_employment_profiles
  add constraint staff_employment_profiles_annual_leave_balance_days_check
    check (annual_leave_balance_days between 0 and 365),
  add constraint staff_employment_profiles_accrued_leave_balance_days_check
    check (accrued_leave_balance_days between 0 and 365);

comment on column public.staff_employment_profiles.annual_leave_balance_days is
  'Manager-maintained remaining annual leave days shown in the staff schedule.';
comment on column public.staff_employment_profiles.accrued_leave_balance_days is
  'Manager-maintained lawful compensatory leave balance; never substitutes for statutory weekly days off.';

update public.staff_employment_profiles as employment
set
  default_shift_code = 'COACH_EARLY',
  is_original_early_shift = true,
  updated_at = now()
from public.profiles as profile
where profile.id = employment.employee_id
  and profile.employee_number = 'E000012';
