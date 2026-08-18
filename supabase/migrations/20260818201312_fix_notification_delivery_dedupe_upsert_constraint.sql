-- The delivery writer also uses a plain PostgREST conflict target. Keep its
-- database arbiter aligned with the application while preserving multiple
-- delivery rows whose optional dedupe key is NULL.
drop index if exists public.notification_deliveries_dedupe_idx;

create unique index notification_deliveries_dedupe_idx
  on public.notification_deliveries(channel, dedupe_key);
