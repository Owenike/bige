-- Fix recursive RLS policy on public.profiles.
-- The previous tenant-scoped policy referenced public.profiles in its own USING clause,
-- which triggers "infinite recursion detected in policy for relation \"profiles\"".

alter table public.profiles enable row level security;

drop policy if exists profiles_self_or_tenant_access on public.profiles;

create policy profiles_self_or_tenant_access
  on public.profiles
  for all
  using (
    id = auth.uid()
    or public.is_platform_admin()
  )
  with check (
    id = auth.uid()
    or public.is_platform_admin()
  );

