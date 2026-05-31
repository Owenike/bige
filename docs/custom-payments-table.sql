-- custom_payments table draft for manual review / Supabase migration tracking
-- This table is reserved for the future /custom-payment self-serve payment page.
-- Frontend clients should not insert directly with the anon key.

create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.custom_payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  payer_name text not null,
  phone text not null,
  purpose text not null check (
    purpose in ('course_fee', 'price_difference', 'event_fee', 'other')
  ),
  note text null,

  amount bigint not null check (amount > 0),
  currency text not null default 'TWD',
  payment_status text not null default 'pending_payment'
    check (payment_status in ('pending_payment', 'paid', 'failed', 'cancelled')),

  merchant_trade_no text unique null,
  acpay_trade_no text null,
  paid_at timestamptz null,

  source text not null default 'website_custom_payment'
);

create index if not exists custom_payments_created_at_desc_idx
  on public.custom_payments (created_at desc);

create index if not exists custom_payments_payment_status_idx
  on public.custom_payments (payment_status);

create index if not exists custom_payments_merchant_trade_no_idx
  on public.custom_payments (merchant_trade_no);

drop trigger if exists set_custom_payments_updated_at on public.custom_payments;

create trigger set_custom_payments_updated_at
before update on public.custom_payments
for each row
execute function public.update_updated_at_column();

alter table public.custom_payments enable row level security;

-- Do not create a public insert policy in this phase.
-- Recommended future flow:
-- - frontend posts to /api/custom-payment/create
-- - Next.js API route writes pending rows with SUPABASE_SERVICE_ROLE_KEY
-- - /api/acpay/create-custom-payment creates ACPay payment from the stored row
-- - /api/acpay/notify updates payment_status / acpay_trade_no / paid_at after verified payment
