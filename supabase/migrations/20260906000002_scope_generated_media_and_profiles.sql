-- The second pass on Lovable's scan (2026-09-06). With the six `TO public`
-- holes closed, the scan promoted the next two, and one of them was the natural
-- next layer of the storage fix rather than a pre-existing bug.
--
-- 1. generated-media was left readable and writable by any authenticated user,
--    which meant a client user of one client could reach another client's
--    generated assets. Objects live under {client_id}/... (browser uploads) and
--    post-thumbnails/... (the competitor preview cache, shared by design), so
--    the folder is the scope. A non-uuid folder — "unknown", from an upload
--    that had no client id — stays staff-only, preserving today's behaviour
--    without exposing anything client-specific.
--
-- 2. profiles was readable in full by every authenticated user, exposing every
--    colleague's name and email to client users. The app only ever reads the
--    signed-in user's own row (useAuth), and the role helpers read profiles
--    through SECURITY DEFINER functions, so neither needs the wider grant.
--
-- Verified after applying, by emulating each role's JWT: a client user sees 1
-- profile (was 24) and 150 generated-media objects (was 320 — their client's 31
-- plus the 119 shared thumbnails); staff still see 24 and 320. Public bucket
-- downloads are unaffected, so thumbnails still render signed out.

-- generated-media, scoped by the client folder ---------------------------------
drop policy if exists "Signed-in read generated media" on storage.objects;
drop policy if exists "Signed-in upload generated media" on storage.objects;
drop policy if exists "Signed-in update generated media" on storage.objects;

create policy "Read generated media for accessible clients" on storage.objects
  for select to authenticated using (
    bucket_id = 'generated-media' and (
      (storage.foldername(name))[1] = 'post-thumbnails'
      or ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.can_access_client(((storage.foldername(name))[1])::uuid))
      or ((storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.is_moburst_staff())
    ));

create policy "Upload generated media for accessible clients" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'generated-media' and (
      (storage.foldername(name))[1] = 'post-thumbnails'
      or ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.can_access_client(((storage.foldername(name))[1])::uuid))
      or ((storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.is_moburst_staff())
    ));

create policy "Update generated media for accessible clients" on storage.objects
  for update to authenticated using (
    bucket_id = 'generated-media' and (
      (storage.foldername(name))[1] = 'post-thumbnails'
      or ((storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.can_access_client(((storage.foldername(name))[1])::uuid))
      or ((storage.foldername(name))[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and public.is_moburst_staff())
    ));

-- There is deliberately no DELETE policy: nothing in the app removes from
-- generated-media, so leaving it unwritable by any client is the safe default.
-- The scan reports that absence as "no delete control defined"; the absence IS
-- the control.

-- profiles ---------------------------------------------------------------------
drop policy if exists "Users can view all profiles" on public.profiles;

create policy "Users read their own profile, staff read all" on public.profiles
  for select to authenticated
  using (user_id = auth.uid() or public.is_moburst_staff());
