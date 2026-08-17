begin;

alter table public.member_plan_contracts
  add column if not exists is_legacy_import boolean not null default false,
  add column if not exists purchase_date_recorded_at timestamptz,
  add column if not exists purchase_date_recorded_by uuid references public.profiles(id) on delete set null;

create table if not exists public.member_plan_contract_members (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  contract_id uuid not null references public.member_plan_contracts(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  relationship text not null default 'participant'
    check (relationship in ('owner', 'participant')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (contract_id, member_id)
);

create unique index if not exists member_plan_contract_members_one_owner_idx
  on public.member_plan_contract_members(contract_id)
  where relationship = 'owner';

create index if not exists member_plan_contract_members_tenant_member_idx
  on public.member_plan_contract_members(tenant_id, member_id, contract_id);

create or replace function public.bige_validate_contract_member_tenant()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.member_plan_contracts contract
    join public.members member on member.id = new.member_id
    where contract.id = new.contract_id
      and contract.tenant_id = new.tenant_id
      and member.tenant_id = new.tenant_id
  ) then
    raise exception 'contract_member_tenant_mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists bige_validate_contract_member_tenant
  on public.member_plan_contract_members;
create trigger bige_validate_contract_member_tenant
before insert or update
on public.member_plan_contract_members
for each row
execute function public.bige_validate_contract_member_tenant();

create or replace function public.bige_sync_contract_owner_membership()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  delete from public.member_plan_contract_members
  where contract_id = new.id
    and relationship = 'owner'
    and member_id <> new.member_id;

  insert into public.member_plan_contract_members (
    tenant_id, contract_id, member_id, relationship, created_by
  ) values (
    new.tenant_id, new.id, new.member_id, 'owner', new.created_by
  )
  on conflict (contract_id, member_id) do update
    set tenant_id = excluded.tenant_id,
        relationship = 'owner';

  return new;
end;
$$;

drop trigger if exists bige_sync_contract_owner_membership
  on public.member_plan_contracts;
create trigger bige_sync_contract_owner_membership
after insert or update of tenant_id, member_id
on public.member_plan_contracts
for each row
execute function public.bige_sync_contract_owner_membership();

insert into public.member_plan_contract_members (
  tenant_id, contract_id, member_id, relationship, created_by
)
select tenant_id, id, member_id, 'owner', created_by
from public.member_plan_contracts
on conflict (contract_id, member_id) do nothing;

alter table public.member_plan_contract_members enable row level security;

drop policy if exists member_plan_contract_members_tenant_read
  on public.member_plan_contract_members;
create policy member_plan_contract_members_tenant_read
  on public.member_plan_contract_members for select
  to authenticated
  using (
    public.is_platform_admin()
    or (
      public.current_is_active()
      and tenant_id = public.current_tenant_id()
    )
  );

drop policy if exists member_plan_contract_members_manager_write
  on public.member_plan_contract_members;
create policy member_plan_contract_members_manager_write
  on public.member_plan_contract_members for all
  to authenticated
  using (
    public.is_platform_admin()
    or exists (
      select 1
      from public.profiles actor
      where actor.id = auth.uid()
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
      where actor.id = auth.uid()
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

create or replace function public.bige_member_can_use_contract(
  p_contract_id uuid,
  p_member_id uuid,
  p_tenant_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.member_plan_contracts contract
    where contract.id = p_contract_id
      and contract.tenant_id = p_tenant_id
      and (
        contract.member_id = p_member_id
        or exists (
          select 1
          from public.member_plan_contract_members contract_member
          where contract_member.contract_id = contract.id
            and contract_member.tenant_id = contract.tenant_id
            and contract_member.member_id = p_member_id
        )
      )
  );
$$;

revoke all on function public.bige_member_can_use_contract(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.bige_member_can_use_contract(uuid, uuid, uuid)
  to authenticated;

revoke all on function public.bige_validate_contract_member_tenant()
  from public, anon, authenticated;
revoke all on function public.bige_sync_contract_owner_membership()
  from public, anon, authenticated;

create or replace function public.bige_contract_expiry_date(
  p_purchase_date date,
  p_total_sessions integer
)
returns date
language sql
immutable
strict
set search_path = public
as $$
  select p_purchase_date + ceil(p_total_sessions::numeric * 3.5)::integer + 30;
$$;

create or replace function public.bige_apply_legacy_contract_purchase_date()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  expiry_date date;
begin
  if not new.is_legacy_import then
    return new;
  end if;

  if new.signed_on is null then
    new.ends_at := null;
    new.original_ends_at := null;
    return new;
  end if;

  if new.total_sessions is null or new.total_sessions <= 0 then
    raise exception 'legacy_contract_total_sessions_required';
  end if;

  expiry_date := public.bige_contract_expiry_date(new.signed_on, new.total_sessions);
  new.starts_at := new.signed_on::timestamp at time zone 'Asia/Taipei';
  new.ends_at := expiry_date::timestamp at time zone 'Asia/Taipei';
  new.original_ends_at := new.ends_at;
  return new;
end;
$$;

drop trigger if exists bige_apply_legacy_contract_purchase_date
  on public.member_plan_contracts;
create trigger bige_apply_legacy_contract_purchase_date
before insert or update of is_legacy_import, signed_on, total_sessions
on public.member_plan_contracts
for each row
execute function public.bige_apply_legacy_contract_purchase_date();

revoke all on function public.bige_contract_expiry_date(date, integer)
  from public, anon;
grant execute on function public.bige_contract_expiry_date(date, integer)
  to authenticated;

revoke all on function public.bige_apply_legacy_contract_purchase_date()
  from public, anon, authenticated;

-- Let every declared participant consume and restore the same contract while
-- retaining the contract owner as the financial/accounting owner.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.bige_complete_schedule_booking(uuid,text)'::regprocedure
  ) into function_definition;

  function_definition := regexp_replace(
    function_definition,
    'where id = booking_row\.member_plan_contract_id\s+and member_id = booking_row\.member_id',
    'where id = booking_row.member_plan_contract_id
      and public.bige_member_can_use_contract(id, booking_row.member_id, booking_row.tenant_id)',
    'i'
  );
  function_definition := regexp_replace(
    function_definition,
    'where c\.member_id = booking_row\.member_id\s+and c\.tenant_id = booking_row\.tenant_id',
    'where c.tenant_id = booking_row.tenant_id
      and public.bige_member_can_use_contract(c.id, booking_row.member_id, booking_row.tenant_id)',
    'i'
  );
  if position('bige_member_can_use_contract' in function_definition) = 0
     or position(
       'where c.member_id = booking_row.member_id'
       in lower(function_definition)
     ) > 0 then
    raise exception 'shared contract completion guards not found';
  end if;
  execute function_definition;

  select pg_get_functiondef(
    'public.bige_restore_completed_schedule_booking(uuid)'::regprocedure
  ) into function_definition;
  function_definition := regexp_replace(
    function_definition,
    'where id = redemption_row\.member_plan_contract_id\s+and member_id = booking_row\.member_id',
    'where id = redemption_row.member_plan_contract_id
    and public.bige_member_can_use_contract(id, booking_row.member_id, booking_row.tenant_id)',
    'i'
  );
  if position('bige_member_can_use_contract' in function_definition) = 0
     or position(
       'and member_id = booking_row.member_id'
       in lower(function_definition)
     ) > 0 then
    raise exception 'shared contract restore guard not found';
  end if;
  execute function_definition;
end;
$$;

-- Legacy contracts intentionally have no expiry until the assistant manager
-- records the original purchase date during daily closing. Keep ordinary
-- contracts strict while allowing those flagged imports to redeem sessions.
do $$
declare
  function_definition text;
  current_guard text :=
    'if contract_row.ends_at is null or contract_row.ends_at <= now() then';
  legacy_guard text :=
    'if not (contract_row.is_legacy_import and contract_row.signed_on is null and contract_row.ends_at is null) and (contract_row.ends_at is null or contract_row.ends_at <= now()) then';
begin
  select pg_get_functiondef(
    'public.bige_complete_schedule_booking(uuid,text)'::regprocedure
  ) into function_definition;

  if position(current_guard in lower(function_definition)) = 0 then
    raise exception 'bige_complete_schedule_booking expiry guard not found';
  end if;

  function_definition := regexp_replace(
    function_definition,
    'if contract_row\.ends_at is null or contract_row\.ends_at <= now\(\) then',
    legacy_guard,
    'i'
  );
  execute function_definition;
end;
$$;

commit;
