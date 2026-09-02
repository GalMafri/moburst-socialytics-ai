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
function competitiveDigest(report: any, feedback: any[]): Record<string, unknown> | null {
  if (!report?.report_data) return null;
  const rd = report.report_data;
  const ai = rd.ai_analysis || {};
  const companies: any[] = rd.aggregates?.companies || [];
  const me = companies.find((c) => c.is_client);
  const rivals = companies.filter((c) => !c.is_client && c.post_count > 0);
  const total = companies.reduce((s, c) => s + (c.post_count || 0), 0);
  const down = new Set(feedback.filter((f) => f.verdict === "down").map((f) => f.insight_key));
  const up = new Set(feedback.filter((f) => f.verdict === "up").map((f) => f.insight_key));
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 120);
  const gaps: any[] = Array.isArray(ai.gaps_for_client) ? ai.gaps_for_client : [];
  return {
    analyzed_at: report.created_at,
    landscape: rd.landscape?.name || null,
    period: rd.period || null,
    benchmark_score: ai.benchmark_scorecard?.client_score ?? null,
    benchmark_dimensions: (ai.benchmark_scorecard?.dimensions || []).map((d: any) => ({ dimension: d.dimension, client: d.client, competitor_avg: d.competitor_avg })),
    share_of_voice_pct: me && total ? Math.round((me.post_count / total) * 100) : null,
    client: me ? { cadence_per_week: me.cadence_per_week, engagement_rate_avg: me.engagement_rate_avg, channel_mix: me.channel_mix } : null,
    competitors: rivals.map((c) => ({ name: c.name, cadence_per_week: c.cadence_per_week, engagement_rate_avg: c.engagement_rate_avg, channel_mix: c.channel_mix, top_hashtags: (c.top_hashtags || []).slice(0, 5).map((h: any) => h.key) })),
    executive_summary: ai.executive_summary || null,
    gaps: gaps.filter((g) => !down.has(key(g.gap || ""))).map((g) => ({ gap: g.gap, platform: g.platform || "all", suggested_play: g.suggested_play })),
    endorsed_gaps: gaps.filter((g) => up.has(key(g.gap || ""))).map((g) => ({ gap: g.gap, platform: g.platform || "all", suggested_play: g.suggested_play })),
    suppressed_gaps: feedback.filter((f) => f.verdict === "down").map((f) => f.gap_text),
    winner_patterns: (ai.winner_teardown || []).map((w: any) => ({ competitor: w.competitor, pattern: w.pattern })),
    posting_time: ai.posting_time_insights || null,
  };
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
    if (!due || due.length === 0) return json({ message: "No schedules due", triggered: 0 });

    const { data: settings } = await supabase.from("app_settings").select("key, value").in("key", ["n8n_webhook_url", "competitive_n8n_webhook_url"]);
    const socialUrl = settings?.find((s) => s.key === "n8n_webhook_url")?.value;
    const competitiveUrl = settings?.find((s) => s.key === "competitive_n8n_webhook_url")?.value;

    const results: unknown[] = [];
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
          const { data: comps } = await supabase.from("competitors").select("*, competitor_handles(*)").eq("set_id", set.id).eq("is_selected", true).order("selected_rank");
          const { data: fb } = await supabase.from("competitive_insight_feedback").select("gap_text, verdict").eq("client_id", client.id).eq("verdict", "down");
          if (dryRun) { results.push({ client: client.name, kind: "competitive", status: "would run", range }); continue; }
          const { data: report, error: repErr } = await supabase.from("competitive_reports").insert({ client_id: client.id, set_id: set.id, status: "running", report_data: {}, date_range_start: range.start, date_range_end: range.end, created_by: schedule.created_by }).select("id").single();
          if (repErr) throw repErr;
          await supabase.from("competitor_sets").update({ status: "analyzing" }).eq("id", set.id).in("status", ["confirmed", "complete", "failed"]);
          const payload = {
            report_id: report.id, client_id: client.id, client_name: client.name, company_slug: client.company_slug, website_url: client.website_url,
            set_id: set.id, rivaliq_landscape_id: set.rivaliq_landscape_id || undefined,
            date_range_start: range.start, date_range_end: range.end,
            suppressed_insights: (fb || []).map((f) => f.gap_text),
            competitors: (comps || []).map((c: any) => ({ id: c.id, rank: c.selected_rank, name: c.name, website_url: c.website_url, rivaliq_company_id: c.rivaliq_company_id, handles: (c.competitor_handles || []).filter((h: any) => h.is_active).map((h: any) => ({ platform: h.platform, handle: h.handle, url: h.profile_url })) })),
            scheduled: true,
          };
          const r = await fetch(competitiveUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          if (!r.ok) throw new Error(`competitive webhook ${r.status}`);
          await advance(`triggered competitive report ${report.id}`);
          results.push({ client: client.name, kind: "competitive", status: "triggered", report_id: report.id, range });
          continue;
        }

        // social (default)
        if (!socialUrl) throw new Error("n8n webhook URL not configured");
        const { data: profiles } = await supabase.from("sprout_profiles").select("*").eq("client_id", client.id).eq("is_active", true);
        const { data: compReport } = await supabase.from("competitive_reports").select("id, created_at, report_data").eq("client_id", client.id).eq("status", "complete").order("created_at", { ascending: false }).limit(1).maybeSingle();
        const { data: feedback } = await supabase.from("competitive_insight_feedback").select("insight_key, verdict, gap_text").eq("client_id", client.id);
        if (dryRun) { results.push({ client: client.name, kind: "social", status: "would run", range, competitive_context: !!compReport }); continue; }

        const { data: report, error: reportErr } = await supabase.from("reports").insert({ client_id: client.id, status: "running", report_data: {}, created_by: schedule.created_by, date_range_start: range.start, date_range_end: range.end }).select("id").single();
        if (reportErr) throw reportErr;

        let brandNotes = client.brand_notes || ""; let brandVoice = "";
        const voiceMatch = brandNotes.match(/^\[VOICE:(.+?)]\n?/);
        if (voiceMatch) { brandVoice = voiceMatch[1]; brandNotes = brandNotes.slice(voiceMatch[0].length); }
        const split = (v: string | null, d: string[]) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);
        const payload = {
          report_id: report.id, client_name: client.name, sprout_customer_id: client.sprout_customer_id || "1676448",
          profile_ids: (profiles || []).map((p: any) => p.sprout_profile_id),
          profiles: (profiles || []).map((p: any) => ({ id: p.sprout_profile_id, name: p.profile_name, native_name: p.native_name, network: p.network_type, url: p.native_link })),
          social_keywords: client.social_keywords || [], trends_keywords: client.trends_keywords || "", content_pillars: client.content_pillars || [],
          primary_platforms: (client.primary_platforms || []).join(","), geo: split(client.geo, ["US"]), languages: split(client.language, ["en"]),
          brand_voice: brandVoice, brand_notes: brandNotes, brand_book_text: client.brand_book_text || "", brief_text: client.brief_text || "", brief_file_id: client.brief_file_id || "",
          design_style_synthesis: client.design_style_synthesis || null, design_references: client.design_references || [], brand_book_file_path: client.brand_book_file_path || null,
          date_range_start: range.start, date_range_end: range.end, skip_trends: false, timezone: client.timezone || "UTC",
          competitive_context: competitiveDigest(compReport, feedback || []),
          scheduled: true,
        };
        const r = await fetch(socialUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error(`social webhook ${r.status}`);
        await advance(`triggered social report ${report.id}`);
        results.push({ client: client.name, kind: "social", status: "triggered", report_id: report.id, range, competitive_context: !!compReport });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await advance(`error: ${msg}`);
        results.push({ client: client?.name || schedule.client_id, kind: schedule.report_kind, status: "error", error: msg });
      }
    }
    return json({ triggered: results.length, dry_run: dryRun, results });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
