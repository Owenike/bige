create index bige_line_group_binding_members_created_by_idx
  on public.bige_line_group_binding_members(created_by)
  where created_by is not null;
