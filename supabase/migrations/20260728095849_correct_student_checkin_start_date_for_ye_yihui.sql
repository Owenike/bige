begin;

alter table public.student_line_profiles disable trigger lock_student_membership_period;

update public.student_line_profiles
set membership_starts_on = date '2026-07-28',
    updated_at = now()
where id = '6edba2b6-7a16-487f-a560-0364c0f57fe6'
  and full_name = '葉怡慧'
  and membership_starts_on = date '2026-08-14'
  and membership_expires_on = date '2027-03-12'
  and is_active = true;

alter table public.student_line_profiles enable trigger lock_student_membership_period;

commit;;
