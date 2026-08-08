-- sendCanvasCollabInvite (public/dotto/friends-presence.js) did a raw INSERT into
-- canvas_collaborations with no conflict handling, so re-inviting someone whose invite had
-- already reached a terminal state (declined, or removed via revoke_canvas_collaboration, which
-- sets status='revoked') hit the table's own (owner_id, folder_id, collaborator_id) unique
-- constraint and failed outright -- "[collab] failed to send canvas collaboration invite: {}" in
-- the console, with no client-side recovery path. revoke_canvas_collaboration
-- (20260727_add_nested_canvas_sharing.sql) already solved the identical problem for its own
-- direction with insert ... on conflict ... do update; this does the same for invites.
--
-- The `where status <> 'accepted'` guard on the update branch is defensive: the client UI never
-- offers an "Add" button for someone already accepted (it shows "Remove" instead), but if a stale
-- client somehow called this for an already-accepted collaborator, this keeps their access intact
-- instead of silently downgrading it back to pending.

create or replace function public.invite_canvas_collaborator(
  p_folder_id text,
  p_folder_title text,
  p_collaborator_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.canvas_collaborations (owner_id, folder_id, folder_title, collaborator_id, status, responded_at)
  values (auth.uid(), p_folder_id, coalesce(p_folder_title, ''), p_collaborator_id, 'pending', null)
  on conflict (owner_id, folder_id, collaborator_id)
  do update set status = 'pending', folder_title = excluded.folder_title, responded_at = null
  where public.canvas_collaborations.status <> 'accepted';
end;
$$;

grant execute on function public.invite_canvas_collaborator(text, text, uuid) to authenticated;
