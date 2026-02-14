-- Enforce phone uniqueness per tenant for member records.
-- Date: 2026-02-14

create unique index if not exists members_tenant_phone_unique_idx
  on public.members(tenant_id, phone)
  where phone is not null;
