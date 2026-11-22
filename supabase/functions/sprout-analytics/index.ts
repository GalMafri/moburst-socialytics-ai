// Live Sprout Social analytics for one client over a chosen date range
// (feedback item 9). The monthly report only stores month-level snapshots, so
// "last 7 days" or a custom window cannot be answered from reports; this asks
// Sprout directly, the same way the n8n workflow does, and also fetches the
// equal-length period before the window for like-for-like comparison.
//
// Request:  { client_id, start: "yyyy-mm-dd", end: "yyyy-mm-dd", compare?: boolean }  (Bearer JWT)
//           compare false skips the previous-period read (a caller that adds
//           several windows together and shows no comparison); the previous
//           fields then come back null.
// Response: { range, previous_range, profiles, totals, previous_totals, changes,
//             daily: [{ date, ...metrics }], by_profile: [...], top_posts: [...],
//             top_posts_failed_networks: [...] }
// A top post carries its reach (impressions, or views on YouTube, the figure
// the posts are ranked on) and its picture (thumbnail_url, media_type).

import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { createClient } from "../_shared/supabase.ts";
import { defaultSproutCustomerId } from "../_shared/sprout/customer.ts";
import { readTopPosts } from "../_shared/sprout/topPosts.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SPROUT_TOKEN_URL = "https://identity.sproutsocial.com/oauth2/84e39c75-d770-45d9-90a9-7b79e3037d2c/v1/token";
const SPROUT_API_BASE = "https://api.sproutsocial.com/v1";
const DEFAULT_CUSTOMER_ID = defaultSproutCustomerId();
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
  const rows: any[] = [];
  let page = 1;
  for (;;) {
    const resp = await sproutPost(token, customerId, "analytics/profiles", {
      filters: [`customer_profile_id.eq(${profileIds.join(", ")})`, `reporting_period.in(${start}...${end})`],
      metrics: ["impressions", "reactions", "post_link_clicks", "video_views", "comments_count", "shares_count"],
      page, limit: 1000,
    });
    if (!Array.isArray(resp?.data)) throw new Error("Sprout returned no valid period data.");
    rows.push(...resp.data);
    const totalPages = Number(resp.paging?.total_pages || 1);
    if (page >= totalPages) break;
    if (page >= 100) throw new Error("Sprout period data is incomplete; pagination limit reached.");
    page++;
  }
  const totals = emptyTotals();
  const daily = new Map<string, Totals>();
  const byProfile = new Map<string, Totals>();
  const seen = new Set<string>();
  for (const row of rows) {
    const dims = row.dimensions || {};
    const dayKey = Object.keys(dims).find((k) => k.startsWith("reporting_period"));
    const date = dayKey ? String(dims[dayKey]).slice(0, 10) : "";
    if (!date || date < start || date > end) throw new Error("Sprout returned data outside the requested reporting period.");
    const profile = String(dims.customer_profile_id ?? "all");
    if (!profileIds.includes(Number(profile))) throw new Error("Sprout returned an unexpected profile.");
    const rowKey = `${profile}:${date}`;
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    const d = daily.get(date) || emptyTotals();
    const p = byProfile.get(profile) || emptyTotals();
    for (const m of METRICS) {
      const providerKey = m === "comments" ? "comments_count" : m === "shares" ? "shares_count" : m;
      const v = num(row.metrics?.[providerKey]);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    // The project's own server calls (the api) present the operational secret instead of a session.
    const server = await secretEquals(req.headers.get("x-socialytics-secret"), Deno.env.get("SOCIALYTICS_N8N_SECRET"));
    if (!server && !auth.startsWith("Bearer ")) return json({ error: "Sign-in required." }, 401);
    const body = await req.json();
    const clientId = String(body.client_id || "");
    const start = String(body.start || "");
    const end = String(body.end || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !clientId) return json({ error: "client_id, start and end (yyyy-mm-dd) are required." }, 400);
    const startD = parseDay(start), endD = parseDay(end);
    if (isNaN(startD.getTime()) || isNaN(endD.getTime()) || endD < startD) return json({ error: "end must be on or after start." }, 400);
    const days = Math.round((endD.getTime() - startD.getTime()) / DAY) + 1;
    if (days > 366) return json({ error: "Ranges longer than a year are not supported." }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Access check runs as the caller: RLS decides whether they may see this client. A server call reads it directly.
    // QA 22 Nov 2026 (P61-04): a read that failed was taken for "not accessible"
    // (403) or "no profiles" (422), which the Analytics page treats as final.
    // A failed read is answered 500, which the page asks again.
    let visible: { id: string; name: string; sprout_customer_id: string | null } | null = null;
    let readError: { message: string } | null = null;
    if (server) {
      ({ data: visible, error: readError } = await admin.from("clients").select("id, name, sprout_customer_id").eq("id", clientId).maybeSingle());
    } else {
      const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
      const { data: who } = await asUser.auth.getUser(auth.slice(7));
      if (!who?.user) return json({ error: "Invalid or expired session." }, 401);
      ({ data: visible, error: readError } = await asUser.from("clients").select("id, name, sprout_customer_id").eq("id", clientId).maybeSingle());
    }
    if (readError) return json({ error: `The client could not be read: ${readError.message}` }, 500);
    if (!visible) return json({ error: "Client not found or not accessible." }, 403);

    const { data: profiles, error: profilesError } = await admin
      .from("sprout_profiles")
      .select("sprout_profile_id, profile_name, native_name, network_type")
      .eq("client_id", clientId)
      .eq("is_active", true);
    if (profilesError) return json({ error: `The client's Sprout profiles could not be read: ${profilesError.message}` }, 500);
    const profileIds = (profiles || []).map((p: any) => Number(p.sprout_profile_id)).filter((n: number) => Number.isFinite(n));
    if (profileIds.length === 0) return json({ error: "No Sprout profiles are assigned to this client." }, 422);

    const customerId = String(visible.sprout_customer_id || DEFAULT_CUSTOMER_ID);
    const prevEnd = new Date(startD.getTime() - DAY);
    const prevStart = new Date(prevEnd.getTime() - (days - 1) * DAY);
    const token = await sproutToken();
    const compare = body.compare !== false;
    const [current, previous, topRead] = await Promise.all([
      profileAnalytics(token, customerId, profileIds, start, end),
      compare ? profileAnalytics(token, customerId, profileIds, iso(prevStart), iso(prevEnd)) : Promise.resolve(null),
      readTopPosts((path, req) => sproutPost(token, customerId, path, req), profiles || [], start, end),
    ]);
    const posts = topRead.posts;

    const changes: Record<string, { current: number; previous: number; absolute: number; percent: number | null }> = {};
    if (previous) {
      for (const m of METRICS) {
        const c = current.totals[m], p = previous.totals[m];
        changes[m] = { current: c, previous: p, absolute: c - p, percent: p > 0 ? Math.round(((c - p) / p) * 1000) / 10 : null };
      }
    }
    const profileMeta = new Map((profiles || []).map((p: any) => [String(p.sprout_profile_id), p]));
    const byProfile = [...current.byProfile.entries()].map(([id, totals]) => {
      const meta: any = profileMeta.get(id) || {};
      return { profile_id: id, name: meta.native_name || meta.profile_name || id, network: meta.network_type || null, ...totals, previous: previous ? previous.byProfile.get(id) || emptyTotals() : null };
    });
    const topPostsOut = posts.map((p) => {
      const meta: any = profileMeta.get(String(p.profile_id)) || {};
      return { ...p, network_type: meta.network_type || null, profile_name: meta.native_name || meta.profile_name || null };
    });

    return json({
      client: { id: visible.id, name: visible.name },
      range: { start, end, days },
      previous_range: compare ? { start: iso(prevStart), end: iso(prevEnd), days } : null,
      profiles: (profiles || []).map((p: any) => ({ id: String(p.sprout_profile_id), name: p.native_name || p.profile_name, network: p.network_type })),
      totals: current.totals,
      previous_totals: previous ? previous.totals : null,
      changes,
      daily: current.daily,
      by_profile: byProfile,
      top_posts: topPostsOut,
      top_posts_failed_networks: topRead.failed,
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
