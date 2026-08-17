alter table public.profiles
  add column if not exists staff_activation_status text not null default 'completed',
  add column if not exists staff_identity_confirmed_at timestamptz,
  add column if not exists staff_identity_denied_at timestamptz,
  add column if not exists staff_activation_completed_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_staff_activation_status_check;

alter table public.profiles
  add constraint profiles_staff_activation_status_check
  check (
    staff_activation_status in (
      'pending_identity',
      'identity_confirmed',
      'denied',
      'locked',
      'completed'
    )
  );

update public.profiles
set staff_activation_completed_at = coalesce(staff_activation_completed_at, updated_at, created_at, now())
where staff_activation_status = 'completed'
  and role not in ('member', 'customer');

create table if not exists public.staff_activation_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete cascade,
  token_hash text not null,
  expires_at timestamptz not null,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  last_attempt_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists staff_activation_tokens_hash_unique_idx
  on public.staff_activation_tokens(token_hash);

create index if not exists staff_activation_tokens_profile_created_idx
  on public.staff_activation_tokens(profile_id, created_at desc);

create unique index if not exists staff_activation_tokens_one_open_idx
  on public.staff_activation_tokens(profile_id)
  where used_at is null and revoked_at is null;

alter table public.staff_activation_tokens enable row level security;

revoke all on table public.staff_activation_tokens from anon;
revoke all on table public.staff_activation_tokens from authenticated;
grant select, insert, update, delete on table public.staff_activation_tokens to service_role;;
