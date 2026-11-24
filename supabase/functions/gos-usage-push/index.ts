import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "../_shared/supabase.ts";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { authServiceFor } from "../_shared/gos/authService.ts";
import { pushUsage, type OutboxRow, type PushState, type SourceRow, type UsageConfig } from "./usage.ts";

/**
 * Sends Socialytics' usage events (public.gos_events) to the gOS Auth Service,
 * POST {AUTH_SERVICE_URL}/usage/events, as the gOS Auth / API Integration
 * Guide §15 asks. The logic and its rules are in usage.ts beside this file.
 *
 * Called by pg_cron every 15 minutes with the x-socialytics-secret header
 * (SOCIALYTICS_N8N_SECRET), as the other scheduled functions are. Never called
 * from a request path.
 *   (no parameters)              send what is pending from the last
 *                                GOS_USAGE_LOOKBACK_DAYS days (default 30)
 *   ?backfill_from=YYYY-MM-DD    one-off: send history from that day (UTC)
 *   ?dry_run=1                   map and count, send and record nothing
 *   ?register_all=1              also re-register every live client that has a slug (daily at 03:00 UTC)
 *   ?force=1                     try again with a token the Auth Service refused
 *
 * Executions: reports.id (content calendars), the only executions gos_events
 * has. Work for clients marked exclude_from_reporting is left out by
 * gos_usage_pending(). With MOBTOOLS_TOOL_TOKEN unset it does nothing.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const env = (name: string) => Deno.env.get(name);
const TOOL_ID = env("TOOL_ID") || "socialytics";

const CONFIG: UsageConfig = {
  tool: TOOL_ID,
  outputKinds: { content_calendar: "content_calendar" },
  quantityKeys: { content_calendar: "posts" },
  // A report with no person and no API caller behind it came from a report schedule.
  defaultMachineActor: "schedule",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const secret = env("SOCIALYTICS_N8N_SECRET");
  if (!secret) return json({ error: "not configured" }, 500);
  if (!(await secretEquals(req.headers.get("x-socialytics-secret"), secret))) return json({ error: "unauthorized" }, 401);

  const url = new URL(req.url);
  const now = new Date();
  const from = url.searchParams.get("backfill_from");
  let since: string;
  if (from) {
    if (!DAY.test(from) || Number.isNaN(Date.parse(`${from}T00:00:00Z`))) {
      return json({ error: "backfill_from must be a day, YYYY-MM-DD" }, 400);
    }
    since = `${from}T00:00:00.000Z`;
  } else {
    const days = Math.max(1, Number(env("GOS_USAGE_LOOKBACK_DAYS") ?? 30) || 30);
    since = new Date(now.getTime() - days * 86_400_000).toISOString();
  }
  const flag = (k: string) => ["1", "true"].includes(url.searchParams.get(k) ?? "");
  const registerAll = flag("register_all") || (now.getUTCHours() === 3 && now.getUTCMinutes() < 15);

  const db = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  try {
    const result = await pushUsage(
      {
        cfg: CONFIG,
        token: env("MOBTOOLS_TOOL_TOKEN"),
        // No origin: production unless AUTH_SERVICE_URL says otherwise (the gos-auth-bridge rule).
        authServiceUrl: authServiceFor("", env("AUTH_SERVICE_URL")),
        userAgent: `${TOOL_ID}/1.0 (gos-usage-push)`,
        fetch: (u, init) => fetch(u, init),
        async loadPending(sinceIso, limit) {
          const { data, error } = await db.rpc("gos_usage_pending", { p_since: sinceIso, p_limit: limit });
          if (error) throw new Error(`gos_usage_pending: ${error.message}`);
          return (data ?? []) as SourceRow[];
        },
        async record(rows: OutboxRow[]) {
          const { error } = await db.from("gos_usage_outbox").upsert(rows, { onConflict: "event_id" });
          if (error) throw new Error(`gos_usage_outbox: ${error.message}`);
        },
        async readState() {
          const { data, error } = await db.from("gos_usage_push_state").select("*").eq("id", 1).maybeSingle();
          if (error) throw new Error(`gos_usage_push_state: ${error.message}`);
          return (data ?? null) as PushState | null;
        },
        async writeState(patch) {
          const { error } = await db.from("gos_usage_push_state").upsert({ id: 1, ...patch }, { onConflict: "id" });
          if (error) throw new Error(`gos_usage_push_state: ${error.message}`);
        },
        now: () => new Date(),
        log: (line) => console.log(JSON.stringify(line)),
        // Live clients with no gOS slug: registered with gOS every run, so a new client never stays unattributed.
        // The clients to register with gOS: every run, the live clients with no slug yet; once a day
        // (03:00 UTC) or with ?register_all=1, also the live clients that have a slug, with it as a hint,
        // so a slug set in the app (or one gOS dropped) is always in gOS's catalog. Demo brands
        // (demo_job_id set or a demo- slug) are left out: they are prospects, not catalog companies.
        // Archived and deleted clients are included: their past runs are still usage to attribute.
        async unslugged() {
          let q = db.from("clients").select("id, name, company_slug, demo_job_id").or("exclude_from_reporting.is.null,exclude_from_reporting.eq.false");
          if (!registerAll) q = q.is("company_slug", null);
          const { data, error } = await q;
          if (error) throw new Error(`clients: ${error.message}`);
          return ((data ?? []) as Array<{ id: string; name: string | null; company_slug: string | null; demo_job_id: string | null }>)
            .filter((c) => c.name?.trim() && !c.demo_job_id && !(c.company_slug ?? "").startsWith("demo-"))
            .map((c) => ({ external_id: c.id, name: c.name!.trim(), ...(c.company_slug ? { slug: c.company_slug } : {}) }));
        },
        // A slug is only ever set where none was: a slug a person or the gOS bridge set is never replaced.
        async saveSlugs(resolved) {
          let saved = 0;
          for (const [id, slug] of Object.entries(resolved)) {
            const { data, error } = await db.from("clients").update({ company_slug: slug }).eq("id", id).is("company_slug", null).select("id");
            if (error) throw new Error(`clients ${id}: ${error.message}`);
            saved += (data ?? []).length;
          }
          return saved;
        },
      },
      { since, dryRun: flag("dry_run"), force: flag("force") },
    );
    // Always 200 for a deferred push: pg_cron has nothing to do about it, the next run retries.
    return json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ event: "GOS_USAGE_PUSH_FAILED", message }));
    return json({ error: message }, 500);
  }
});
