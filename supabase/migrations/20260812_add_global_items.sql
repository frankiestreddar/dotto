-- Global canvas/source ids: a lightweight registry mapping a short, human-typeable id (unique
-- across every user, not just within one) to a specific canvas or source, for the new
-- slash-command system (look up/share something by id) and its faint on-card display.
--
-- Same shape as canvas_collaborations (20260726_add_canvas_collaboration.sql): canvases aren't
-- their own database rows in this app, they live as JSON in workspaces.data.folders keyed by a
-- folder id that's only unique within one owner's own id sequence — so this table is metadata
-- only (a pointer + visibility flag), the real content stays exactly where it already lives. A
-- stable reference to "this specific canvas" is always (owner_id, folder_id) together, same
-- convention as every other collaboration function.
--
-- global_id itself is generated CLIENT-SIDE (see global-ids.js) — the app's canvas/source
-- creation is fully synchronous/offline-friendly today, and requiring a server round trip for
-- every single card creation would be a real behavior change. The client only needs collisions to
-- be rare, not impossible: this table's primary key is the actual correctness guarantee, and a
-- client-generated id is never treated as authoritative anywhere else until it's successfully
-- registered here.
--
-- visibility starts 'private' for everything — nothing here is reachable by anyone but the owner
-- (and, transitively, an accepted/inherited collaborator via canvas_access_status, checked by
-- functions added in a later migration) until the owner explicitly flips it to 'public'. RLS on
-- this table itself is owner-only in every direction — no other user, public or collaborator, is
-- ever allowed to read a row directly; every other case is served through a SECURITY DEFINER
-- function (added alongside the public-access feature) that decides what it's safe to reveal,
-- same "raise/return nothing rather than leak" posture get_shared_folder already uses.

create table if not exists public.global_items (
  global_id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id text not null,
  kind text not null check (kind in ('canvas', 'source')),
  -- Snapshot of the title, same staleness tradeoff canvas_collaborations.folder_title already
  -- accepts — refreshed opportunistically on every register call, not kept perfectly live.
  title text not null default '',
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, folder_id)
);

create index if not exists global_items_owner_idx on public.global_items (owner_id);

alter table public.global_items enable row level security;

drop policy if exists "owner can select own global items" on public.global_items;
create policy "owner can select own global items"
  on public.global_items for select
  using (auth.uid() = owner_id);

drop policy if exists "owner can insert own global items" on public.global_items;
create policy "owner can insert own global items"
  on public.global_items for insert
  with check (auth.uid() = owner_id);

drop policy if exists "owner can update own global items" on public.global_items;
create policy "owner can update own global items"
  on public.global_items for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "owner can delete own global items" on public.global_items;
create policy "owner can delete own global items"
  on public.global_items for delete
  using (auth.uid() = owner_id);

-- Batched, not one-row-per-call — the client's lazy registration runs on every workspace
-- autosave (see saveWorkspaceNow, history-autosave.js), so a workspace with many canvases/sources
-- would otherwise mean many round trips per save. p_items is a JSON array of
-- {global_id, folder_id, kind, title}; every row is upserted on (owner_id, folder_id), owner
-- implicit via auth.uid() (same pattern as revoke_canvas_collaboration,
-- 20260727_add_nested_canvas_sharing.sql). A conflict on the global_id primary key itself (a
-- genuine cross-owner or cross-device collision, not the expected (owner_id, folder_id) upsert
-- path) is left to raise and abort the whole batch — the client's own retry-with-a-fresh-id path
-- handles that on the next save cycle, see global-ids.js's own comment.
create or replace function public.register_global_items(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
begin
  for item in select * from jsonb_array_elements(p_items) loop
    insert into public.global_items (global_id, owner_id, folder_id, kind, title)
    values (item ->> 'global_id', auth.uid(), item ->> 'folder_id', item ->> 'kind', coalesce(item ->> 'title', ''))
    on conflict (owner_id, folder_id) do update
      set title = excluded.title, updated_at = now();
  end loop;
end;
$$;

grant execute on function public.register_global_items(jsonb) to authenticated;

-- Backs the future "set public"/"set private" commands (not wired to any UI yet — this migration
-- only lays the table/column down, see the slash-command feature's own PR sequencing).
create or replace function public.set_global_item_visibility(p_folder_id text, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_visibility not in ('private', 'public') then
    raise exception 'set_global_item_visibility: invalid visibility %', p_visibility;
  end if;

  update public.global_items
     set visibility = p_visibility, updated_at = now()
   where owner_id = auth.uid() and folder_id = p_folder_id;

  if not found then
    raise exception 'set_global_item_visibility: no global item registered for this folder yet';
  end if;
end;
$$;

grant execute on function public.set_global_item_visibility(text, text) to authenticated;
