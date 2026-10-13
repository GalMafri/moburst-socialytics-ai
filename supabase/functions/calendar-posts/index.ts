// supabase/functions/calendar-posts/index.ts
//
// The content calendar's posts (table calendar_posts), for staff and for the
// project's own schedules. Monthly reports plan posts into the calendar when
// they finish (update-report calls the same import); these actions cover
// existing reports and a report staff want to bring in again.
//
//   POST {action:"import_report", report_id}   staff with write access to the report's client
//   POST {action:"import_latest"}              operational secret: each client's latest finished report
//   POST {action:"plan_weeks", client_id, start, count, report_id?}
//        staff or the operational secret: plan weeks from the client's latest
//        report, one week per call, starting the next itself
//   POST {action:"plan_after_report", report_id}   operational secret: the three weeks after a report's own week
//   POST {action:"fill_trend_slots"}           operational secret: write trend slots due in the next 10 days
//   POST {action:"save_copy", client_id, calendar_post_key, post_copy, ...}
//        a member of the client or staff: save a copy edit (a revision row
//        without media) and update the calendar post

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { requireMember } from "../_shared/auth/requireMember.ts";
import { importReportPosts } from "../_shared/calendar/fromReport.ts";
import { type PlanContext, WEEKDAYS, parseWeek, trendSlotPrompt, weekDates, weekPrompt } from "../_shared/calendar/planner.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;
const PLANNER_MODEL = "claude-opus-5-5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};

const service = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = service();
  try {
    const body = await req.json().catch(() => ({}));

    if (body?.action === "import_report") {
      const { data: report } = await admin.from("reports").select("id, client_id, status").eq("id", String(body.report_id || "")).maybeSingle();
      if (!report) return json({ error: "No such report." }, 404);
      await requireStaff(req, { writeClientId: report.client_id });
      if (report.status !== "completed") return json({ error: "The report has not finished yet." }, 409);
      return json(await importReportPosts(admin, report.id));
    }

    if (body?.action === "import_latest") {
      const caller = await requireStaff(req);
      if (!caller.viaSecret) return json({ error: "Not allowed." }, 403);
      const { data: reports } = await admin.from("reports").select("id, client_id, created_at").eq("status", "completed").order("created_at", { ascending: false });
      const latest = new Map<string, string>();
      for (const r of reports ?? []) if (!latest.has(r.client_id)) latest.set(r.client_id, r.id);
      const results: Record<string, unknown> = {};
      for (const [clientId, reportId] of latest) {
        try { results[clientId] = await importReportPosts(admin, reportId); }
        catch (e) { results[clientId] = { error: e instanceof Error ? e.message : String(e) }; }
      }
      return json({ clients: latest.size, results });
    }

    if (body?.action === "save_copy") {
      const clientId = String(body.client_id || "");
      const key = String(body.calendar_post_key || "");
      const copy = String(body.post_copy || "").trim();
      if (!clientId || !key || !copy) return json({ error: "client_id, calendar_post_key and post_copy are required." }, 400);
      const userId = await requireMember(req, clientId);
      const hashtags = Array.isArray(body.hashtags) ? body.hashtags.map(String).slice(0, 30) : null;
      const { error } = await admin.from("post_iterations").insert({
        client_id: clientId, report_id: body.report_id || null, calendar_post_key: key,
        version: Number(body.version) || 1, platform: body.platform || null, post_copy: copy,
        hashtags, cta: body.cta || null, concept: body.concept || null, visual_direction: body.visual_direction || null,
        format: body.format || null, source: body.source === "regeneration" ? "regeneration" : "calendar", created_by: userId,
      });
      if (error) throw new Error(`Could not save the copy: ${error.message}`);
      // The calendar post holds the current copy too, for every view that reads it directly.
      await admin.from("calendar_posts").update({ copy, ...(hashtags ? { hashtags } : {}), ...(body.cta ? { cta: String(body.cta) } : {}) })
        .eq("client_id", clientId).eq("post_key", key);
      return json({ ok: true });
    }

    if (body?.action === "plan_weeks") {
      const clientId = String(body.client_id || "");
      await requireStaff(req, { writeClientId: clientId });
      const start = String(body.start || "");
      const count = Math.max(1, Math.min(6, Number(body.count) || 1));
      if (!clientId || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return json({ error: "client_id and start (a Monday, YYYY-MM-DD) are required." }, 400);
      const work = planWeeks(admin, clientId, mondayOf(start), count, body.report_id ? String(body.report_id) : null);
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) { EdgeRuntime.waitUntil(work.catch((e) => console.error("[calendar-posts] plan:", e))); return json({ accepted: true }, 202); }
      return json(await work);
    }

    if (body?.action === "plan_after_report") {
      const caller = await requireStaff(req);
      if (!caller.viaSecret) return json({ error: "Not allowed." }, 403);
      const { data: report } = await admin.from("reports").select("id, client_id").eq("id", String(body.report_id || "")).maybeSingle();
      if (!report) return json({ error: "No such report." }, 404);
      const { data: own } = await admin.from("calendar_posts").select("post_date").eq("report_id", report.id).order("post_date").limit(1);
      const first = own?.[0]?.post_date;
      if (!first) return json({ planned: 0, note: "The report planned no posts." });
      const work = planWeeks(admin, report.client_id, addDays(mondayOf(first), 7), 3, report.id);
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) { EdgeRuntime.waitUntil(work.catch((e) => console.error("[calendar-posts] plan:", e))); return json({ accepted: true }, 202); }
      return json(await work);
    }

    if (body?.action === "fill_trend_slots") {
      const caller = await requireStaff(req);
      if (!caller.viaSecret) return json({ error: "Not allowed." }, 403);
      return json(await fillTrendSlots(admin));
    }

    return json({ error: `Unknown action '${body?.action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[calendar-posts]", msg);
    return json({ error: msg }, 500);
  }
});

// ── Planning ────────────────────────────────────────────────────────────────

function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
}
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return addDays(day, -((d.getUTCDay() + 6) % 7));
}
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((t) => typeof t === "string").join(": ") : "")).filter(Boolean) : []);

/** Everything a week's plan is written from: the client, its latest report's findings, its posting pattern and nearby posts. */
async function planContext(admin: any, clientId: string, monday: string, reportId: string | null): Promise<{ ctx: PlanContext; reportId: string | null } | null> {
  const { data: client } = await admin.from("clients").select("name, brand_identity, content_pillars, geo, language").eq("id", clientId).maybeSingle();
  if (!client) return null;
  const reportQuery = reportId
    ? admin.from("reports").select("id, report_data").eq("id", reportId).maybeSingle()
    : admin.from("reports").select("id, report_data").eq("client_id", clientId).eq("status", "completed").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: report } = await reportQuery;
  const rd = Array.isArray(report?.report_data) ? report.report_data[0] : report?.report_data;
  const ai = rd?.ai_analysis ?? {};
  const perf = ai.sprout_performance_analysis ?? {};
  const findings = {
    performance: [...strings(perf.key_insights), ...strings(perf.pillar_alignment?.recommendations), ...strings((perf.platform_breakdown ?? []).map((p: any) => p?.headline))],
    trends: [...strings(ai.tiktok_trends_analysis?.opportunities_for_client), ...strings(ai.instagram_trends_analysis?.opportunities_for_client)],
    competitors: strings(ai.competitive_takeaways),
  };

  // The posting pattern: the client's report week, or its most recent planned week.
  const { data: patternRows } = await admin.from("calendar_posts").select("post_date, platform, format, posting_time, report_id, source")
    .eq("client_id", clientId).neq("source", "ad_hoc").order("post_date", { ascending: false }).limit(60);
  const rows = (patternRows ?? []) as Array<{ post_date: string; platform: string; format: string | null; posting_time: string | null; report_id: string | null }>;
  const fromReport = report?.id ? rows.filter((r) => r.report_id === report.id) : [];
  const basis = fromReport.length ? fromReport : rows;
  const firstWeek = basis.length ? mondayOf(basis.map((r) => r.post_date).sort()[0]) : null;
  const pattern = basis
    .filter((r) => firstWeek && r.post_date >= firstWeek && r.post_date <= addDays(firstWeek, 6))
    .map((r) => ({ weekday: WEEKDAYS[(new Date(`${r.post_date}T00:00:00Z`).getUTCDay() + 6) % 7], platform: r.platform, format: r.format, posting_time: r.posting_time }))
    .sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday));
  if (!pattern.length) return null;

  const { data: near } = await admin.from("calendar_posts").select("post_date, platform, copy").eq("client_id", clientId)
    .gte("post_date", addDays(monday, -21)).lte("post_date", addDays(monday, 27)).neq("copy", "").order("post_date");
  return {
    reportId: report?.id ?? null,
    ctx: {
      brand: client.name,
      voice: client.brand_identity?.tone_of_voice ?? null,
      pillars: (Array.isArray(client.content_pillars) ? client.content_pillars : []).map((p: any) => ({ name: String(p?.name ?? ""), description: p?.description ? String(p.description).slice(0, 240) : undefined })).filter((p: any) => p.name),
      market: String(client.geo ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
      languages: String(client.language ?? "").split(",").map((s: string) => s.trim()).filter(Boolean),
      findings,
      pattern,
      nearby: (near ?? []).map((n: any) => ({ date: n.post_date, platform: n.platform, copy: n.copy })),
    },
  };
}

/** Plan one week (unless it already has planned posts), then start the next week's plan. */
async function planWeeks(admin: any, clientId: string, monday: string, count: number, reportId: string | null): Promise<{ planned: number; week: string }> {
  let planned = 0;
  const { count: existing } = await admin.from("calendar_posts").select("id", { count: "exact", head: true })
    .eq("client_id", clientId).gte("post_date", monday).lte("post_date", addDays(monday, 6)).neq("source", "ad_hoc");
  if (!existing) {
    const built = await planContext(admin, clientId, monday, reportId);
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (built && apiKey) {
      let posts = [] as ReturnType<typeof parseWeek>;
      for (let attempt = 0; attempt < 2 && !posts.length; attempt++) {
        const result = await anthropicMessages({ apiKey, body: { model: PLANNER_MODEL, max_tokens: 12000, messages: [{ role: "user", content: weekPrompt(built.ctx, monday) }] } });
        posts = parseWeek(result.text, monday, built.reportId);
      }
      if (posts.length) {
        const rows = posts.map((p) => ({ ...p, client_id: clientId, report_id: built.reportId }));
        const { error } = await admin.from("calendar_posts").insert(rows);
        if (error) throw new Error(`Could not add the week's posts: ${error.message}`);
        planned = rows.length;
      }
    }
  }
  if (count > 1) await nextCall({ action: "plan_weeks", client_id: clientId, start: addDays(monday, 7), count: count - 1, report_id: reportId });
  return { planned, week: monday };
}

async function nextCall(body: Record<string, unknown>): Promise<void> {
  const url = Deno.env.get("SUPABASE_URL");
  const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
  const user = Deno.env.get("SOCIALYTICS_SYSTEM_USER_ID") || "04b86c53-de62-4d3d-a661-c714f337c8fc";
  if (!url || !secret) return;
  try {
    const res = await fetch(`${url}/functions/v1/calendar-posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Socialytics-Secret": secret, "X-Socialytics-User": user },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
  } catch (e) {
    console.warn("[calendar-posts] could not start the next week's plan:", e instanceof Error ? e.message : e);
  }
}

/** Trend slots due in the next 10 days that nobody has written: write each from what is trending now. */
async function fillTrendSlots(admin: any): Promise<{ filled: number; waiting: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const { data: slots } = await admin.from("calendar_posts").select("*").eq("source", "trend_slot").eq("copy", "")
    .gte("post_date", today).lte("post_date", addDays(today, 10)).order("post_date").limit(12);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  let filled = 0;
  for (const slot of slots ?? []) {
    if (!apiKey) break;
    // Someone already wrote it (a saved copy edit): leave it as theirs.
    const { data: edits } = await admin.from("post_iterations").select("id, media_urls").eq("client_id", slot.client_id).eq("calendar_post_key", slot.post_key).limit(5);
    if ((edits ?? []).some((r: any) => !(Array.isArray(r.media_urls) && r.media_urls.length))) continue;
    const built = await planContext(admin, slot.client_id, mondayOf(slot.post_date), null);
    if (!built) continue;
    const since = addDays(today, -14);
    const { data: alerts } = await admin.from("competitive_alerts").select("topic, summary").eq("client_id", slot.client_id).gte("created_at", since).order("created_at", { ascending: false }).limit(6);
    const trends = [
      ...(alerts ?? []).map((a: any) => `${a.topic}${a.summary ? `: ${String(a.summary).slice(0, 200)}` : ""}`),
      ...built.ctx.findings.trends,
    ];
    if (!trends.length) continue;
    // Trends other posts near this date already act on, so two slots in a week do not take the same one.
    const { data: takenRows } = await admin.from("calendar_posts").select("reasons").eq("client_id", slot.client_id).neq("id", slot.id)
      .gte("post_date", addDays(slot.post_date, -7)).lte("post_date", addDays(slot.post_date, 7)).neq("copy", "");
    const taken = (takenRows ?? []).map((r: any) => r.reasons?.[0]).filter((r: any) => r?.type === "trend" && r.label).map((r: any) => String(r.label));
    const result = await anthropicMessages({ apiKey, body: { model: PLANNER_MODEL, max_tokens: 2500, messages: [{ role: "user", content: trendSlotPrompt({ brand: built.ctx.brand, voice: built.ctx.voice, languages: built.ctx.languages, platform: slot.platform, format: slot.format, date: slot.post_date, trends, nearby: built.ctx.nearby, taken }) }] } });
    const start = result.text.indexOf("{"), end = result.text.lastIndexOf("}");
    let out: any = null;
    try { out = start >= 0 && end > start ? JSON.parse(result.text.slice(start, end + 1)) : null; } catch { out = null; }
    const copy = String(out?.copy ?? "").trim();
    if (!copy) continue;
    await admin.from("calendar_posts").update({
      copy,
      hashtags: Array.isArray(out.hashtags) ? out.hashtags.map(String).slice(0, 12) : [],
      cta: out.cta ? String(out.cta) : null,
      visual_direction: out.visual_direction ? String(out.visual_direction) : null,
      reasons: [{ type: "trend", label: String(out.trend || "A current trend").slice(0, 200) }],
    }).eq("id", slot.id).eq("copy", "");
    filled++;
  }
  return { filled, waiting: Math.max(0, (slots ?? []).length - filled) };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
