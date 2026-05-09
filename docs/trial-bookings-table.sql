-- trial_bookings table draft for manual execution in Supabase SQL Editor
-- This phase is intended to be written by the Next.js API route using a
-- server-side Supabase service-role client.
-- Do not insert into this table directly from the frontend anon key.

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.trial_bookings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  name text not null,
  phone text not null,
  line_name text null,
  service text not null,
  preferred_time text not null,
  note text null,

  payment_method text not null,
  payment_status text not null,
  amount integer null,
  currency text not null default 'TWD',

  acpay_trade_no text null,
  merchant_trade_no text null,
  paid_at timestamptz null,

  source text not null default 'website_trial_booking',
  booking_status text not null default 'new',

  constraint trial_bookings_payment_method_check
    check (payment_method in ('cash_on_site', 'online_payment')),
  constraint trial_bookings_payment_status_check
    check (payment_status in ('pending_cash', 'pending_payment', 'paid', 'failed', 'cancelled')),
  constraint trial_bookings_booking_status_check
    check (booking_status in ('new', 'contacted', 'scheduled', 'completed', 'cancelled')),
  constraint trial_bookings_service_check
    check (service in ('weight_training', 'boxing_fitness', 'pilates', 'sports_massage')),
  constraint trial_bookings_preferred_time_check
    check (preferred_time in ('weekday_morning', 'weekday_afternoon', 'weekday_evening', 'weekend_morning', 'weekend_afternoon', 'weekend_evening', 'other'))
);

create index if not exists trial_bookings_created_at_desc_idx
  on public.trial_bookings (created_at desc);

create index if not exists trial_bookings_phone_idx
  on public.trial_bookings (phone);

create index if not exists trial_bookings_payment_status_idx
  on public.trial_bookings (payment_status);

create index if not exists trial_bookings_booking_status_idx
  on public.trial_bookings (booking_status);

create index if not exists trial_bookings_service_idx
  on public.trial_bookings (service);

drop trigger if exists set_trial_bookings_updated_at on public.trial_bookings;

create trigger set_trial_bookings_updated_at
before update on public.trial_bookings
for each row
execute function public.update_updated_at_column();

alter table public.trial_bookings enable row level security;

-- Do not create a public insert policy in this phase.
-- Recommended pattern:
-- - frontend posts to /api/trial-booking/create
-- - Next.js API route writes with SUPABASE_SERVICE_ROLE_KEY
-- - public anon client should not be allowed to insert directly
