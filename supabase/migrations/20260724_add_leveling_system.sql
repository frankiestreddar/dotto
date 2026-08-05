-- 20-tier / 9-sub-rank (180 total sub-level) leveling system.
--
-- IMPORTANT: run this migration BEFORE deploying the app code that reads/writes
-- `profiles.total_score` (app/page.js, lib/leveling.js, public/dotto-script.js) — that code
-- selects `total_score` in the same query as every other profile field, and Postgrest fails an
-- entire `.select()` (not just the missing column) when one of the requested columns doesn't
-- exist, which would silently degrade username/avatar/display-name display for every user until
-- this is applied.
--
-- Supersedes the old flat `profiles.level_number` column, which is left in place (untouched,
-- still readable) but is no longer written or displayed by the app — total_score is now the sole
-- source of truth for a user's level. Drop level_number later if you're sure nothing else depends
-- on it.

alter table public.profiles
  add column if not exists total_score integer not null default 0;

alter table public.profiles
  add constraint profiles_total_score_non_negative check (total_score >= 0);

-- Nullable: a user who has never received the daily bonus has no last-award time yet.
alter table public.profiles
  add column if not exists last_daily_bonus_at timestamptz;

-- Append-only log of every point award — gives `p_action_type` an actual purpose (auditing,
-- future "recent activity" UI, abuse investigation) beyond just being summed into total_score.
create table if not exists public.user_point_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null,
  points integer not null,
  created_at timestamptz not null default now()
);

alter table public.user_point_events enable row level security;

drop policy if exists "users can read their own point events" on public.user_point_events;
create policy "users can read their own point events"
  on public.user_point_events for select
  using (auth.uid() = user_id);

-- Atomically increments a user's total_score and logs the event. SECURITY DEFINER, mirroring the
-- existing deduct_search_credits/deduct_generation_credits RPCs (see lib/dotbot.js) so clients
-- never need direct UPDATE grants on profiles — but unlike those two (which act implicitly on
-- auth.uid() with no id parameter), this one's requested signature takes an explicit p_user_id,
-- so it defensively CHECKS that p_user_id matches the authenticated caller rather than trusting
-- it blindly. Without that check, any authenticated client could award points to an arbitrary
-- other account by just passing a different id.
create or replace function public.award_user_points(
  p_user_id uuid,
  p_action_type text,
  p_points integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total integer;
begin
  if p_points <= 0 then
    raise exception 'award_user_points: p_points must be positive (got %)', p_points;
  end if;

  if p_user_id is distinct from auth.uid() then
    raise exception 'award_user_points: p_user_id must match the authenticated caller';
  end if;

  update public.profiles
     set total_score = total_score + p_points
   where id = p_user_id
   returning total_score into new_total;

  if new_total is null then
    raise exception 'award_user_points: no profile found for user %', p_user_id;
  end if;

  insert into public.user_point_events (user_id, action_type, points)
  values (p_user_id, p_action_type, p_points);

  return new_total;
end;
$$;

grant execute on function public.award_user_points(uuid, text, integer) to authenticated;

-- Idempotent per rolling 20-hour window (a little under 24h so a slightly-early next-day visit
-- still counts, matching the lazy-reset style already used for search/generation credits) —
-- returns the new total_score if the bonus was actually awarded, or null if it's not time yet.
-- Same p_user_id-must-match-auth.uid() defense as award_user_points above.
create or replace function public.award_daily_login_bonus(
  p_user_id uuid,
  p_points integer default 20
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total integer;
  last_bonus timestamptz;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'award_daily_login_bonus: p_user_id must match the authenticated caller';
  end if;

  select last_daily_bonus_at into last_bonus from public.profiles where id = p_user_id;
  if last_bonus is not null and last_bonus > now() - interval '20 hours' then
    return null; -- already claimed within this window
  end if;

  update public.profiles
     set total_score = total_score + p_points,
         last_daily_bonus_at = now()
   where id = p_user_id
   returning total_score into new_total;

  insert into public.user_point_events (user_id, action_type, points)
  values (p_user_id, 'daily_login', p_points);

  return new_total;
end;
$$;

grant execute on function public.award_daily_login_bonus(uuid, integer) to authenticated;
