-- Require the original two-page NT$50 registration and terms acceptance before
-- a visitor can create or complete a drop-in admission request.

alter table public.student_drop_in_entitlements
  add column if not exists invoice_carrier text,
  add column if not exists gender text,
  add column if not exists activity_interest text,
  add column if not exists discovery_source text,
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz;

alter table public.student_drop_in_entitlements
  drop constraint if exists student_drop_in_entitlements_invoice_carrier_check,
  drop constraint if exists student_drop_in_entitlements_gender_check,
  drop constraint if exists student_drop_in_entitlements_activity_interest_check,
  drop constraint if exists student_drop_in_entitlements_discovery_source_check,
  drop constraint if exists student_drop_in_entitlements_terms_acceptance_check;

alter table public.student_drop_in_entitlements
  add constraint student_drop_in_entitlements_invoice_carrier_check
    check (invoice_carrier is null or char_length(btrim(invoice_carrier)) between 1 and 80),
  add constraint student_drop_in_entitlements_gender_check
    check (gender is null or gender in ('male', 'female')),
  add constraint student_drop_in_entitlements_activity_interest_check
    check (activity_interest is null or activity_interest in ('weight_training', 'reformer_pilates')),
  add constraint student_drop_in_entitlements_discovery_source_check
    check (discovery_source is null or char_length(btrim(discovery_source)) between 1 and 200),
  add constraint student_drop_in_entitlements_terms_acceptance_check
    check (
      (terms_version is null and terms_accepted_at is null)
      or (terms_version is not null and terms_accepted_at is not null)
    );

comment on column public.student_drop_in_entitlements.invoice_carrier is
  'Invoice carrier supplied on page one of the NT$50 admission registration.';
comment on column public.student_drop_in_entitlements.terms_version is
  'Version of the NT$50 membership terms accepted by this visitor.';

create or replace function public.enforce_student_drop_in_registration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.student_drop_in_entitlements as entitlement
    where entitlement.student_profile_id = new.student_profile_id
      and char_length(btrim(entitlement.invoice_carrier)) between 1 and 80
      and entitlement.gender in ('male', 'female')
      and entitlement.activity_interest in ('weight_training', 'reformer_pilates')
      and char_length(btrim(entitlement.discovery_source)) between 1 and 200
      and entitlement.terms_version = '2026-08-11'
      and entitlement.terms_accepted_at is not null
  ) then
    raise exception 'DROP_IN_REGISTRATION_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists student_drop_in_requests_registration_required
  on public.student_drop_in_requests;
create trigger student_drop_in_requests_registration_required
before insert on public.student_drop_in_requests
for each row execute function public.enforce_student_drop_in_registration();

drop trigger if exists student_drop_ins_registration_required
  on public.student_drop_ins;
create trigger student_drop_ins_registration_required
before insert on public.student_drop_ins
for each row execute function public.enforce_student_drop_in_registration();

revoke all on function public.enforce_student_drop_in_registration() from public, anon, authenticated;
grant execute on function public.enforce_student_drop_in_registration() to service_role;
