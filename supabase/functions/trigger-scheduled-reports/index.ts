// Scheduled report runner (feedback item 10).
//
// Called daily by the n8n "Socialytics - Daily Scheduler" workflow with the
// shared secret header. Finds every active schedule whose next_run_at has
// passed and fires its kind:
//   social       → monthly performance report (existing n8n webhook), with the
//                  client's latest complete competitive report attached as
//                  competitive_context so the calendar is competitor-informed.
//   competitive  → RivalIQ competitive analysis (competitive webhook), only
//                  when the client has a confirmed competitor set; otherwise
//                  the run is skipped and the reason recorded in last_result.
// Range: range_mode 'previous_month' covers the first to the last day of the
// previous calendar month, so a run on the 7th reports on the whole prior
// month. next_run_at advances to run_day_of_month of the following month, 07:00 UTC.
//
// FINDING (2026-09-02): nothing had been calling this function — schedules sat
// with stale next_run_at values — so the daily n8n trigger is what makes any
// of this real.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildCompetitivePayload, buildSocialPayload } from "../_shared/reports/payloads.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};

function previousMonthRange(now: Date): { start: string; end: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
}

function currentMonthRange(now: Date): { start: string; end: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { start: first.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
}

function nextRun(now: Date, runDay: number, frequency: string): string {
  if (frequency === "weekly") return new Date(now.getTime() + 7 * 86400000).toISOString();
  if (frequency === "biweekly") return new Date(now.getTime() + 14 * 86400000).toISOString();
  const day = Math.min(Math.max(runDay || 7, 1), 28);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day, 7, 0, 0)).toISOString();
}

/** Compact digest of the latest complete competitive report (mirrors RunAnalysis). */
// Milestone 4: keep each client's competitor feed under a week old. One
// RivalIQ call per client, at most ten clients per daily run, so the weekly
// refresh never competes with the monthly pulls for the hourly budget.
async function refreshStaleFeeds(supabase: any, now: Date, dryRun: boolean, secret: string) {
  const out: unknown[] = [];
  try {
    const { data: sets } = await supabase
      .from("competitor_sets")
      .select("client_id, status, clients!inner(id, name, archived_at)")
      .in("status", ["confirmed", "analyzing", "complete", "failed"]);
    const clientIds = [...new Set((sets || []).filter((s: any) => !s.clients?.archived_at).map((s: any) => s.client_id as string))].slice(0, 25);
    if (clientIds.length === 0) return out;
    const { data: snaps } = await supabase
      .from("rivaliq_snapshots")
      .select("client_id, fetched_at")
      .eq("endpoint", "feed")
      .in("client_id", clientIds)
      .order("fetched_at", { ascending: false });
    const latest = new Map<string, string>();
    for (const s of snaps || []) if (!latest.has(s.client_id)) latest.set(s.client_id, s.fetched_at);
    const stale = clientIds.filter((id) => { const f = latest.get(id); return !f || now.getTime() - new Date(f).getTime() > 6 * 86400000; }).slice(0, 10);
    for (const clientId of stale) {
      if (dryRun) { out.push({ client_id: clientId, status: "would refresh feed" }); continue; }
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/refresh-competitor-feed`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Socialytics-Secret": secret },
          body: JSON.stringify({ client_id: clientId }),
        });
        const j = await r.json().catch(() => ({}));
        out.push({ client_id: clientId, status: r.ok ? "refreshed" : "error", posts: j.posts, alerts: j.alerts, error: j.error });
      } catch (e) {
        out.push({ client_id: clientId, status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    }
  } catch (e) {
    out.push({ status: "error", error: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
  if (!secret) return json({ error: "not configured" }, 500);
  if (req.headers.get("x-socialytics-secret") !== secret) return json({ error: "unauthorized" }, 401);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const now = new Date();
    const dryRun = new URL(req.url).searchParams.get("dry_run") === "1";

    const { data: due, error: dueErr } = await supabase
      .from("report_schedules")
      .select("*, clients(*)")
      .eq("is_active", true)
      .lte("next_run_at", now.toISOString());
    if (dueErr) throw dueErr;
    const feeds = await refreshStaleFeeds(supabase, now, dryRun, secret);
    if (!due || due.length === 0) return json({ message: "No schedules due", triggered: 0, feeds });

    const { data: settings } = await supabase.from("app_settings").select("key, value").in("key", ["n8n_webhook_url", "competitive_n8n_webhook_url"]);
    const socialUrl = settings?.find((s) => s.key === "n8n_webhook_url")?.value;
    const competitiveUrl = settings?.find((s) => s.key === "competitive_n8n_webhook_url")?.value;

    const results: unknown[] = [];
    // Runs fired in the same minute are spaced out: each n8n workflow waits
    // stagger_seconds before its first external call. RivalIQ allows one concurrent
    // call per account (competitive, 150 s apart); the social pipeline shares Sprout,
    // Apify and Gamma quotas across clients (180 s apart).
    let competitiveIndex = 0;
    let socialIndex = 0;
    for (const schedule of due) {
      const client = schedule.clients;
      if (!client || client.archived_at) { results.push({ schedule: schedule.id, status: "skipped", reason: "client archived or missing" }); continue; }
      const range = schedule.range_mode === "previous_month" ? previousMonthRange(now) : currentMonthRange(now);
      const advance = async (result: string) => {
        if (dryRun) return;
        await supabase.from("report_schedules").update({ last_run_at: now.toISOString(), next_run_at: nextRun(now, schedule.run_day_of_month, schedule.frequency), last_result: result.slice(0, 500) }).eq("id", schedule.id);
      };

      try {
        if (schedule.report_kind === "competitive") {
          if (!competitiveUrl) throw new Error("competitive webhook URL not configured");
          const { data: set } = await supabase.from("competitor_sets").select("*").eq("client_id", client.id).in("status", ["confirmed", "complete"]).order("confirmed_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
          if (!set) { await advance("skipped: no confirmed competitor set"); results.push({ client: client.name, kind: "competitive", status: "skipped", reason: "no confirmed competitor set" }); continue; }
          if (dryRun) { results.push({ client: client.name, kind: "competitive", status: "would run", range }); continue; }
          const { data: report, error: repErr } = await supabase.from("competitive_reports").insert({ client_id: client.id, set_id: set.id, status: "running", report_data: {}, date_range_start: range.start, date_range_end: range.end, created_by: schedule.created_by }).select("id").single();
          if (repErr) throw repErr;
          await supabase.from("competitor_sets").update({ status: "analyzing" }).eq("id", set.id).in("status", ["confirmed", "complete", "failed"]);
          const payload = await buildCompetitivePayload({
            supabase, client, reportId: report.id, set, range,
            scheduled: true, staggerSeconds: competitiveIndex++ * 150,
          });
          const r = await fetch(competitiveUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (!r.ok) throw new Error(`competitive webhook ${r.status}`);
          await advance(`triggered competitive report ${report.id}`);
          results.push({ client: client.name, kind: "competitive", status: "triggered", report_id: report.id, range });
          continue;
        }

        // social (default)
        if (!socialUrl) throw new Error("n8n webhook URL not configured");
        if (dryRun) { results.push({ client: client.name, kind: "social", status: "would run", range }); continue; }

        const { data: report, error: reportErr } = await supabase.from("reports").insert({ client_id: client.id, status: "running", report_data: {}, created_by: schedule.created_by, date_range_start: range.start, date_range_end: range.end }).select("id").single();
        if (reportErr) throw reportErr;

        const payload = await buildSocialPayload({
          supabase, client, reportId: report.id, range,
          scheduled: true, staggerSeconds: socialIndex++ * 180,
        });
        const r = await fetch(socialUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error(`social webhook ${r.status}`);
        await advance(`triggered social report ${report.id}`);
        results.push({ client: client.name, kind: "social", status: "triggered", report_id: report.id, range, competitive_context: !!payload.competitive_context });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await advance(`error: ${msg}`);
        results.push({ client: client?.name || schedule.client_id, kind: schedule.report_kind, status: "error", error: msg });
      }
    }
    return json({ triggered: results.length, dry_run: dryRun, results, feeds });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
