import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "../_shared/supabase.ts";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { socialyticsCheckDeps } from "../_shared/paid/checks.ts";
import { rangeDays, runChecks } from "../_shared/cost/audit.ts";
import { dayBounds, daysAgo } from "../_shared/cost/reconcile.ts";

/**
 * The cost checks (see _shared/cost/audit.ts): for each provider with a
 * billing API, compares what cost_events recorded for a UTC day with what the
 * provider billed (cost_reconciliation); counts paid calls whose intent was
 * never completed (unrecorded calls); audits every Apify run on the account
 * (records a missed run of Socialytics' own actors, puts others up for review in
 * cost_unclaimed_runs); and keeps what needs a person in cost_alerts, which
 * GET /v1/costs returns as "alerts". Nothing is posted to Slack, email or n8n.
 *
 * Called by pg_cron with the x-socialytics-secret header (SOCIALYTICS_N8N_SECRET), as the other scheduled functions are. By default it
 * checks yesterday and the day before, because Anthropic's figures can take
 * up to a day to settle and a re-run replaces the day's row.
 *   ?day=YYYY-MM-DD                 one past day
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD  a range of past days (at most 90)
 *   ?dry_run=1                      answer without writing anything
 *   ?mode=history                   also load past Apify runs of Socialytics' own
 *                                   actors, assigned to clients (one-off)
 * An admin key reaches the same through the api function:
 * POST /v1/admin/cost-check?from=…&to=…
 *
 * Tolerance: COST_RECONCILE_DRIFT_PCT (default 0.05) and
 * COST_RECONCILE_DRIFT_MIN_USD (default 5). Unattributed share alert:
 * COST_ALERT_UNATTRIBUTED_PCT (default 0.1).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const env = (name: string) => Deno.env.get(name);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const secret = env("SOCIALYTICS_N8N_SECRET");
  if (!secret) return json({ error: "not configured" }, 500);
  if (!(await secretEquals(req.headers.get("x-socialytics-secret"), secret))) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const now = new Date();
  const today = daysAgo(now, 0);
  let days: string[];
  const asked = url.searchParams.get("day");
  const from = url.searchParams.get("from");
  try {
    if (from) {
      days = rangeDays(from, url.searchParams.get("to") ?? from, today);
    } else if (asked) {
      dayBounds(asked);
      if (asked >= today) return json({ error: `${asked} has not ended yet (UTC); pick a past day` }, 400);
      days = [asked];
    } else {
      days = [daysAgo(now, 1), daysAgo(now, 2)];
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  const dryRun = ["1", "true"].includes(url.searchParams.get("dry_run") ?? "");
  const mode = url.searchParams.get("mode") === "history" ? "history" : "check";

  const db = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  let result;
  try {
    result = await runChecks({ days, dryRun, mode }, socialyticsCheckDeps(db));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ event: "COST_RECONCILE_FAILED", days, message }));
    return json({ error: message }, 500);
  }

  for (const r of result.rows) {
    if (r.status === "drift") {
      console.warn(JSON.stringify({ event: "COST_DRIFT", tool: "socialytics", day: r.day, provider: r.provider, ours_usd: r.ours_usd, theirs_usd: r.theirs_usd, diff_usd: Math.round(((r.theirs_usd ?? 0) - r.ours_usd) * 100) / 100, note: r.note }));
    } else if (r.status === "error") {
      console.error(JSON.stringify({ event: "COST_RECONCILE_ERROR", tool: "socialytics", day: r.day, provider: r.provider, note: r.note }));
    }
  }
  if (result.alerts.length) console.warn(JSON.stringify({ event: "COST_ALERTS", tool: "socialytics", dry_run: dryRun, alerts: result.alerts.map((a) => a.dedupe_key) }));
  return json(result);
});
