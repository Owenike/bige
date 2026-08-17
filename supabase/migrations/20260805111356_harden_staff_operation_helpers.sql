-- Staff authorization helpers are used by authenticated RLS policies, but
-- anonymous callers never need to invoke them through the Data API.
revoke execute on function public.can_manage_staff_operations() from anon;
revoke execute on function public.can_final_approve_staff_operations() from anon;
-- Both functions already fully qualify their profile lookup. An empty search
-- path prevents object shadowing while preserving authenticated RLS use.
alter function public.can_manage_staff_operations() set search_path = '';
alter function public.can_final_approve_staff_operations() set search_path = '';
