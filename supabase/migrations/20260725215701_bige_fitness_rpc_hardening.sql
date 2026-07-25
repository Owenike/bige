alter function public.bige_validate_course_allocations(jsonb, integer)
  set search_path = public;

revoke all on function public.bige_validate_course_allocations(jsonb, integer) from public, anon;
revoke all on function public.bige_set_attendance_pin(uuid, text) from public, anon;
revoke all on function public.bige_create_schedule_booking(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) from public, anon;
revoke all on function public.bige_reschedule_schedule_booking(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) from public, anon;
revoke all on function public.bige_create_member_contract(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, uuid, date, text, bigint, text, jsonb, text
) from public, anon;
revoke all on function public.bige_record_contract_payment(
  uuid, uuid, text, bigint, text, timestamptz, text, text
) from public, anon;
revoke all on function public.bige_complete_schedule_booking(uuid, text) from public, anon;
revoke all on function public.bige_extend_contract(
  uuid, integer, text, text, text, text, timestamptz
) from public, anon;
revoke all on function public.bige_reverse_contract_payment(uuid, text, text) from public, anon;

grant execute on function public.bige_validate_course_allocations(jsonb, integer) to authenticated;
grant execute on function public.bige_set_attendance_pin(uuid, text) to authenticated;
grant execute on function public.bige_create_schedule_booking(
  uuid, uuid, uuid, uuid, uuid, text, text, timestamptz, timestamptz, text, uuid, text
) to authenticated;
grant execute on function public.bige_reschedule_schedule_booking(
  uuid, uuid, uuid, text, timestamptz, timestamptz, text
) to authenticated;
grant execute on function public.bige_create_member_contract(
  uuid, uuid, uuid, uuid, text, text, date, text, boolean, uuid, date, text, bigint, text, jsonb, text
) to authenticated;
grant execute on function public.bige_record_contract_payment(
  uuid, uuid, text, bigint, text, timestamptz, text, text
) to authenticated;
grant execute on function public.bige_complete_schedule_booking(uuid, text) to authenticated;
grant execute on function public.bige_extend_contract(
  uuid, integer, text, text, text, text, timestamptz
) to authenticated;
grant execute on function public.bige_reverse_contract_payment(uuid, text, text) to authenticated;
