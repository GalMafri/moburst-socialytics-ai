// Enqueue the due scheduled work now.
//
// Scheduled reports and competitor feeds run as a queue since 2026-10-06
// (docs/superpowers/specs/2026-10-06-scheduled-report-queue-design.md). The
// daily pg_cron job scheduled-reports-enqueue calls the same SQL function
// directly; this endpoint is the manual and QA way in. ?dry_run=1 returns the
// plan without writing. The scheduled-jobs worker does the work.
//
// Until 2026-10-06 this function did all of it inside one request (abandoned
// runs, every stale feed, every due dispatch), and on that day the feed
// refreshes alone outlasted the caller's timeout.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { secretEquals } from "../_shared/auth/secretEquals.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
  if (!secret) return json({ error: "not configured" }, 500);
  if (!(await secretEquals(req.headers.get("x-socialytics-secret"), secret))) return json({ error: "unauthorized" }, 401);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";
    const { data, error } = await supabase.rpc("enqueue_scheduled_report_jobs", { p_dry_run: dryRun });
    if (error) throw new Error(error.message);
    return json(data);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
