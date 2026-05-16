drop function if exists public.create_public_booking(uuid, text, text, uuid, timestamptz, timestamptz, text, text, text, text);
drop function if exists public.create_public_booking_request(uuid, text, text, text, text, date, text, text, text);

create or replace function public.create_public_booking_request(
  p_customer_name text default null,
  p_customer_gender text default null,
  p_customer_phone text default null,
  p_customer_birthdate date default null,
  p_preferred_day_type text default null,
  p_preferred_time_slot text default null,
  p_note text default null
)
returns table (
  id uuid,
  status text,
  contact_name text,
  contact_phone text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch public.branches%rowtype;
  v_waitlist public.booking_waitlist%rowtype;
  v_note text;
begin
  p_customer_name := nullif(btrim(coalesce(p_customer_name, '')), '');
  p_customer_gender := nullif(btrim(coalesce(p_customer_gender, '')), '');
  p_customer_phone := nullif(btrim(coalesce(p_customer_phone, '')), '');
  p_preferred_day_type := nullif(btrim(coalesce(p_preferred_day_type, '')), '');
  p_preferred_time_slot := nullif(btrim(coalesce(p_preferred_time_slot, '')), '');
  p_note := nullif(btrim(coalesce(p_note, '')), '');

  if p_customer_name is null then
    raise exception 'customer_name_required';
  end if;
  if p_customer_gender is null or p_customer_gender not in ('男性', '女性') then
    raise exception 'customer_gender_required';
  end if;
  if p_customer_phone is null then
    raise exception 'customer_phone_required';
  end if;
  if p_customer_birthdate is null then
    raise exception 'customer_birthdate_required';
  end if;
  if p_preferred_day_type is null or p_preferred_day_type not in ('平日', '假日', '都可以') then
    raise exception 'preferred_day_type_required';
  end if;
  if p_preferred_time_slot is null or p_preferred_time_slot not in ('下午', '晚上', '都可以') then
    raise exception 'preferred_time_slot_required';
  end if;

  select *
  into v_branch
  from public.branches b
  where b.id = '4c3f077d-af12-4ac0-be0c-0005a42acb5b'
    and b.tenant_id = '3bc12d76-e8b6-4dd0-a87d-2048b495ff0c'
    and b.is_active = true
  limit 1;

  if not found then
    raise exception 'booking_branch_not_found';
  end if;

  v_note := concat_ws(
    E'\n',
    '姓名：' || p_customer_name,
    '性別：' || p_customer_gender,
    '手機號碼：' || p_customer_phone,
    '出生年月日：' || p_customer_birthdate::text,
    '可預約日期：' || p_preferred_day_type,
    '可預約時段：' || p_preferred_time_slot,
    case when p_note is not null then '備註：' || p_note else null end
  );

  insert into public.booking_waitlist (
    tenant_id,
    branch_id,
    member_id,
    linked_booking_id,
    contact_name,
    contact_phone,
    desired_date,
    desired_time,
    note,
    status,
    created_by
  )
  values (
    v_branch.tenant_id,
    v_branch.id,
    null,
    null,
    p_customer_name,
    p_customer_phone,
    null,
    null,
    v_note,
    'pending',
    null
  )
  returning * into v_waitlist;

  return query
  select
    v_waitlist.id,
    v_waitlist.status,
    v_waitlist.contact_name,
    v_waitlist.contact_phone,
    v_waitlist.created_at;
end;
$$;

revoke all on function public.create_public_booking_request(text, text, text, date, text, text, text) from public;
grant execute on function public.create_public_booking_request(text, text, text, date, text, text, text) to anon, authenticated;
