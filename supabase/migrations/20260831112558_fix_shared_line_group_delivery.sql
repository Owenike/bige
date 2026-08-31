begin;

create or replace function public.bige_queue_line_schedule_notification_v2(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_member_id uuid,
  p_binding_id uuid,
  p_event_kind text,
  p_message text,
  p_schedule_snapshot jsonb,
  p_dedupe_key text,
  p_created_by uuid,
  p_manual_retry_of_notification_id uuid default null
)
returns table(notification_id uuid, notification_status text, inserted boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  queued_id uuid := gen_random_uuid();
  existing_row public.bige_line_schedule_notifications%rowtype;
  manual_row public.bige_line_schedule_notifications%rowtype;
begin
  if p_event_kind not in ('created', 'updated', 'cancelled') then
    raise exception 'invalid_line_schedule_event_kind';
  end if;
  if length(btrim(coalesce(p_message, ''))) = 0 then
    raise exception 'line_schedule_message_required';
  end if;
  if length(btrim(coalesce(p_dedupe_key, ''))) < 8 then
    raise exception 'line_schedule_dedupe_key_required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('bige-line-notification:' || p_tenant_id::text || ':' || p_member_id::text, 0)
  );

  select * into existing_row
  from public.bige_line_schedule_notifications notification
  where notification.dedupe_key = p_dedupe_key;
  if found then
    return query select existing_row.id, existing_row.status, false;
    return;
  end if;

  if not exists (
    select 1
    from public.members member
    where member.id = p_member_id
      and member.tenant_id = p_tenant_id
  ) then
    raise exception 'member_not_found';
  end if;

  if not exists (
    select 1
    from public.bige_line_group_bindings binding
    join public.bige_line_group_binding_members link
      on link.tenant_id = binding.tenant_id
     and link.binding_id = binding.id
     and link.member_id = p_member_id
    where binding.id = p_binding_id
      and binding.tenant_id = p_tenant_id
      and binding.status = 'active'
  ) then
    raise exception 'line_group_binding_inactive';
  end if;

  if p_manual_retry_of_notification_id is not null then
    select * into manual_row
    from public.bige_line_schedule_notifications notification
    where notification.id = p_manual_retry_of_notification_id
      and notification.tenant_id = p_tenant_id
      and notification.member_id = p_member_id
    for update;
    if not found or manual_row.status <> 'failed' then
      raise exception 'line_schedule_notification_not_retryable';
    end if;
  end if;

  insert into public.bige_line_schedule_notifications (
    id,
    tenant_id,
    branch_id,
    member_id,
    binding_id,
    event_kind,
    status,
    message,
    schedule_snapshot,
    dedupe_key,
    created_by,
    manual_retry_of_notification_id,
    snapshot_refreshed_at,
    updated_at
  ) values (
    queued_id,
    p_tenant_id,
    p_branch_id,
    p_member_id,
    p_binding_id,
    p_event_kind,
    'pending',
    p_message,
    coalesce(p_schedule_snapshot, '[]'::jsonb),
    btrim(p_dedupe_key),
    p_created_by,
    p_manual_retry_of_notification_id,
    now(),
    now()
  )
  on conflict (dedupe_key) do nothing
  returning id into queued_id;

  if queued_id is null then
    select * into existing_row
    from public.bige_line_schedule_notifications notification
    where notification.dedupe_key = p_dedupe_key;
    return query select existing_row.id, existing_row.status, false;
    return;
  end if;

  update public.bige_line_schedule_notifications notification
  set status = 'cancelled',
      next_retry_at = null,
      superseded_by_notification_id = queued_id,
      resolution_reason = case
        when notification.id = p_manual_retry_of_notification_id then 'manual_resend_requested'
        else 'superseded_by_newer_schedule_change'
      end,
      updated_at = now()
  where notification.tenant_id = p_tenant_id
    and notification.member_id = p_member_id
    and notification.id <> queued_id
    and notification.status in ('pending', 'retrying', 'failed');

  if p_manual_retry_of_notification_id is not null then
    insert into public.audit_logs (
      tenant_id,
      actor_id,
      action,
      target_type,
      target_id,
      reason,
      payload
    ) values (
      p_tenant_id,
      p_created_by,
      'bige_line_schedule_manual_resend_requested',
      'bige_line_schedule_notification',
      queued_id::text,
      'member_schedule_latest_snapshot',
      jsonb_build_object(
        'memberId', p_member_id,
        'previousNotificationId', p_manual_retry_of_notification_id,
        'newNotificationId', queued_id,
        'before', jsonb_build_object('status', manual_row.status, 'attempts', manual_row.attempts),
        'after', jsonb_build_object('status', 'pending', 'attempts', 0)
      )
    );
  end if;

  return query select queued_id, 'pending'::text, true;
end;
$$;

revoke all on function public.bige_queue_line_schedule_notification_v2(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.bige_queue_line_schedule_notification_v2(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, uuid, uuid
) to service_role;

comment on function public.bige_queue_line_schedule_notification_v2(
  uuid, uuid, uuid, uuid, text, text, jsonb, text, uuid, uuid
) is 'Atomically queues the latest member-specific schedule snapshot for any active member routed to the selected physical LINE group.';

commit;
