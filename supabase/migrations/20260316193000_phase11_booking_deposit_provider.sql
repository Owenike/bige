alter table if exists public.orders
  add column if not exists booking_id uuid references public.bookings(id) on delete set null;

create index if not exists orders_tenant_booking_created_idx
  on public.orders (tenant_id, booking_id, created_at desc);
