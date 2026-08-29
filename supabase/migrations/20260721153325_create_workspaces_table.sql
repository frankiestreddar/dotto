create table public.workspaces (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  data jsonb not null,
  current_folder_id text,
  updated_at timestamptz not null default now()
);

alter table public.workspaces enable row level security;

create policy "Users manage their own workspace"
  on public.workspaces for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
