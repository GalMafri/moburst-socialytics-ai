-- Google and Higgsfield sign-ins return to the app address they were started
-- from (the app is served on socialytics.moburst.com and socialytics.moburst.ai
-- and each keeps its own session). The start stores that address beside the
-- pending sign-in; the callback, which carries no Origin of its own, reads it.
-- Only an address the app answers on is ever stored (appOrigin.ts).

alter table public.google_connection add column if not exists pending_return_origin text;
alter table public.integration_tokens add column if not exists pending_return_origin text;

comment on column public.google_connection.pending_return_origin is 'The app address the pending Google sign-in was started from; the callback sends the browser back to it.';
comment on column public.integration_tokens.pending_return_origin is 'The app address the pending sign-in was started from; the callback sends the browser back to it.';
