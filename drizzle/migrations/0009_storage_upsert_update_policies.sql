-- Sending the same file again to a path that already holds it is taken in
-- the three buckets that allowed insert but not update (QA 22 Nov 2026, S1).
--
-- The app uploads with upsert to post-footage (the filmed clip for a video
-- post, src/lib/designRequests.ts), brand-books (the brand book and the
-- strategy doc) and design-references (the client's reference posts). An
-- upload with upsert to a path that already holds the file writes it over,
-- and Supabase Storage asks for SELECT and UPDATE on storage.objects for
-- that. These buckets had INSERT and SELECT (and DELETE for brand assets)
-- but no UPDATE, so a second press after the clip uploaded, a quiet resend
-- whose first reply was lost, or the same brand book chosen again was
-- refused, and every later press of that file was refused the same way.
--
-- Each UPDATE policy is the bucket's INSERT rule, for both the row it
-- replaces and the row it writes:
--   brand-books, design-references  Moburst staff
--     (20260906000001_close_public_rls_holes.sql, "Staff upload brand assets")
--   post-footage                    staff, or a member of the client whose
--     folder the clip is in (20261014200000_post_footage_upload.sql)
-- SELECT already holds the same rules in all three. The restrictive "OAuth
-- sessions cannot update" policy on storage.objects
-- (20261109120000_claude_connector.sql) still applies. Safe to run twice.

drop policy if exists "Staff update brand assets" on storage.objects;
create policy "Staff update brand assets" on storage.objects for update to authenticated
  using (bucket_id in ('brand-books','design-references') and public.is_moburst_staff())
  with check (bucket_id in ('brand-books','design-references') and public.is_moburst_staff());

drop policy if exists "Members update post footage" on storage.objects;
create policy "Members update post footage" on storage.objects for update to authenticated
  using (bucket_id = 'post-footage' and (public.is_moburst_staff() or public.is_client_member(((storage.foldername(name))[1])::uuid)))
  with check (bucket_id = 'post-footage' and (public.is_moburst_staff() or public.is_client_member(((storage.foldername(name))[1])::uuid)));
