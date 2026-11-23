-- Per-client cost tracking.
--
-- cost_events holds one row per billable unit of a paid provider call (an LLM
-- reply, an Apify run, a Gamma deck), written only by the edge functions'
-- meter (supabase/functions/_shared/cost). It is append-only: finance
-- reconciles it against the Mesh card, so a row is never changed or removed. A
-- correction is a new row.
--
-- The bucket a cost lands in is worked out when it is read (cost_ledger), so
-- flagging a client as a test client later (clients.cost_bucket = 'dev_qa')
-- moves its whole history to the dev/QA bucket.
--
-- Additive only. Service role writes; nobody reads the table from a browser.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS cost_bucket TEXT NOT NULL DEFAULT 'client'
  CHECK (cost_bucket IN ('client', 'dev_qa'));
COMMENT ON COLUMN public.clients.cost_bucket IS
  'dev_qa for internal test clients: their spend is reported under the development & QA bucket.';

CREATE TABLE IF NOT EXISTS public.cost_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  tool            TEXT NOT NULL,
  env             TEXT NOT NULL,
  -- No foreign key: a purged client keeps its cost history.
  client_id       UUID,
  bucket_hint     TEXT NOT NULL CHECK (bucket_hint IN ('client', 'shared', 'dev_qa')),
  unattributed    BOOLEAN NOT NULL DEFAULT false,
  feature         TEXT NOT NULL,
  execution_id    TEXT,
  actor_kind      TEXT NOT NULL,
  user_id         TEXT,
  api_key_id      TEXT,
  provider        TEXT NOT NULL,
  resource        TEXT NOT NULL,
  quantities      JSONB NOT NULL DEFAULT '{}'::jsonb,
  cost_usd        NUMERIC(14, 6),
  cost_source     TEXT NOT NULL CHECK (cost_source IN ('provider', 'priced', 'estimated', 'unpriced', 'backfill', 'backfill_estimate')),
  price_ref       TEXT,
  provider_ref    TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  duration_ms     INTEGER
);

CREATE INDEX IF NOT EXISTS cost_events_occurred_idx ON public.cost_events (occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS cost_events_client_idx ON public.cost_events (client_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cost_events_provider_idx ON public.cost_events (provider, occurred_at DESC);
CREATE INDEX IF NOT EXISTS cost_events_execution_idx ON public.cost_events (execution_id) WHERE execution_id IS NOT NULL;

ALTER TABLE public.cost_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cost_events FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.cost_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'cost_events is append-only: add a correcting row instead of changing one';
END;
$$;
DROP TRIGGER IF EXISTS cost_events_append_only ON public.cost_events;
CREATE TRIGGER cost_events_append_only BEFORE UPDATE OR DELETE ON public.cost_events
  FOR EACH ROW EXECUTE FUNCTION public.cost_events_append_only();

-- Each event with its client's name and slug, and the bucket it reports under.
CREATE OR REPLACE VIEW public.cost_ledger WITH (security_invoker = on) AS
SELECT
  e.*,
  c.name AS client_name,
  c.company_slug AS company_slug,
  CASE
    WHEN e.bucket_hint <> 'client' THEN e.bucket_hint
    WHEN c.cost_bucket = 'dev_qa' THEN 'dev_qa'
    ELSE 'client'
  END AS bucket
FROM public.cost_events e
LEFT JOIN public.clients c ON c.id = e.client_id;

REVOKE ALL ON public.cost_ledger FROM anon, authenticated;

-- Totals grouped by any of: day, week, month, client, provider, resource,
-- feature, bucket, env. Filters are optional. Only these names reach the SQL.
CREATE OR REPLACE FUNCTION public.cost_summary(
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ,
  p_group TEXT[] DEFAULT '{}',
  p_filters JSONB DEFAULT '{}'::jsonb
) RETURNS SETOF JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g TEXT;
  sel TEXT[] := '{}';
  key_sql TEXT;
  where_sql TEXT := 'occurred_at >= $1 AND occurred_at < $2';
  f TEXT;
BEGIN
  FOREACH g IN ARRAY coalesce(p_group, '{}') LOOP
    CASE g
      WHEN 'day'   THEN sel := array_append(sel, $q$'day', to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')$q$);
      WHEN 'week'  THEN sel := array_append(sel, $q$'week', to_char(date_trunc('week', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')$q$);
      WHEN 'month' THEN sel := array_append(sel, $q$'month', to_char(date_trunc('month', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM')$q$);
      WHEN 'client' THEN sel := array_append(sel, $q$'client', jsonb_build_object('id', client_id, 'name', client_name, 'company_slug', company_slug, 'bucket', bucket)$q$);
      WHEN 'provider' THEN sel := array_append(sel, $q$'provider', provider$q$);
      WHEN 'resource' THEN sel := array_append(sel, $q$'provider', provider, 'resource', resource$q$);
      WHEN 'feature' THEN sel := array_append(sel, $q$'feature', feature$q$);
      WHEN 'bucket' THEN sel := array_append(sel, $q$'bucket', bucket$q$);
      WHEN 'env' THEN sel := array_append(sel, $q$'env', env$q$);
      ELSE RAISE EXCEPTION 'unknown group %', g USING ERRCODE = '22023';
    END CASE;
  END LOOP;

  FOR f IN SELECT jsonb_object_keys(coalesce(p_filters, '{}'::jsonb)) LOOP
    IF f NOT IN ('client_id', 'company_slug', 'provider', 'resource', 'feature', 'bucket', 'env', 'execution_id') THEN
      RAISE EXCEPTION 'unknown filter %', f USING ERRCODE = '22023';
    END IF;
    where_sql := where_sql || format(' AND %I::text = %L', f, p_filters ->> f);
  END LOOP;

  key_sql := CASE WHEN array_length(sel, 1) IS NULL THEN '''{}''::jsonb' ELSE 'jsonb_build_object(' || array_to_string(sel, ', ') || ')' END;

  RETURN QUERY EXECUTE format($sql$
    WITH base AS (
      SELECT %2$s AS k, cost_usd, cost_source, unattributed, quantities
        FROM public.cost_ledger WHERE %1$s
    ),
    grouped AS (
      SELECT k,
             coalesce(sum(cost_usd), 0) AS cost_usd,
             count(*) AS events,
             coalesce(sum(cost_usd) FILTER (WHERE unattributed), 0) AS unattributed_usd,
             coalesce(sum(cost_usd) FILTER (WHERE cost_source IN ('estimated', 'backfill_estimate')), 0) AS estimated_usd,
             count(*) FILTER (WHERE cost_source = 'unpriced') AS unpriced_events,
             count(*) FILTER (WHERE unattributed) AS unattributed_events
        FROM base GROUP BY k
    ),
    per_key AS (
      SELECT b.k, kv.key, sum(kv.value::numeric) AS n
        FROM base b CROSS JOIN LATERAL jsonb_each_text(b.quantities) kv
       WHERE kv.value ~ '^-?[0-9]+(\.[0-9]+)?$'
       GROUP BY b.k, kv.key
    ),
    quantities AS (SELECT k, jsonb_object_agg(key, n) AS q FROM per_key GROUP BY k)
    SELECT g.k || jsonb_build_object(
             'cost_usd', round(g.cost_usd, 6), 'events', g.events,
             'unattributed_usd', round(g.unattributed_usd, 6), 'estimated_usd', round(g.estimated_usd, 6),
             'unpriced_events', g.unpriced_events, 'unattributed_events', g.unattributed_events,
             'quantities', coalesce(qs.q, '{}'::jsonb))
      FROM grouped g LEFT JOIN quantities qs ON qs.k = g.k
     ORDER BY g.cost_usd DESC
  $sql$, where_sql, key_sql) USING p_from, p_to;
END;
$$;

REVOKE ALL ON FUNCTION public.cost_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cost_summary(TIMESTAMPTZ, TIMESTAMPTZ, TEXT[], JSONB) TO service_role;
