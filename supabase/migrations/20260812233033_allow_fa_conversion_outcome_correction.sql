-- Change an already converted FA to not-converted as one atomic operation.
-- The existing restore function performs all destructive eligibility checks,
-- reverses the initial payment and contract, and locks the affected rows.
-- Completing the new outcome in the same statement means either both steps
-- commit or PostgreSQL rolls the whole correction back.
create or replace function public.bige_change_fa_conversion_outcome(
  p_booking_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  restore_result jsonb;
  outcome_result jsonb;
begin
  if p_outcome <> 'not_converted' then
    raise exception 'invalid_trial_conversion_outcome';
  end if;

  restore_result := public.bige_restore_fa_conversion(p_booking_id);
  outcome_result := public.bige_complete_trial_outcome(p_booking_id, p_outcome);

  return jsonb_build_object(
    'bookingId', p_booking_id,
    'outcome', p_outcome,
    'restoredConversion', restore_result,
    'completedOutcome', outcome_result
  );
end;
$$;

revoke all on function public.bige_change_fa_conversion_outcome(uuid, text)
  from public, anon;
grant execute on function public.bige_change_fa_conversion_outcome(uuid, text)
  to authenticated;
