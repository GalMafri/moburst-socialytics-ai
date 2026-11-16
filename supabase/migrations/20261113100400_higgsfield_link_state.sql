-- Settings says whether the Higgsfield link works from what the server's own
-- token refreshes found: the time one last worked, and the time Higgsfield
-- last refused the token. A person's sign-in sets the first (it works as of
-- then). The link needs a new sign-in when the refusal is newer than the last
-- success. Service role only, like the rest of the row.

alter table public.integration_tokens add column if not exists last_refresh_ok_at timestamptz;
alter table public.integration_tokens add column if not exists last_refresh_refused_at timestamptz;

comment on column public.integration_tokens.last_refresh_ok_at is 'When a token refresh (or a person''s sign-in) last worked.';
comment on column public.integration_tokens.last_refresh_refused_at is 'When the provider last refused the refresh token. Newer than last_refresh_ok_at means the link needs a new sign-in.';
