// Writeback endpoint for the competitive n8n workflow.
//
// Deliberately NOT a copy of update-report, whose lack of any caller check is
// a flagged pre-existing hole. n8n is not a user session, so the gate is a
// shared secret header: X-Socialytics-Secret must equal the
// SOCIALYTICS_N8N_SECRET edge secret (stored in n8n as a Header Auth
// credential). verify_jwt is off like every function here; the secret is the
// actual gate.
//
// Two operations, one endpoint, so n8n needs a single credential + URL:
//   { op: "snapshot", ... }  append a raw RivalIQ response to rivaliq_snapshots
//   { op: "report", ... }    update a competitive_reports row (status/data/deck)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleCompetitiveWrite } from "../_shared/competitive/reportWriter.ts";
import { secretEquals } from "../_shared/auth/secretEquals.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ error: "method not allowed" }, 405);

  const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
  if (!secret) {
    console.error("[update-competitive-report] SOCIALYTICS_N8N_SECRET is not set");
    return jsonResp({ error: "not configured" }, 500);
  }
  if (!(await secretEquals(req.headers.get("x-socialytics-secret"), secret))) {
    return jsonResp({ error: "unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // The write itself is shared with the in-app competitive pipeline
    // (_shared/competitive/reportWriter.ts), so both store a report the same way.
    const result = await handleCompetitiveWrite(supabase, body);
    return jsonResp(result.body, result.status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[update-competitive-report]", msg);
    return jsonResp({ error: msg }, 500);
  }
});

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
