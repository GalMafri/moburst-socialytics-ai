// Milestone 4, steps 12 and 13: the competitor feed and trend detection.
//
// Pulls the last few days of posts for the client's RivalIQ landscape (one
// call, well inside the 100-per-hour budget), stores them as a `feed` snapshot
// in rivaliq_snapshots, then asks the model which topics two or more companies
// posted about inside the window. Each convergence becomes a competitive_alerts
// row with a confidence score. Called from the feed page (staff) and once a
// week by trigger-scheduled-reports (shared secret).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireStaff } from "../_shared/auth/requireStaff.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};
const RIVALIQ = "https://api.rivaliq.com/v3";
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const slug = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "topic";

async function rivaliq(path: string, key: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${RIVALIQ}${path}${sep}apiKey=${encodeURIComponent(key)}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`RivalIQ ${path.split("?")[0]} failed [${r.status}]: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

type Topic = { topic: string; summary: string; companies: string[]; platforms: string[]; post_urls: string[]; confidence: number };

/** Topics that two or more companies posted about in the window, with confidence. */
async function detectTopics(clientName: string, posts: any[], start: string, end: string): Promise<Topic[]> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key || posts.length < 2) return [];
  const compact = posts
    .slice()
    .sort((a, b) => (Number(b.engagementTotal) || 0) - (Number(a.engagementTotal) || 0))
    .slice(0, 120)
    .map((p) => ({
      company: p.companyName || String(p.companyId),
      is_client: String(p.companyName || "").toLowerCase().includes(clientName.toLowerCase()),
      channel: p.channel,
      date: String(p.publishedAt || "").slice(0, 10),
      text: String(p.message || "").replace(/\s+/g, " ").slice(0, 220),
      engagement: Number(p.engagementTotal) || 0,
      url: p.postLink || null,
    }));
  const prompt = `You monitor a social media competitive landscape for the client "${clientName}". Below are the posts every company in the landscape published between ${start} and ${end}.

Find TOPICS (themes, formats, news hooks, campaigns, moments) that at least TWO DIFFERENT companies posted about inside this window. For each, give a short topic name, a one-sentence summary of how the companies approached it, the list of companies, the platforms involved, the post URLs that prove it (only URLs from the data), and a confidence between 0 and 1 that this is a real shared trend rather than a coincidence (more companies, more posts, closer dates and clearer wording mean higher confidence). Ignore generic always-on themes such as "posts about the company" unless the framing is clearly shared. Return at most 8 topics, best first.

Return ONLY JSON in this shape:
{"topics":[{"topic":"...","summary":"...","companies":["..."],"platforms":["instagram"],"post_urls":["https://..."],"confidence":0.8}]}

POSTS:
${JSON.stringify(compact)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) {
    console.error("[refresh-competitor-feed] model error", r.status, (await r.text()).slice(0, 200));
    return [];
  }
  const text: string = (await r.json()).content?.[0]?.text?.trim() || "";
  const raw = text.match(/\{[\s\S]*\}/)?.[0] || "";
  try {
    const parsed = JSON.parse(raw);
    const topics: Topic[] = Array.isArray(parsed?.topics) ? parsed.topics : [];
    const known = new Set(compact.map((p) => p.url).filter(Boolean));
    return topics
      .filter((t) => t && t.topic && Array.isArray(t.companies) && t.companies.length >= 2)
      .map((t) => ({
        topic: String(t.topic).slice(0, 120),
        summary: String(t.summary || "").slice(0, 600),
        companies: [...new Set(t.companies.map(String))],
        platforms: [...new Set((t.platforms || []).map((p: string) => String(p).toLowerCase()))],
        post_urls: [...new Set((t.post_urls || []).filter((u: string) => known.has(u)))],
        confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0.5)),
      }));
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const clientId = String(body.client_id || "");
    const secret = Deno.env.get("SOCIALYTICS_N8N_SECRET");
    const viaSecret = !!secret && req.headers.get("X-Socialytics-Secret") === secret;
    if (!viaSecret) await requireStaff(req);
    if (!clientId) return json({ error: "client_id is required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: client } = await admin.from("clients").select("id, name").eq("id", clientId).maybeSingle();
    if (!client) return json({ error: "Client not found" }, 404);
    const key = Deno.env.get("RIVALIQ_API_KEY");
    if (!key) return json({ error: "RIVALIQ_API_KEY is not configured" }, 500);

    // The landscape comes from the confirmed set when it was imported from
    // RivalIQ; otherwise match the landscape whose focus company is the client.
    const { data: set } = await admin
      .from("competitor_sets")
      .select("id, rivaliq_landscape_id")
      .eq("client_id", clientId)
      .in("status", ["confirmed", "analyzing", "complete", "failed"])
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    let landscapeId = set?.rivaliq_landscape_id ? String(set.rivaliq_landscape_id) : null;
    if (!landscapeId) {
      const list = await rivaliq("/landscapes", key);
      const needle = String(client.name).toLowerCase();
      const match = (list.landscapes || []).find((l: any) => {
        const focus = (l.companies || []).find((c: any) => String(c.id) === String(l.focusCompanyId));
        const fn = String(focus?.name || "").toLowerCase();
        return fn && (fn.includes(needle) || needle.includes(fn));
      });
      if (!match) return json({ error: `No RivalIQ landscape has ${client.name} as its focus company.` }, 422);
      landscapeId = String(match.id);
    }

    const days = Math.min(30, Math.max(1, Number(body.days) || 7));
    const end = new Date(Date.now() - DAY);
    const start = new Date(end.getTime() - (days - 1) * DAY);
    const window = { start: iso(start), end: iso(end) };
    const resp = await rivaliq(`/landscapes/${landscapeId}/socialposts?mainPeriodStart=${window.start}&mainPeriodEnd=${window.end}`, key);
    const socialPosts: any[] = Array.isArray(resp?.socialPosts) ? resp.socialPosts : [];

    await admin.from("rivaliq_snapshots").insert({
      client_id: clientId,
      landscape_id: landscapeId,
      endpoint: "feed",
      payload: { window, socialPosts, fetched_at: new Date().toISOString(), truncated: socialPosts.length >= 100 },
    });

    const topics = await detectTopics(client.name, socialPosts, window.start, window.end);
    let saved = 0;
    for (const t of topics) {
      const { error } = await admin.from("competitive_alerts").upsert(
        {
          client_id: clientId,
          window_start: window.start,
          window_end: window.end,
          topic: t.topic,
          topic_key: slug(t.topic),
          summary: t.summary,
          companies: t.companies,
          platforms: t.platforms,
          post_urls: t.post_urls,
          post_count: t.post_urls.length,
          confidence: t.confidence,
        },
        { onConflict: "client_id,window_start,topic_key", ignoreDuplicates: false },
      );
      if (!error) saved += 1;
      else console.error("[refresh-competitor-feed] alert upsert failed", error.message);
    }

    return json({ client_id: clientId, landscape_id: landscapeId, window, posts: socialPosts.length, truncated: socialPosts.length >= 100, alerts: saved });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    console.error("[refresh-competitor-feed]", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, status);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
