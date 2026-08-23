begin;

-- A contract that the application already presents as voided must not become
-- payable again merely because voided payments are excluded from its paid
-- total. Patch the established RPC in place so all existing authorization,
-- overpayment, installment, idempotency, and session-unlock behavior remains.
do $migration$
declare
  function_definition text;
  original_definition text;
  existing_guard text;
  replacement_guard text;
begin
  select pg_get_functiondef(
    'public.bige_record_contract_payment(uuid,uuid,text,bigint,text,timestamptz,text,text)'::regprocedure
  ) into function_definition;

  if function_definition not like '%voided_contract_payment_not_allowed%' then
    original_definition := function_definition;
    existing_guard := $guard$if actor.role <> 'platform_admin' and actor.tenant_id is distinct from contract_row.tenant_id then
    raise exception 'forbidden';
  end if;

  select * into existing_payment$guard$;
    replacement_guard := $guard$if actor.role <> 'platform_admin' and actor.tenant_id is distinct from contract_row.tenant_id then
    raise exception 'forbidden';
  end if;

  if contract_row.status = 'canceled'
     or (
       exists (
         select 1
         from public.bige_contract_payments payment
         where payment.contract_id = contract_row.id
       )
       and not exists (
         select 1
         from public.bige_contract_payments payment
         where payment.contract_id = contract_row.id
           and payment.status <> 'voided'
       )
     ) then
    raise exception 'voided_contract_payment_not_allowed';
  end if;

  select * into existing_payment$guard$;

    function_definition := replace(
      function_definition,
      existing_guard,
      replacement_guard
    );

    if function_definition = original_definition then
      raise exception 'bige_record_contract_payment voided-contract guard update failed';
    end if;

    execute function_definition;
  end if;
end;
$migration$;

revoke all on function public.bige_record_contract_payment(
  uuid, uuid, text, bigint, text, timestamptz, text, text
) from public, anon;
grant execute on function public.bige_record_contract_payment(
  uuid, uuid, text, bigint, text, timestamptz, text, text
) to authenticated;

commit;
