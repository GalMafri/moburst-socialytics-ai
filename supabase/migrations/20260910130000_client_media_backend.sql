-- Which provider renders a client's post images and video.
--
-- Applied by hand against the live Lovable-managed project; this file is the
-- record, not the mechanism.
--
-- Default 'gemini' so nothing changes for an existing client. 'higgsfield'
-- routes that client's generations through the team's linked Higgsfield
-- account, which spends shared credits — hence per client, and hence read
-- server-side from this column rather than from a request body.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS media_backend text NOT NULL DEFAULT 'gemini';

COMMENT ON COLUMN public.clients.media_backend IS
  'Image/video generation provider for this client: gemini (default) or higgsfield.';
