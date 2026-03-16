alter table public.notification_deliveries
  add column if not exists provider text,
  add column if not exists resend_of_delivery_id uuid references public.notification_deliveries(id) on delete set null;

create index if not exists notification_deliveries_provider_status_idx
  on public.notification_deliveries(tenant_id, provider, status, created_at desc);

create index if not exists notification_deliveries_resend_parent_idx
  on public.notification_deliveries(tenant_id, resend_of_delivery_id, created_at desc)
  where resend_of_delivery_id is not null;
