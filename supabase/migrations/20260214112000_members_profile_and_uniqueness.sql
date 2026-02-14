-- Member profile hardening for frontdesk operations.
-- Date: 2026-02-14

alter table public.members
  add column if not exists email text,
  add column if not exists birth_date date,
  add column if not exists gender text,
  add column if not exists address text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists lead_source text,
  add column if not exists sales_owner text,
  add column if not exists marketing_sms_opt_in boolean not null default false,
  add column if not exists marketing_email_opt_in boolean not null default false,
  add column if not exists marketing_line_opt_in boolean not null default false,
  add column if not exists marketing_consented_at timestamptz,
  add column if not exists contract_agreed boolean not null default false,
  add column if not exists privacy_agreed boolean not null default false,
  add column if not exists waiver_agreed boolean not null default false,
  add column if not exists health_note text,
  add column if not exists guardian_name text,
  add column if not exists guardian_phone text,
  add column if not exists member_code text,
  add column if not exists status text not null default 'active'
    check (status in ('active', 'expired', 'frozen', 'suspended', 'blacklisted')),
  add column if not exists custom_fields jsonb not null default '{}'::jsonb;

create unique index if not exists members_tenant_email_unique_idx
  on public.members(tenant_id, lower(email))
  where email is not null and btrim(email) <> '';

create unique index if not exists members_tenant_member_code_unique_idx
  on public.members(tenant_id, member_code)
  where member_code is not null and btrim(member_code) <> '';
