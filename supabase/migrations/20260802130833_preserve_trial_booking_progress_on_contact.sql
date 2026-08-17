create or replace function public.record_trial_booking_contact(
  p_booking_id uuid,
  p_tenant_id uuid,
  p_contacted_by uuid,
  p_note text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
  v_updated_at timestamptz := now();
  v_log_id uuid;
  v_booking_status text;
begin
  if p_tenant_id is null then
    raise exception using message = 'missing_tenant_context';
  end if;

  if char_length(v_note) < 1 then
    raise exception using message = 'contact_note_required';
  end if;

  if char_length(v_note) > 500 then
    raise exception using message = 'contact_note_too_long';
  end if;

  if not exists (
    select 1
    from public.profiles p
    where p.id = p_contacted_by
      and p.tenant_id = p_tenant_id
      and p.is_active = true
  ) then
    raise exception using message = 'invalid_contact_operator';
  end if;

  update public.trial_bookings
  set booking_status = case
        when booking_status in ('new', 'contacted') then 'contacted'
        else booking_status
      end,
      updated_at = v_updated_at
  where id = p_booking_id
  returning booking_status into v_booking_status;

  if not found then
    raise exception using message = 'booking_not_found';
  end if;

  insert into public.trial_booking_contact_logs (
    tenant_id,
    trial_booking_id,
    note,
    contacted_by,
    contacted_at
  )
  values (
    p_tenant_id,
    p_booking_id,
    v_note,
    p_contacted_by,
    v_updated_at
  )
  returning id into v_log_id;

  return jsonb_build_object(
    'id', p_booking_id,
    'booking_status', v_booking_status,
    'updated_at', v_updated_at,
    'contact_log_id', v_log_id,
    'contacted_at', v_updated_at
  );
end;
$$;

revoke all on function public.record_trial_booking_contact(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_trial_booking_contact(uuid, uuid, uuid, text)
  to service_role;
