-- Rename the existing daily pool to "search" credits and widen its reset column to
-- timestamptz so it can support a 6-hourly (not just daily) reset cadence.
ALTER TABLE profiles RENAME COLUMN credits_remaining TO search_credits_remaining;
ALTER TABLE profiles ALTER COLUMN credits_reset_at TYPE timestamptz USING credits_reset_at::timestamptz;
ALTER TABLE profiles RENAME COLUMN credits_reset_at TO search_credits_reset_at;
ALTER TABLE profiles ALTER COLUMN search_credits_reset_at SET DEFAULT now();

-- New separate pool for image + mnemonic generation, resets monthly.
ALTER TABLE profiles ADD COLUMN generation_credits_remaining integer NOT NULL DEFAULT 100;
ALTER TABLE profiles ADD COLUMN generation_credits_reset_at timestamptz NOT NULL DEFAULT now();

-- New profile level (no earning mechanic yet — just a display field, defaults to 1).
ALTER TABLE profiles ADD COLUMN level_number integer NOT NULL DEFAULT 1;

-- Rename + rework the daily RPC into a 6-hourly one.
CREATE OR REPLACE FUNCTION public.deduct_search_credits(p_amount integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_remaining integer;
  v_reset_at timestamptz;
begin
  if v_user_id is null then
    return false;
  end if;

  select search_credits_remaining, search_credits_reset_at into v_remaining, v_reset_at
  from public.profiles
  where id = v_user_id
  for update;

  if v_reset_at < now() - interval '6 hours' then
    v_remaining := 30;
    v_reset_at := now();
  end if;

  if v_remaining < p_amount then
    update public.profiles set search_credits_remaining = v_remaining, search_credits_reset_at = v_reset_at where id = v_user_id;
    return false;
  end if;

  update public.profiles
  set search_credits_remaining = v_remaining - p_amount, search_credits_reset_at = v_reset_at
  where id = v_user_id;

  return true;
end;
$function$;

DROP FUNCTION IF EXISTS public.deduct_dotbot_credits(integer);

-- New RPC for the monthly generation pool, same shape.
CREATE OR REPLACE FUNCTION public.deduct_generation_credits(p_amount integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_remaining integer;
  v_reset_at timestamptz;
begin
  if v_user_id is null then
    return false;
  end if;

  select generation_credits_remaining, generation_credits_reset_at into v_remaining, v_reset_at
  from public.profiles
  where id = v_user_id
  for update;

  if v_reset_at < now() - interval '1 month' then
    v_remaining := 100;
    v_reset_at := now();
  end if;

  if v_remaining < p_amount then
    update public.profiles set generation_credits_remaining = v_remaining, generation_credits_reset_at = v_reset_at where id = v_user_id;
    return false;
  end if;

  update public.profiles
  set generation_credits_remaining = v_remaining - p_amount, generation_credits_reset_at = v_reset_at
  where id = v_user_id;

  return true;
end;
$function$;
