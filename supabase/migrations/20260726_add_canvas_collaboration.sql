-- Canvas-level collaboration: invite a friend to collaborate on a specific (non-root) canvas,
-- they accept/decline from the hamburger menu's Collaborations panel, and once accepted they can
-- open and edit that canvas live.
--
-- Canvases aren't their own database rows in this app — every user's entire canvas tree lives as
-- one big JSON blob in workspaces.data.folders, keyed by a folder id string that's only unique
-- WITHIN that one user's own id sequence (two different users can both have a 'folder-5'). So a
-- stable reference to "this specific canvas" is always the pair (owner_id, folder_id) together,
-- never folder_id alone — every policy/function below checks both.
--
-- Granting a collaborator broad access to the owner's whole `workspaces` row would leak the
-- owner's entire private canvas tree, not just the one shared folder — workspaces RLS is
-- untouched by this migration. Instead, get_shared_folder/update_shared_folder below are
-- SECURITY DEFINER functions that read/patch only the one JSON path
-- (data->'folders'->folder_id) for a canvas the caller has an accepted collaboration on, using
-- the same auth.uid()-gated pattern as the existing award_user_points/award_daily_login_bonus
-- functions (see 20260724_add_leveling_system.sql).
--
-- Scope note: a shared canvas's own direct content (cards, drawings) is fully live/editable by
-- both owner and collaborator. Any folder/source card NESTED inside it is NOT itself
-- transitively shared — it renders as a static preview only (same as any other read-only mini
-- card preview elsewhere in the app), not something the collaborator can drill into. Sharing a
-- nested canvas requires its own separate invite.

create table if not exists public.canvas_collaborations (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  folder_id text not null,
  -- Snapshot of the canvas's title at invite time, purely for display in the Requests/
  -- Collaborations lists without an extra round trip — can go stale if the owner renames the
  -- canvas later, which is an accepted, low-stakes tradeoff here.
  folder_title text not null default '',
  collaborator_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (owner_id, folder_id, collaborator_id)
);

alter table public.canvas_collaborations enable row level security;

drop policy if exists "owners can view their canvas collaborations" on public.canvas_collaborations;
create policy "owners can view their canvas collaborations"
  on public.canvas_collaborations for select
  using (auth.uid() = owner_id);

drop policy if exists "collaborators can view their own collaboration rows" on public.canvas_collaborations;
create policy "collaborators can view their own collaboration rows"
  on public.canvas_collaborations for select
  using (auth.uid() = collaborator_id);

drop policy if exists "owners can invite collaborators" on public.canvas_collaborations;
create policy "owners can invite collaborators"
  on public.canvas_collaborations for insert
  with check (auth.uid() = owner_id);

-- Collaborator may only flip their own row's status (accept/decline) — RLS alone can't stop them
-- from also trying to change owner_id/folder_id/collaborator_id in the same UPDATE, so
-- respond_to_canvas_collaboration below (SECURITY DEFINER, only touches status/responded_at) is
-- the real gate; the client-side code always goes through it rather than a raw table update.
drop policy if exists "collaborators can respond to invites" on public.canvas_collaborations;
create policy "collaborators can respond to invites"
  on public.canvas_collaborations for update
  using (auth.uid() = collaborator_id)
  with check (auth.uid() = collaborator_id);

drop policy if exists "owners can delete their canvas collaborations" on public.canvas_collaborations;
create policy "owners can delete their canvas collaborations"
  on public.canvas_collaborations for delete
  using (auth.uid() = owner_id);

create or replace function public.respond_to_canvas_collaboration(
  p_id bigint,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.canvas_collaborations
     set status = case when p_accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = p_id and collaborator_id = auth.uid();

  if not found then
    raise exception 'respond_to_canvas_collaboration: no matching pending invite for this caller';
  end if;
end;
$$;

grant execute on function public.respond_to_canvas_collaboration(bigint, boolean) to authenticated;

-- Returns just the one shared folder's own data (title/items/drawings — never its
-- `collaborators` list, and never anything else from the owner's workspace) if the caller has an
-- accepted collaboration on it. Returns null if the owner's workspace or that folder id doesn't
-- exist (distinguished from "not authorized", which raises).
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
  if not exists (
    select 1 from public.canvas_collaborations
    where owner_id = p_owner_id and folder_id = p_folder_id
      and collaborator_id = auth.uid() and status = 'accepted'
  ) then
    raise exception 'get_shared_folder: no accepted collaboration for this canvas';
  end if;

  select data -> 'folders' -> p_folder_id into folder_data
    from public.workspaces where user_id = p_owner_id;

  if folder_data is not null then
    folder_data := folder_data - 'collaborators';
  end if;

  return folder_data;
end;
$$;

grant execute on function public.get_shared_folder(uuid, text) to authenticated;

-- Patches just data->'folders'->folder_id in the OWNER's workspace row — never touches any other
-- folder, and never touches current_folder_id/the rest of `data`, so a collaborator saving their
-- edits can't affect where the owner's own client resumes or any of the owner's other canvases.
-- p_new_folder_data is the collaborator's full replacement for that one folder's {title, items,
-- drawings, ...} — its own `collaborators` field (if the client naively sent one back) is
-- stripped so a collaborator's write can never grant/revoke access.
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
  if not exists (
    select 1 from public.canvas_collaborations
    where owner_id = p_owner_id and folder_id = p_folder_id
      and collaborator_id = auth.uid() and status = 'accepted'
  ) then
    raise exception 'update_shared_folder: no accepted collaboration for this canvas';
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

grant execute on function public.update_shared_folder(uuid, text, jsonb) to authenticated;
