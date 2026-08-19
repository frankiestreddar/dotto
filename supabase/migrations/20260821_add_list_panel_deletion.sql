-- Deletion RPCs for the hamburger-menu list panels (Chats, Waypoints, Collaborations). Waypoints
-- needs no new RPC here — "Creator can delete own waypoints" (20260729_add_waypoints_table.sql)
-- already permits a direct client-side delete of the waypoints table row under RLS; only new
-- client logic (deleteWaypointCardEverywhere) is needed for the actual canvas-card cleanup.
-- Owner-clears-all-collaborators reuses the existing deleteCanvasCollabsForFolder client function
-- + revoke_canvas_collaboration RPC as-is, just from a new call site — no new SQL needed for that
-- direction either.

-- Chats: one flexible RPC covers both single-delete and clear-all (null ids = clear all). RLS on
-- dotbot_conversations has select-only, no delete policy at all (see 20260819_add_dotbot_
-- conversations.sql's own header comment — writes are never exposed to the client directly), so
-- this needs a SECURITY DEFINER RPC, same convention as append_dotbot_turn. dotbot_messages.
-- conversation_id ... on delete cascade already handles message cleanup with no separate step.
create or replace function public.delete_dotbot_conversations(p_conversation_ids uuid[] default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.dotbot_conversations
  where owner_id = auth.uid()
    and (p_conversation_ids is null or id = any(p_conversation_ids));
end;
$$;

grant execute on function public.delete_dotbot_conversations(uuid[]) to authenticated;

-- Collaborations: the collaborator-side mirror of revoke_canvas_collaboration (which is the OWNER
-- removing a collaborator). A hard delete, not a 'revoked' status row -- revoke_canvas_collaboration
-- writes 'revoked' specifically so an OWNER can permanently block re-invites to one nested folder
-- even when access there was only inherited (see 20260727_add_nested_canvas_sharing.sql); that
-- bookkeeping doesn't apply to a collaborator voluntarily leaving their own top-level grant. There
-- was previously no delete/leave path at all for a collaborator's own row -- confirmed no DELETE
-- RLS policy exists for collaborator_id = auth.uid() on canvas_collaborations.
create or replace function public.leave_canvas_collaboration(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.canvas_collaborations where id = p_id and collaborator_id = auth.uid();
end;
$$;

grant execute on function public.leave_canvas_collaboration(bigint) to authenticated;
