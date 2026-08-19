-- Persisted multi-turn Dotbot AI chat history — backs the search palette's new chat-thread mode
-- (a conversation of user/assistant turns shown above the search bar, continuable with follow-ups,
-- and reopenable later from the sidebar's "Chats" panel). Distinct from public.messages, which is
-- an unrelated friend-DM table.
--
-- Reads are plain client-side `.from()` selects under RLS (select-only), same convention as
-- public.waypoints — no RPC needed to list a user's own conversations or replay one's messages.
-- Writes are NOT exposed to the client at all: both the user's turn and the assistant's response
-- are inserted together, server-side, by append_dotbot_turn (called from
-- app/api/dotbot/orchestrate/route.js right after a successful AI response and credit spend), so
-- one exchange is one atomic-ish server-side unit — mirrors the SECURITY DEFINER RPC convention
-- used for deduct_search_credits/bump_achievement_stat/award_user_points rather than the direct-
-- client-write convention waypoints uses, since this needs to happen alongside credit accounting,
-- not as an independent client action.

create table if not exists public.dotbot_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dotbot_conversations_owner_updated_idx
  on public.dotbot_conversations (owner_id, updated_at desc);

alter table public.dotbot_conversations enable row level security;

drop policy if exists "owner can read own conversations" on public.dotbot_conversations;
create policy "owner can read own conversations"
  on public.dotbot_conversations for select
  using (owner_id = auth.uid());

-- owner_id is denormalized onto messages too (not just reachable via a join through
-- conversation_id) so this table's own RLS check stays a flat, fast owner_id = auth.uid() —
-- same simplicity convention seen elsewhere rather than requiring a join in the policy itself.
create table if not exists public.dotbot_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dotbot_conversations(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists dotbot_messages_conversation_created_idx
  on public.dotbot_messages (conversation_id, created_at);

alter table public.dotbot_messages enable row level security;

drop policy if exists "owner can read own messages" on public.dotbot_messages;
create policy "owner can read own messages"
  on public.dotbot_messages for select
  using (owner_id = auth.uid());

-- Inserts one user turn + one assistant turn as a pair, creating a new conversation first when
-- p_conversation_id is null. Always acts as auth.uid() — never a client-supplied owner id, so
-- there's no p_user_id to validate (unlike bump_achievement_stat's pattern, which does take one
-- since it can be called for stats not solely tied to the caller's own session — this RPC has no
-- such case). p_title is only actually applied on a brand-new conversation, or defensively if an
-- existing one's title is somehow still null; an existing conversation's real title is otherwise
-- left alone. Returns the conversation id either way, so the client can carry it forward for the
-- next follow-up in the same thread.
create or replace function public.append_dotbot_turn(
  p_conversation_id uuid,
  p_title text,
  p_user_content jsonb,
  p_assistant_content jsonb
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
    insert into public.dotbot_conversations (owner_id, title)
    values (auth.uid(), p_title)
    returning id into v_conversation_id;
  else
    v_conversation_id := p_conversation_id;
    update public.dotbot_conversations
      set updated_at = now(),
          title = coalesce(title, p_title)
      where id = v_conversation_id and owner_id = auth.uid();
    if not found then
      raise exception 'append_dotbot_turn: conversation not found or not owned by caller';
    end if;
  end if;

  insert into public.dotbot_messages (conversation_id, owner_id, role, content)
  values (v_conversation_id, auth.uid(), 'user', p_user_content);

  insert into public.dotbot_messages (conversation_id, owner_id, role, content)
  values (v_conversation_id, auth.uid(), 'assistant', p_assistant_content);

  return v_conversation_id;
end;
$$;

grant execute on function public.append_dotbot_turn(uuid, text, jsonb, jsonb) to authenticated;
