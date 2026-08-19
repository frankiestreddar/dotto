-- append_dotbot_turn's two inserts (user turn, then assistant turn) both defaulted created_at to
-- now(), which in Postgres is frozen at transaction start — so both rows in a turn got an
-- IDENTICAL created_at. loadConversationHistory (app/api/dotbot/orchestrate/route.js) orders
-- history strictly by created_at with no tiebreaker, so a tied pair could come back as
-- [assistant, user] instead of [user, assistant], breaking the strict user/assistant alternation
-- sent to Groq. clock_timestamp() (unlike now()) advances within a transaction, so setting it
-- explicitly on each insert guarantees the user row's created_at is strictly earlier than the
-- assistant row's.

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

  insert into public.dotbot_messages (conversation_id, owner_id, role, content, created_at)
  values (v_conversation_id, auth.uid(), 'user', p_user_content, clock_timestamp());

  insert into public.dotbot_messages (conversation_id, owner_id, role, content, created_at)
  values (v_conversation_id, auth.uid(), 'assistant', p_assistant_content, clock_timestamp());

  return v_conversation_id;
end;
$$;
