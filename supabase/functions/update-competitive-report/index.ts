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
  if (req.headers.get("x-socialytics-secret") !== secret) {
    return jsonResp({ error: "unauthorized" }, 401);
  }

  try {
    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (body.op === "snapshot") {
      const { client_id, report_id, landscape_id, endpoint, params_hash, payload } = body;
      if (!landscape_id || !endpoint || payload === undefined) {
        return jsonResp({ error: "landscape_id, endpoint and payload are required" }, 400);
      }
      const { data, error } = await supabase
        .from("rivaliq_snapshots")
        .insert({
          client_id: client_id || null,
          report_id: report_id || null,
          landscape_id: String(landscape_id),
          endpoint: String(endpoint).slice(0, 100),
          params_hash: String(params_hash || "").slice(0, 200),
          payload,
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return jsonResp({ ok: true, snapshot_id: data.id });
    }

    if (body.op === "report") {
      const { report_id, status, report_data, gamma_url, duration_minutes } = body;
      if (!report_id) return jsonResp({ error: "report_id is required" }, 400);

      const updates: Record<string, unknown> = {};
      if (status !== undefined) {
        if (!["pending", "running", "complete", "failed"].includes(status)) {
          return jsonResp({ error: `invalid status '${status}'` }, 400);
        }
        updates.status = status;
      }
      if (report_data !== undefined) updates.report_data = report_data;
      if (gamma_url !== undefined) updates.gamma_url = gamma_url;
      if (duration_minutes !== undefined) updates.duration_minutes = duration_minutes;

      const { data, error } = await supabase
        .from("competitive_reports")
        .update(updates)
        .eq("id", report_id)
        .select("id, status");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) return jsonResp({ error: "report not found" }, 404);

      // Keep the set's lifecycle in step with its latest run.
      if (status === "complete" || status === "failed") {
        const { data: rep } = await supabase
          .from("competitive_reports")
          .select("set_id")
          .eq("id", report_id)
          .maybeSingle();
        if (rep?.set_id) {
          await supabase
            .from("competitor_sets")
            .update({ status: status === "complete" ? "complete" : "failed" })
            .eq("id", rep.set_id)
            .in("status", ["confirmed", "analyzing"]);
        }
      }
      return jsonResp({ ok: true, report: data[0] });
    }

    return jsonResp({ error: "op must be 'snapshot' or 'report'" }, 400);
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
