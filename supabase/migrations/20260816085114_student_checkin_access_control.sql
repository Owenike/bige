-- Keep autonomous training limited to the formal member roster and provide a
-- separate, internal-only all-entry block list. Public clients never receive
-- the internal block reason.

create table if not exists public.student_checkin_member_links (
  student_profile_id uuid primary key
    references public.student_line_profiles(id) on delete cascade,
  member_id uuid not null unique
    references public.members(id) on delete cascade,
  match_method text not null,
  linked_at timestamptz not null default now(),
  linked_by uuid references public.profiles(id) on delete set null,
  constraint student_checkin_member_links_match_method_check
    check (match_method in ('phone', 'email_birth', 'name_birth', 'unique_name', 'manual'))
);

create table if not exists public.student_checkin_access_blocks (
  student_profile_id uuid primary key
    references public.student_line_profiles(id) on delete cascade,
  scope text not null default 'all_entry',
  internal_reason text not null,
  is_active boolean not null default true,
  blocked_at timestamptz not null default now(),
  blocked_by uuid references public.profiles(id) on delete set null,
  unblocked_at timestamptz,
  unblocked_by uuid references public.profiles(id) on delete set null,
  constraint student_checkin_access_blocks_scope_check
    check (scope = 'all_entry'),
  constraint student_checkin_access_blocks_state_check
    check (
      (is_active and unblocked_at is null and unblocked_by is null)
      or (not is_active and unblocked_at is not null)
    )
);

create index if not exists student_checkin_access_blocks_active_idx
  on public.student_checkin_access_blocks (student_profile_id)
  where is_active = true;

alter table public.student_checkin_member_links enable row level security;
alter table public.student_checkin_access_blocks enable row level security;

revoke all on table public.student_checkin_member_links from public, anon, authenticated;
revoke all on table public.student_checkin_access_blocks from public, anon, authenticated;
grant select, insert, update, delete on table public.student_checkin_member_links to service_role;
grant select, insert, update, delete on table public.student_checkin_access_blocks to service_role;

comment on table public.student_checkin_member_links is
  'Internal link from a student check-in identity to exactly one formal member record.';
comment on table public.student_checkin_access_blocks is
  'Internal all-entry block list. Never expose internal_reason to public clients.';

-- Backfill only deterministic matches. Ambiguous names or identities remain
-- unlinked and therefore cannot use autonomous training.
with candidate_matches as (
  select distinct
    profile.id as student_profile_id,
    member.id as member_id,
    1 as priority,
    'phone'::text as match_method
  from public.student_line_profiles as profile
  join public.members as member
    on member.is_prospect = false
   and nullif(regexp_replace(profile.phone, '[^0-9]', '', 'g'), '') is not null
   and regexp_replace(member.phone, '[^0-9]', '', 'g') =
       regexp_replace(profile.phone, '[^0-9]', '', 'g')
  where profile.is_active = true

  union all

  select distinct
    profile.id,
    member.id,
    2,
    'email_birth'::text
  from public.student_line_profiles as profile
  join public.members as member
    on member.is_prospect = false
   and profile.email is not null
   and member.email is not null
   and lower(btrim(member.email)) = lower(btrim(profile.email))
   and member.birth_date = profile.birth_date
  where profile.is_active = true
    and nullif(btrim(profile.email), '') is not null
    and profile.birth_date is not null

  union all

  select distinct
    profile.id,
    member.id,
    3,
    'name_birth'::text
  from public.student_line_profiles as profile
  join public.members as member
    on member.is_prospect = false
   and btrim(member.full_name) = btrim(profile.full_name)
   and member.birth_date = profile.birth_date
  where profile.is_active = true
    and profile.birth_date is not null

  union all

  select distinct
    profile.id,
    member.id,
    4,
    'unique_name'::text
  from public.student_line_profiles as profile
  join public.members as member
    on member.is_prospect = false
   and btrim(member.full_name) = btrim(profile.full_name)
  where profile.is_active = true
    and (
      select count(*)
      from public.members as same_name
      where same_name.is_prospect = false
        and btrim(same_name.full_name) = btrim(profile.full_name)
    ) = 1
),
best_priority as (
  select student_profile_id, min(priority) as priority
  from candidate_matches
  group by student_profile_id
),
best_matches as (
  select candidate.*
  from candidate_matches as candidate
  join best_priority as best
    on best.student_profile_id = candidate.student_profile_id
   and best.priority = candidate.priority
),
unambiguous_profiles as (
  select student_profile_id
  from best_matches
  group by student_profile_id
  having count(distinct member_id) = 1
),
resolved as (
  select distinct on (best.student_profile_id)
    best.student_profile_id,
    best.member_id,
    best.match_method
  from best_matches as best
  join unambiguous_profiles as unambiguous
    on unambiguous.student_profile_id = best.student_profile_id
  order by best.student_profile_id, best.member_id
),
unique_member_links as (
  select resolved.*
  from resolved
  where (
    select count(*)
    from resolved as same_member
    where same_member.member_id = resolved.member_id
  ) = 1
)
insert into public.student_checkin_member_links (
  student_profile_id,
  member_id,
  match_method
)
select student_profile_id, member_id, match_method
from unique_member_links
on conflict do nothing;

-- Owner-confirmed all-entry blocks. Include the unique phone value so a same-
-- name profile can never be blocked accidentally.
insert into public.student_checkin_access_blocks (
  student_profile_id,
  internal_reason
)
select profile.id, 'owner_requested_2026_08_16'
from public.student_line_profiles as profile
where profile.is_active = true
  and (profile.full_name, regexp_replace(profile.phone, '[^0-9]', '', 'g')) in (
    ('劉芝妤', '0971584221'),
    ('蔣安政', '0987826221'),
    ('蔡子瀅', '0968868782')
  )
on conflict (student_profile_id) do update
set is_active = true,
    scope = 'all_entry',
    internal_reason = excluded.internal_reason,
    blocked_at = now(),
    unblocked_at = null,
    unblocked_by = null;

create or replace function public.enforce_student_entry_access()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.student_checkin_access_blocks as block
    where block.student_profile_id = new.student_profile_id
      and block.is_active = true
      and block.scope = 'all_entry'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'STUDENT_ENTRY_BLOCKED';
  end if;

  if tg_table_name in ('student_checkin_requests', 'student_check_ins')
    and not exists (
      select 1
      from public.student_checkin_member_links as link
      join public.members as member on member.id = link.member_id
      where link.student_profile_id = new.student_profile_id
        and member.is_prospect = false
    ) then
    raise exception using
      errcode = 'P0001',
      message = 'STUDENT_NOT_OFFICIAL_MEMBER';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_student_entry_access() from public, anon, authenticated;
grant execute on function public.enforce_student_entry_access() to service_role;

drop trigger if exists student_checkin_requests_entry_access
  on public.student_checkin_requests;
create trigger student_checkin_requests_entry_access
before insert on public.student_checkin_requests
for each row execute function public.enforce_student_entry_access();

drop trigger if exists student_check_ins_entry_access
  on public.student_check_ins;
create trigger student_check_ins_entry_access
before insert on public.student_check_ins
for each row execute function public.enforce_student_entry_access();

drop trigger if exists student_drop_in_requests_entry_access
  on public.student_drop_in_requests;
create trigger student_drop_in_requests_entry_access
before insert on public.student_drop_in_requests
for each row execute function public.enforce_student_entry_access();

drop trigger if exists student_drop_ins_entry_access
  on public.student_drop_ins;
create trigger student_drop_ins_entry_access
before insert on public.student_drop_ins
for each row execute function public.enforce_student_entry_access();

-- Pending rows created before this policy are removed from the approval queue
-- if they no longer qualify. No approved history is rewritten.
update public.student_checkin_requests as request
set status = 'rejected',
    reviewed_at = now(),
    reviewed_by = null,
    updated_at = now()
where request.status = 'pending'
  and (
    exists (
      select 1
      from public.student_checkin_access_blocks as block
      where block.student_profile_id = request.student_profile_id
        and block.is_active = true
    )
    or not exists (
      select 1
      from public.student_checkin_member_links as link
      join public.members as member on member.id = link.member_id
      where link.student_profile_id = request.student_profile_id
        and member.is_prospect = false
    )
  );

update public.student_drop_in_requests as request
set status = 'rejected',
    rejection_action = 'general',
    reviewed_at = now(),
    reviewed_by = null,
    updated_at = now()
where request.status = 'pending'
  and exists (
    select 1
    from public.student_checkin_access_blocks as block
    where block.student_profile_id = request.student_profile_id
      and block.is_active = true
  );
