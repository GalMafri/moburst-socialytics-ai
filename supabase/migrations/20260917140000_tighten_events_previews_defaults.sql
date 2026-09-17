-- 1. app_events accepted any client_id from any signed-in user.
--
-- The stamp_app_event trigger already overwrites user_id, email, role, company
-- and tool from the session, so the ACTOR cannot be forged. What nothing
-- checked was the ATTRIBUTION: the trigger takes whatever client_id the row
-- carries and looks up that client's company_slug to stamp on the event. The
-- gos_events view derives its tool-open rows straight from app_events, and
-- freeze_quarter() aggregates that view into gos_usage_snapshot, which
-- block_snapshot_mutation makes append-only on the grounds that a frozen
-- quarter must never be restated. So a bad client_id here lands in a number
-- that is deliberately impossible to correct afterwards.
--
-- Only the attribution clause changes. can_access_client is what every other
-- client-scoped policy in this schema uses.
DROP POLICY IF EXISTS "append own" ON public.app_events;
CREATE POLICY "append own" ON public.app_events
  FOR INSERT TO authenticated
  WITH CHECK (client_id IS NULL OR public.can_access_client(client_id));

-- 2. post_previews had one policy, SELECT TO authenticated USING (true), and
--    no client_id column to scope by. Nothing in the frontend reads the table:
--    its only reader and writer is the post-preview edge function, which runs
--    with the service role and ignores RLS entirely. So the policy grants every
--    signed-in user every cached row and buys nothing.
--
--    RLS stays enabled with zero policies, which is the same shape
--    integration_tokens uses: service role only.
DROP POLICY IF EXISTS "Authenticated can read post_previews" ON public.post_previews;

-- 3. A new client defaulted to the Gemini media backend.
--
--    All nine clients run on Higgsfield. Gemini was therefore the path nobody
--    exercises, which is where a leaked API key and a poll that outlived its
--    own request were found sitting. A new client should start on the path that
--    is actually in use.
ALTER TABLE public.clients ALTER COLUMN media_backend SET DEFAULT 'higgsfield';
