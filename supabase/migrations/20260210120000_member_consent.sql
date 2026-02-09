-- Member consent fields (minimal viable)
-- Date: 2026-02-09

alter table public.members
  add column if not exists consent_status text not null default 'unknown'
    check (consent_status in ('unknown', 'agreed')),
  add column if not exists consent_signed_at timestamptz;

