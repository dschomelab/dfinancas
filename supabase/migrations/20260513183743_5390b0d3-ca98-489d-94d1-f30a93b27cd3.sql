
revoke execute on function public.seed_default_categories(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_group_member(uuid, uuid) from public, anon;
