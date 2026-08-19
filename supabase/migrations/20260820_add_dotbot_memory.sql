-- Dotbot two-tier memory: an in-conversation running summary (all plans), and a silent
-- cross-conversation memory of the user gated to pro/polyglot plans. Both ride along as optional
-- extra fields in the SAME orchestrate response (see app/api/dotbot/orchestrate/route.js) — no
-- second LLM call, since this codebase has no background-job infrastructure and Groq is already
-- documented as hitting its TPM cap on this endpoint.

alter table public.profiles
  add column if not exists plan text not null default 'free';

alter table public.profiles
  add constraint profiles_plan_valid check (plan in ('free', 'pro', 'polyglot'));

alter table public.profiles
  add column if not exists dotbot_memory text;

-- "plan" gets no write RPC at all — admin/billing-set only, directly in Supabase, since no real
-- billing/checkout exists anywhere in this codebase yet (see app/dotto/PricingOverlay.jsx's own
-- comment — upgrade CTAs just show a "coming soon" notification). "dotbot_memory" DOES need one:
-- there is no direct client-side `.from("profiles").update(...)` anywhere in this codebase, every
-- profile mutation goes through a SECURITY DEFINER RPC scoped to auth.uid(), same as
-- deduct_search_credits/award_user_points/bump_login_streak.
create or replace function public.update_dotbot_memory(p_memory text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles set dotbot_memory = p_memory where id = auth.uid();
end;
$$;

grant execute on function public.update_dotbot_memory(text) to authenticated;

alter table public.dotbot_conversations
  add column if not exists conversation_summary text;

-- CREATE OR REPLACE FUNCTION with a new trailing parameter does NOT replace a function of a
-- different arity in Postgres — it adds a second overload alongside the original 4-arg version,
-- which PostgREST can then fail to disambiguate between (PGRST203). Drop the 4-arg version
-- explicitly first. This migration and the app/api/dotbot/orchestrate/route.js change that starts
-- passing p_conversation_summary must land together (same deploy).
drop function if exists public.append_dotbot_turn(uuid, text, jsonb, jsonb);

create or replace function public.append_dotbot_turn(
  p_conversation_id uuid,
  p_title text,
  p_user_content jsonb,
  p_assistant_content jsonb,
  p_conversation_summary text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
begin
  if p_conversation_id is null then
    insert into public.dotbot_conversations (owner_id, title, conversation_summary)
    values (auth.uid(), p_title, p_conversation_summary)
    returning id into v_conversation_id;
  else
    v_conversation_id := p_conversation_id;
    update public.dotbot_conversations
      set updated_at = now(),
          title = coalesce(title, p_title),
          conversation_summary = coalesce(p_conversation_summary, conversation_summary)
      where id = v_conversation_id and owner_id = auth.uid();
    if not found then
      raise exception 'append_dotbot_turn: conversation not found or not owned by caller';
    end if;
  end if;

  insert into public.dotbot_messages (conversation_id, owner_id, role, content, created_at)
  values (v_conversation_id, auth.uid(), 'user', p_user_content, clock_timestamp());

  insert into public.dotbot_messages (conversation_id, owner_id, role, content, created_at)
  values (v_conversation_id, auth.uid(), 'assistant', p_assistant_content, clock_timestamp());

  return v_conversation_id;
end;
$$;

grant execute on function public.append_dotbot_turn(uuid, text, jsonb, jsonb, text) to authenticated;
