-- PostgREST generates ON CONFLICT (recipient_user_id, dedupe_key) for the
-- shared notification upsert. A partial unique index cannot arbitrate that
-- conflict target unless the generated statement repeats the index predicate.
-- A regular unique index keeps the intended behavior because PostgreSQL still
-- permits multiple NULL dedupe keys while enforcing uniqueness for non-NULL
-- keys.
drop index if exists public.in_app_notifications_recipient_dedupe_idx;

create unique index in_app_notifications_recipient_dedupe_idx
  on public.in_app_notifications(recipient_user_id, dedupe_key);
