-- Phase 5.5: pre-production stability hardening.
-- Date: 2026-03-06
-- Scope:
-- 1) request idempotency store
-- 2) subscription status backfill normalization
-- 3) consistency query performance indexes

create table if not exists public.operation_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  operation_key text not null,
  status text not null default 'processing' check (status in ('processing', 'succeeded', 'failed')),
  response jsonb,
  error_code text,
  actor_id uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, operation_key)
);

create index if not exists operation_idempotency_status_idx
  on public.operation_idempotency_keys(tenant_id, status, created_at desc);

create index if not exists operation_idempotency_expires_idx
  on public.operation_idempotency_keys(expires_at);

alter table public.operation_idempotency_keys enable row level security;

drop policy if exists operation_idempotency_tenant_access on public.operation_idempotency_keys;
create policy operation_idempotency_tenant_access
  on public.operation_idempotency_keys
  for all
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  )
  with check (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id is not null
      and tenant_id = public.current_tenant_id()
    )
  );

-- Normalize historical subscription lifecycle state based on date boundaries.
update public.tenant_subscriptions ts
set
  status = case
    when ts.status in ('active', 'trial')
      and ts.ends_at is not null
      and ts.ends_at < now()
      and ts.grace_ends_at is not null
      and ts.grace_ends_at >= now()
      then 'grace'
    when ts.status in ('active', 'trial', 'grace')
      and (
        (ts.grace_ends_at is not null and ts.grace_ends_at < now())
        or (ts.grace_ends_at is null and ts.ends_at is not null and ts.ends_at < now())
      )
      then 'expired'
    else ts.status
  end,
  updated_at = now()
where ts.is_current = true;

-- Hard consistency helpers.
create index if not exists member_plan_contracts_member_status_idx
  on public.member_plan_contracts(tenant_id, member_id, status, updated_at desc);

create index if not exists member_plan_contracts_source_payment_idx
  on public.member_plan_contracts(tenant_id, source_payment_id);

create index if not exists session_redemptions_contract_idx
  on public.session_redemptions(tenant_id, member_plan_contract_id, created_at desc);

create index if not exists audit_logs_action_created_idx
  on public.audit_logs(tenant_id, action, created_at desc);
