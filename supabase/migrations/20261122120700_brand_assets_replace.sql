-- QA 22 Nov 2026 (P06-4): Client Setup uploads brand books and design
-- references with upsert (a path made from the file, so a quiet resend is
-- harmless). Choosing the same file again, after Remove kept the stored
-- object, or a resend of an upload whose answer was lost, takes the upsert's
-- replace path, and storage checks that against the UPDATE policies. These
-- buckets had select, insert and delete for staff but no update, so the same
-- file was refused every time. Staff may now replace what they may upload, as
-- with the client-notes bucket's "Staff replace client notes".
drop policy if exists "Staff replace brand assets" on storage.objects;
create policy "Staff replace brand assets" on storage.objects for update to authenticated
  using (bucket_id in ('brand-books','design-references') and public.is_moburst_staff())
  with check (bucket_id in ('brand-books','design-references') and public.is_moburst_staff());
