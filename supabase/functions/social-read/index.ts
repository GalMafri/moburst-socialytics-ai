// supabase/functions/social-read/index.ts
//
// The public profile reads of the own competitor analysis (plan:
// docs/superpowers/specs/2026-11-25-own-competitive-cutover-plan.md). A
// function of its own so the readers never add to run-scheduled-jobs'
// upload, which is at its budget (supabase/tests/_shared/packaging.test.ts).
// Only the project calls it, with the operational secret.
//
// POST {"mode":"job","job":{...}}
//     runs one social_read job of the scheduled-jobs worker and answers its
//     outcome (readJob.ts). run-scheduled-jobs calls this for every
//     social_read job it leases and writes the outcome back to the job.
// POST {"mode":"plan"[,"client_id":"<id>"][,"dry_run":false]}
//     a round of reads (plan.ts): which profiles it covers and its estimated
//     cost. A dry run, writing nothing, unless "dry_run": false is sent; then
//     it keeps the profiles in line with the handles and queues one
//     social_read job per profile (paid: Apify). No cron calls it yet.

import { createClient } from "../_shared/supabase.ts";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { apifyClient } from "../_shared/apify/client.ts";
import { costCtx } from "../_shared/paid/index.ts";
import type { ScheduledJob } from "../_shared/scheduled-jobs/types.ts";
import { runSocialRead, SOCIAL_READ_FEATURE } from "./readJob.ts";
import { planReadRound } from "./plan.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
  if (!secret) return json({ error: "not configured" }, 500);
  const presented = req.headers.get("x-socialytics-secret") ?? req.headers.get("x-cron-secret");
  if (!(await secretEquals(presented, secret))) return json({ error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    if (body?.mode === "job") {
      const job = body.job as ScheduledJob | undefined;
      if (!job?.id || job.kind !== "social_read" || !job.client_id) return json({ error: "a social_read job is required" }, 400);
      return json(await runSocialRead(db, job, {
        now: () => new Date(),
        // The job's client, the schedule as the actor and the job as the execution (CLAUDE.md, paid calls).
        apify: (j) => apifyClient({ cost: costCtx({ clientId: j.client_id, feature: SOCIAL_READ_FEATURE, actor: "schedule", executionId: j.id }) }),
      }));
    }
    if (body?.mode === "plan") {
      const clientId = typeof body.client_id === "string" && body.client_id ? body.client_id : null;
      return json(await planReadRound(db, new Date(), { dryRun: body.dry_run !== false, clientId }));
    }
    return json({ error: "mode must be job or plan" }, 400);
  } catch (e) {
    console.error("[social-read]", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
