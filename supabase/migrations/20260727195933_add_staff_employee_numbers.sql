alter table public.profiles
  add column if not exists employee_number text;

with numbered_staff as (
  select
    id,
    row_number() over (order by created_at asc, id asc) as sequence_number
  from public.profiles
  where role in (
    'platform_admin',
    'manager',
    'supervisor',
    'branch_manager',
    'frontdesk',
    'coach',
    'sales'
  )
    and employee_number is null
)
update public.profiles as profile
set employee_number = 'BE' || lpad(numbered_staff.sequence_number::text, 6, '0')
from numbered_staff
where profile.id = numbered_staff.id;

create sequence if not exists public.staff_employee_number_seq;

select setval(
  'public.staff_employee_number_seq',
  greatest(
    coalesce(
      (
        select max(substring(employee_number from 3)::bigint)
        from public.profiles
        where employee_number ~ '^BE[0-9]{6}$'
      ),
      0
    ),
    1
  ),
  exists (
    select 1
    from public.profiles
    where employee_number ~ '^BE[0-9]{6}$'
  )
);

create unique index if not exists profiles_employee_number_unique_idx
  on public.profiles(employee_number)
  where employee_number is not null;

alter table public.profiles
  drop constraint if exists profiles_employee_number_format_check;

alter table public.profiles
  add constraint profiles_employee_number_format_check
  check (employee_number is null or employee_number ~ '^BE[0-9]{6}$');

create or replace function public.next_staff_employee_number()
returns text
language sql
security invoker
set search_path = ''
as $$
  select 'BE' || lpad(nextval('public.staff_employee_number_seq')::text, 6, '0');
$$;

revoke all on function public.next_staff_employee_number() from public;
revoke all on function public.next_staff_employee_number() from anon;
revoke all on function public.next_staff_employee_number() from authenticated;
grant execute on function public.next_staff_employee_number() to service_role;
grant usage, select on sequence public.staff_employee_number_seq to service_role;
