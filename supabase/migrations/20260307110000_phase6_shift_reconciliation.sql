-- Phase 6: extend existing frontdesk shift/handover model for reconciliation.
-- Keep current frontdesk_shifts/frontdesk_shift_items and add minimal columns + safeguards.

alter table public.frontdesk_shifts
  add column if not exists opening_cash numeric(12, 2) not null default 0,
  add column if not exists expected_cash numeric(12, 2),
  add column if not exists counted_cash numeric(12, 2),
  add column if not exists difference numeric(12, 2),
  add column if not exists difference_reason text,
  add column if not exists closing_confirmed boolean not null default false;

alter table public.frontdesk_shift_items
  add column if not exists event_type text,
  add column if not exists payment_method text check (payment_method in ('cash', 'card', 'transfer', 'newebpay', 'manual')),
  add column if not exists quantity integer not null default 1,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists frontdesk_shifts_open_one_per_branch_idx
  on public.frontdesk_shifts(tenant_id, branch_id)
  where status = 'open';

create index if not exists frontdesk_shift_items_shift_event_idx
  on public.frontdesk_shift_items(tenant_id, shift_id, event_type, created_at desc);

create index if not exists frontdesk_shifts_tenant_branch_opened_idx
  on public.frontdesk_shifts(tenant_id, branch_id, opened_at desc);

