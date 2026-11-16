-- The shared post-thumbnails folder of generated-media was open to every
-- signed-in user for reading, adding and overwriting files, so a client user
-- could replace a preview every other viewer sees. Only the service role
-- (post-preview) writes there, and the files are read by their public URLs,
-- which this policy never governed. With the folder's branch gone it falls
-- under the existing rule for a folder that is not a client id: staff only.
-- Safe to apply twice.
drop policy if exists "Read generated media for accessible clients" on storage.objects;
drop policy if exists "Upload generated media for accessible clients" on storage.objects;
drop policy if exists "Update generated media for accessible clients" on storage.objects;

create policy "Read generated media for accessible clients" on storage.objects
  for select to authenticated using (
    bucket_id = 'generated-media' and (
      ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.can_access_client(((storage.foldername(name))[1])::uuid))
      or ((storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.is_moburst_staff())
    ));

create policy "Upload generated media for accessible clients" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'generated-media' and (
      ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.can_access_client(((storage.foldername(name))[1])::uuid))
      or ((storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.is_moburst_staff())
    ));

create policy "Update generated media for accessible clients" on storage.objects
  for update to authenticated using (
    bucket_id = 'generated-media' and (
      ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.can_access_client(((storage.foldername(name))[1])::uuid))
      or ((storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.is_moburst_staff())
    ));
