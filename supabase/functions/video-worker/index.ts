// The video worker: a video post's footage and its join with the cover and
// end cards (_shared/video/steps.ts). It is its own worker, with its own lease
// and timer, because none of its work uses Canva: the Canva worker
// (canva-finish) takes one editing session at a time, and footage that took
// a place in that queue waited behind other posts' slides (13 Oct).
//
//   POST { action: "tick" }  (operational secret) — one pass, in the background;
//   the pass starts the next while video work remains. A minute timer
//   (cron video-worker) restarts it if a pass ever fails to.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { settleRequest } from "../_shared/canva/jobs.ts";
import { wakeVideoWorker } from "../_shared/canva/worker.ts";
import { type VideoJob, runVideoStep } from "../_shared/video/steps.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const WORKER = "video-worker";
const PASS_LEASE_S = 150;
/** A pass stops starting steps after this long, to end inside its lease. */
const PASS_BUDGET_MS = 90_000;
/** A job is held this long while a pass works on it. */
const JOB_LEASE_MS = 120_000;
/** Between passes that found nothing to advance (footage still rendering). */
const IDLE_PAUSE_MS = 15_000;
const MAX_ATTEMPTS = 4;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  if (body?.action !== "tick") return json({ error: "Unknown action." }, 400);
  if (!(await secretEquals(req.headers.get("x-socialytics-secret") ?? "", Deno.env.get("SOCIALYTICS_N8N_SECRET")))) {
    return json({ error: "Not allowed." }, 401);
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const pass = runPass(admin);
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(pass);
    return json({ accepted: true }, 202);
  }
  return json(await pass);
});

// deno-lint-ignore no-explicit-any
async function runPass(admin: any) {
  const holder = crypto.randomUUID();
  const { data: claimed, error } = await admin.rpc("claim_worker_lease", { p_name: WORKER, p_holder: holder, p_seconds: PASS_LEASE_S });
  if (error) return { error: error.message };
  if (!claimed) return { skipped: "A pass is already running." };
  let advanced = 0;
  let failed = false;
  try {
    advanced = await pass(admin);
  } catch (e) {
    failed = true;
    console.error("[video-worker] pass failed:", e instanceof Error ? e.message : e);
  } finally {
    await admin.rpc("release_worker_lease", { p_name: WORKER, p_holder: holder });
  }
  if (!failed && (await workRemains(admin))) {
    if (!advanced) await new Promise((r) => setTimeout(r, IDLE_PAUSE_MS));
    await wakeVideoWorker();
  }
  return { advanced };
}

// deno-lint-ignore no-explicit-any
async function workRemains(admin: any): Promise<boolean> {
  const { count } = await admin.from("canva_finish_jobs").select("id", { count: "exact", head: true })
    .in("status", ["queued", "running"]).eq("input->>kind", "video");
  return !!count;
}

/** Advance every due video job until it waits or the pass's budget is spent. Returns how many moved on. */
// deno-lint-ignore no-explicit-any
async function pass(admin: any): Promise<number> {
  const started = Date.now();
  const now = new Date();
  const { data: due } = await admin.from("canva_finish_jobs").select("id")
    .in("status", ["queued", "running"]).eq("input->>kind", "video")
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .order("created_at").limit(20);
  let advanced = 0;
  const requests = new Set<string>();
  for (const { id } of due ?? []) {
    if (Date.now() - started > PASS_BUDGET_MS) break;
    const { data: rows } = await admin.from("canva_finish_jobs")
      .update({ lease_until: new Date(Date.now() + JOB_LEASE_MS).toISOString(), status: "running", updated_at: new Date().toISOString() })
      .eq("id", id).in("status", ["queued", "running"])
      .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
      .select("id, client_id, step, state, input, attempts, design_request_id, option_index");
    const job = rows?.[0] as (VideoJob & { attempts: number }) | undefined;
    if (!job) continue;
    job.state = job.state ?? {};
    const before = job.step;
    try {
      let result = await runVideoStep(admin, job);
      while (result === "next" && Date.now() - started < PASS_BUDGET_MS) result = await runVideoStep(admin, job);
      if (result === "done") {
        await admin.from("canva_finish_jobs").update({ status: "done", step: job.step, state: job.state, output_path: job.state.final_path, error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      } else {
        await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id);
      }
      if (result === "done" || job.step !== before) advanced++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const attempts = (job.attempts ?? 0) + 1;
      const final = attempts >= MAX_ATTEMPTS || msg.startsWith("FINAL:");
      console.error(`[video-worker] job ${job.id} step ${job.step}:`, msg);
      await admin.from("canva_finish_jobs").update({
        attempts, state: job.state, error: msg.replace(/^FINAL:\s*/, ""), status: final ? "failed" : "running", lease_until: null, updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
    if (job.design_request_id) requests.add(job.design_request_id);
  }
  for (const id of requests) {
    await settleRequest(admin, id).catch((e) => console.error(`[video-worker] request ${id}:`, e instanceof Error ? e.message : e));
  }
  return advanced;
}
