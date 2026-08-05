-- Fixes "failed to load canvas collaborations" / "failed to load owned canvas collaborations" in
-- the client: canvas_collaborations.owner_id/collaborator_id were created referencing
-- auth.users(id), but the client's PostgREST embed syntax
-- (profiles!canvas_collaborations_owner_id_fkey(...), matching the existing friendships table's
-- already-working requester_id/addressee_id embeds) needs the foreign key to point at
-- public.profiles instead — PostgREST resolves an embedded join via the actual FK constraint, so
-- asking it to join `profiles` using a constraint that actually points at `auth.users` fails to
-- resolve. Repoints both constraints at public.profiles(id), keeping the same
-- auto-generated-style names so the existing embed syntax needs no client-side changes.

alter table public.canvas_collaborations
  drop constraint if exists canvas_collaborations_owner_id_fkey;
alter table public.canvas_collaborations
  add constraint canvas_collaborations_owner_id_fkey
  foreign key (owner_id) references public.profiles(id) on delete cascade;

alter table public.canvas_collaborations
  drop constraint if exists canvas_collaborations_collaborator_id_fkey;
alter table public.canvas_collaborations
  add constraint canvas_collaborations_collaborator_id_fkey
  foreign key (collaborator_id) references public.profiles(id) on delete cascade;
