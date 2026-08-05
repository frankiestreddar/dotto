-- Storage bucket for uploaded PDF/EPUB documents (see the 'media' card kind's new pdf/epub
-- mediaType branches in public/dotto-script.js). Images/video pasted-by-link or small uploads
-- still go through the existing data: URL path (embedded directly in the item's own JSON) — this
-- bucket is specifically for PDFs/EPUBs, which can be many MB and would otherwise bloat every
-- single workspace autosave if embedded the same way.
--
-- Mirrors the existing "avatars" bucket's own path convention exactly (see
-- app/avatar-setup/page.js: `${user.id}/avatar.png`) — no migration exists for that bucket either
-- (predates migration tracking, set up directly in the dashboard), so this is the first storage
-- bucket+policy set actually captured in a migration file. Public read (like avatars) since a
-- document uploaded to a SHARED canvas needs to be viewable by every collaborator, not just the
-- uploader — Storage RLS SELECT policies default to owner-only otherwise. Write access (insert/
-- update/delete) stays scoped to the uploader's own `${auth.uid()}/...` path prefix.

insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do nothing;

drop policy if exists "anyone can read documents" on storage.objects;
create policy "anyone can read documents"
  on storage.objects for select
  using (bucket_id = 'documents');

drop policy if exists "users can upload their own documents" on storage.objects;
create policy "users can upload their own documents"
  on storage.objects for insert
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can update their own documents" on storage.objects;
create policy "users can update their own documents"
  on storage.objects for update
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can delete their own documents" on storage.objects;
create policy "users can delete their own documents"
  on storage.objects for delete
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
