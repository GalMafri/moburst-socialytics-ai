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

      // Same as update-report: derive the runtime from created_at when the
      // workflow does not send a real one, because created_at is the only
      // authoritative start and a code node's idea of it has proven wrong.
      if (!Number(duration_minutes)) {
        const { data: row } = await supabase
          .from("competitive_reports")
          .select("created_at")
          .eq("id", report_id)
          .maybeSingle();
        if (row?.created_at) {
          const minutes = Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000);
          if (minutes >= 0 && minutes < 24 * 60) updates.duration_minutes = minutes;
        }
      }

      // Say when the period is only partly covered.
      //
      // Landscape Social Posts runs once per weekly window and is set to
      // continueErrorOutput, so a window that fails routes its own item to
      // Mark Report Failed while the survivors carry on to a complete report.
      // Because a complete report is never downgraded (see below), the
      // completion wins and the failure disappears: the run finishes on
      // partial data and reads as if it covered the whole month.
      //
      // Merge Post Pages now counts the windows that never arrived, and
      // Cache Posts Snapshot stores its whole output against this report, so
      // the count can be read back here rather than by editing two large code
      // nodes in the workflow.
      if (status === "complete" && report_data && typeof report_data === "object") {
        const { data: snap } = await supabase
          .from("rivaliq_snapshots")
          .select("payload")
          .eq("report_id", report_id)
          .eq("endpoint", "socialposts")
          .order("fetched_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const failed = Number((snap?.payload as Record<string, unknown> | null)?.failed_windows) || 0;
        const expected = Number((snap?.payload as Record<string, unknown> | null)?.expected_windows) || 0;
        if (failed > 0) {
          const rd = report_data as Record<string, unknown>;
          const warning =
            `${failed} of ${expected} weekly windows did not load, so this report covers only part of the period ` +
            `and the comparison is incomplete.`;
          const existing = typeof rd.schema_note === "string" ? rd.schema_note.trim() : "";
          rd.schema_note = existing ? `${warning} ${existing}` : warning;
          const totals = (rd.totals && typeof rd.totals === "object" ? rd.totals : {}) as Record<string, unknown>;
          totals.windows_failed = failed;
          totals.windows_expected = expected;
          rd.totals = totals;
          updates.report_data = rd;
        }
      }

      // A finished report is never downgraded. Every error output in the
      // workflow lands in one "Mark Report Failed" node, including the error
      // output of the POST that writes the finished report — so a timeout on
      // a successful writeback used to replace a complete report with an
      // error stub.
      let query = supabase.from("competitive_reports").update(updates).eq("id", report_id);
      if (status === "failed") query = query.neq("status", "complete");
      const { data, error } = await query.select("id, status");
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        if (status === "failed") return jsonResp({ ok: true, skipped: "report already complete" });
        return jsonResp({ error: "report not found" }, 404);
      }

      // Keep the set's lifecycle in step with its latest run. A successful run
      // supersedes an earlier failure (sets are re-runnable by design), so
      // "complete" may roll forward from failed as well; a failure only marks
      // sets that were mid-run, never one that already completed.
      if (status === "complete" || status === "failed") {
        const { data: rep } = await supabase
          .from("competitive_reports")
          .select("set_id")
          .eq("id", report_id)
          .maybeSingle();
        if (rep?.set_id) {
          const from = status === "complete"
            ? ["confirmed", "analyzing", "failed"]
            : ["confirmed", "analyzing"];
          await supabase
            .from("competitor_sets")
            .update({ status })
            .eq("id", rep.set_id)
            .in("status", from);
        }
      }
      let schedulingWarning: string | undefined;
      if (status === "complete") {
        try {
          const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/trigger-scheduled-reports`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Socialytics-Secret": Deno.env.get("SOCIALYTICS_N8N_SECRET")! },
            body: JSON.stringify({ resume_competitive_report_id: report_id }),
          });
          if (!response.ok) throw new Error(`Scheduler returned ${response.status}`);
        } catch (error) {
          schedulingWarning = "The competitive report is saved. Its waiting social schedule will be checked again by the daily scheduler.";
          console.warn("[competitive schedule resume]", error);
        }
      }
      return jsonResp({ ok: true, report: data[0], ...(schedulingWarning ? { warning: schedulingWarning } : {}) });
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
