create table public.messages (
  id uuid primary key default gen_random_uuid(),
  friendship_id uuid not null references public.friendships (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text,
  canvas_snapshot jsonb,
  created_at timestamptz not null default now(),
  check (body is not null or canvas_snapshot is not null)
);

alter table public.messages enable row level security;

create policy "Participants can view messages in their friendship"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.friendships f
      where f.id = friendship_id
        and f.status = 'accepted'
        and (auth.uid() = f.requester_id or auth.uid() = f.addressee_id)
    )
  );

create policy "Participants can send messages in an accepted friendship"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.friendships f
      where f.id = friendship_id
        and f.status = 'accepted'
        and (auth.uid() = f.requester_id or auth.uid() = f.addressee_id)
    )
  );
