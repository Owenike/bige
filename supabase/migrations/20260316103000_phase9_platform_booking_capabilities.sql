alter table public.store_booking_settings
  add column if not exists packages_enabled boolean not null default true;

create index if not exists store_booking_settings_tenant_packages_idx
  on public.store_booking_settings(tenant_id, branch_id, packages_enabled, updated_at desc);
