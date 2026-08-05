-- Keeps canvas_collaborations.folder_title in sync when the underlying canvas is renamed.
-- That column was an intentional invite-time snapshot ("can go stale if the owner renames the
-- canvas later, which is an accepted, low-stakes tradeoff here" — see its own comment in
-- 20260726_add_canvas_collaboration.sql). Per product feedback that staleness is no longer
-- acceptable: the Collaborations panel (both the owner's own list and every collaborator's)
-- should always show the canvas's current name.
--
-- SECURITY DEFINER rather than a plain RLS UPDATE policy because a rename can come from either
-- side: the owner renaming their own canvas, or a collaborator renaming a shared canvas they have
-- edit access to (the breadcrumb rename flow in public/dotto-script.js is the same code path for
-- both — it doesn't distinguish who's viewing). A collaborator has no row of their own to satisfy
-- a normal "auth.uid() = owner_id" RLS check with, so this reuses the same canvas_access_status()
-- tree-walk that update_shared_folder/get_shared_folder already rely on to authorize a
-- collaborator's edits to a shared canvas (see 20260727_add_nested_canvas_sharing.sql).
create or replace function public.rename_canvas_collaborations(
  p_owner_id uuid,
  p_folder_id text,
  p_new_title text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() != p_owner_id
     and public.canvas_access_status(p_owner_id, p_folder_id, auth.uid()) != 'granted' then
    raise exception 'rename_canvas_collaborations: not authorized for this canvas';
  end if;

  update public.canvas_collaborations
     set folder_title = p_new_title
   where owner_id = p_owner_id and folder_id = p_folder_id;
end;
$$;

grant execute on function public.rename_canvas_collaborations(uuid, text, text) to authenticated;
