-- Keep the canonical middle-shift template and all future draft entries aligned.
update public.staff_shift_templates
set starts_at = time '14:00',
    ends_at = time '23:00',
    updated_at = now()
where code = 'COACH_MIDDLE'
  and starts_at = time '13:00'
  and ends_at = time '22:00';

update public.staff_schedule_entries as entry
set starts_at = time '14:00',
    ends_at = time '23:00',
    updated_at = now()
from public.staff_schedule_versions as version
where version.id = entry.version_id
  and version.status = 'draft'
  and entry.work_date >= current_date
  and entry.entry_kind = 'work'
  and entry.shift_code = 'COACH_MIDDLE'
  and entry.starts_at = time '13:00'
  and entry.ends_at = time '22:00';
