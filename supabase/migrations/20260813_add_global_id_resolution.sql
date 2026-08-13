-- Global-id resolution + public-canvas access — the actual new security surface for the
-- slash-command feature (see 20260812_add_global_items.sql for the registry table this builds
-- on). Nothing before this migration lets anyone access a canvas/source without an explicit or
-- inherited canvas_collaborations row; resolve_global_id/get_public_folder below are what let an
-- owner-marked-public item be reached by anyone, by its exact id, with no collaboration row at
-- all — so both functions are deliberately conservative about what they reveal.

-- Single resolution point for every "/source|canvas <id>" lookup (own, shared, or public) — the
-- caller never queries global_items directly (its own RLS is owner-only, see the previous
-- migration), only through this. Returns nothing at all — not an error, not a "private" flag —
-- when the caller has no right to know the id exists: a private item that isn't the caller's own
-- and isn't shared with them behaves EXACTLY like an id that was never registered, so a command
-- error message built on this can't be used to probe whether a guessed id is real but private
-- (see the slash-command plan's own trade-offs section). canvas_access_status
-- (20260727_add_nested_canvas_sharing.sql) already does the "is there an accepted/inherited
-- collaboration" walk — reused directly, not re-implemented.
create or replace function public.resolve_global_id(p_global_id text)
returns table(owner_id uuid, folder_id text, kind text, title text, visibility text, access text)
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  a text;
begin
  select * into g from public.global_items where global_id = p_global_id;
  if g is null then
    return;
  end if;

  if g.owner_id = auth.uid() then
    a := 'owner';
  elsif g.visibility = 'public' then
    a := 'public';
  elsif public.canvas_access_status(g.owner_id, g.folder_id, auth.uid()) = 'granted' then
    a := 'collaborator';
  else
    return; -- private, not the caller's, not shared with them — indistinguishable from "no such id"
  end if;

  return query
    select g.owner_id, g.folder_id, g.kind, g.title, g.visibility, a;
end;
$$;

grant execute on function public.resolve_global_id(text) to authenticated;

-- Read-only fetch for a PUBLIC canvas/source, by (owner_id, folder_id) — a direct sibling of
-- get_shared_folder (20260726_add_canvas_collaboration.sql), gated on global_items.visibility
-- instead of an accepted collaboration row. Deliberately has NO update_public_folder
-- counterpart at all: "obtain" on a public item is a one-off, view-only read with no lasting
-- grant or record created anywhere (per the feature spec) — there is nothing to ever write back.
-- Note this checks visibility fresh on every call, not once at some earlier "you obtained this"
-- moment — an owner flipping something back to private takes effect immediately for anyone
-- trying to fetch it afterward, including someone who successfully viewed it a moment ago.
create or replace function public.get_public_folder(p_owner_id uuid, p_folder_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  folder_data jsonb;
begin
  if not exists (
    select 1 from public.global_items
    where owner_id = p_owner_id and folder_id = p_folder_id and visibility = 'public'
  ) then
    raise exception 'get_public_folder: not public';
  end if;

  select data -> 'folders' -> p_folder_id into folder_data
    from public.workspaces where user_id = p_owner_id;

  if folder_data is not null then
    folder_data := folder_data - 'collaborators';
  end if;

  return folder_data;
end;
$$;

grant execute on function public.get_public_folder(uuid, text) to authenticated;
