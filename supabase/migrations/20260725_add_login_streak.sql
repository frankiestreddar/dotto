-- Login streak for the profile panel's streak pill (flame.png + day count).
--
-- profiles.login_streak counts consecutive 24-hour periods (a rolling clock bucketed against a
-- fixed epoch, not calendar days) in which the user has logged in at least once. Visiting again
-- within the SAME 24h period as the last recorded login doesn't change it; visiting during the
-- very NEXT period increments it; letting a full period pass with no visit at all resets it to 1
-- on the next visit after that gap.
--
-- This is deliberately separate from last_daily_bonus_at/award_daily_login_bonus (see
-- 20260724_add_leveling_system.sql), which tracks the total_score login bonus on its own ~20h
-- idempotent claim window — different semantics (a claim window vs. a continuity streak), so a
-- different tracking column and function.

alter table public.profiles
  add column if not exists login_streak integer not null default 0;

alter table public.profiles
  add constraint profiles_login_streak_non_negative check (login_streak >= 0);

alter table public.profiles
  add column if not exists last_login_at timestamptz;

-- Guard for the profile panel's "Joined <Month> <Year>" line — guaranteed present after this
-- migration even if it wasn't already on the table. Existing rows get `now()` as a fallback,
-- which won't be historically accurate for accounts created before this ran, but there's no
-- other source of truth for that date if the column never existed.
alter table public.profiles
  add column if not exists created_at timestamptz not null default now();

-- Bucketing is against a fixed epoch (unix epoch, not account creation) — which bucket a given
-- instant falls in is arbitrary, only whether two instants land in the same/adjacent/non-adjacent
-- bucket matters, so any fixed epoch works as long as it's consistent across calls. SECURITY
-- DEFINER + the same p_user_id-must-match-auth.uid() defense as award_user_points/
-- award_daily_login_bonus.
create or replace function public.bump_login_streak(
  p_user_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_login timestamptz;
  prev_streak integer;
  new_streak integer;
  prev_period bigint;
  current_period bigint;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'bump_login_streak: p_user_id must match the authenticated caller';
  end if;

  select last_login_at, login_streak into prev_login, prev_streak
    from public.profiles where id = p_user_id;

  current_period := floor(extract(epoch from now()) / 86400);

  if prev_login is null then
    new_streak := 1;
  else
    prev_period := floor(extract(epoch from prev_login) / 86400);
    if current_period = prev_period then
      new_streak := prev_streak; -- same 24h period as last time — no change
    elsif current_period = prev_period + 1 then
      new_streak := prev_streak + 1; -- the very next period — consecutive
    else
      new_streak := 1; -- a full period passed with no login at all
    end if;
  end if;

  update public.profiles
     set login_streak = new_streak,
         last_login_at = now()
   where id = p_user_id;

  return new_streak;
end;
$$;

grant execute on function public.bump_login_streak(uuid) to authenticated;
