begin;

-- Legacy schedule imports intentionally keep a shared FA contact number on the
-- trial booking when that number already belongs to another member. Preserve
-- that separation during FA conversion instead of promoting the shared contact
-- into the converting member's unique primary phone.
do $migration$
declare
  function_definition text;
  original_definition text;
begin
  select pg_get_functiondef(
    'public.bige_create_member_contract(uuid,uuid,uuid,uuid,text,text,date,text,boolean,uuid,date,text,bigint,text,jsonb,text)'::regprocedure
  ) into function_definition;

  original_definition := function_definition;
  function_definition := replace(
    function_definition,
    E'      phone = btrim(p_phone),\n      phone_normalized = normalized_phone,',
    E'      phone = case\n        when p_source_booking_id is not null\n         and exists (\n           select 1\n           from public.members other_member\n           where other_member.tenant_id = p_tenant_id\n             and other_member.id <> member_row.id\n             and (\n               other_member.phone = btrim(p_phone)\n               or (\n                 normalized_phone <> ''''\n                 and other_member.phone_normalized = normalized_phone\n               )\n             )\n         ) then member_row.phone\n        else btrim(p_phone)\n      end,\n      phone_normalized = case\n        when p_source_booking_id is not null\n         and exists (\n           select 1\n           from public.members other_member\n           where other_member.tenant_id = p_tenant_id\n             and other_member.id <> member_row.id\n             and (\n               other_member.phone = btrim(p_phone)\n               or (\n                 normalized_phone <> ''''\n                 and other_member.phone_normalized = normalized_phone\n               )\n             )\n         ) then member_row.phone_normalized\n        else normalized_phone\n      end,'
  );

  if function_definition = original_definition
     or function_definition not like '%other_member.phone_normalized = normalized_phone%'
  then
    raise exception 'bige_create_member_contract shared FA contact patch failed';
  end if;

  execute function_definition;
end;
$migration$;

commit;
