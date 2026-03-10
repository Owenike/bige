-- Temporary cron reachability probe evidence table.
-- This table is intentionally isolated from notification_job_runs semantics.

create table if not exists public.cron_probe_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  source text not null,
  request_method text not null,
  host text,
  vercel_env text,
  vercel_url text,
  x_vercel_id text,
  user_agent text,
  headers_summary jsonb not null default '{}'::jsonb,
  is_cron_like boolean not null default false
);

create index if not exists cron_probe_runs_created_idx
  on public.cron_probe_runs(created_at desc);

create index if not exists cron_probe_runs_cron_like_created_idx
  on public.cron_probe_runs(is_cron_like, created_at desc);

alter table public.cron_probe_runs enable row level security;

drop policy if exists cron_probe_runs_platform_admin_select on public.cron_probe_runs;
create policy cron_probe_runs_platform_admin_select
  on public.cron_probe_runs
  for select
  using (public.is_platform_admin());

