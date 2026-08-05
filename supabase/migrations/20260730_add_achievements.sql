-- Achievement system backing the profile panel's spritebook (see SPRITE_UNLOCKED_COUNT /
-- renderSpriteGrid in public/dotto-script.js) — each of the 8 currently-unlocked sprite slots
-- maps to one achievement, tracked via a generic stat-counter + threshold-crossing RPC rather
-- than one bespoke column/RPC per achievement.
--
-- Mirrors the existing award_user_points / bump_login_streak pattern (see
-- 20260724_add_leveling_system.sql, 20260725_add_login_streak.sql): SECURITY DEFINER RPC that
-- defensively checks p_user_id against auth.uid() so clients never need direct write grants on
-- these tables.

create table if not exists public.user_stat_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  stat_key text not null,
  count bigint not null default 0,
  primary key (user_id, stat_key)
);

alter table public.user_stat_counters
  add constraint user_stat_counters_count_non_negative check (count >= 0);

alter table public.user_stat_counters enable row level security;

drop policy if exists "users can read their own stat counters" on public.user_stat_counters;
create policy "users can read their own stat counters"
  on public.user_stat_counters for select
  using (auth.uid() = user_id);

create table if not exists public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

alter table public.user_achievements enable row level security;

drop policy if exists "users can read their own achievements" on public.user_achievements;
create policy "users can read their own achievements"
  on public.user_achievements for select
  using (auth.uid() = user_id);

-- Bumps a single named stat counter for p_user_id and, if this crosses p_threshold for the first
-- time, records the achievement unlock. Two update modes on the counter itself:
--   - default (p_absolute = false): count = count + p_delta — for stats that are naturally an
--     incrementing tally of events (blocks placed, AI searches, flashcard flips, ...).
--   - p_absolute = true: count = greatest(count, p_delta) — for stats where the caller already
--     knows their own true current total (e.g. friends.length, which is symmetric regardless of
--     who sent/accepted the request) and just wants to sync it in, never regressing it.
-- newly_unlocked relies on plpgsql's FOUND after INSERT ... ON CONFLICT DO NOTHING (true only when
-- a row was actually inserted), so the unlock check is atomic and idempotent without a separate
-- existence lookup — same trick as elsewhere in this migration set would use if it needed it.
create or replace function public.bump_achievement_stat(
  p_user_id uuid,
  p_stat_key text,
  p_achievement_id text,
  p_threshold bigint,
  p_delta bigint default 1,
  p_absolute boolean default false
)
returns table(new_count bigint, newly_unlocked boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
  v_unlocked boolean := false;
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'bump_achievement_stat: p_user_id must match the authenticated caller';
  end if;

  insert into public.user_stat_counters (user_id, stat_key, count)
  values (p_user_id, p_stat_key, p_delta)
  on conflict (user_id, stat_key) do update
    set count = case when p_absolute
      then greatest(public.user_stat_counters.count, excluded.count)
      else public.user_stat_counters.count + excluded.count
    end
  returning count into v_count;

  if v_count >= p_threshold then
    insert into public.user_achievements (user_id, achievement_id)
    values (p_user_id, p_achievement_id)
    on conflict (user_id, achievement_id) do nothing;
    v_unlocked := found;
  end if;

  new_count := v_count;
  newly_unlocked := v_unlocked;
  return next;
end;
$$;

grant execute on function public.bump_achievement_stat(uuid, text, text, bigint, bigint, boolean) to authenticated;
