ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS media_backend text NOT NULL DEFAULT 'gemini';

COMMENT ON COLUMN public.clients.media_backend IS
  'Image/video generation provider for this client: gemini (default) or higgsfield.';

ALTER TABLE public.integration_tokens
  ADD COLUMN IF NOT EXISTS linked_at timestamptz;

COMMENT ON COLUMN public.integration_tokens.linked_at IS
  'When a person completed the OAuth link. Unlike updated_at, token refreshes do not touch it.';