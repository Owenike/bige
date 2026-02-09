-- Add RLS SELECT policies for public.checkins and public.qr_token_uses
-- so manager reports + member "me" can read checkins under anon+session client.
-- Date: 2026-02-09

create or replace function public.current_member_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
  from public.members m
  where m.auth_user_id = auth.uid()
  limit 1;
$$;

grant execute on function public.current_member_id() to authenticated;

alter table public.checkins enable row level security;
alter table public.qr_token_uses enable row level security;

-- checkins: staff read
drop policy if exists checkins_select_staff on public.checkins;

create policy checkins_select_staff
  on public.checkins
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.role in ('manager', 'frontdesk', 'coach')
        and p.tenant_id = checkins.tenant_id
        and (p.branch_id is null or p.branch_id = checkins.store_id)
    )
  );

-- checkins: member read self
drop policy if exists checkins_select_member_self on public.checkins;

create policy checkins_select_member_self
  on public.checkins
  for select
  to authenticated
  using (
    checkins.member_id = public.current_member_id()
  );

-- qr_token_uses: staff read
drop policy if exists qr_token_uses_select_staff on public.qr_token_uses;

create policy qr_token_uses_select_staff
  on public.qr_token_uses
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.role in ('manager', 'frontdesk', 'coach')
        and p.tenant_id = qr_token_uses.tenant_id
        and (p.branch_id is null or p.branch_id = qr_token_uses.store_id)
    )
  );

