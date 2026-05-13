
alter function public.set_updated_at() set search_path = public;

revoke execute on function public.is_group_member(uuid, uuid) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
