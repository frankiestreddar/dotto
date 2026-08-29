alter table public.profiles
  add column credits_remaining integer not null default 30,
  add column credits_reset_at date not null default current_date;

-- Atomic check-and-deduct, scoped to the calling user via auth.uid() (never takes a
-- user id param, so it can't be used to drain someone else's credits even though it's
-- SECURITY DEFINER). Lazily resets to 30 the first time it's called on a new day —
-- no cron job needed.
create or replace function public.deduct_dottie_credits(p_amount integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_remaining integer;
  v_reset_at date;
begin
  if v_user_id is null then
    return false;
  end if;

  select credits_remaining, credits_reset_at into v_remaining, v_reset_at
  from public.profiles
  where id = v_user_id
  for update;

  if v_reset_at < current_date then
    v_remaining := 30;
    v_reset_at := current_date;
  end if;

  if v_remaining < p_amount then
    update public.profiles set credits_remaining = v_remaining, credits_reset_at = v_reset_at where id = v_user_id;
    return false;
  end if;

  update public.profiles
  set credits_remaining = v_remaining - p_amount, credits_reset_at = v_reset_at
  where id = v_user_id;

  return true;
end;
$$;

revoke all on function public.deduct_dottie_credits(integer) from public;
grant execute on function public.deduct_dottie_credits(integer) to authenticated;
