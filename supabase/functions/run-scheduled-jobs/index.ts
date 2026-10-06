// The scheduled-jobs worker. Design: docs/superpowers/specs/2026-10-06-scheduled-report-queue-design.md
//
// POST {}                      the per-minute tick (pg_cron job scheduled-jobs-worker):
//                              sweep abandoned runs, then lease and run due jobs.
// POST {"mode":"status"}       the daily check (n8n): 200 when nothing needs a person,
//                              500 listing failed, blocked, stuck and overdue jobs.
// POST {"mode":"dry_run"}      what the next enqueue would add, and every due dispatch
//                              built against live data with no writes and no requests.
//
// Authenticated with the operational secret (X-Socialytics-Secret or X-Cron-Secret).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { buildCompetitivePayload, buildSocialPayload } from "../_shared/reports/payloads.ts";
import { closeAbandonedRuns } from "../_shared/reports/schedule.ts";
import { refreshCompetitorFeed } from "../_shared/competitive/refreshFeed.ts";
import { makePoster, runDispatch, type DispatchDeps } from "./dispatch.ts";
import { runFeedJob } from "./feed.ts";
import { LEASE_SECONDS, summarize, workerTick } from "./worker.ts";
import { makeDispatchStore, makeJobStore } from "./store.ts";
import type { ScheduledJob } from "./types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
  if (!secret) return json({ error: "not configured" }, 500);
  const presented = req.headers.get("x-socialytics-secret") ?? req.headers.get("x-cron-secret");
  if (!(await secretEquals(presented, secret))) return json({ error: "unauthorized" }, 401);

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const mode = typeof body.mode === "string" ? body.mode : "tick";
    const jobs = makeJobStore(db);
    const store = makeDispatchStore(db);
    const post = makePoster(secret);
    const dispatchDeps = (job: ScheduledJob, dryRun: boolean): DispatchDeps => ({
      store,
      now: () => new Date(),
      post,
      // deno-lint-ignore no-explicit-any
      buildSocialPayload: (a) => buildSocialPayload({ supabase: db, ...a } as any),
      // deno-lint-ignore no-explicit-any
      buildCompetitivePayload: (a) => buildCompetitivePayload({ supabase: db, ...a } as any),
      saveJob: (patch) => (dryRun ? Promise.resolve() : jobs.saveJob(job.id, patch)),
      dryRun,
    });
    const refreshFeed = (clientId: string) => refreshCompetitorFeed(db, clientId, {
      rivaliqKey: Deno.env.get("RIVALIQ_API_KEY"),
      anthropicKey: Deno.env.get("ANTHROPIC_API_KEY"),
      secret,
    });

    if (mode === "status") {
      const now = new Date();
      const summary = summarize(await jobs.statusRows(now), now, await jobs.gaps(now));
      // The rows carry the client's name and the schedule's kind (embedded by statusRows) for a readable alert.
      type Named = ScheduledJob & { clients?: { name?: string } | null; report_schedules?: { report_kind?: string } | null };
      const brief = (rows: ScheduledJob[]) => (rows as Named[]).map((r) => ({
        id: r.id, client: r.clients?.name ?? r.client_id, job: r.kind === "dispatch" ? `${r.report_schedules?.report_kind ?? "report"} dispatch` : "feed refresh",
        status: r.status, reason: r.reason, attempts: r.attempts,
      }));
      return json({
        ok: summary.ok, at: now.toISOString(), counts: summary.counts,
        failed: brief(summary.failed), blocked: brief(summary.blocked), stuck: brief(summary.stuck), overdue: brief(summary.overdue),
        unscheduled: summary.unscheduled.map((g) => ({ client: g.client_name ?? g.client_id, job: `${g.report_kind} dispatch`, reason: `due ${g.next_run_at} and never queued` })),
      }, summary.ok ? 200 : 500);
    }

    if (mode === "dry_run") {
      const plan = await jobs.enqueue(true);
      const now = new Date().toISOString();
      const dispatch = [];
      for (const c of plan.enqueued.filter((j) => j.kind === "dispatch")) {
        const schedule = c.schedule_id ? await store.schedule(c.schedule_id) : null;
        const virtual: ScheduledJob = {
          id: `dry-${c.schedule_id}`, kind: "dispatch", client_id: c.client_id, schedule_id: c.schedule_id, occurrence: schedule?.next_run_at ?? null,
          priority: c.priority, stagger_seconds: c.stagger_seconds, status: "running", phase: null, report_id: null, attempts: 1, max_attempts: 3,
          available_at: now, lease_until: null, reason: null, result: null, created_at: now, started_at: now, finished_at: null,
        };
        const outcome = await runDispatch(virtual, dispatchDeps(virtual, true));
        dispatch.push({ client_id: c.client_id, kind: c.detail, schedule_id: c.schedule_id, stagger_seconds: c.stagger_seconds, ...outcome });
      }
      return json({ plan, dispatch });
    }

    const result = await workerTick({
      now: () => new Date(),
      lease: () => jobs.lease(LEASE_SECONDS),
      run: (job) => (job.kind === "dispatch"
        ? runDispatch(job, dispatchDeps(job, false))
        : runFeedJob(job, { now: () => new Date(), refreshFeed })),
      finish: (job, outcome) => jobs.finish(job, outcome),
      closeAbandoned: () => closeAbandonedRuns(db, new Date(), false),
      releaseReady: () => jobs.releaseReady(),
    });
    return json(result);
  } catch (err) {
    console.error("[run-scheduled-jobs]", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
