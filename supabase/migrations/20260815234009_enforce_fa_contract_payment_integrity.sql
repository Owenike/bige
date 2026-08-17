-- FA conversion is a paid outcome. Keep direct non-FA contracts able to start
-- unpaid, but reject zero/under-minimum FA conversions and every overpayment.

do $migration$
declare
  function_definition text;
  original_definition text;
begin
  select pg_get_functiondef(
    'public.bige_create_member_contract(uuid,uuid,uuid,uuid,text,text,date,text,boolean,uuid,date,text,bigint,text,jsonb,text)'::regprocedure
  ) into function_definition;

  if function_definition not like '%fa_initial_payment_required%' then
    original_definition := function_definition;
    function_definition := replace(
      function_definition,
      E'    raise exception ''fitness_plan_invalid'';\n  end if;\n\n  if p_source_booking_id is not null then',
      E'    raise exception ''fitness_plan_invalid'';\n  end if;\n\n  if p_initial_payment < 0 then\n    raise exception ''payment_amount_invalid'';\n  end if;\n\n  if p_initial_payment > plan_row.price_amount::bigint then\n    raise exception ''payment_amount_exceeds_contract_balance'';\n  end if;\n\n  if p_source_booking_id is not null then\n    minimum_deposit := ceil(plan_row.price_amount::numeric / plan_row.total_sessions)::bigint;\n    if p_initial_payment < minimum_deposit then\n      raise exception ''fa_initial_payment_required'';\n    end if;\n  end if;\n\n  if p_source_booking_id is not null then'
    );

    if function_definition = original_definition then
      raise exception 'bige_create_member_contract FA payment validation update failed';
    end if;

    execute function_definition;
  end if;
end;
$migration$;

create or replace function public.enforce_bige_contract_payment_amount_integrity()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  contract_row public.member_plan_contracts%rowtype;
  other_recorded_total bigint := 0;
  minimum_deposit bigint;
begin
  if new.status <> 'recorded' then
    return new;
  end if;

  select * into contract_row
  from public.member_plan_contracts
  where id = new.contract_id
  for update;

  if not found
     or contract_row.total_amount is null
     or contract_row.total_amount <= 0
     or contract_row.total_sessions is null
     or contract_row.total_sessions <= 0 then
    raise exception 'fitness_contract_not_found';
  end if;

  select coalesce(sum(amount), 0)::bigint into other_recorded_total
  from public.bige_contract_payments
  where contract_id = new.contract_id
    and status = 'recorded'
    and id is distinct from new.id;

  if other_recorded_total + new.amount > contract_row.total_amount then
    raise exception 'payment_amount_exceeds_contract_balance';
  end if;

  if other_recorded_total = 0 then
    minimum_deposit := ceil(
      contract_row.total_amount::numeric / contract_row.total_sessions
    )::bigint;
    if new.amount < minimum_deposit then
      raise exception 'minimum_deposit_not_met';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_bige_contract_payment_amount_integrity()
from public, anon, authenticated;

drop trigger if exists bige_contract_payment_amount_integrity
on public.bige_contract_payments;

create trigger bige_contract_payment_amount_integrity
before insert or update of amount, status, contract_id
on public.bige_contract_payments
for each row
execute function public.enforce_bige_contract_payment_amount_integrity();
