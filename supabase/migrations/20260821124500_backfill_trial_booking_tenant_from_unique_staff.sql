begin;

-- Some historical successful appointments predate tenant attribution and have
-- no linked member or schedule booking. Attribute only when the saved booking
-- or executing coach label maps to exactly one tenant across all staff profiles.
with profile_labels as (
  select distinct
    profile.tenant_id,
    lower(regexp_replace(names.label, '\s+', '', 'g')) as normalized_label
  from public.profiles profile
  cross join lateral unnest(array[profile.english_name, profile.display_name]) as names(label)
  where profile.tenant_id is not null
    and nullif(btrim(names.label), '') is not null
), unique_trial_tenants as (
  select
    trial.id,
    max(profile_labels.tenant_id::text)::uuid as tenant_id
  from public.trial_bookings trial
  join profile_labels
    on profile_labels.normalized_label in (
      lower(regexp_replace(coalesce(trial.booking_coach, ''), '\s+', '', 'g')),
      lower(regexp_replace(coalesce(trial.executing_coach, ''), '\s+', '', 'g'))
    )
  where trial.tenant_id is null
    and trial.scheduled_at is not null
  group by trial.id
  having count(distinct profile_labels.tenant_id) = 1
)
update public.trial_bookings trial
set tenant_id = unique_trial_tenants.tenant_id
from unique_trial_tenants
where trial.id = unique_trial_tenants.id
  and trial.tenant_id is null;

commit;
