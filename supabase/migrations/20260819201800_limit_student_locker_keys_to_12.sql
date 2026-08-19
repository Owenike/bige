begin;

set local lock_timeout = '5s';

do $$
begin
  if exists (
    select 1
    from public.student_check_ins
    where locker_key_number is not null
      and locker_key_number not between 1 and 12
  ) then
    raise exception 'Cannot limit student locker keys to 1-12 while out-of-range student_check_ins rows exist';
  end if;

  if exists (
    select 1
    from public.student_drop_ins
    where locker_key_number is not null
      and locker_key_number not between 1 and 12
  ) then
    raise exception 'Cannot limit student locker keys to 1-12 while out-of-range student_drop_ins rows exist';
  end if;
end
$$;

alter table public.student_check_ins
  drop constraint if exists student_check_ins_locker_key_check;

alter table public.student_check_ins
  add constraint student_check_ins_locker_key_check
  check (
    (locker_key_taken is null and locker_key_number is null)
    or (locker_key_taken = false and locker_key_number is null)
    or (locker_key_taken = true and locker_key_number between 1 and 12)
  );

alter table public.student_drop_ins
  drop constraint if exists student_drop_ins_locker_key_check;

alter table public.student_drop_ins
  add constraint student_drop_ins_locker_key_check
  check (
    (locker_key_taken is null and locker_key_number is null)
    or (locker_key_taken = false and locker_key_number is null)
    or (locker_key_taken = true and locker_key_number between 1 and 12)
  );

comment on column public.student_check_ins.locker_key_number is
  'Locker key number (1-12) issued for this autonomous-training entry.';

comment on column public.student_drop_ins.locker_key_number is
  'Locker key number (1-12) issued for this drop-in entry.';

commit;
