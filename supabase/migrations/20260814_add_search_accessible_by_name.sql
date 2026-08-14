-- Nested shared-tree name search for the slash-command feature (see command-target-lookup.js's
-- resolveCommandTarget) — "/canvas <name>" needs to find a match not just among canvases you were
-- DIRECTLY invited to, but anywhere in the entire tree you have effective (possibly multi-level
-- inherited) access to, same depth canvas_access_status already grants navigation-wise. There's
-- no cached title anywhere for a nested item you were never directly invited to, so this has to
-- actually walk each owner's jsonb tree, not just query canvas_collaborations rows.
--
-- Your OWN tree is deliberately NOT searched here — it's already loaded client-side in
-- appState.folders, searched locally (see command-target-lookup.js's searchOwnTreeByNameAll), no
-- round trip needed. This only covers the "shared with me" half.
--
-- Iterative stack-walk (not a recursive CTE) — same style jsonb_folder_parent/canvas_access_status
-- already use (20260727_add_nested_canvas_sharing.sql) for walking this same tree shape, for
-- consistency. One caller-visible row per matching (owner, folder) pair, capped by the client
-- (see command-target-lookup.js) the same way every other live-suggestions list already is.
create or replace function public.search_accessible_by_name(p_query text)
returns table(owner_id uuid, folder_id text, kind text, title text, global_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  root record;
  ws_folders jsonb;
  stack text[];
  current_id text;
  folder_data jsonb;
  item jsonb;
  child_id text;
  -- Defensive cap, not an expected limit — real trees are nowhere near this size. Genuine cycles
  -- shouldn't exist (folders are only ever created pointing at brand-new ids, never back at an
  -- ancestor), but this bounds the walk regardless of any future data shape this can't predict,
  -- rather than trusting that invariant to hold forever.
  visits_remaining int := 5000;
begin
  -- Every distinct (owner, folder) this caller was ever directly invited to and still has an
  -- accepted row for is its own search root — nested children below it inherit access per
  -- canvas_access_status, walked explicitly below rather than re-called per node (that RPC reads
  -- canvas_collaborations itself on every call; since we're already iterating this owner's own
  -- collaboration rows here, checking them directly in-memory is cheaper for a tree walk this size).
  for root in
    select distinct cc.owner_id, cc.folder_id as root_folder_id
    from public.canvas_collaborations cc
    where cc.collaborator_id = auth.uid() and cc.status = 'accepted'
  loop
    select data -> 'folders' into ws_folders from public.workspaces where user_id = root.owner_id;
    continue when ws_folders is null;

    stack := array[root.root_folder_id];
    while array_length(stack, 1) > 0 and visits_remaining > 0 loop
      visits_remaining := visits_remaining - 1;
      current_id := stack[array_upper(stack, 1)];
      stack := stack[1:array_upper(stack, 1) - 1];
      folder_data := ws_folders -> current_id;
      continue when folder_data is null;

      if (folder_data ->> 'title') ilike '%' || p_query || '%' then
        return query
          select root.owner_id, current_id,
                 case when (folder_data ->> 'isSource')::boolean then 'source' else 'canvas' end,
                 coalesce(folder_data ->> 'title', ''),
                 gi.global_id
          from public.global_items gi
          where gi.owner_id = root.owner_id and gi.folder_id = current_id;
      end if;

      for item in select * from jsonb_array_elements(coalesce(folder_data -> 'items', '[]'::jsonb)) loop
        if (item ->> 'kind') in ('folder', 'source') then
          child_id := item ->> 'folderId';
          -- Only descend where this caller isn't explicitly revoked at (or below) this point —
          -- canvas_access_status's own "nearest explicit row wins" rule means a revocation deeper
          -- in the tree than the invited root must still be respected here, not just at the root.
          if public.canvas_access_status(root.owner_id, child_id, auth.uid()) = 'granted' then
            stack := stack || child_id;
          end if;
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

grant execute on function public.search_accessible_by_name(text) to authenticated;
