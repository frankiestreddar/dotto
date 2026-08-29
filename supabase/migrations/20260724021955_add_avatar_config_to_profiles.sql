alter table public.profiles add column avatar_config jsonb;
comment on column public.profiles.avatar_config is 'Full custom-avatar builder state (age, type, skin/part colors, chosen option per category) — used to re-open the builder for editing. The rendered result lives in avatar_url.';
