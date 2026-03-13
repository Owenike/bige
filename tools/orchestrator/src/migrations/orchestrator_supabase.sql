create table if not exists public.orchestrator_documents (
  key text primary key,
  value jsonb not null,
  version bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists orchestrator_documents_updated_at_idx
  on public.orchestrator_documents (updated_at desc);
