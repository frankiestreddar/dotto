-- Extends 20260726_add_canvas_collaboration.sql: a canvas/source nested inside a shared canvas is
-- now ALSO shared with the same collaborator, without a separate invite — access is checked by
-- walking UP the owner's folder tree from the target folder toward the root, and the NEAREST
-- explicit row found for that collaborator (at the target folder itself, or at whichever
-- ancestor is closest) wins, whether it's an acceptance or an explicit revocation. That's what
-- lets an owner explicitly remove someone from one nested canvas without affecting their
-- (inherited) access to the rest of the shared tree — see revoke_canvas_collaboration.

alter table public.canvas_collaborations
  drop constraint if exists canvas_collaborations_status_check;
alter table public.canvas_collaborations
  add constraint canvas_collaborations_status_check
  check (status in ('pending', 'accepted', 'declined', 'revoked'));

-- Given one owner's full folders tree (workspaces.data->'folders') and a folder id, finds the id
-- of whichever OTHER folder in that same tree contains an item (kind 'folder' or 'source')
-- pointing at it — the same reverse lookup findParentFolderId does client-side (see
-- public/dotto-script.js), just walking jsonb instead of the live in-memory object. Returns null
-- if nothing references it (it's that tree's own root, or orphaned).
create or replace function public.jsonb_folder_parent(
  p_folders jsonb,
  p_folder_id text
)
returns text
language plpgsql
as $$
declare
  folder_rec record;
  item jsonb;
begin
  for folder_rec in select * from jsonb_each(p_folders) as t(key, value)
  loop
    for item in select * from jsonb_array_elements(coalesce(folder_rec.value -> 'items', '[]'::jsonb))
    loop
      if (item ->> 'kind') in ('folder', 'source') and (item ->> 'folderId') = p_folder_id then
        return folder_rec.key;
      end if;
    end loop;
  end loop;
  return null;
end;
$$;

-- 'granted' or 'denied' for whether p_collaborator_id can access p_folder_id, walking from it up
-- toward the root of p_owner_id's tree. The nearest explicit row (accepted or revoked) found
-- along that walk decides it; folders further up with no row of their own are transparent
-- (inherit whatever their nearest-explicit-row descendant/ancestor resolves to). No row anywhere
-- in the chain = denied. Internal helper (used by get_shared_folder/update_shared_folder/
-- get_effective_collaborators below) — not exposed directly to clients.
create or replace function public.canvas_access_status(
  p_owner_id uuid,
  p_folder_id text,
  p_collaborator_id uuid
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_folders jsonb;
  current_id text := p_folder_id;
  visited text[] := array[]::text[];
  row_status text;
  parent_id text;
begin
  select data -> 'folders' into ws_folders from public.workspaces where user_id = p_owner_id;
  if ws_folders is null then
    return 'denied';
  end if;

  loop
    if current_id = any(visited) then
      return 'denied'; -- cycle guard — shouldn't happen in a real tree, never loop forever
    end if;
    visited := visited || current_id;

    select status into row_status from public.canvas_collaborations
      where owner_id = p_owner_id and folder_id = current_id and collaborator_id = p_collaborator_id;

    if row_status = 'revoked' then
      return 'denied';
    end if;
    if row_status = 'accepted' then
      return 'granted';
    end if;

    parent_id := public.jsonb_folder_parent(ws_folders, current_id);
    if parent_id is null then
      return 'denied'; -- reached the top of the tree with no grant anywhere in the chain
    end if;
    current_id := parent_id;
  end loop;
end;
$$;

grant execute on function public.canvas_access_status(uuid, text, uuid) to authenticated;

-- Every collaborator with EFFECTIVE (possibly inherited) access to p_folder_id, for the
-- per-canvas collaborator panel/pill (see the caller-side comment) — same nearest-explicit-row-
-- wins walk as canvas_access_status, just collecting every collaborator instead of checking one.
-- Callable by the owner (managing their own tree) OR anyone who already has granted access to
-- this folder themselves (so a collaborator can see their fellow collaborators, matching the
-- collab bubble already being visible to anyone viewing a shared canvas, not just its owner).
create or replace function public.get_effective_collaborators(
  p_owner_id uuid,
  p_folder_id text
)
returns table(collaborator_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  ws_folders jsonb;
  current_id text := p_folder_id;
  visited_folders text[] := array[]::text[];
  resolved_ids uuid[] := array[]::uuid[]; -- collaborators whose nearest explicit row has already been found — never re-examined further up
  result_ids uuid[] := array[]::uuid[];
  parent_id text;
  rec record;
begin
  if auth.uid() != p_owner_id and public.canvas_access_status(p_owner_id, p_folder_id, auth.uid()) != 'granted' then
    raise exception 'get_effective_collaborators: not authorized for this canvas';
  end if;

  select data -> 'folders' into ws_folders from public.workspaces where user_id = p_owner_id;
  if ws_folders is null then
    return;
  end if;

  loop
    if current_id = any(visited_folders) then
      exit;
    end if;
    visited_folders := visited_folders || current_id;

    for rec in
      select cc.collaborator_id, cc.status from public.canvas_collaborations cc
      where cc.owner_id = p_owner_id and cc.folder_id = current_id
        and cc.status in ('accepted', 'revoked')
        and not (cc.collaborator_id = any(resolved_ids))
    loop
      resolved_ids := resolved_ids || rec.collaborator_id;
      if rec.status = 'accepted' then
        result_ids := result_ids || rec.collaborator_id;
      end if;
    end loop;

    parent_id := public.jsonb_folder_parent(ws_folders, current_id);
    exit when parent_id is null;
    current_id := parent_id;
  end loop;

  return query select distinct unnest(result_ids);
end;
$$;

grant execute on function public.get_effective_collaborators(uuid, text) to authenticated;

-- Explicitly blocks one collaborator from one specific folder — even if their access there is
-- only inherited from an ancestor's grant, not a direct invite at this exact folder (see
-- canvas_access_status: the nearest explicit row wins, so this creates/overwrites the row at
-- p_folder_id itself, which then shadows any grant further up for just this one subtree).
-- Owner-only implicitly, via auth.uid() rather than a p_owner_id parameter — you can only revoke
-- access to your own canvases.
create or replace function public.revoke_canvas_collaboration(
  p_folder_id text,
  p_collaborator_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text;
begin
  select data -> 'folders' -> p_folder_id ->> 'title' into v_title
    from public.workspaces where user_id = auth.uid();

  insert into public.canvas_collaborations (owner_id, folder_id, folder_title, collaborator_id, status, responded_at)
  values (auth.uid(), p_folder_id, coalesce(v_title, ''), p_collaborator_id, 'revoked', now())
  on conflict (owner_id, folder_id, collaborator_id)
  do update set status = 'revoked', responded_at = now();
end;
$$;

grant execute on function public.revoke_canvas_collaboration(text, uuid) to authenticated;

-- get_shared_folder/update_shared_folder (20260726) now check inherited access via
-- canvas_access_status instead of an exact-row match, so a nested canvas/source works the same
-- way for a collaborator as the one they were actually invited to.
create or replace function public.get_shared_folder(
  p_owner_id uuid,
  p_folder_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  folder_data jsonb;
begin
  if public.canvas_access_status(p_owner_id, p_folder_id, auth.uid()) != 'granted' then
    raise exception 'get_shared_folder: no accepted collaboration covers this canvas';
  end if;

  select data -> 'folders' -> p_folder_id into folder_data
    from public.workspaces where user_id = p_owner_id;

  if folder_data is not null then
    folder_data := folder_data - 'collaborators';
  end if;

  return folder_data;
end;
$$;

create or replace function public.update_shared_folder(
  p_owner_id uuid,
  p_folder_id text,
  p_new_folder_data jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sanitized jsonb;
begin
  if public.canvas_access_status(p_owner_id, p_folder_id, auth.uid()) != 'granted' then
    raise exception 'update_shared_folder: no accepted collaboration covers this canvas';
  end if;

  sanitized := p_new_folder_data - 'collaborators';

  update public.workspaces
     set data = jsonb_set(data, array['folders', p_folder_id], sanitized, false)
   where user_id = p_owner_id;

  if not found then
    raise exception 'update_shared_folder: owner has no workspace row yet';
  end if;
end;
$$;
