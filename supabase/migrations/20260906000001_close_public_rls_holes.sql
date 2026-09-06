-- Close the six critical findings from Lovable's security scan (2026-09-06).
--
-- Each one was a policy granted TO public. In Postgres that includes `anon`,
-- and `anon` is the key shipped in the public JavaScript bundle — so these were
-- reachable by anyone on the internet, not just by signed-in users as the scan
-- wording suggested. Verified before the change: 145 post_iterations rows and
-- 4 brand_voice_learnings rows readable while signed out, and both brand
-- buckets listable anonymously.
--
-- Every affected table already carried correct authenticated + role-scoped
-- policies alongside the loose ones, so in most cases the fix is simply to drop
-- the redundant catch-all. scheduled_posts is the exception: it had only the
-- open policy, so it gets a scoped set here.
--
-- Checked before applying, because the app is signed in through
-- tools.moburst.com and moburst.ai rather than Supabase auth directly:
--   * both bridges (hub-auth-bridge, gos-auth-bridge) create a real Supabase
--     user and signInWithPassword, so every app user holds an `authenticated`
--     session and auth.uid() resolves — nothing depends on the `anon` role;
--   * all 24 users have a user_roles row (18 admin, 3 moburst_user, 3 client)
--     and every one still reaches the same clients under can_access_client();
--   * both n8n workflows write through update-report / update-competitive-report
--     with X-Socialytics-Secret, never over REST, so the anon UPDATE on reports
--     had no caller;
--   * edge functions use the service role and bypass RLS entirely; the two that
--     use the anon key pass the caller's JWT, so RLS runs as that user.

-- 1. reports ------------------------------------------------------------------
drop policy if exists "Allow anon to update reports from n8n" on public.reports;

-- 2. post_iterations ----------------------------------------------------------
drop policy if exists "Users can read post iterations for their clients" on public.post_iterations;
drop policy if exists "Users can insert post iterations" on public.post_iterations;

create policy "Client members and staff can view post_iterations" on public.post_iterations
  for select to authenticated using (public.can_access_client(client_id));
create policy "Client members and staff can insert post_iterations" on public.post_iterations
  for insert to authenticated with check (public.can_access_client(client_id));

-- 3. brand_voice_learnings ----------------------------------------------------
drop policy if exists "Users can read brand voice learnings" on public.brand_voice_learnings;
drop policy if exists "Service role can manage brand voice learnings" on public.brand_voice_learnings;

-- 4. design_states ------------------------------------------------------------
drop policy if exists "Users can manage design states" on public.design_states;

-- 5. scheduled_posts ----------------------------------------------------------
-- The old policy was named "Allow all for authenticated" but its role was
-- public, so it applied to anon too.
drop policy if exists "Allow all for authenticated" on public.scheduled_posts;

create policy "Client members and staff can view scheduled_posts" on public.scheduled_posts
  for select to authenticated
  using (client_id is not null and public.can_access_client(client_id));
create policy "Moburst staff can manage scheduled_posts" on public.scheduled_posts
  for all to authenticated
  using (public.is_moburst_staff()) with check (public.is_moburst_staff());

-- 6. app_settings -------------------------------------------------------------
-- RunAnalysis and CompetitiveRun read the webhook URLs and are staff routes, so
-- staff keep those; anything named like a secret (gemini_api_key today) is left
-- to the existing admin ALL policy. Edge functions read it with the service
-- role and are unaffected.
drop policy if exists "Authenticated users can read app_settings" on public.app_settings;

create policy "Staff can read non-secret app_settings" on public.app_settings
  for select to authenticated
  using (public.is_moburst_staff() and key !~* '(key|secret|token|password|credential)');

-- 7. storage ------------------------------------------------------------------
-- The buckets stay public so getPublicUrl keeps rendering design-reference and
-- generated-media thumbnails (a public bucket serves object downloads without
-- consulting RLS). What stops is anonymous listing, upload, overwrite and
-- delete. Nothing in the app lists a bucket.
drop policy if exists "Allow read brand-books" on storage.objects;
drop policy if exists "Allow upload brand-books" on storage.objects;
drop policy if exists "Allow delete brand-books" on storage.objects;
drop policy if exists "Allow read design-references" on storage.objects;
drop policy if exists "Allow upload design-references" on storage.objects;
drop policy if exists "Allow delete design-references" on storage.objects;
drop policy if exists "Public read access for generated media" on storage.objects;
drop policy if exists "Allow uploads to generated media" on storage.objects;
drop policy if exists "Allow updates to generated media" on storage.objects;

-- Brand assets are uploaded and removed from Client Setup, which is staff only.
create policy "Staff read brand assets" on storage.objects for select to authenticated
  using (bucket_id in ('brand-books','design-references') and public.is_moburst_staff());
create policy "Staff upload brand assets" on storage.objects for insert to authenticated
  with check (bucket_id in ('brand-books','design-references') and public.is_moburst_staff());
create policy "Staff delete brand assets" on storage.objects for delete to authenticated
  using (bucket_id in ('brand-books','design-references') and public.is_moburst_staff());

-- Generated media is written straight from the browser by whoever generated it,
-- and a client user may generate a design on their own report.
create policy "Signed-in read generated media" on storage.objects for select to authenticated
  using (bucket_id = 'generated-media');
create policy "Signed-in upload generated media" on storage.objects for insert to authenticated
  with check (bucket_id = 'generated-media');
create policy "Signed-in update generated media" on storage.objects for update to authenticated
  using (bucket_id = 'generated-media') with check (bucket_id = 'generated-media');
