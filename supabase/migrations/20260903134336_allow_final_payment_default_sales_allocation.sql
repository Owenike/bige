begin;

create or replace function public.staff_seed_default_allocation_v1(
  p_tenant_id uuid,
  p_event_id uuid,
  p_actor_id uuid,
  p_employee_id uuid,
  p_amount numeric,
  p_remaining_amount numeric
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_event public.staff_sales_events%rowtype;
begin
  select * into target_event
  from public.staff_sales_events
  where id = p_event_id and tenant_id = p_tenant_id
  for update;

  if not found
    or target_event.status <> 'unassigned'
    or target_event.active_allocation_version <> 0
    or target_event.source_type not in ('fa', 'bb', 'renewal', 'final_payment')
  then return false; end if;

  if p_amount <= 0 or round(p_amount + p_remaining_amount, 2) <> round(target_event.amount, 2) then
    raise exception 'default_allocation_amount_invalid';
  end if;

  insert into public.staff_sales_allocations (
    tenant_id, branch_id, event_id, allocation_version, employee_id, amount,
    allocation_kind, status, proposed_by
  ) values (
    p_tenant_id, target_event.branch_id, target_event.id, 1, p_employee_id,
    round(p_amount, 2), 'origin_default', 'pending_manager', p_actor_id
  );

  update public.staff_sales_events
  set active_allocation_version = 1,
      allocation_note = format('原成交教練已預設 50%%，尚餘 %s 元待分配', round(p_remaining_amount, 2))
  where id = target_event.id;

  return true;
end;
$$;

revoke all on function public.staff_seed_default_allocation_v1(
  uuid, uuid, uuid, uuid, numeric, numeric
) from public, anon, authenticated;

grant execute on function public.staff_seed_default_allocation_v1(
  uuid, uuid, uuid, uuid, numeric, numeric
) to service_role;

commit;
