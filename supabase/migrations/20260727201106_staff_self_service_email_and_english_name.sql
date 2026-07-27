alter table public.profiles
  add column if not exists english_name text;

alter table public.profiles
  drop constraint if exists profiles_employee_number_format_check;

update public.profiles
set employee_number = regexp_replace(employee_number, '^BE', 'E')
where employee_number ~ '^BE[0-9]{6}$';

alter table public.profiles
  add constraint profiles_employee_number_format_check
  check (employee_number is null or employee_number ~ '^E[0-9]{6}$');

select setval(
  'public.staff_employee_number_seq',
  greatest(
    coalesce(
      (
        select max(substring(employee_number from 2)::bigint)
        from public.profiles
        where employee_number ~ '^E[0-9]{6}$'
      ),
      0
    ),
    1
  ),
  exists (
    select 1
    from public.profiles
    where employee_number ~ '^E[0-9]{6}$'
  )
);

create or replace function public.next_staff_employee_number()
returns text
language sql
security invoker
set search_path = ''
as $$
  select 'E' || lpad(nextval('public.staff_employee_number_seq')::text, 6, '0');
$$;

revoke all on function public.next_staff_employee_number() from public;
revoke all on function public.next_staff_employee_number() from anon;
revoke all on function public.next_staff_employee_number() from authenticated;
grant execute on function public.next_staff_employee_number() to service_role;

create table if not exists public.staff_email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  email text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  requested_ip text,
  requested_ua text,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_email_verification_tokens_hash_unique_idx
  on public.staff_email_verification_tokens(token_hash);

create index if not exists staff_email_verification_tokens_profile_created_idx
  on public.staff_email_verification_tokens(profile_id, created_at desc);

alter table public.staff_email_verification_tokens enable row level security;

revoke all on table public.staff_email_verification_tokens from anon;
revoke all on table public.staff_email_verification_tokens from authenticated;
grant select, insert, update, delete on table public.staff_email_verification_tokens to service_role;
