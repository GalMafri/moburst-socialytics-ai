import { competitiveRangeError } from "../_shared/reports/competitiveRange.ts";
// supabase/functions/run-report/index.ts
//
// A person asks for a report for a period. Every run the app starts by hand
// comes through here: the monthly page and the competitive page.
//
// The run itself goes through the scheduled path (run-scheduled-jobs,
// dispatch.ts): this queues a manual dispatch job with the kind and period,
// and the worker makes the report, sends the workflow request, watches it,
// and runs it again quietly when it does not finish, exactly as it does for
// a schedule. Nothing here sends a workflow request, so a request that is
// sent twice, or a page that is reloaded, never starts a second run: an open
// request or a running report for the client answers it.
//
// A report id (an older screen's "Run now" on a run that did not finish)
// asks for that report's kind and period again, the same way.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { type ReportRange, STUCK_AFTER_MINUTES } from "../_shared/reports/payloads.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Kind = "social" | "competitive";
const OPEN = ["queued", "running", "waiting", "blocked"];
const RUNNABLE_SETS = ["confirmed", "analyzing", "complete", "failed"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const retryId: string | undefined = body.report_id || undefined;
    let kind: Kind = body.kind === "competitive" ? "competitive" : "social";
    let clientId: string | undefined = body.client_id || undefined;
    let range: ReportRange = { start: body.date_range_start || "", end: body.date_range_end || "" };
    const skipTrends = body.skip_trends === true;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Staff, before any lookup: an anonymous caller must not tell a real
    // report id from an invented one. The client-scoped check follows.
    await requireStaff(req);

    if (retryId) {
      const social = await admin.from("reports").select("id, client_id, date_range_start, date_range_end").eq("id", retryId).maybeSingle();
      const row = social.data ?? (await admin.from("competitive_reports").select("id, client_id, date_range_start, date_range_end").eq("id", retryId).maybeSingle()).data;
      if (!row) return json({ error: "That report no longer exists." }, 404);
      kind = social.data ? "social" : "competitive";
      clientId = row.client_id;
      if (!range.start) range = { start: row.date_range_start || "", end: row.date_range_end || "" };
    }
    if (!clientId) return json({ error: "client_id is required" }, 400);

    const caller = await requireStaff(req, { writeClientId: clientId });

    const { data: client, error: clientErr } = await admin.from("clients").select("id, name, archived_at").eq("id", clientId).maybeSingle();
    if (clientErr || !client) return json({ error: "Client not found" }, 404);
    if (client.archived_at) return json({ error: `${client.name} is archived.` }, 422);

    // Default range: the last 30 days, matching what the run pages offer.
    if (kind === "competitive" && (!!range.start !== !!range.end)) return json({ error: "Choose both start and end dates." }, 400);
    if (!range.start || !range.end) {
      const end = new Date();
      if (kind === "competitive") end.setUTCDate(end.getUTCDate() - 1);
      const start = new Date(end.getTime() - 29 * 86400000);
      range = { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
    }
    if (kind === "competitive") {
      const rangeError = competitiveRangeError(range);
      if (rangeError) return json({ error: rangeError }, 400);
      // The run reads the client's confirmed selection; tracking for it is
      // the lifecycle's, and the dispatch waits for it when it is still starting.
      const { data: set } = await admin.from("competitor_sets").select("id").eq("client_id", clientId).in("status", RUNNABLE_SETS)
        .order("confirmed_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (!set) return json({ error: `${client.name} has no confirmed competitors yet.` }, 422);
    }

    // An open request, or a report running now, answers this one.
    const existing = await openRequest(admin, clientId, kind);
    if (existing) return json(existing);
    const table = kind === "competitive" ? "competitive_reports" : "reports";
    const { data: active } = await admin.from(table).select("id, created_at, date_range_start, date_range_end")
      .eq("client_id", clientId).eq("status", "running").gt("created_at", new Date(Date.now() - STUCK_AFTER_MINUTES * 60000).toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (active) {
      return json({ report_id: active.id, kind, created_at: active.created_at, range: { start: active.date_range_start, end: active.date_range_end }, resumed: true });
    }

    const requestedAt = new Date().toISOString();
    const { data: job, error: jobError } = await admin.from("scheduled_jobs").insert({
      kind: "dispatch",
      client_id: clientId,
      dedupe_key: `run:${kind}:${clientId}:${range.start}:${range.end}:${Date.now()}`,
      priority: 15,
      available_at: requestedAt,
      payload: { run: "manual", kind, range, requested_by: caller.userId ?? null, requested_at: requestedAt, ...(skipTrends ? { skip_trends: true } : {}) },
      result: { range },
    }).select("id, created_at").single();
    if (jobError) {
      // Two requests at once: the one-open-run index lets one in, and that one answers both.
      const raced = jobError.code === "23505" ? await openRequest(admin, clientId, kind) : null;
      if (raced) return json(raced);
      throw new Error(jobError.message);
    }

    kickWorker();
    return json({ job_id: job.id, kind, range, requested_at: job.created_at, queued: true });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[run-report]", msg);
    return json({ error: msg }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function openRequest(admin: any, clientId: string, kind: Kind) {
  const { data } = await admin.from("scheduled_jobs").select("id, created_at, report_id, payload")
    .eq("kind", "dispatch").eq("client_id", clientId).is("schedule_id", null)
    .eq("payload->>run", "manual").eq("payload->>kind", kind).in("status", OPEN)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return null;
  return { job_id: data.id, kind, range: data.payload?.range ?? null, requested_at: data.created_at, report_id: data.report_id ?? null, queued: true, resumed: true };
}

/** The worker runs every minute; asking it now starts the run in seconds. Best effort. */
function kickWorker() {
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
  if (!url || !secret) return;
  const tick = fetch(`${url}/functions/v1/run-scheduled-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Socialytics-Secret": secret },
    body: "{}",
    signal: AbortSignal.timeout(55_000),
  }).then((r) => r.body?.cancel()).catch((e) => console.warn("[run-report] the worker will pick the run up on its next minute:", e instanceof Error ? e.message : e));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(tick);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
