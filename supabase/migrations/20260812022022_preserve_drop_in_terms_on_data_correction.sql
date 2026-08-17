-- A visitor who already accepted the current NT$50 drop-in terms only needs
-- to correct page-one personal data after a staff data-correction rejection.
-- Preserve the original terms version and acceptance timestamp in that path.

create or replace function public.save_student_drop_in_registration(
  p_student_profile_id uuid,
  p_full_name text,
  p_birth_date date,
  p_invoice_carrier text,
  p_gender text,
  p_activity_interest text,
  p_discovery_source text
)
returns setof public.student_drop_in_entitlements
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entitlement public.student_drop_in_entitlements%rowtype;
  v_now timestamptz := now();
begin
  if p_full_name is null or char_length(btrim(p_full_name)) not between 1 and 100 then
    raise exception 'INVALID_FULL_NAME';
  end if;
  if p_birth_date is null or p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception 'INVALID_BIRTH_DATE';
  end if;
  if p_invoice_carrier is null or char_length(btrim(p_invoice_carrier)) not between 1 and 80 then
    raise exception 'INVALID_INVOICE_CARRIER';
  end if;
  if p_gender not in ('male', 'female') then
    raise exception 'INVALID_GENDER';
  end if;
  if p_activity_interest not in ('weight_training', 'reformer_pilates') then
    raise exception 'INVALID_ACTIVITY_INTEREST';
  end if;
  if p_discovery_source is null or char_length(btrim(p_discovery_source)) not between 1 and 200 then
    raise exception 'INVALID_DISCOVERY_SOURCE';
  end if;

  perform 1
  from public.student_line_profiles
  where id = p_student_profile_id
    and is_active
  for update;

  if not found then
    raise exception 'PROFILE_NOT_ACTIVE';
  end if;

  insert into public.student_drop_in_entitlements (student_profile_id)
  values (p_student_profile_id)
  on conflict (student_profile_id) do nothing;

  select *
  into v_entitlement
  from public.student_drop_in_entitlements
  where student_profile_id = p_student_profile_id
  for update;

  if not v_entitlement.registration_correction_required
     and char_length(btrim(v_entitlement.invoice_carrier)) between 1 and 80
     and v_entitlement.gender in ('male', 'female')
     and v_entitlement.activity_interest in ('weight_training', 'reformer_pilates')
     and char_length(btrim(v_entitlement.discovery_source)) between 1 and 200
     and v_entitlement.terms_version = '2026-08-11'
     and v_entitlement.terms_accepted_at is not null then
    return query
      select entitlement.*
      from public.student_drop_in_entitlements as entitlement
      where entitlement.student_profile_id = p_student_profile_id;
    return;
  end if;

  if v_entitlement.registration_correction_required
     and (
       v_entitlement.terms_version is distinct from '2026-08-11'
       or v_entitlement.terms_accepted_at is null
     ) then
    raise exception 'TERMS_ACCEPTANCE_REQUIRED';
  end if;

  update public.student_line_profiles
  set full_name = btrim(p_full_name),
      birth_date = p_birth_date,
      updated_at = v_now
  where id = p_student_profile_id;

  update public.student_drop_in_entitlements
  set invoice_carrier = btrim(p_invoice_carrier),
      gender = p_gender,
      activity_interest = p_activity_interest,
      discovery_source = btrim(p_discovery_source),
      terms_version = case
        when v_entitlement.registration_correction_required then v_entitlement.terms_version
        else '2026-08-11'
      end,
      terms_accepted_at = case
        when v_entitlement.registration_correction_required then v_entitlement.terms_accepted_at
        else v_now
      end,
      registration_correction_required = false,
      correction_requested_at = null,
      updated_at = v_now
  where student_profile_id = p_student_profile_id;

  return query
    select entitlement.*
    from public.student_drop_in_entitlements as entitlement
    where entitlement.student_profile_id = p_student_profile_id;
end;
$$;

revoke all on function public.save_student_drop_in_registration(uuid, text, date, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.save_student_drop_in_registration(uuid, text, date, text, text, text, text)
  to service_role;
