create table if not exists public.trial_booking_contact_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trial_booking_id uuid not null references public.trial_bookings(id) on delete cascade,
  note text not null,
  contacted_by uuid references public.profiles(id) on delete set null,
  contacted_at timestamptz not null default now(),
  constraint trial_booking_contact_logs_note_check
    check (note = btrim(note) and char_length(note) between 1 and 500)
);

create index if not exists trial_booking_contact_logs_booking_time_idx
  on public.trial_booking_contact_logs (tenant_id, trial_booking_id, contacted_at desc);

alter table public.trial_booking_contact_logs enable row level security;

revoke all on table public.trial_booking_contact_logs from anon, authenticated;
grant select, insert on table public.trial_booking_contact_logs to service_role;

comment on table public.trial_booking_contact_logs is
  'Append-only contact notes recorded by staff for a trial booking.';
comment on column public.trial_booking_contact_logs.note is
  'Staff contact note; separate from the customer-supplied trial_bookings.note.';

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
  set booking_status = 'contacted',
      updated_at = v_updated_at
  where id = p_booking_id;

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
    'booking_status', 'contacted',
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

;
