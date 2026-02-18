alter table public.frontdesk_locker_rentals
  add column if not exists member_code text;

update public.frontdesk_locker_rentals r
set member_code = m.member_code
from public.members m
where r.member_id = m.id
  and r.tenant_id = m.tenant_id
  and (r.member_code is null or btrim(r.member_code) = '');

create index if not exists frontdesk_locker_rentals_member_code_idx
  on public.frontdesk_locker_rentals(tenant_id, member_code);
