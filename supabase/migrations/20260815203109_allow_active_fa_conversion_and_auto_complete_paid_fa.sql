begin;

-- Allow an active FA booking to create its member contract before the lesson
-- is manually marked complete. A conversion with a real initial payment also
-- completes the FA atomically; cancelled and no-show bookings remain blocked.
do $migration$
declare
  function_definition text;
  original_definition text;
begin
  select pg_get_functiondef(
    'public.bige_create_member_contract(uuid,uuid,uuid,uuid,text,text,date,text,boolean,uuid,date,text,bigint,text,jsonb,text)'::regprocedure
  ) into function_definition;

  if function_definition like '%operation_result = ''completed''%' then
    original_definition := function_definition;
    function_definition := replace(
      function_definition,
      E'      and operation_kind = ''trial''\n      and operation_result = ''completed''',
      E'      and operation_kind = ''trial''\n      and status in (''pending'', ''confirmed'', ''booked'', ''checked_in'', ''completed'')'
    );
    function_definition := replace(
      function_definition,
      'completed_trial_required',
      'active_trial_required'
    );
    function_definition := replace(
      function_definition,
      E'    set converted_at = now(),\n        converted_contract_id = contract_row.id,\n        updated_at = now()',
      E'    set converted_at = now(),\n        converted_contract_id = contract_row.id,\n        status = case when p_initial_payment > 0 then ''completed'' else status end,\n        operation_result = case when p_initial_payment > 0 then ''completed'' else operation_result end,\n        completed_at = case when p_initial_payment > 0 then coalesce(completed_at, now()) else completed_at end,\n        status_updated_at = case when p_initial_payment > 0 then now() else status_updated_at end,\n        updated_at = now()'
    );

    if function_definition = original_definition
       or function_definition like '%operation_result = ''completed''%'
       or function_definition not like '%active_trial_required%'
       or function_definition not like '%status = case when p_initial_payment > 0 then ''completed'' else status end%' then
      raise exception 'bige_create_member_contract active FA conversion update failed';
    end if;

    execute function_definition;
  elsif function_definition not like '%active_trial_required%'
     or function_definition not like '%status in (''pending'', ''confirmed'', ''booked'', ''checked_in'', ''completed'')%'
     or function_definition not like '%status = case when p_initial_payment > 0 then ''completed'' else status end%' then
    raise exception 'bige_create_member_contract active FA conversion definition is unexpected';
  end if;
end;
$migration$;

commit;
