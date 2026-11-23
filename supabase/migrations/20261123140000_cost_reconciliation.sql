-- Daily cost reconciliation.
--
-- The cost-reconcile edge function writes one row per provider and UTC day:
-- what our meter recorded in cost_events (ours_usd, this tool only) against
-- what the provider's own billing API says (theirs_usd, the whole provider
-- account, so another Moburst tool sharing the account shows up there).
-- A re-run of the same day replaces its row.
--
--   ok            within max(5% of theirs, $5) (configurable in the function)
--   drift         outside it
--   unreconciled  no figure to compare with (no admin key, data not final,
--                 a provider with only a credit balance); the note says why
--   error         the provider's billing API failed
--
-- Additive only. Service role writes and reads; nobody reads it from a browser.
-- GET /v1/costs returns cost_reconciliation_latest as "reconciliation".

CREATE TABLE IF NOT EXISTS public.cost_reconciliation (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day         DATE NOT NULL,
  provider    TEXT NOT NULL,
  ours_usd    NUMERIC(14, 6) NOT NULL DEFAULT 0,
  theirs_usd  NUMERIC(14, 6),
  status      TEXT NOT NULL CHECK (status IN ('ok', 'drift', 'unreconciled', 'error')),
  note        TEXT,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (day, provider)
);

CREATE INDEX IF NOT EXISTS cost_reconciliation_provider_day_idx ON public.cost_reconciliation (provider, day DESC);

ALTER TABLE public.cost_reconciliation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cost_reconciliation FROM anon, authenticated;

-- The Claude connector's sign-ins (OAuth sessions) never write here, as on every table (see the mcp migrations).
DROP POLICY IF EXISTS "OAuth sessions cannot insert" ON public.cost_reconciliation;
CREATE POLICY "OAuth sessions cannot insert" ON public.cost_reconciliation AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT (SELECT public.is_oauth_session()));
DROP POLICY IF EXISTS "OAuth sessions cannot update" ON public.cost_reconciliation;
CREATE POLICY "OAuth sessions cannot update" ON public.cost_reconciliation AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT (SELECT public.is_oauth_session())) WITH CHECK (NOT (SELECT public.is_oauth_session()));
DROP POLICY IF EXISTS "OAuth sessions cannot delete" ON public.cost_reconciliation;
CREATE POLICY "OAuth sessions cannot delete" ON public.cost_reconciliation AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT (SELECT public.is_oauth_session()));

-- The most recent day checked for each provider.
CREATE OR REPLACE VIEW public.cost_reconciliation_latest WITH (security_invoker = on) AS
SELECT DISTINCT ON (provider)
  provider, day, status, ours_usd, theirs_usd, note, checked_at
FROM public.cost_reconciliation
ORDER BY provider, day DESC;

REVOKE ALL ON public.cost_reconciliation_latest FROM anon, authenticated;
