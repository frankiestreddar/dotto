alter table public.profiles
  add column avatar_id integer not null default 0;

alter table public.profiles
  add constraint profiles_avatar_id_check check (avatar_id >= 0);

comment on column public.profiles.avatar_id is 'Index into the static /assets/avatar/avatar-{n}.png set. 0 = default silhouette (no avatar chosen).';
