create or replace function public.is_username_available(check_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (select 1 from profiles where lower(username) = lower(check_username));
$$;

grant execute on function public.is_username_available(text) to anon, authenticated;
