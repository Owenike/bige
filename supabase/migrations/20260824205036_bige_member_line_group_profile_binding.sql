begin;

create or replace function public.bige_set_member_line_group_binding_v1(
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
  previous_binding public.bige_line_group_bindings%rowtype;
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
  if selected_binding.member_id is not null
     and selected_binding.member_id is distinct from p_member_id then
    raise exception 'line_group_binding_member_mismatch';
  end if;

  if selected_binding.status = 'active'
     and selected_binding.member_id = p_member_id then
    return jsonb_build_object(
      'memberId', p_member_id,
      'lineBindingId', selected_binding.id,
      'lineGroupName', selected_binding.group_name,
      'status', selected_binding.status,
      'replayed', true
    );
  end if;

  select * into previous_binding
  from public.bige_line_group_bindings binding
  where binding.tenant_id = p_tenant_id
    and binding.member_id = p_member_id
    and binding.status = 'active'
  for update;

  if previous_binding.id is not null and previous_binding.id <> selected_binding.id then
    update public.bige_line_group_bindings
    set status = 'disabled',
        updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'disabledReason', 'member_profile_rebound',
          'disabledBy', actor.id,
          'disabledAt', now()
        )
    where id = previous_binding.id;
  end if;

  update public.bige_line_group_bindings
  set member_id = p_member_id,
      status = 'active',
      verified_at = coalesce(verified_at, now()),
      verified_by = actor.id,
      left_at = null,
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'bindingSource', 'member_profile',
        'boundBy', actor.id,
        'boundAt', now()
      )
  where id = selected_binding.id;

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
        when previous_binding.id is null then null
        else jsonb_build_object(
          'lineBindingId', previous_binding.id,
          'lineGroupName', previous_binding.group_name,
          'status', previous_binding.status
        )
      end,
      'after', jsonb_build_object(
        'lineBindingId', selected_binding.id,
        'lineGroupName', selected_binding.group_name,
        'status', 'active'
      )
    )
  );

  return jsonb_build_object(
    'memberId', p_member_id,
    'lineBindingId', selected_binding.id,
    'lineGroupName', selected_binding.group_name,
    'status', 'active',
    'previousLineBindingId', previous_binding.id,
    'replayed', false
  );
end;
$$;

revoke all on function public.bige_set_member_line_group_binding_v1(
  uuid, uuid, uuid
) from public, anon;
grant execute on function public.bige_set_member_line_group_binding_v1(
  uuid, uuid, uuid
) to authenticated;

commit;
