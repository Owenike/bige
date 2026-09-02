-- Close direct Data API privilege-escalation and overly broad tenant access.
-- Server-side service_role flows continue to bypass these RLS policies after
-- their existing API authorization checks.

create or replace function public.security_actor_has_tenant_role(
  p_tenant_id uuid,
  p_roles text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active = true
      and p.staff_deleted_at is null
      and (
        p.role::text = 'platform_admin'
        or (
          p.tenant_id = p_tenant_id
          and p.role::text = any(p_roles)
        )
      )
  );
$$;

create or replace function public.security_member_is_self(p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members m
    where m.id = p_member_id
      and m.auth_user_id = (select auth.uid())
  );
$$;

revoke all on function public.security_actor_has_tenant_role(uuid, text[]) from public, anon;
revoke all on function public.security_member_is_self(uuid) from public, anon;
grant execute on function public.security_actor_has_tenant_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.security_member_is_self(uuid) to authenticated, service_role;

-- The public booking request must pass through the server route where shared
-- abuse limits run. Prevent direct anonymous RPC calls from bypassing them.
revoke all on function public.create_public_booking_request(text, text, text, date, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_public_booking_request(text, text, text, date, text, text, text)
  to service_role;

create or replace function public.prevent_unauthorized_profile_security_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_platform_admin() then
    if old.id <> (select auth.uid()) then
      raise exception 'profile_update_forbidden' using errcode = '42501';
    end if;

    -- A signed-in user may only change presentation fields on their own row.
    -- All current privileged/activation fields and any future columns are
    -- protected by default because they remain in this JSON comparison.
    if (
      to_jsonb(new) - array['display_name', 'english_name', 'updated_at']::text[]
    ) is distinct from (
      to_jsonb(old) - array['display_name', 'english_name', 'updated_at']::text[]
    ) then
      raise exception 'profile_security_fields_are_server_managed' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.prevent_unauthorized_profile_security_changes() from public, anon, authenticated;
grant execute on function public.prevent_unauthorized_profile_security_changes() to service_role;

drop trigger if exists prevent_unauthorized_profile_security_changes on public.profiles;
create trigger prevent_unauthorized_profile_security_changes
before update on public.profiles
for each row execute function public.prevent_unauthorized_profile_security_changes();

drop policy if exists profiles_select_self_or_tenant on public.profiles;
create policy profiles_select_authorized
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or public.is_platform_admin()
    or public.security_actor_has_tenant_role(
      tenant_id,
      array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk', 'coach', 'therapist', 'sales']
    )
  );

drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_admin
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) or public.is_platform_admin())
  with check (id = (select auth.uid()) or public.is_platform_admin());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin
  on public.profiles for insert to authenticated
  with check (public.is_platform_admin());

drop policy if exists profiles_delete_admin on public.profiles;
create policy profiles_delete_admin
  on public.profiles for delete to authenticated
  using (public.is_platform_admin());

-- Branches: all active tenant users can discover their branch; only tenant
-- management can change branch configuration through the Data API.
drop policy if exists branches_tenant_access on public.branches;
create policy branches_authorized_select
  on public.branches for select to authenticated
  using (
    public.security_actor_has_tenant_role(
      tenant_id,
      array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk', 'coach', 'therapist', 'sales', 'member', 'customer']
    )
  );
create policy branches_management_insert
  on public.branches for insert to authenticated
  with check (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));
create policy branches_management_update
  on public.branches for update to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']))
  with check (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));
create policy branches_management_delete
  on public.branches for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

-- Members and identities: members can only see their own record. Operational
-- staff keep the same tenant/branch access used by the application APIs.
drop policy if exists members_tenant_access on public.members;
create policy members_authorized_select
  on public.members for select to authenticated
  using (
    auth_user_id = (select auth.uid())
    or public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'sales'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk', 'coach', 'therapist'])
      and ((public.current_profile()).branch_id is null or store_id is null or store_id = (public.current_profile()).branch_id)
    )
  );
create policy members_operations_insert
  on public.members for insert to authenticated
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or store_id = (public.current_profile()).branch_id)
    )
  );
create policy members_operations_update
  on public.members for update to authenticated
  using (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or store_id = (public.current_profile()).branch_id)
    )
  )
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or store_id = (public.current_profile()).branch_id)
    )
  );
create policy members_management_delete
  on public.members for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

drop policy if exists member_identities_tenant_access on public.member_identities;
create policy member_identities_authorized_select
  on public.member_identities for select to authenticated
  using (
    public.security_member_is_self(member_id)
    or public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk'])
  );
create policy member_identities_operations_insert
  on public.member_identities for insert to authenticated
  with check (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']));
create policy member_identities_operations_update
  on public.member_identities for update to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']))
  with check (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']));
create policy member_identities_management_delete
  on public.member_identities for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

-- Membership products remain readable to the owning member and operational
-- staff. Only staff may mutate them; public/member purchase APIs use the
-- already-authorized server path.
drop policy if exists subscriptions_tenant_access on public.subscriptions;
create policy subscriptions_authorized_select
  on public.subscriptions for select to authenticated
  using (
    public.security_member_is_self(member_id)
    or public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk', 'coach', 'therapist'])
  );
create policy subscriptions_operations_insert
  on public.subscriptions for insert to authenticated
  with check (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']));
create policy subscriptions_operations_update
  on public.subscriptions for update to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']))
  with check (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']));
create policy subscriptions_management_delete
  on public.subscriptions for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

drop policy if exists entry_passes_tenant_access on public.entry_passes;
create policy entry_passes_authorized_select
  on public.entry_passes for select to authenticated
  using (
    public.security_member_is_self(member_id)
    or public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk', 'coach', 'therapist'])
  );
create policy entry_passes_operations_insert
  on public.entry_passes for insert to authenticated
  with check (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']));
create policy entry_passes_operations_update
  on public.entry_passes for update to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']))
  with check (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']));
create policy entry_passes_management_delete
  on public.entry_passes for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

-- Bookings preserve tenant-wide manager/sales visibility, branch-limited
-- frontdesk visibility, assigned-coach visibility, and member ownership.
drop policy if exists bookings_tenant_access on public.bookings;
create policy bookings_authorized_select
  on public.bookings for select to authenticated
  using (
    public.security_member_is_self(member_id)
    or public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'sales'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
    or (
      public.security_actor_has_tenant_role(tenant_id, array['coach', 'therapist'])
      and coach_id = (select auth.uid())
    )
  );
create policy bookings_operations_insert
  on public.bookings for insert to authenticated
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  );
create policy bookings_operations_update
  on public.bookings for update to authenticated
  using (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
    or (
      public.security_actor_has_tenant_role(tenant_id, array['coach', 'therapist'])
      and coach_id = (select auth.uid())
    )
  )
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
    or (
      public.security_actor_has_tenant_role(tenant_id, array['coach', 'therapist'])
      and coach_id = (select auth.uid())
    )
  );
create policy bookings_operations_delete
  on public.bookings for delete to authenticated
  using (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  );

drop policy if exists session_redemptions_tenant_access on public.session_redemptions;
create policy session_redemptions_authorized_select
  on public.session_redemptions for select to authenticated
  using (
    public.security_member_is_self(member_id)
    or public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['coach', 'therapist'])
      and redeemed_by = (select auth.uid())
    )
  );
create policy session_redemptions_operations_insert
  on public.session_redemptions for insert to authenticated
  with check (
    redeemed_by = (select auth.uid())
    and public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk', 'coach', 'therapist'])
  );
create policy session_redemptions_operations_update
  on public.session_redemptions for update to authenticated
  using (
    redeemed_by = (select auth.uid())
    and public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk', 'coach', 'therapist'])
  )
  with check (
    redeemed_by = (select auth.uid())
    and public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk', 'coach', 'therapist'])
  );
create policy session_redemptions_management_delete
  on public.session_redemptions for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

-- Financial tables are no longer readable or writable by arbitrary active
-- staff. Members retain read-only access to their own orders and payments.
drop policy if exists orders_tenant_access on public.orders;
create policy orders_authorized_select
  on public.orders for select to authenticated
  using (
    public.security_member_is_self(member_id)
    or public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'sales'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  );
create policy orders_operations_insert
  on public.orders for insert to authenticated
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  );
create policy orders_operations_update
  on public.orders for update to authenticated
  using (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  )
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  );
create policy orders_operations_delete
  on public.orders for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

drop policy if exists order_items_tenant_access on public.order_items;
create policy order_items_authorized_select
  on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.tenant_id = order_items.tenant_id));
create policy order_items_operations_insert
  on public.order_items for insert to authenticated
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk'])
    and exists (select 1 from public.orders o where o.id = order_id and o.tenant_id = order_items.tenant_id)
  );
create policy order_items_operations_update
  on public.order_items for update to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']))
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk'])
    and exists (select 1 from public.orders o where o.id = order_id and o.tenant_id = order_items.tenant_id)
  );
create policy order_items_management_delete
  on public.order_items for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

drop policy if exists payments_tenant_access on public.payments;
create policy payments_authorized_select
  on public.payments for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and o.tenant_id = payments.tenant_id));
create policy payments_operations_insert
  on public.payments for insert to authenticated
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk'])
    and exists (select 1 from public.orders o where o.id = order_id and o.tenant_id = payments.tenant_id)
  );
create policy payments_operations_update
  on public.payments for update to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']))
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk'])
    and exists (select 1 from public.orders o where o.id = order_id and o.tenant_id = payments.tenant_id)
  );
create policy payments_management_delete
  on public.payments for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

drop policy if exists audit_logs_tenant_access on public.audit_logs;
create policy audit_logs_authorized_select
  on public.audit_logs for select to authenticated
  using (
    actor_id = (select auth.uid())
    or public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk'])
  );
create policy audit_logs_actor_insert
  on public.audit_logs for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and public.security_actor_has_tenant_role(
      tenant_id,
      array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk', 'coach', 'therapist', 'sales', 'member', 'customer']
    )
  );

drop policy if exists frontdesk_shifts_tenant_access on public.frontdesk_shifts;
create policy frontdesk_shifts_authorized_select
  on public.frontdesk_shifts for select to authenticated
  using (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  );
create policy frontdesk_shifts_operations_insert
  on public.frontdesk_shifts for insert to authenticated
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      opened_by = (select auth.uid())
      and public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  );
create policy frontdesk_shifts_operations_update
  on public.frontdesk_shifts for update to authenticated
  using (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  )
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'])
    or (
      public.security_actor_has_tenant_role(tenant_id, array['frontdesk'])
      and ((public.current_profile()).branch_id is null or branch_id = (public.current_profile()).branch_id)
    )
  );
create policy frontdesk_shifts_management_delete
  on public.frontdesk_shifts for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

drop policy if exists frontdesk_shift_items_tenant_access on public.frontdesk_shift_items;
create policy frontdesk_shift_items_authorized_select
  on public.frontdesk_shift_items for select to authenticated
  using (exists (select 1 from public.frontdesk_shifts s where s.id = shift_id and s.tenant_id = frontdesk_shift_items.tenant_id));
create policy frontdesk_shift_items_operations_insert
  on public.frontdesk_shift_items for insert to authenticated
  with check (
    public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk'])
    and exists (select 1 from public.frontdesk_shifts s where s.id = shift_id and s.tenant_id = frontdesk_shift_items.tenant_id)
  );
create policy frontdesk_shift_items_operations_update
  on public.frontdesk_shift_items for update to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']))
  with check (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk']));
create policy frontdesk_shift_items_management_delete
  on public.frontdesk_shift_items for delete to authenticated
  using (public.security_actor_has_tenant_role(tenant_id, array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager']));

drop policy if exists feature_flags_tenant_access on public.feature_flags;
create policy feature_flags_authorized_select
  on public.feature_flags for select to authenticated
  using (
    public.security_actor_has_tenant_role(
      tenant_id,
      array['manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk', 'coach', 'therapist', 'sales', 'member', 'customer']
    )
  );
create policy feature_flags_platform_insert
  on public.feature_flags for insert to authenticated
  with check (public.is_platform_admin());
create policy feature_flags_platform_update
  on public.feature_flags for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());
create policy feature_flags_platform_delete
  on public.feature_flags for delete to authenticated
  using (public.is_platform_admin());

-- Contract signatures are private and tenant-scoped by the first path segment.
drop policy if exists bige_contract_signatures_read on storage.objects;
create policy bige_contract_signatures_read
  on storage.objects for select to authenticated
  using (
    bucket_id = 'bige-contract-signatures'
    and (
      public.is_platform_admin()
      or (
        public.current_is_active()
        and (storage.foldername(name))[1] = public.current_tenant_id()::text
        and (public.current_profile()).role::text in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager', 'frontdesk')
      )
    )
  );

-- Shared fixed-window rate limiter. Only service_role can call the function;
-- public endpoints invoke it from their trusted Next.js server route.
create table if not exists public.security_rate_limits (
  key_hash text primary key,
  request_count integer not null check (request_count >= 0),
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.security_rate_limits enable row level security;
revoke all on table public.security_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.security_rate_limits to service_role;

create index if not exists security_rate_limits_expires_at_idx
  on public.security_rate_limits(expires_at);

create or replace function public.consume_security_rate_limit_v1(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_at timestamptz := clock_timestamp();
begin
  if nullif(trim(p_key_hash), '') is null or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid_rate_limit_configuration' using errcode = '22023';
  end if;

  if random() < 0.01 then
    delete from public.security_rate_limits
    where expires_at < now_at - interval '1 day';
  end if;

  return query
  insert into public.security_rate_limits as limits (
    key_hash,
    request_count,
    window_started_at,
    expires_at,
    updated_at
  ) values (
    p_key_hash,
    1,
    now_at,
    now_at + make_interval(secs => p_window_seconds),
    now_at
  )
  on conflict (key_hash) do update
  set
    request_count = case
      when limits.expires_at <= now_at then 1
      else limits.request_count + 1
    end,
    window_started_at = case
      when limits.expires_at <= now_at then now_at
      else limits.window_started_at
    end,
    expires_at = case
      when limits.expires_at <= now_at then now_at + make_interval(secs => p_window_seconds)
      else limits.expires_at
    end,
    updated_at = now_at
  returning
    limits.request_count <= p_limit,
    greatest(p_limit - limits.request_count, 0),
    limits.expires_at;
end;
$$;

revoke all on function public.consume_security_rate_limit_v1(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_security_rate_limit_v1(text, integer, integer) to service_role;
