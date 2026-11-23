import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "../_shared/supabase.ts";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { billingCredentials } from "../_shared/paid/index.ts";
import { dayBounds, daysAgo, oursForDay, reconcileDay, saveRows, thresholdFrom, type ReconcileRow } from "../_shared/cost/reconcile.ts";

/**
 * Daily cost reconciliation. For each provider with a billing API, compares
 * what cost_events recorded for a UTC day with what the provider billed, and
 * writes one row per provider to cost_reconciliation (GET /v1/costs returns
 * the latest as "reconciliation"). See _shared/cost/reconcile.ts.
 *
 * Called by pg_cron with the x-socialytics-secret header (SOCIALYTICS_N8N_SECRET), as the other scheduled functions are. By default it
 * checks yesterday and the day before, because Anthropic's figures can take
 * up to a day to settle and a re-run replaces the day's row. ?day=YYYY-MM-DD
 * checks one past day; ?dry_run=1 answers without writing.
 *
 * Drift is logged as a structured COST_DRIFT line. It is not posted to Slack:
 * the only alert path (_shared/alert-webhook.ts) is n8n, which is being
 * turned off.
 *
 * Tolerance: COST_RECONCILE_DRIFT_PCT (default 0.05) and
 * COST_RECONCILE_DRIFT_MIN_USD (default 5).
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
  if (asked) {
    try {
      dayBounds(asked);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
    if (asked >= today) return json({ error: `${asked} has not ended yet (UTC); pick a past day` }, 400);
    days = [asked];
  } else {
    days = [daysAgo(now, 1), daysAgo(now, 2)];
  }
  const dryRun = ["1", "true"].includes(url.searchParams.get("dry_run") ?? "");

  const db = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const threshold = thresholdFrom(env);
  const deps = { fetch: (u: string, init?: RequestInit) => fetch(u, init), env, credentials: billingCredentials };

  const rows: ReconcileRow[] = [];
  try {
    for (const day of days) {
      const ours = await oursForDay(db, day);
      const dayRows = await reconcileDay(day, ours, deps, threshold);
      if (!dryRun) await saveRows(db, dayRows);
      rows.push(...dayRows);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ event: "COST_RECONCILE_FAILED", days, message }));
    return json({ error: message, rows }, 500);
  }

  for (const r of rows) {
    if (r.status === "drift") {
      console.warn(JSON.stringify({ event: "COST_DRIFT", tool: "socialytics", day: r.day, provider: r.provider, ours_usd: r.ours_usd, theirs_usd: r.theirs_usd, diff_usd: Math.round(((r.theirs_usd ?? 0) - r.ours_usd) * 100) / 100, note: r.note }));
    } else if (r.status === "error") {
      console.error(JSON.stringify({ event: "COST_RECONCILE_ERROR", tool: "socialytics", day: r.day, provider: r.provider, note: r.note }));
    }
  }
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return json({ days, dry_run: dryRun, threshold, ok: count("ok"), drift: count("drift"), unreconciled: count("unreconciled"), error: count("error"), rows });
});
