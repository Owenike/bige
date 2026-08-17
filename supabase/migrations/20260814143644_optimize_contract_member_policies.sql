begin;

create index if not exists member_plan_contract_members_member_idx
  on public.member_plan_contract_members(member_id);

create index if not exists member_plan_contract_members_created_by_idx
  on public.member_plan_contract_members(created_by)
  where created_by is not null;

drop policy if exists member_plan_contract_members_manager_write
  on public.member_plan_contract_members;

drop policy if exists member_plan_contract_members_manager_insert
  on public.member_plan_contract_members;
create policy member_plan_contract_members_manager_insert
  on public.member_plan_contract_members for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.is_active = true
        and actor.tenant_id = member_plan_contract_members.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in (
              'coach_assistant_manager', 'coach_manager', 'coach_city_manager'
            )
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in (
              'manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'
            )
          )
        )
    )
  );

drop policy if exists member_plan_contract_members_manager_update
  on public.member_plan_contract_members;
create policy member_plan_contract_members_manager_update
  on public.member_plan_contract_members for update
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.is_active = true
        and actor.tenant_id = member_plan_contract_members.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in (
              'coach_assistant_manager', 'coach_manager', 'coach_city_manager'
            )
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in (
              'manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'
            )
          )
        )
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.is_active = true
        and actor.tenant_id = member_plan_contract_members.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in (
              'coach_assistant_manager', 'coach_manager', 'coach_city_manager'
            )
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in (
              'manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'
            )
          )
        )
    )
  );

drop policy if exists member_plan_contract_members_manager_delete
  on public.member_plan_contract_members;
create policy member_plan_contract_members_manager_delete
  on public.member_plan_contract_members for delete
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = (select auth.uid())
        and actor.is_active = true
        and actor.tenant_id = member_plan_contract_members.tenant_id
        and (
          (
            actor.department = 'coaching'
            and actor.position in (
              'coach_assistant_manager', 'coach_manager', 'coach_city_manager'
            )
          )
          or (
            actor.department is null
            and actor.position is null
            and actor.role in (
              'manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager'
            )
          )
        )
    )
  );

commit;
