begin;

-- A successful FA appointment belongs to the tenant whose staff arranged it.
-- Older rows are attributed only when an existing member or schedule booking
-- provides direct evidence; ambiguous rows remain null instead of being guessed.
alter table public.trial_bookings
  add column if not exists tenant_id uuid references public.tenants(id) on delete set null;

update public.trial_bookings trial
set tenant_id = member.tenant_id
from public.members member
where trial.tenant_id is null
  and trial.member_id = member.id;

with booking_tenant as (
  select distinct on (booking.trial_booking_id)
    booking.trial_booking_id,
    booking.tenant_id
  from public.bookings booking
  where booking.trial_booking_id is not null
    and booking.is_bige_schedule = true
  order by booking.trial_booking_id, booking.created_at asc, booking.id asc
)
update public.trial_bookings trial
set tenant_id = booking_tenant.tenant_id
from booking_tenant
where trial.tenant_id is null
  and trial.id = booking_tenant.trial_booking_id;

create index if not exists trial_bookings_tenant_scheduled_at_idx
  on public.trial_bookings(tenant_id, scheduled_at)
  where tenant_id is not null and scheduled_at is not null;

comment on column public.trial_bookings.tenant_id is
  'Tenant that first successfully arranged the FA appointment. Null means historical attribution is not provable.';

commit;
