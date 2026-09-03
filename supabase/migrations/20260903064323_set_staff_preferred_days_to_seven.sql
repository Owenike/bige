alter table public.staff_schedule_periods
  alter column preferred_days_required set default 7;

update public.staff_schedule_periods
set preferred_days_required = 7,
    updated_at = now()
where month_start >= date '2026-10-01'
  and status in ('selection_open', 'selection_closed', 'drafting')
  and preferred_days_required <> 7;

with completed_drafts as (
  select preference.id
  from public.staff_time_off_preferences as preference
  join public.staff_schedule_periods as period
    on period.id = preference.period_id
  cross join lateral (
    select count(*)::integer as selected_days
    from (
      select requested_date
      from public.staff_time_off_preference_dates
      where preference_id = preference.id
        and source = 'employee'
      union
      select closure_date
      from public.staff_facility_closures
      where period_id = preference.period_id
        and counts_as_preferred_day = true
    ) as selected_dates
  ) as totals
  where period.month_start >= date '2026-10-01'
    and period.status in ('selection_open', 'selection_closed', 'drafting')
    and period.preferred_days_required = 7
    and preference.status = 'draft'
    and totals.selected_days = 7
)
update public.staff_time_off_preferences as preference
set status = 'submitted',
    submitted_at = coalesce(preference.submitted_at, now()),
    last_edited_at = now(),
    updated_at = now()
where preference.id in (select id from completed_drafts);
