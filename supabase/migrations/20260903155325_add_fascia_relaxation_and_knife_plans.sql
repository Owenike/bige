-- Add fixed fascia relaxation and fascia knife plans for every existing
-- session tier. Prices and contract terms intentionally mirror the current
-- fixed training plans at the same session count.

with target_branch as (
  select tenant_id, branch_id
  from public.member_plan_catalog
  where tenant_id = '3bc12d76-e8b6-4dd0-a87d-2048b495ff0c'::uuid
    and fitness_visible = true
    and is_active = true
    and branch_id is not null
  order by created_at
  limit 1
),
plan_tiers(total_sessions, price_amount, validity_days, base_validity_days, extension_limit_days) as (
  values
    (12,  21456::numeric,  72,  42,  21),
    (24,  38112::numeric, 114,  84,  42),
    (30,  44640::numeric, 135, 105,  53),
    (36,  53568::numeric, 156, 126,  63),
    (48,  66624::numeric, 198, 168,  84),
    (72,  92736::numeric, 282, 252, 126),
    (100, 118800::numeric, 380, 350, 175)
),
plan_courses(course_key, course_slug, course_name) as (
  values
    ('relaxation', 'fascia_relaxation', '筋膜放鬆'),
    ('fascia_knife', 'fascia_knife', '筋膜刀')
)
insert into public.member_plan_catalog (
  tenant_id,
  branch_id,
  code,
  name,
  description,
  plan_type,
  fulfillment_kind,
  default_duration_days,
  default_quantity,
  allow_auto_renew,
  is_active,
  metadata,
  price_amount,
  service_scope,
  fitness_plan_kind,
  total_sessions,
  course_allocations,
  validity_bonus_days,
  fitness_visible,
  version
)
select
  target_branch.tenant_id,
  target_branch.branch_id,
  format('fitness_%s_%s', plan_tiers.total_sessions, plan_courses.course_slug),
  format('%s堂%s', plan_tiers.total_sessions, plan_courses.course_name),
  null,
  'coach_pack',
  'none',
  plan_tiers.validity_days,
  plan_tiers.total_sessions,
  false,
  true,
  jsonb_build_object(
    'baseValidityDays', plan_tiers.base_validity_days,
    'extensionLimitDays', plan_tiers.extension_limit_days
  ),
  plan_tiers.price_amount,
  jsonb_build_array(plan_courses.course_key),
  'pt_fixed',
  plan_tiers.total_sessions,
  jsonb_build_object(
    'weight_training', 0,
    'relaxation', case when plan_courses.course_key = 'relaxation' then plan_tiers.total_sessions else 0 end,
    'reformer_pilates', 0,
    'sports_cupping', 0,
    'fascia_knife', case when plan_courses.course_key = 'fascia_knife' then plan_tiers.total_sessions else 0 end,
    'boxing', 0
  ),
  30,
  true,
  1
from target_branch
cross join plan_tiers
cross join plan_courses
on conflict (tenant_id, code) do update
set
  branch_id = excluded.branch_id,
  name = excluded.name,
  description = excluded.description,
  plan_type = excluded.plan_type,
  fulfillment_kind = excluded.fulfillment_kind,
  default_duration_days = excluded.default_duration_days,
  default_quantity = excluded.default_quantity,
  allow_auto_renew = excluded.allow_auto_renew,
  is_active = excluded.is_active,
  metadata = excluded.metadata,
  price_amount = excluded.price_amount,
  service_scope = excluded.service_scope,
  fitness_plan_kind = excluded.fitness_plan_kind,
  total_sessions = excluded.total_sessions,
  course_allocations = excluded.course_allocations,
  validity_bonus_days = excluded.validity_bonus_days,
  fitness_visible = excluded.fitness_visible,
  updated_at = now(),
  version = public.member_plan_catalog.version + 1;
