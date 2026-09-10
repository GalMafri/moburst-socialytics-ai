// supabase/functions/run-report/index.ts
//
// Starts a report run, or starts a failed one again.
//
// Every run in the app comes through here — the monthly page, the
// competitive page, and the Retry control on any list — so there is one
// place that decides what n8n receives. Before this, three copies of the
// payload existed and had already drifted apart.
//
// A retry reuses the failed report's own row rather than making a new one:
// the row holds nothing but an error, n8n writes its result back to that
// report_id, and the run keeps the place it already has in the client's
// history.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { buildCompetitivePayload, buildSocialPayload, type ReportRange } from "../_shared/reports/payloads.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Kind = "social" | "competitive";

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

    // A retry names only the report; everything else comes from the row.
    let existing: any = null;
    let existingSetId: string | null = null;
    if (retryId) {
      const social = await admin
        .from("reports")
        .select("id, client_id, status, date_range_start, date_range_end")
        .eq("id", retryId)
        .maybeSingle();
      if (social.data) {
        existing = social.data;
        kind = "social";
      } else {
        const comp = await admin
          .from("competitive_reports")
          .select("id, client_id, status, set_id, date_range_start, date_range_end")
          .eq("id", retryId)
          .maybeSingle();
        if (!comp.data) return json({ error: "That report no longer exists." }, 404);
        existing = comp.data;
        existingSetId = comp.data.set_id;
        kind = "competitive";
      }
      clientId = existing.client_id;
      if (!range.start) range = { start: existing.date_range_start || "", end: existing.date_range_end || "" };
    }

    if (!clientId) return json({ error: "client_id is required" }, 400);

    // Staff, with write access to this client. Checked before anything is
    // read back to the caller.
    await requireStaff(req, { writeClientId: clientId });

    if (existing && existing.status === "running") {
      return json({ error: "That run is still going. Wait for it to finish or fail." }, 409);
    }

    const { data: client, error: clientErr } = await admin.from("clients").select("*").eq("id", clientId).maybeSingle();
    if (clientErr || !client) return json({ error: "Client not found" }, 404);
    if (client.archived_at) return json({ error: `${client.name} is archived.` }, 422);

    const settingKey = kind === "competitive" ? "competitive_n8n_webhook_url" : "n8n_webhook_url";
    const { data: setting } = await admin.from("app_settings").select("value").eq("key", settingKey).maybeSingle();
    if (!setting?.value) {
      return json({ error: `The ${kind === "competitive" ? "competitive" : "monthly"} workflow is not configured (app_settings.${settingKey}).` }, 500);
    }

    // Default range: the last 30 days, matching what the run pages offer.
    if (!range.start || !range.end) {
      const end = new Date();
      const start = new Date(end.getTime() - 29 * 86400000);
      range = { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
    }

    let reportId: string;
    let payload: Record<string, unknown>;

    if (kind === "competitive") {
      // The set the failed run used, or the client's current confirmed one.
      let set: any = null;
      if (existingSetId) {
        const { data } = await admin.from("competitor_sets").select("*").eq("id", existingSetId).maybeSingle();
        set = data;
      }
      if (!set) {
        const { data } = await admin
          .from("competitor_sets")
          .select("*")
          .eq("client_id", clientId)
          .in("status", ["confirmed", "analyzing", "complete", "failed"])
          .order("confirmed_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        set = data;
      }
      if (!set) return json({ error: `${client.name} has no confirmed competitor set to analyse.` }, 422);

      if (existing) {
        reportId = existing.id;
        const { error } = await admin
          .from("competitive_reports")
          .update({ status: "running", report_data: {}, set_id: set.id, date_range_start: range.start, date_range_end: range.end })
          .eq("id", reportId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await admin
          .from("competitive_reports")
          .insert({ client_id: clientId, set_id: set.id, status: "running", report_data: {}, date_range_start: range.start, date_range_end: range.end })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        reportId = data.id;
      }
      // The set follows its run, so a retry takes it out of 'failed'.
      await admin.from("competitor_sets").update({ status: "analyzing" }).eq("id", set.id).in("status", ["confirmed", "complete", "failed"]);
      payload = await buildCompetitivePayload({ supabase: admin, client, reportId, set, range });
    } else {
      if (existing) {
        reportId = existing.id;
        const { error } = await admin
          .from("reports")
          .update({ status: "running", report_data: {}, date_range_start: range.start, date_range_end: range.end })
          .eq("id", reportId);
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await admin
          .from("reports")
          .insert({ client_id: clientId, status: "running", report_data: {}, date_range_start: range.start, date_range_end: range.end })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        reportId = data.id;
      }
      payload = await buildSocialPayload({ supabase: admin, client, reportId, range, skipTrends });
    }

    const resp = await fetch(setting.value, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      // The row was set running; a webhook that never accepted the run must
      // not leave it spinning for ever.
      const table = kind === "competitive" ? "competitive_reports" : "reports";
      await admin
        .from(table)
        .update({ status: "failed", report_data: { error: `The workflow did not accept the run (${resp.status}).` } })
        .eq("id", reportId);
      return json({ error: `The workflow returned ${resp.status}${text ? `. ${text.slice(0, 200)}` : "."}` }, 502);
    }

    return json({ report_id: reportId, kind, range, retried: !!existing });
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[run-report]", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
