begin;

create or replace function public.enforce_bige_legacy_number_share_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  shared_count integer;
begin
  select count(distinct member_id)
    into shared_count
  from public.bige_member_legacy_numbers
  where tenant_id = new.tenant_id
    and legacy_number = new.legacy_number
    and id is distinct from new.id;

  if shared_count >= 3 then
    raise exception 'legacy_number_share_limit_exceeded';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_bige_legacy_number_share_limit()
  from public, anon, authenticated;

comment on table public.bige_member_legacy_numbers is
  'Legacy workbook member number. A number may be shared by at most three distinct formal members.';

commit;
