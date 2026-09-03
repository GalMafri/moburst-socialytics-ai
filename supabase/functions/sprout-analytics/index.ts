// Live Sprout Social analytics for one client over a chosen date range
// (feedback item 9). The monthly report only stores month-level snapshots, so
// "last 7 days" or a custom window cannot be answered from reports; this asks
// Sprout directly, the same way the n8n workflow does, and also fetches the
// equal-length period before the window for like-for-like comparison.
//
// Request:  { client_id, start: "yyyy-mm-dd", end: "yyyy-mm-dd" }  (Bearer JWT)
// Response: { range, previous_range, profiles, totals, previous_totals, changes,
//             daily: [{ date, ...metrics }], by_profile: [...], top_posts: [...] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SPROUT_TOKEN_URL = "https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token";
const SPROUT_API_BASE = "https://api.sproutsocial.com/v1";
const DEFAULT_CUSTOMER_ID = "1676448";
const METRICS = ["impressions", "reactions", "post_link_clicks", "video_views", "comments", "shares"] as const;
type Metric = (typeof METRICS)[number];
type Totals = Record<Metric, number>;

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const parseDay = (s: string) => new Date(s + "T00:00:00Z");
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : 0);
const emptyTotals = (): Totals => ({ impressions: 0, reactions: 0, post_link_clicks: 0, video_views: 0, comments: 0, shares: 0 });

async function sproutToken(): Promise<string> {
  const clientId = Deno.env.get("SPROUT_CLIENT_ID");
  const clientSecret = Deno.env.get("SPROUT_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Sprout credentials are not configured");
  const r = await fetch(SPROUT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials", scope: "organization_id" }),
  });
  if (!r.ok) throw new Error(`Sprout token failed [${r.status}]: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).access_token;
}

async function sproutPost(token: string, customerId: string, path: string, body: unknown) {
  const r = await fetch(`${SPROUT_API_BASE}/${customerId}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Sprout ${path} failed [${r.status}]: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

/** Profile analytics for a window: totals, per-day series and per-profile totals. */
async function profileAnalytics(token: string, customerId: string, profileIds: number[], start: string, end: string) {
  const resp = await sproutPost(token, customerId, "analytics/profiles", {
    filters: [`customer_profile_id.eq(${profileIds.join(", ")})`, `reporting_period.in(${start}...${end})`],
    metrics: [...METRICS],
    page: 1,
  });
  const rows: any[] = Array.isArray(resp?.data) ? resp.data : [];
  const totals = emptyTotals();
  const daily = new Map<string, Totals>();
  const byProfile = new Map<string, Totals>();
  for (const row of rows) {
    const dims = row.dimensions || {};
    const dayKey = Object.keys(dims).find((k) => k.startsWith("reporting_period"));
    const date = dayKey ? String(dims[dayKey]).slice(0, 10) : start;
    const profile = String(dims.customer_profile_id ?? "all");
    const d = daily.get(date) || emptyTotals();
    const p = byProfile.get(profile) || emptyTotals();
    for (const m of METRICS) {
      const v = num(row.metrics?.[m]);
      totals[m] += v;
      d[m] += v;
      p[m] += v;
    }
    daily.set(date, d);
    byProfile.set(profile, p);
  }
  return {
    totals,
    daily: [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, m]) => ({ date, ...m })),
    byProfile,
  };
}

/** Posts published in the window, ranked by impressions, with their permalinks. */
async function topPosts(token: string, customerId: string, profileIds: number[], start: string, end: string) {
  try {
    const resp = await sproutPost(token, customerId, "analytics/posts", {
      filters: [`customer_profile_id.eq(${profileIds.join(", ")})`, `created_time.in(${start}T00:00:00...${end}T23:59:59)`],
      metrics: ["lifetime.impressions", "lifetime.reactions", "lifetime.comments_count", "lifetime.shares_count", "lifetime.post_link_clicks", "lifetime.video_views"],
      fields: ["created_time", "perma_link", "text", "post_type"],
      sort: ["lifetime.impressions:desc"],
      page: 1,
      limit: 20,
    });
    const rows: any[] = Array.isArray(resp?.data) ? resp.data : [];
    return rows
      .map((r) => ({
        permalink: r.perma_link || r.permalink || null,
        text: r.text || "",
        posted_at: r.created_time || null,
        post_type: r.post_type || null,
        profile_id: r.dimensions?.customer_profile_id ?? r.customer_profile_id ?? null,
        impressions: num(r.metrics?.["lifetime.impressions"]),
        reactions: num(r.metrics?.["lifetime.reactions"]),
        comments: num(r.metrics?.["lifetime.comments_count"]),
        shares: num(r.metrics?.["lifetime.shares_count"]),
        link_clicks: num(r.metrics?.["lifetime.post_link_clicks"]),
        video_views: num(r.metrics?.["lifetime.video_views"]),
      }))
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 10);
  } catch (e) {
    console.error("[sprout-analytics] posts query failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Sign-in required." }, 401);
    const body = await req.json();
    const clientId = String(body.client_id || "");
    const start = String(body.start || "");
    const end = String(body.end || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !clientId) return json({ error: "client_id, start and end (yyyy-mm-dd) are required." }, 400);
    const startD = parseDay(start), endD = parseDay(end);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || endD < startD) return json({ error: "end must be on or after start." }, 400);
    const days = Math.round((endD.getTime() - startD.getTime()) / DAY) + 1;
    if (days > 366) return json({ error: "Ranges longer than a year are not supported." }, 400);

    // Access check runs as the caller: RLS decides whether they may see this client.
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: who } = await asUser.auth.getUser(auth.slice(7));
    if (!who?.user) return json({ error: "Invalid or expired session." }, 401);
    const { data: visible } = await asUser.from("clients").select("id, name, sprout_customer_id").eq("id", clientId).maybeSingle();
    if (!visible) return json({ error: "Client not found or not accessible." }, 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: profiles } = await admin
      .from("sprout_profiles")
      .select("sprout_profile_id, profile_name, native_name, network_type")
      .eq("client_id", clientId)
      .eq("is_active", true);
    const profileIds = (profiles || []).map((p: any) => Number(p.sprout_profile_id)).filter((n: number) => Number.isFinite(n));
    if (profileIds.length === 0) return json({ error: "No Sprout profiles are assigned to this client." }, 422);

    const customerId = String(visible.sprout_customer_id || DEFAULT_CUSTOMER_ID);
    const prevEnd = new Date(startD.getTime() - DAY);
    const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY);
    const token = await sproutToken();
    const [current, previous, posts] = await Promise.all([
      profileAnalytics(token, customerId, profileIds, start, end),
      profileAnalytics(token, customerId, profileIds, iso(prevStart), iso(prevEnd)),
      topPosts(token, customerId, profileIds, start, end),
    ]);

    const changes: Record<string, { current: number; previous: number; absolute: number; percent: number | null }> = {};
    for (const m of METRICS) {
      const c = current.totals[m], p = previous.totals[m];
      changes[m] = { current: c, previous: p, absolute: c - p, percent: p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null };
    }
    const profileMeta = new Map((profiles || []).map((p: any) => [String(p.sprout_profile_id), p]));
    const byProfile = [...current.byProfile.entries()].map(([id, totals]) => {
      const meta: any = profileMeta.get(id) || {};
      return { profile_id: id, name: meta.native_name || meta.profile_name || id, network: meta.network_type || null, ...totals, previous: previous.byProfile.get(id) || emptyTotals() };
    });
    const topPostsOut = posts.map((p) => {
      const meta: any = profileMeta.get(String(p.profile_id)) || {};
      return { ...p, network_type: meta.network_type || null, profile_name: meta.native_name || meta.profile_name || null };
    });

    return json({
      client: { id: visible.id, name: visible.name },
      range: { start, end, days },
      previous_range: { start: iso(prevStart), end: iso(prevEnd), days },
      profiles: (profiles || []).map((p: any) => ({ id: String(p.sprout_profile_id), name: p.native_name || p.profile_name, network: p.network_type })),
      totals: current.totals,
      previous_totals: previous.totals,
      changes,
      daily: current.daily,
      by_profile: byProfile,
      top_posts: topPostsOut,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[sprout-analytics]", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
