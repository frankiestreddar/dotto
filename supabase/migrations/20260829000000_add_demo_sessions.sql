-- public.demo_sessions and the demo-recordings storage bucket — the only two pieces of the
-- production schema left with NO tracked migration anywhere (not in this project's own
-- migrations/, and not in production's CLI-tracked supabase_migrations.schema_migrations history
-- either, which stops at 20260724150404 — everything else in that history was pulled down
-- verbatim as the other 20260721-20260724 migrations alongside this file). Reconstructed
-- 2026-08-29 by introspecting the live production schema (information_schema/pg_catalog via the
-- Supabase Management API) while provisioning a fresh test project for Phase 4 of the
-- vanilla->React migration — see PHASE4_ROADMAP.md. Column defaults/constraints/RLS/indexes
-- match production as observed; exact original authorship date/order relative to other
-- around-that-time migrations is unknown, hence today's date rather than a guessed historical one.
create table if not exists public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Untitled Demo',
  created_at timestamptz not null default now(),
  duration_ms integer not null default 0,
  video_url text
);

create index if not exists demo_sessions_user_id_idx
  on public.demo_sessions (user_id, created_at desc);

alter table public.demo_sessions enable row level security;

create policy "users can read their own demo sessions"
  on public.demo_sessions for select
  using (auth.uid() = user_id);

create policy "users can insert their own demo sessions"
  on public.demo_sessions for insert
  with check (auth.uid() = user_id);

create policy "users can update their own demo sessions"
  on public.demo_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users can delete their own demo sessions"
  on public.demo_sessions for delete
  using (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('demo-recordings', 'demo-recordings', true)
on conflict (id) do nothing;

create policy "anyone can view demo recording videos"
  on storage.objects for select
  using (bucket_id = 'demo-recordings');

create policy "users can upload their own demo recordings"
  on storage.objects for insert
  with check (bucket_id = 'demo-recordings' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "users can delete their own demo recording files"
  on storage.objects for delete
  using (bucket_id = 'demo-recordings' and auth.uid()::text = (storage.foldername(name))[1]);
