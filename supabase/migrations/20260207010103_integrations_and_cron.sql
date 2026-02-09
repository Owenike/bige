-- External integrations and scheduled job support tables.
-- Date: 2026-02-07

create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  member_id uuid references public.members(id) on delete set null,
  channel text not null check (channel in ('line', 'sms', 'email')),
  target text not null,
  template_key text,
  message text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_ref text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists notification_logs_tenant_time_idx
  on public.notification_logs (tenant_id, created_at desc);

create table if not exists public.payment_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  provider text not null check (provider in ('newebpay', 'manual')),
  event_type text not null,
  payment_id uuid references public.payments(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  signature text,
  status text not null default 'received' check (status in ('received', 'processed', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists payment_webhooks_provider_time_idx
  on public.payment_webhooks (provider, received_at desc);

create table if not exists public.daily_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  settlement_date date not null,
  total_paid numeric(12, 2) not null default 0,
  total_refunded numeric(12, 2) not null default 0,
  cash_total numeric(12, 2) not null default 0,
  card_total numeric(12, 2) not null default 0,
  transfer_total numeric(12, 2) not null default 0,
  newebpay_total numeric(12, 2) not null default 0,
  order_count integer not null default 0,
  payment_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, branch_id, settlement_date)
);

create index if not exists daily_settlements_tenant_date_idx
  on public.daily_settlements (tenant_id, settlement_date desc);

alter table public.notification_logs enable row level security;
alter table public.payment_webhooks enable row level security;
alter table public.daily_settlements enable row level security;

drop policy if exists notification_logs_tenant_access on public.notification_logs;
create policy notification_logs_tenant_access
  on public.notification_logs
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = notification_logs.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = notification_logs.tenant_id
    )
  );

drop policy if exists payment_webhooks_platform_manager_access on public.payment_webhooks;
create policy payment_webhooks_platform_manager_access
  on public.payment_webhooks
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and (p.role = 'manager' or p.role = 'frontdesk')
        and p.tenant_id = payment_webhooks.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and (p.role = 'manager' or p.role = 'frontdesk')
        and p.tenant_id = payment_webhooks.tenant_id
    )
  );

drop policy if exists daily_settlements_tenant_access on public.daily_settlements;
create policy daily_settlements_tenant_access
  on public.daily_settlements
  for all
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = daily_settlements.tenant_id
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.tenant_id = daily_settlements.tenant_id
    )
  );
