-- Global, cross-canvas waypoint index. Waypoint cards themselves still live inside
-- workspaces.data.folders (the owner's canvas JSON, whether that's the creator's own workspace or
-- a canvas they merely have collaboration access to) — this table is just a searchable pointer to
-- every waypoint a given user has ever created, ANY of their own canvases or any canvas shared
-- with them, at any depth, so the hamburger Waypoints panel can list and jump to all of them
-- without having to have every canvas in the platform pre-loaded client-side (see
-- syncWaypointToDb/renderWaypointsList/goToWaypointCard in public/dotto-script.js).
--
-- Waypoints are private: only creator_id can ever see their own rows (plain RLS, no
-- SECURITY DEFINER needed for CRUD) — even the canvas owner can't see a collaborator's waypoints
-- through this table if they're not the creator.

create table if not exists public.waypoints (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  folder_id text not null,
  item_id text not null,
  name text not null default 'New Waypoint',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, folder_id, item_id)
);

create index if not exists waypoints_creator_id_idx on public.waypoints (creator_id);

alter table public.waypoints enable row level security;

create policy "Creator can view own waypoints" on public.waypoints
  for select using (creator_id = auth.uid());
create policy "Creator can insert own waypoints" on public.waypoints
  for insert with check (creator_id = auth.uid());
create policy "Creator can update own waypoints" on public.waypoints
  for update using (creator_id = auth.uid());
create policy "Creator can delete own waypoints" on public.waypoints
  for delete using (creator_id = auth.uid());

-- Keeps `updated_at` honest on rename (the client always upserts the whole row on create/rename —
-- see syncWaypointToDb — so this just saves it from having to pass updated_at itself).
create or replace function public.touch_waypoints_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_waypoints_touch_updated_at on public.waypoints;
create trigger trg_waypoints_touch_updated_at
  before update on public.waypoints
  for each row execute function public.touch_waypoints_updated_at();

-- Resolves the ordered chain of folder ids from the outer edge of the caller's granted access
-- down to (and including) p_folder_id, within p_owner_id's own folder tree — what
-- goToWaypointCard needs to walk into a waypoint that lives arbitrarily deep inside a canvas
-- someone else shared, level by level (via ensureSharedFolderLoaded for each id in the chain),
-- so the breadcrumb/"nearest parent" logic that already works for normal drill-in navigation
-- (findParentFolderId) also works correctly for a waypoint jumped-to directly instead of drilled
-- into by hand. Stops climbing as soon as it reaches the folder holding the nearest explicit
-- collaboration row for the caller (the boundary of what they were actually granted) — same
-- nearest-explicit-row walk as canvas_access_status, just also collecting the path instead of
-- only checking one folder.
create or replace function public.get_folder_ancestor_chain(
  p_owner_id uuid,
  p_folder_id text
)
returns text[]
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
  chain text[] := array[]::text[];
begin
  if public.canvas_access_status(p_owner_id, p_folder_id, auth.uid()) != 'granted' then
    raise exception 'get_folder_ancestor_chain: not authorized for this canvas';
  end if;

  select data -> 'folders' into ws_folders from public.workspaces where user_id = p_owner_id;
  if ws_folders is null then
    return chain;
  end if;

  loop
    chain := array_prepend(current_id, chain);
    if current_id = any(visited) then
      exit; -- cycle guard — shouldn't happen in a real tree, never loop forever
    end if;
    visited := visited || current_id;

    select status into row_status from public.canvas_collaborations
      where owner_id = p_owner_id and folder_id = current_id and collaborator_id = auth.uid();
    exit when row_status in ('accepted', 'revoked'); -- reached the boundary of the granted subtree

    parent_id := public.jsonb_folder_parent(ws_folders, current_id);
    exit when parent_id is null;
    current_id := parent_id;
  end loop;

  return chain; -- outermost accessible ancestor first, p_folder_id itself last
end;
$$;

grant execute on function public.get_folder_ancestor_chain(uuid, text) to authenticated;
