-- Cost safeguards: nothing paid goes unrecorded, and what needs a person is
-- kept in the app (supabase/functions/_shared/cost/meter.ts and audit.ts).
--
--   cost_intents         one row per paid call, written just before the call
--                        and completed once its cost rows are written. An
--                        intent still open an hour later is a call whose cost
--                        was never recorded; the daily checks count them.
--                        Completed intents are pruned after 30 days.
--   cost_unclaimed_runs  finished Apify runs on the shared Apify account that
--                        no cost_events row holds and whose actor this tool
--                        does not own: up for review, never counted.
--   cost_alerts          what the daily checks found (drift, unrecorded calls,
--                        unclaimed or newly recorded Apify runs, a high
--                        unattributed share, unpriced events). GET /v1/costs
--                        returns the open ones. Nothing is posted elsewhere.
--
-- Additive only. Written and read by the service role through the edge
-- functions; RLS is on, app roles have no grants, and a restrictive policy
-- refuses every other caller, so a browser or OAuth session can never read
-- them even if a permissive policy is added later.

CREATE TABLE IF NOT EXISTS public.cost_intents (
  id            UUID PRIMARY KEY,
  tool          TEXT NOT NULL,
  env           TEXT NOT NULL,
  provider      TEXT NOT NULL,
  feature       TEXT NOT NULL,
  client_id     UUID,
  execution_id  TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  events        INTEGER
);
CREATE INDEX IF NOT EXISTS cost_intents_open_idx ON public.cost_intents (started_at) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS cost_intents_started_idx ON public.cost_intents (started_at);

CREATE TABLE IF NOT EXISTS public.cost_unclaimed_runs (
  run_id         TEXT PRIMARY KEY,
  tool           TEXT NOT NULL,
  actor_id       TEXT NOT NULL,
  actor_task_id  TEXT,
  actor_class    TEXT NOT NULL CHECK (actor_class IN ('shared', 'unknown')),
  status         TEXT NOT NULL,
  started_at     TIMESTAMPTZ NOT NULL,
  finished_at    TIMESTAMPTZ,
  usage_usd      NUMERIC(14, 6) NOT NULL DEFAULT 0,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note           TEXT
);
CREATE INDEX IF NOT EXISTS cost_unclaimed_runs_started_idx ON public.cost_unclaimed_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.cost_alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- kind:day:provider, so a re-run of the same day updates its alert instead of adding one.
  dedupe_key     TEXT NOT NULL UNIQUE,
  tool           TEXT NOT NULL,
  kind           TEXT NOT NULL CHECK (kind IN ('drift', 'unrecorded_calls', 'apify_unclaimed', 'apify_recorded', 'unattributed_share', 'unpriced')),
  day            DATE NOT NULL,
  provider       TEXT,
  message        TEXT NOT NULL,
  count          NUMERIC,
  usd            NUMERIC(14, 6),
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cost_alerts_open_idx ON public.cost_alerts (day DESC) WHERE resolved_at IS NULL;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['cost_intents', 'cost_unclaimed_runs', 'cost_alerts'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role only" ON public.%I', t);
    EXECUTE format('CREATE POLICY "Service role only" ON public.%I AS RESTRICTIVE FOR ALL TO anon, authenticated USING (false) WITH CHECK (false)', t);
  END LOOP;
END $$;

-- The Claude connector's OAuth sessions never write here (supabase/tests/mcp/schema-guards.test.ts).
drop policy if exists "OAuth sessions cannot insert" on public.cost_intents;
create policy "OAuth sessions cannot insert" on public.cost_intents as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.cost_intents;
create policy "OAuth sessions cannot update" on public.cost_intents as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.cost_intents;
create policy "OAuth sessions cannot delete" on public.cost_intents as restrictive for delete to authenticated using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.cost_unclaimed_runs;
create policy "OAuth sessions cannot insert" on public.cost_unclaimed_runs as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.cost_unclaimed_runs;
create policy "OAuth sessions cannot update" on public.cost_unclaimed_runs as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.cost_unclaimed_runs;
create policy "OAuth sessions cannot delete" on public.cost_unclaimed_runs as restrictive for delete to authenticated using (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot insert" on public.cost_alerts;
create policy "OAuth sessions cannot insert" on public.cost_alerts as restrictive for insert to authenticated with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot update" on public.cost_alerts;
create policy "OAuth sessions cannot update" on public.cost_alerts as restrictive for update to authenticated using (not (select public.is_oauth_session())) with check (not (select public.is_oauth_session()));
drop policy if exists "OAuth sessions cannot delete" on public.cost_alerts;
create policy "OAuth sessions cannot delete" on public.cost_alerts as restrictive for delete to authenticated using (not (select public.is_oauth_session()));
