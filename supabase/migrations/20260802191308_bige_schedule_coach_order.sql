create table if not exists public.bige_schedule_coach_order (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  coach_id uuid not null references public.profiles(id) on delete cascade,
  sort_order integer not null check (sort_order >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (tenant_id, coach_id)
);

create index if not exists bige_schedule_coach_order_tenant_sort_idx
  on public.bige_schedule_coach_order (tenant_id, sort_order, coach_id);

alter table public.bige_schedule_coach_order enable row level security;

revoke all on table public.bige_schedule_coach_order from anon, authenticated;
grant select, insert, update, delete on table public.bige_schedule_coach_order to service_role;

comment on table public.bige_schedule_coach_order is
  'Persistent display order for coach columns on the BigE daily schedule.';
