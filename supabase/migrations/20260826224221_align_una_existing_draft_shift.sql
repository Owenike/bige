with una_draft_entries as (
  select
    entry.id,
    entry.tenant_id,
    profile.branch_id,
    case
      when extract(isodow from entry.work_date) = 3 then 'COACH_EARLY_WED'
      else 'COACH_EARLY'
    end as shift_code
  from public.staff_schedule_entries as entry
  join public.staff_schedule_versions as version on version.id = entry.version_id
  join public.profiles as profile on profile.id = entry.employee_id
  where profile.employee_number = 'E000012'
    and entry.entry_kind = 'work'
    and entry.source = 'generated'
    and version.status in ('draft', 'assistant_review', 'manager_review')
)
update public.staff_schedule_entries as entry
set
  shift_template_id = (
    select template.id
    from public.staff_shift_templates as template
    where template.tenant_id = target.tenant_id
      and template.code = target.shift_code
      and (template.branch_id is null or template.branch_id = target.branch_id)
    order by (template.branch_id is not distinct from target.branch_id) desc, template.created_at
    limit 1
  ),
  shift_code = target.shift_code,
  shift_label = case when target.shift_code = 'COACH_EARLY_WED' then '週三早班' else '早班' end,
  starts_at = case when target.shift_code = 'COACH_EARLY_WED' then time '12:00' else time '10:00' end,
  ends_at = case when target.shift_code = 'COACH_EARLY_WED' then time '21:00' else time '19:00' end,
  break_minutes = 60,
  paid_break = false,
  break_hidden_from_employee = true,
  counts_toward_middle_limit = false,
  updated_at = now()
from una_draft_entries as target
where entry.id = target.id;
