create table public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  price_label text not null default 'Free',
  status text not null default 'draft' check (status in ('draft', 'published')),
  content jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz
);

alter table public.marketplace_listings enable row level security;

create policy "Published listings are public, drafts are private"
  on public.marketplace_listings for select
  to authenticated
  using (status = 'published' or creator_id = auth.uid());

create policy "Creators manage their own listings"
  on public.marketplace_listings for all
  to authenticated
  using (creator_id = auth.uid())
  with check (creator_id = auth.uid());

create table public.library_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  listing_id uuid not null references public.marketplace_listings (id) on delete cascade,
  acquired_at timestamptz not null default now(),
  unique (user_id, listing_id)
);

alter table public.library_items enable row level security;

create policy "Users manage their own library"
  on public.library_items for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
