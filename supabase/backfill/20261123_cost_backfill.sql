-- One-off backfill of cost_events from what Socialytics already recorded before
-- per-client cost tracking existed. Run once in the Lovable SQL console after
-- migration 20261123130000_cost_events.sql. Safe to run again: every row has a
-- fixed idempotency key, so a second run inserts nothing.
--
-- It only covers work that happened before the first live cost event, so the
-- backfill and live tracking never count the same work twice.
--
-- What it can backfill (per client):
--   trend_weeks.cost.apify_usd           Apify dollars per trends week (as Apify reported them): cost_source "backfill"
--   trend_weeks.cost.claude              Claude tokens per model per trends week: priced, "backfill_estimate"
--   calendar_plans input/output tokens   the weekly calendar's Claude call: priced, "backfill_estimate"
--   report_insights input/output tokens  the report insights' Claude call: priced, "backfill_estimate"
-- Token rows are estimates because prompt-cache reads were not recorded and are
-- priced as ordinary input (so they may read slightly high).
--
-- What it cannot backfill: every other Claude call (design, posts, brand,
-- competitors, video), OpenAI, Gemini, Firecrawl, Higgsfield and Gamma calls,
-- which kept no usage. Provider totals for those months are in each provider's
-- own billing page; they are not per client.
--
-- Prices (USD per million tokens, from supabase/functions/_shared/cost/pricing.ts, read 2026-11-23).

WITH cutoff AS (
  SELECT coalesce(min(occurred_at), now()) AS at
    FROM public.cost_events
   WHERE cost_source NOT IN ('backfill', 'backfill_estimate')
),
prices(model, input_usd, output_usd) AS (
  VALUES
    ('claude-opus-5-5', 4.0, 20.0),
    ('claude-sonnet-5-5', 2.0, 10.0),
    ('claude-haiku-5-5', 0.1, 0.5),
    ('claude-sonnet-5', 2.0, 10.0),
    ('claude-sonnet-4-6', 3.0, 15.0),
    ('claude-haiku-4-5', 1.0, 5.0),
    ('claude-haiku-4-5-20251001', 1.0, 5.0)
),
trend_apify AS (
  SELECT coalesce(w.finished_at, w.created_at) AS occurred_at, w.client_id, 'trends.week' AS feature, w.id::text AS execution_id,
         'apify' AS provider, 'trend_actors' AS resource,
         jsonb_build_object('requests', 1) AS quantities,
         round((w.cost ->> 'apify_usd')::numeric, 6) AS cost_usd, 'backfill' AS cost_source,
         'backfill:trend_weeks:' || w.id || ':apify' AS idempotency_key
    FROM public.trend_weeks w, cutoff
   WHERE (w.cost ->> 'apify_usd') ~ '^[0-9.]+$' AND (w.cost ->> 'apify_usd')::numeric > 0
     AND coalesce(w.finished_at, w.created_at) < cutoff.at
),
trend_claude AS (
  SELECT coalesce(w.finished_at, w.created_at) AS occurred_at, w.client_id, 'trends.week' AS feature, w.id::text AS execution_id,
         'anthropic' AS provider, m.key AS resource,
         jsonb_build_object('input_tokens', coalesce((m.value ->> 'input_tokens')::bigint, 0), 'output_tokens', coalesce((m.value ->> 'output_tokens')::bigint, 0)) AS quantities,
         round((coalesce((m.value ->> 'input_tokens')::numeric, 0) * p.input_usd + coalesce((m.value ->> 'output_tokens')::numeric, 0) * p.output_usd) / 1000000, 6) AS cost_usd,
         CASE WHEN p.model IS NULL THEN 'unpriced' ELSE 'backfill_estimate' END AS cost_source,
         'backfill:trend_weeks:' || w.id || ':claude:' || m.key AS idempotency_key
    FROM public.trend_weeks w
    CROSS JOIN LATERAL jsonb_each(coalesce(w.cost -> 'claude', '{}'::jsonb)) m
    LEFT JOIN prices p ON p.model = m.key
    , cutoff
   WHERE coalesce(w.finished_at, w.created_at) < cutoff.at
),
calendar AS (
  SELECT coalesce(c.ready_at, c.created_at) AS occurred_at, c.client_id, 'calendar.week_copy' AS feature, c.id::text AS execution_id,
         'anthropic' AS provider, coalesce(c.model, 'unknown') AS resource,
         jsonb_build_object('input_tokens', coalesce(c.input_tokens, 0), 'output_tokens', coalesce(c.output_tokens, 0)) AS quantities,
         round((coalesce(c.input_tokens, 0) * p.input_usd + coalesce(c.output_tokens, 0) * p.output_usd) / 1000000.0, 6) AS cost_usd,
         CASE WHEN p.model IS NULL THEN 'unpriced' ELSE 'backfill_estimate' END AS cost_source,
         'backfill:calendar_plans:' || c.id AS idempotency_key
    FROM public.calendar_plans c
    LEFT JOIN prices p ON p.model = c.model
    , cutoff
   WHERE coalesce(c.input_tokens, 0) + coalesce(c.output_tokens, 0) > 0
     AND coalesce(c.ready_at, c.created_at) < cutoff.at
),
insights AS (
  SELECT i.created_at AS occurred_at, i.client_id, 'report.insights' AS feature, i.report_id::text AS execution_id,
         'anthropic' AS provider, coalesce(i.model, 'unknown') AS resource,
         jsonb_build_object('input_tokens', i.input_tokens, 'output_tokens', i.output_tokens) AS quantities,
         round((i.input_tokens * p.input_usd + i.output_tokens * p.output_usd) / 1000000.0, 6) AS cost_usd,
         CASE WHEN p.model IS NULL THEN 'unpriced' ELSE 'backfill_estimate' END AS cost_source,
         'backfill:report_insights:' || i.id AS idempotency_key
    FROM public.report_insights i
    LEFT JOIN prices p ON p.model = i.model
    , cutoff
   WHERE i.input_tokens + i.output_tokens > 0
     AND i.created_at < cutoff.at
),
all_rows AS (
  SELECT * FROM trend_apify
  UNION ALL SELECT * FROM trend_claude
  UNION ALL SELECT * FROM calendar
  UNION ALL SELECT * FROM insights
)
INSERT INTO public.cost_events (occurred_at, tool, env, client_id, bucket_hint, unattributed, feature, execution_id, actor_kind,
                                provider, resource, quantities, cost_usd, cost_source, price_ref, idempotency_key)
SELECT occurred_at, 'socialytics', 'prod', client_id, 'client', false, feature, execution_id, 'schedule',
       provider, resource, quantities, CASE WHEN cost_source = 'unpriced' THEN NULL ELSE cost_usd END, cost_source,
       CASE WHEN provider = 'anthropic' AND cost_source <> 'unpriced' THEN 'anthropic:' || resource || '@backfill-2026-11-23' END,
       idempotency_key
  FROM all_rows
ON CONFLICT (idempotency_key) DO NOTHING;

-- What it loaded, for the handoff:
SELECT feature, provider, cost_source, count(*) AS events, round(sum(cost_usd), 2) AS usd, min(occurred_at)::date AS since
  FROM public.cost_events
 WHERE cost_source IN ('backfill', 'backfill_estimate') OR idempotency_key LIKE 'backfill:%'
 GROUP BY 1, 2, 3 ORDER BY 1, 2;
