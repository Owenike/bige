begin;

do $$
declare
  target_tenant_id constant uuid := '3bc12d76-e8b6-4dd0-a87d-2048b495ff0c';
  matched_count integer;
begin
  select count(*)::integer into matched_count
  from public.members member
  where member.tenant_id = target_tenant_id
    and (
      (member.id = 'f2ad8bff-ebcb-48f4-af4d-0f11e8157da0'::uuid
        and member.full_name in ('謝曉萱', '謝筱萱'))
      or
      (member.id = 'a762e71e-94dc-4d9a-ad10-b5c7c273564f'::uuid
        and member.full_name in ('蘇宥蓁', '蘇宥溱'))
      or
      (member.id = '76ecaa94-cd7e-4562-bedf-209ddb52a6e9'::uuid
        and member.full_name in ('欣妤', '蔡欣妤'))
    );

  if matched_count <> 3 then
    raise exception 'shared_member_name_correction_precondition_failed';
  end if;

  update public.members
  set full_name = case id
        when 'f2ad8bff-ebcb-48f4-af4d-0f11e8157da0'::uuid then '謝筱萱'
        when 'a762e71e-94dc-4d9a-ad10-b5c7c273564f'::uuid then '蘇宥溱'
        when '76ecaa94-cd7e-4562-bedf-209ddb52a6e9'::uuid then '蔡欣妤'
      end,
      updated_at = now()
  where tenant_id = target_tenant_id
    and id in (
      'f2ad8bff-ebcb-48f4-af4d-0f11e8157da0'::uuid,
      'a762e71e-94dc-4d9a-ad10-b5c7c273564f'::uuid,
      '76ecaa94-cd7e-4562-bedf-209ddb52a6e9'::uuid
    )
    and full_name is distinct from case id
      when 'f2ad8bff-ebcb-48f4-af4d-0f11e8157da0'::uuid then '謝筱萱'
      when 'a762e71e-94dc-4d9a-ad10-b5c7c273564f'::uuid then '蘇宥溱'
      when '76ecaa94-cd7e-4562-bedf-209ddb52a6e9'::uuid then '蔡欣妤'
    end;

  if exists (
    select 1
    from public.members member
    where member.tenant_id = target_tenant_id
      and (
        (member.id = 'f2ad8bff-ebcb-48f4-af4d-0f11e8157da0'::uuid and member.full_name <> '謝筱萱')
        or (member.id = 'a762e71e-94dc-4d9a-ad10-b5c7c273564f'::uuid and member.full_name <> '蘇宥溱')
        or (member.id = '76ecaa94-cd7e-4562-bedf-209ddb52a6e9'::uuid and member.full_name <> '蔡欣妤')
      )
  ) then
    raise exception 'shared_member_name_correction_verification_failed';
  end if;
end;
$$;

commit;
