begin;

alter table public.bige_line_group_bindings
  add constraint bige_line_group_bindings_tenant_id_id_key
  unique (tenant_id, id);

alter table public.members
  add constraint members_tenant_id_id_key
  unique (tenant_id, id);

create table public.bige_line_group_binding_members (
  tenant_id uuid not null,
  binding_id uuid not null,
  member_id uuid not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (binding_id, member_id),
  constraint bige_line_group_binding_members_binding_tenant_fkey
    foreign key (tenant_id, binding_id)
    references public.bige_line_group_bindings(tenant_id, id)
    on delete cascade,
  constraint bige_line_group_binding_members_member_tenant_fkey
    foreign key (tenant_id, member_id)
    references public.members(tenant_id, id)
    on delete restrict,
  constraint bige_line_group_binding_members_one_group_per_member_key
    unique (tenant_id, member_id)
);

create index bige_line_group_binding_members_tenant_binding_idx
  on public.bige_line_group_binding_members(tenant_id, binding_id, created_at);

alter table public.bige_line_group_binding_members enable row level security;

revoke all on table public.bige_line_group_binding_members
  from public, anon, authenticated;
grant all on table public.bige_line_group_binding_members to service_role;

insert into public.bige_line_group_binding_members (
  tenant_id,
  binding_id,
  member_id,
  created_by,
  created_at
)
select
  binding.tenant_id,
  binding.id,
  binding.member_id,
  coalesce(binding.verified_by, binding.created_by),
  coalesce(binding.verified_at, binding.created_at)
from public.bige_line_group_bindings binding
where binding.member_id is not null
  and binding.status = 'active'
on conflict (tenant_id, member_id) do nothing;

comment on table public.bige_line_group_binding_members is
  'Canonical one-group-per-member routing map. Multiple members may point to the same physical LINE group binding.';

comment on column public.bige_line_group_bindings.member_id is
  'Primary member retained for backwards compatibility and group ownership display. Notification routing uses bige_line_group_binding_members.';

create or replace function public.bige_sync_line_group_primary_member_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'active' and new.member_id is not null then
    insert into public.bige_line_group_binding_members (
      tenant_id, binding_id, member_id, created_by, created_at
    ) values (
      new.tenant_id,
      new.id,
      new.member_id,
      coalesce(new.verified_by, new.created_by),
      coalesce(new.verified_at, new.updated_at, now())
    )
    on conflict (tenant_id, member_id) do nothing;

    if not exists (
      select 1
      from public.bige_line_group_binding_members link
      where link.tenant_id = new.tenant_id
        and link.member_id = new.member_id
        and link.binding_id = new.id
    ) then
      raise exception 'member_already_has_line_group';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bige_sync_line_group_primary_member_trigger
  on public.bige_line_group_bindings;
create trigger bige_sync_line_group_primary_member_trigger
after insert or update of member_id, status
on public.bige_line_group_bindings
for each row
execute function public.bige_sync_line_group_primary_member_v1();

revoke all on function public.bige_sync_line_group_primary_member_v1()
  from public, anon, authenticated;

create or replace function public.bige_set_member_line_group_binding_v2(
  p_tenant_id uuid,
  p_member_id uuid,
  p_line_binding_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles%rowtype;
  member_row public.members%rowtype;
  selected_binding public.bige_line_group_bindings%rowtype;
  previous_link public.bige_line_group_binding_members%rowtype;
  previous_binding public.bige_line_group_bindings%rowtype;
  replacement_primary_member_id uuid;
  selected_member_count integer;
begin
  select * into actor
  from public.profiles
  where id = (select auth.uid()) and is_active = true;
  if not found
     or not (
       actor.role = 'platform_admin'
       or (
         actor.tenant_id = p_tenant_id
         and upper(coalesce(actor.employee_number, '')) ~ '^E[0-9]{6}$'
       )
     ) then
    raise exception 'member_line_group_binding_forbidden';
  end if;

  select * into member_row
  from public.members member
  where member.id = p_member_id
    and member.tenant_id = p_tenant_id
  for update;
  if not found then raise exception 'member_not_found'; end if;

  select * into selected_binding
  from public.bige_line_group_bindings binding
  where binding.id = p_line_binding_id
    and binding.tenant_id = p_tenant_id
  for update;
  if not found or selected_binding.status not in ('pending', 'active') then
    raise exception 'line_group_binding_unavailable';
  end if;

  select * into previous_link
  from public.bige_line_group_binding_members link
  where link.tenant_id = p_tenant_id
    and link.member_id = p_member_id
  for update;

  if previous_link.binding_id = selected_binding.id
     and selected_binding.status = 'active' then
    select count(*)::integer into selected_member_count
    from public.bige_line_group_binding_members link
    where link.tenant_id = p_tenant_id
      and link.binding_id = selected_binding.id;
    return jsonb_build_object(
      'memberId', p_member_id,
      'lineBindingId', selected_binding.id,
      'lineGroupName', selected_binding.group_name,
      'status', selected_binding.status,
      'sharedMemberCount', selected_member_count,
      'replayed', true
    );
  end if;

  if previous_link.binding_id is not null
     and previous_link.binding_id <> selected_binding.id then
    select * into previous_binding
    from public.bige_line_group_bindings binding
    where binding.id = previous_link.binding_id
      and binding.tenant_id = p_tenant_id
    for update;

    delete from public.bige_line_group_binding_members link
    where link.tenant_id = p_tenant_id
      and link.member_id = p_member_id;

    if previous_binding.member_id = p_member_id then
      select link.member_id into replacement_primary_member_id
      from public.bige_line_group_binding_members link
      where link.tenant_id = p_tenant_id
        and link.binding_id = previous_binding.id
      order by link.created_at, link.member_id
      limit 1;

      if replacement_primary_member_id is null then
        update public.bige_line_group_bindings
        set status = 'disabled',
            updated_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
              'disabledReason', 'last_member_profile_rebound',
              'disabledBy', actor.id,
              'disabledAt', now()
            )
        where id = previous_binding.id;
      else
        update public.bige_line_group_bindings
        set member_id = replacement_primary_member_id,
            updated_at = now(),
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
              'primaryMemberChangedReason', 'member_profile_rebound',
              'primaryMemberChangedBy', actor.id,
              'primaryMemberChangedAt', now()
            )
        where id = previous_binding.id;
      end if;
    end if;
  end if;

  if selected_binding.status = 'pending' then
    update public.bige_line_group_bindings
    set member_id = coalesce(member_id, p_member_id),
        status = 'active',
        verified_at = coalesce(verified_at, now()),
        verified_by = coalesce(verified_by, actor.id),
        left_at = null,
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'bindingSource', 'member_profile',
          'boundBy', actor.id,
          'boundAt', now()
        )
    where id = selected_binding.id
    returning * into selected_binding;
  end if;

  if selected_binding.member_id is null then
    raise exception 'line_group_binding_primary_member_required';
  end if;

  insert into public.bige_line_group_binding_members (
    tenant_id, binding_id, member_id, created_by
  ) values (
    p_tenant_id, selected_binding.id, selected_binding.member_id, actor.id
  )
  on conflict (tenant_id, member_id) do nothing;

  if selected_binding.member_id <> p_member_id then
    if exists (
      select 1
      from public.bige_line_group_binding_members link
      where link.tenant_id = p_tenant_id
        and link.member_id = selected_binding.member_id
        and link.binding_id <> selected_binding.id
    ) then
      raise exception 'line_group_primary_member_already_bound_elsewhere';
    end if;
  end if;

  insert into public.bige_line_group_binding_members (
    tenant_id, binding_id, member_id, created_by
  ) values (
    p_tenant_id, selected_binding.id, p_member_id, actor.id
  )
  on conflict (tenant_id, member_id) do update
    set binding_id = excluded.binding_id,
        created_by = excluded.created_by,
        created_at = now();

  select count(*)::integer into selected_member_count
  from public.bige_line_group_binding_members link
  where link.tenant_id = p_tenant_id
    and link.binding_id = selected_binding.id;

  insert into public.audit_logs (
    tenant_id, actor_id, action, target_type, target_id, reason, payload
  ) values (
    p_tenant_id, actor.id, 'bige_member_line_group_bound',
    'member', p_member_id::text, 'member_profile',
    jsonb_build_object(
      'memberId', p_member_id,
      'actorEmployeeNumber', actor.employee_number,
      'actorName', coalesce(actor.english_name, actor.display_name, actor.employee_number),
      'before', case
        when previous_link.binding_id is null then null
        else jsonb_build_object(
          'lineBindingId', previous_link.binding_id,
          'lineGroupName', previous_binding.group_name,
          'status', previous_binding.status
        )
      end,
      'after', jsonb_build_object(
        'lineBindingId', selected_binding.id,
        'lineGroupName', selected_binding.group_name,
        'status', 'active',
        'sharedMemberCount', selected_member_count,
        'primaryMemberId', selected_binding.member_id
      )
    )
  );

  return jsonb_build_object(
    'memberId', p_member_id,
    'lineBindingId', selected_binding.id,
    'lineGroupName', selected_binding.group_name,
    'status', 'active',
    'previousLineBindingId', previous_link.binding_id,
    'sharedMemberCount', selected_member_count,
    'primaryMemberId', selected_binding.member_id,
    'replayed', false
  );
end;
$$;

create or replace function public.bige_set_member_line_group_binding_v1(
  p_tenant_id uuid,
  p_member_id uuid,
  p_line_binding_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select public.bige_set_member_line_group_binding_v2(
    p_tenant_id,
    p_member_id,
    p_line_binding_id
  );
$$;

revoke all on function public.bige_set_member_line_group_binding_v2(
  uuid, uuid, uuid
) from public, anon;
grant execute on function public.bige_set_member_line_group_binding_v2(
  uuid, uuid, uuid
) to authenticated;

revoke all on function public.bige_set_member_line_group_binding_v1(
  uuid, uuid, uuid
) from public, anon;
grant execute on function public.bige_set_member_line_group_binding_v1(
  uuid, uuid, uuid
) to authenticated;

commit;
