-- Deck files in the private report-decks bucket: the read rule now checks the
-- reader's access itself, instead of leaning only on report_decks' own row
-- security. A file is readable when it is a recorded deck of a client the
-- person can access, and it sits in that client's folder
-- ({client_id}/{report id}/{deck id}.{pptx|pdf}). Nothing else changes: the
-- same people read the same files (Lovable's security scan flagged the old rule
-- as "any signed-in user"; report_decks' row security already narrowed it).

drop policy if exists "People who see the report read its deck files" on storage.objects;
create policy "People who see the report read its deck files" on storage.objects for select to authenticated
  using (
    bucket_id = 'report-decks'
    and exists (
      select 1 from public.report_decks d
       where d.file_path = objects.name
         and public.can_access_client(d.client_id)
         and split_part(objects.name, '/', 1) = d.client_id::text
    )
  );
