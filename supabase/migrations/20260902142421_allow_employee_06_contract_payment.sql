begin;

-- The application and the current contract entrypoint allow every valid employee
-- number to create a BIG E contract. The v2 function retained an older, explicit
-- E000006 exclusion, so later wrappers failed only when the final RPC reached v2.
-- Remove that one exclusion while preserving tenant, active-profile, and employee-
-- number validation for every caller.
do $migration$
declare
  target_function regprocedure := to_regprocedure(
    'public.bige_create_member_contract_v2(uuid,uuid,uuid,uuid,text,text,date,text,boolean,text,uuid,jsonb,date,text,bigint,text,jsonb,text)'
  );
  function_definition text;
  forbidden_guard constant text := $guard$     or upper(actor.employee_number) = 'E000006' then$guard$;
  allowed_guard constant text := $guard$     then$guard$;
begin
  if target_function is null then
    raise exception 'bige_create_member_contract_v2_not_found';
  end if;

  function_definition := pg_get_functiondef(target_function);

  if strpos(function_definition, forbidden_guard) = 0 then
    raise exception 'bige_create_member_contract_v2_employee_06_guard_not_found';
  end if;

  execute replace(function_definition, forbidden_guard, allowed_guard);

  function_definition := pg_get_functiondef(target_function);

  if strpos(function_definition, forbidden_guard) > 0 then
    raise exception 'bige_create_member_contract_v2_employee_06_guard_still_present';
  end if;

  if strpos(
    function_definition,
    $guard$upper(actor.employee_number) !~ '^E[0-9]{6}$'$guard$
  ) = 0 then
    raise exception 'bige_create_member_contract_v2_employee_validation_missing';
  end if;
end;
$migration$;

commit;
