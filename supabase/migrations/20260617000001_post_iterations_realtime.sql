-- Enable Supabase Realtime for post_iterations.
--
-- The frontend subscribes to post_iterations changes (useRealtimePostIterations)
-- to live-refresh generated designs/videos in the calendar panel. But the table
-- was never added to the supabase_realtime publication, so no change events were
-- ever delivered — freshly generated media only appeared after a full page
-- reload. (The frontend now also refetches on generation activity as a
-- guaranteed fallback; this migration restores true realtime so updates also
-- propagate across tabs/users.)
--
-- REPLICA IDENTITY FULL so UPDATE/DELETE events carry the full row, which the
-- client_id realtime filter needs on those events. (INSERT only needs the
-- table to be a member of the publication.)

ALTER TABLE public.post_iterations REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'post_iterations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.post_iterations;
  END IF;
END $$;
