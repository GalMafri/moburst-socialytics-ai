// supabase/functions/media-job-status/index.ts
//
// Where a generation that could not be waited out has got to.
//
// Higgsfield's video model takes minutes — about fourteen for a five-second
// clip on the team's account — so generate-post-video submits, records a
// media_jobs row and returns. The browser asks here until the row goes
// terminal.
//
// The provider's own webhook is not the mechanism on this path: the MCP
// tools take no callback url, unlike the REST API that higgsfield-webhook
// was written for. That function still stands for the REST path; this one
// is the MCP path's collector.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { HiggsfieldError } from "../_shared/higgsfield/generate.ts";
import { checkVideoJob } from "../_shared/higgsfield/renderVideo.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TERMINAL = new Set(["completed", "failed", "nsfw", "canceled", "timed_out"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    // Authenticate before anything is revealed, including whether a given
    // job id exists. The client-scoped check follows, once the row says
    // which client the job belongs to.
    await requireStaff(req);

    const body = await req.json().catch(() => ({}));
    const jobId = typeof body?.job_id === "string" ? body.job_id : "";
    if (!jobId) return json({ error: "job_id is required" }, 400);

    const { data: job } = await admin
      .from("media_jobs")
      .select("id, client_id, kind, request_id, status, output_url, seed_image_url, error")
      .eq("id", jobId)
      .maybeSingle();
    if (!job) return json({ error: "That job no longer exists." }, 404);

    // Authorised against the job's own client, so one client's staff cannot
    // read another's generations.
    await requireStaff(req, { writeClientId: job.client_id });

    // Already settled: answer from the row rather than asking the provider
    // again. A browser polls this every few seconds.
    if (TERMINAL.has(job.status)) {
      return json({
        status: job.status,
        video_url: job.output_url,
        seed_image_url: job.seed_image_url,
        error: job.error,
      });
    }
    if (!job.request_id) return json({ status: job.status, video_url: null, error: null });

    const snapshot = await checkVideoJob(admin, job.request_id);
    if (snapshot.status === "running" || snapshot.status === "pending") {
      return json({ status: "running", video_url: null, error: null });
    }

    // Terminal. Record it once so later polls, and anything reading the
    // client's history, do not depend on the provider still knowing.
    const patch =
      snapshot.status === "completed"
        ? { status: "completed", output_url: snapshot.url, error: null, updated_at: new Date().toISOString() }
        : { status: "failed", error: snapshot.error, updated_at: new Date().toISOString() };
    await admin.from("media_jobs").update(patch).eq("id", job.id).not("status", "in", "(completed,failed)");

    return json({
      status: snapshot.status,
      video_url: snapshot.url,
      seed_image_url: job.seed_image_url,
      error: snapshot.error,
    });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    if (err instanceof HiggsfieldError) return json({ error: err.message }, 502);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[media-job-status]", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
