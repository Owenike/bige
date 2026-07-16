create index if not exists student_checkin_requests_profile_idx
  on public.student_checkin_requests (student_profile_id);

create index if not exists student_checkin_requests_reviewed_by_idx
  on public.student_checkin_requests (reviewed_by)
  where reviewed_by is not null;

create index if not exists student_check_ins_reviewed_by_idx
  on public.student_check_ins (reviewed_by)
  where reviewed_by is not null;

revoke all on table public.student_line_profiles from anon, authenticated;
revoke all on table public.student_checkin_requests from anon, authenticated;
revoke all on table public.student_check_ins from anon, authenticated;
