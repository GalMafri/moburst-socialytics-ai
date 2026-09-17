DROP POLICY IF EXISTS "append own" ON public.app_events;
CREATE POLICY "append own" ON public.app_events
  FOR INSERT TO authenticated
  WITH CHECK (client_id IS NULL OR public.can_access_client(client_id));

DROP POLICY IF EXISTS "Authenticated can read post_previews" ON public.post_previews;

ALTER TABLE public.clients ALTER COLUMN media_backend SET DEFAULT 'higgsfield';