begin;

-- Expand the existing approval queue so BIG E contract reversals and
-- extensions use the same auditable manager-review workflow as POS refunds.
alter table public.high_risk_action_requests
  drop constraint if exists high_risk_action_requests_action_check;
alter table public.high_risk_action_requests
  add constraint high_risk_action_requests_action_check
  check (action in (
    'order_void',
    'payment_refund',
    'bige_contract_payment_void',
    'bige_contract_payment_refund',
    'bige_contract_extension'
  ));

alter table public.high_risk_action_requests
  drop constraint if exists high_risk_action_requests_target_type_check;
alter table public.high_risk_action_requests
  add constraint high_risk_action_requests_target_type_check
  check (target_type in (
    'order',
    'payment',
    'bige_contract_payment',
    'member_plan_contract'
  ));

alter table public.high_risk_action_requests
  drop constraint if exists high_risk_action_requests_status_check;
alter table public.high_risk_action_requests
  add constraint high_risk_action_requests_status_check
  check (status in ('pending', 'processing', 'approved', 'rejected', 'cancelled'));

drop index if exists public.high_risk_action_requests_pending_unique_idx;
create unique index high_risk_action_requests_active_unique_idx
  on public.high_risk_action_requests (tenant_id, action, target_id)
  where status in ('pending', 'processing');

alter table public.high_risk_action_requests enable row level security;

drop policy if exists high_risk_action_requests_select_tenant
  on public.high_risk_action_requests;
create policy high_risk_action_requests_select_tenant
  on public.high_risk_action_requests
  for select
  to authenticated
  using (
    public.is_platform_admin()
    or requested_by = (select auth.uid())
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_active = true
        and p.tenant_id = high_risk_action_requests.tenant_id
        and (
          p.position in ('general_affairs_manager', 'coach_manager', 'coach_city_manager')
          or (
            p.department is null
            and p.position is null
            and p.role in ('manager', 'branch_manager', 'store_owner', 'store_manager')
          )
        )
    )
  );

drop policy if exists high_risk_action_requests_insert_tenant
  on public.high_risk_action_requests;
create policy high_risk_action_requests_insert_tenant
  on public.high_risk_action_requests
  for insert
  to authenticated
  with check (
    public.is_platform_admin()
    or (
      requested_by = (select auth.uid())
      and exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.is_active = true
          and p.tenant_id = high_risk_action_requests.tenant_id
          and (
            p.role = 'frontdesk'
            or p.position in (
              'general_affairs_assistant_manager',
              'general_affairs_manager',
              'coach_assistant_manager',
              'coach_manager',
              'coach_city_manager'
            )
            or (
              p.department is null
              and p.position is null
              and p.role in (
                'manager',
                'supervisor',
                'branch_manager',
                'store_owner',
                'store_manager'
              )
            )
          )
      )
    )
  );

drop policy if exists high_risk_action_requests_update_manager
  on public.high_risk_action_requests;
create policy high_risk_action_requests_update_manager
  on public.high_risk_action_requests
  for update
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_active = true
        and p.tenant_id = high_risk_action_requests.tenant_id
        and (
          p.position in ('general_affairs_manager', 'coach_manager', 'coach_city_manager')
          or (
            p.department is null
            and p.position is null
            and p.role in ('manager', 'branch_manager', 'store_owner', 'store_manager')
          )
        )
    )
  )
  with check (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
        and p.is_active = true
        and p.tenant_id = high_risk_action_requests.tenant_id
        and (
          p.position in ('general_affairs_manager', 'coach_manager', 'coach_city_manager')
          or (
            p.department is null
            and p.position is null
            and p.role in ('manager', 'branch_manager', 'store_owner', 'store_manager')
          )
        )
    )
  );

grant select, insert, update on table public.high_risk_action_requests to authenticated;

-- Keep the established, tested business logic in these RPCs and only replace
-- their authorization preambles. Each replacement is asserted so a future
-- upstream function change cannot silently weaken the migration.
do $migration$
declare
  definition text;
  old_guard text;
  new_guard text;
begin
  select pg_get_functiondef(
    'public.bige_record_contract_payment(uuid,uuid,text,bigint,text,timestamptz,text,text)'::regprocedure
  ) into definition;

  old_guard := $guard$if not found or actor.role not in ('platform_admin', 'manager', 'store_owner', 'store_manager', 'frontdesk') then
    raise exception 'forbidden';
  end if;$guard$;
  new_guard := $guard$if not found
     or not (
       actor.role = 'platform_admin'
       or actor.role = 'frontdesk'
       or (
         actor.department = 'coaching'
         and actor.position in ('coach_assistant_manager', 'coach_manager', 'coach_city_manager')
       )
       or (
         actor.department is null
         and actor.position is null
         and actor.role in ('manager', 'supervisor', 'branch_manager', 'store_owner', 'store_manager')
       )
     ) then
    raise exception 'forbidden';
  end if;$guard$;
  if position(old_guard in definition) = 0 then
    raise exception 'bige_record_contract_payment authorization guard changed unexpectedly';
  end if;
  execute replace(definition, old_guard, new_guard);

  select pg_get_functiondef(
    'public.bige_extend_contract(uuid,integer,text,text,text,text,timestamptz)'::regprocedure
  ) into definition;
  old_guard := $guard$if not found
     or not (
       actor.role = 'platform_admin'
       or (
         actor.department = 'coaching'
         and actor.position in (
           'coach_assistant_manager',
           'coach_manager',
           'coach_city_manager'
         )
       )
       or (
         actor.department is null
         and actor.position is null
         and actor.role in (
           'manager',
           'supervisor',
           'branch_manager',
           'store_owner',
           'store_manager'
         )
       )
     ) then
    raise exception 'manager_required';
  end if;$guard$;
  new_guard := $guard$if not found
     or not (
       actor.role = 'platform_admin'
       or (
         actor.department = 'coaching'
         and actor.position in ('coach_manager', 'coach_city_manager')
       )
       or (
         actor.department is null
         and actor.position is null
         and actor.role in ('manager', 'branch_manager', 'store_owner', 'store_manager')
       )
     ) then
    raise exception 'manager_required';
  end if;$guard$;
  if position(old_guard in definition) = 0 then
    raise exception 'bige_extend_contract authorization guard changed unexpectedly';
  end if;
  execute replace(definition, old_guard, new_guard);

  select pg_get_functiondef(
    'public.bige_reverse_contract_payment(uuid,text,text)'::regprocedure
  ) into definition;
  old_guard := $guard$if not found
     or not (
       actor.role = 'platform_admin'
       or (
         actor.department = 'coaching'
         and actor.position in (
           'coach_assistant_manager',
           'coach_manager',
           'coach_city_manager'
         )
       )
       or (
         actor.department is null
         and actor.position is null
         and actor.role in (
           'manager',
           'supervisor',
           'branch_manager',
           'store_owner',
           'store_manager'
         )
       )
     ) then
    raise exception 'manager_required';
  end if;$guard$;
  new_guard := $guard$if not found
     or not (
       actor.role = 'platform_admin'
       or (
         actor.department = 'coaching'
         and actor.position in ('coach_manager', 'coach_city_manager')
       )
       or (
         actor.department is null
         and actor.position is null
         and actor.role in ('manager', 'branch_manager', 'store_owner', 'store_manager')
       )
     ) then
    raise exception 'manager_required';
  end if;$guard$;
  if position(old_guard in definition) = 0 then
    raise exception 'bige_reverse_contract_payment authorization guard changed unexpectedly';
  end if;
  execute replace(definition, old_guard, new_guard);
end;
$migration$;

revoke all on function public.bige_record_contract_payment(
  uuid, uuid, text, bigint, text, timestamptz, text, text
) from public, anon;
grant execute on function public.bige_record_contract_payment(
  uuid, uuid, text, bigint, text, timestamptz, text, text
) to authenticated;

revoke all on function public.bige_extend_contract(
  uuid, integer, text, text, text, text, timestamptz
) from public, anon;
grant execute on function public.bige_extend_contract(
  uuid, integer, text, text, text, text, timestamptz
) to authenticated;

revoke all on function public.bige_reverse_contract_payment(uuid, text, text)
  from public, anon;
grant execute on function public.bige_reverse_contract_payment(uuid, text, text)
  to authenticated;

comment on table public.high_risk_action_requests is
  'Tenant approval queue. Deputies create requests; managers resolve them using their own authenticated identity.';

commit;
