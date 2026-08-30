-- Repair two staff numbers that were allocated from a stale sequence. The
-- UUID predicates keep this correction scoped to the intended accounts and
-- make the migration a no-op in environments where those accounts do not
-- exist.
do $$
declare
  luna_id constant uuid := '30d43cb4-0ffc-488c-9d32-23f570af634f';
  hailey_id constant uuid := '90d57ff1-e0af-4b84-ac83-77c770271ed1';
begin
  if exists (
    select 1
    from public.profiles
    where employee_number = 'E000013'
      and id <> luna_id
  ) then
    raise exception 'employee_number_E000013_already_assigned';
  end if;

  if exists (
    select 1
    from public.profiles
    where employee_number = 'E000014'
      and id <> hailey_id
  ) then
    raise exception 'employee_number_E000014_already_assigned';
  end if;

  if exists (
    select 1
    from public.profiles
    where id = luna_id
      and employee_number not in ('E000008', 'E000013')
  ) then
    raise exception 'unexpected_luna_employee_number';
  end if;

  if exists (
    select 1
    from public.profiles
    where id = hailey_id
      and employee_number not in ('E000007', 'E000014')
  ) then
    raise exception 'unexpected_hailey_employee_number';
  end if;

  update public.profiles
  set employee_number = 'E000013',
      updated_at = now()
  where id = luna_id
    and employee_number = 'E000008';

  update public.profiles
  set employee_number = 'E000014',
      updated_at = now()
  where id = hailey_id
    and employee_number = 'E000007';
end;
$$;

-- Keep automatic allocation ahead of every real staff number, including
-- manually assigned numbers. E000099 is an explicit test account and must not
-- advance the production sequence.
create or replace function public.next_staff_employee_number()
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  highest_assigned bigint;
  sequence_value bigint;
  sequence_called boolean;
  allocated_value bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.staff_employee_number_seq', 0)
  );

  select coalesce(max(substring(profile.employee_number from 2)::bigint), 0)
  into highest_assigned
  from public.profiles as profile
  where profile.employee_number ~ '^E[0-9]{6}$'
    and profile.employee_number <> 'E000099';

  select last_value, is_called
  into sequence_value, sequence_called
  from public.staff_employee_number_seq;

  if highest_assigned > sequence_value
     or (
       highest_assigned = sequence_value
       and highest_assigned > 0
       and not sequence_called
     ) then
    perform pg_catalog.setval(
      'public.staff_employee_number_seq',
      highest_assigned,
      true
    );
  end if;

  allocated_value := pg_catalog.nextval('public.staff_employee_number_seq');
  return 'E' || pg_catalog.lpad(allocated_value::text, 6, '0');
end;
$$;

revoke all on function public.next_staff_employee_number() from public;
revoke all on function public.next_staff_employee_number() from anon;
revoke all on function public.next_staff_employee_number() from authenticated;
grant execute on function public.next_staff_employee_number() to service_role;
grant update on sequence public.staff_employee_number_seq to service_role;

-- Reconcile the current sequence without consuming E000015. The next call to
-- next_staff_employee_number() will therefore return E000015 in production.
do $$
declare
  highest_assigned bigint;
  sequence_value bigint;
  sequence_called boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.staff_employee_number_seq', 0)
  );

  select coalesce(max(substring(profile.employee_number from 2)::bigint), 0)
  into highest_assigned
  from public.profiles as profile
  where profile.employee_number ~ '^E[0-9]{6}$'
    and profile.employee_number <> 'E000099';

  select last_value, is_called
  into sequence_value, sequence_called
  from public.staff_employee_number_seq;

  if highest_assigned > sequence_value
     or (
       highest_assigned = sequence_value
       and highest_assigned > 0
       and not sequence_called
     ) then
    perform pg_catalog.setval(
      'public.staff_employee_number_seq',
      highest_assigned,
      true
    );
  end if;
end;
$$;
