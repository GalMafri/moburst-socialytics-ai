// Milestone 4, steps 12 and 13: the competitor feed and trend detection.
//
// Pulls the last few days of posts for the client's RivalIQ landscape (one
// call, well inside the 100-per-hour budget), stores them as a `feed` snapshot
// in rivaliq_snapshots, then asks the model which topics two or more companies
// posted about inside the window. Each convergence becomes a competitive_alerts
// row with a confidence score. Called from the feed page (staff) and once a
// week by trigger-scheduled-reports (shared secret).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bestLandscapeMatch, summarizeLandscapes } from "../_shared/competitive/rivaliqLandscape.ts";
import { harvestedPaths, type HarvestedRef } from "../_shared/design-prompts/designRefs.ts";
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

/** How many of the client's own posts are kept as references. */
const HARVEST_CAP = 8;
/** A reference has to be an image the readers accept, and small enough for them. */
const HARVEST_MAX_BYTES = 4 * 1024 * 1024;

/**
 * Stores the client's own recent creative as design references.
 *
 * Selection is by RivalIQ's focusCompanyId, never by name: the focus company
 * IS the client, and matching names would pull a competitor whose name
 * happens to contain the client's.
 */
async function harvestOwnCreative(
  admin: any,
  clientId: string,
  landscapeId: string,
  key: string,
  socialPosts: any[],
  clientName: string,
): Promise<{ added: number; kept: number; skipped: string[] }> {
  const skipped: string[] = [];
  try {
    // Which company in this landscape is the client.
    const list = await rivaliq("/landscapes", key);
    const landscape = (list?.landscapes || []).find((l: any) => String(l.id) === String(landscapeId));
    const focusId = landscape?.focusCompanyId;
    if (!focusId) {
      return { added: 0, kept: 0, skipped: ["the landscape names no focus company, so the client's own posts cannot be told apart"] };
    }

    const { data: row } = await admin
      .from("clients")
      .select("harvested_design_references")
      .eq("id", clientId)
      .maybeSingle();
    const existing: HarvestedRef[] = Array.isArray(row?.harvested_design_references)
      ? (row!.harvested_design_references as HarvestedRef[]).filter((r) => r && typeof r.path === "string")
      : [];
    const seen = new Set(existing.map((r) => String(r.source_post_id || "")));

    const mine = socialPosts
      .filter((p) => String(p?.companyId) === String(focusId))
      .filter((p) => typeof (p?.imageLarge || p?.image) === "string")
      .sort((a, b) => Number(b?.engagementTotal || 0) - Number(a?.engagementTotal || 0));

    const added: HarvestedRef[] = [];
    for (const post of mine) {
      // Cap what this run adds, not the total. Counting the stored list here
      // meant that once it reached the cap nothing was ever harvested again,
      // and the trim below that keeps the newest could never run.
      if (added.length >= HARVEST_CAP) break;
      const id = String(post.postId ?? post.nativeId ?? post.postLink ?? "");
      if (!id || seen.has(id)) continue;
      // imageLarge first: RivalIQ's `image` is a smaller copy, and a
      // reference the synthesis reads should be the best available.
      const src = String(post.imageLarge || post.image);
      try {
        const resp = await fetch(src, { signal: AbortSignal.timeout(15000) });
        if (!resp.ok) { skipped.push(`${id}: ${resp.status}`); continue; }
        const type = (resp.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (type !== "image/png" && type !== "image/jpeg") { skipped.push(`${id}: ${type || "unknown type"}`); continue; }
        const bytes = new Uint8Array(await resp.arrayBuffer());
        if (bytes.byteLength > HARVEST_MAX_BYTES) { skipped.push(`${id}: too large`); continue; }
        const ext = type === "image/png" ? "png" : "jpg";
        const folder = (clientName || "client").replace(/[^a-zA-Z0-9]/g, "-");
        const path = `${folder}/harvested-${clientId}-${id.replace(/[^a-zA-Z0-9]/g, "")}.${ext}`;
        const { error: upErr } = await admin.storage.from("design-references").upload(path, bytes, { contentType: type, upsert: true });
        if (upErr) { skipped.push(`${id}: ${upErr.message}`); continue; }
        added.push({ path, source_post_id: id, platform: String(post.channel || ""), posted_at: String(post.publishedAt || "") });
        seen.add(id);
      } catch (e) {
        skipped.push(`${id}: ${(e as Error)?.name || "failed"}`);
      }
    }

    if (added.length === 0) return { added: 0, kept: existing.length, skipped };

    // Newest first, capped. Anything pushed out is deleted, so the bucket
    // does not grow without limit.
    const merged = [...added, ...existing].sort((a, b) => String(b.posted_at || "").localeCompare(String(a.posted_at || "")));
    const keep = merged.slice(0, HARVEST_CAP);
    const drop = merged.slice(HARVEST_CAP).map((r) => r.path);
    if (drop.length > 0) await admin.storage.from("design-references").remove(drop).catch(() => {});

    await admin
      .from("clients")
      .update({ harvested_design_references: keep, design_refs_harvested_at: new Date().toISOString() })
      .eq("id", clientId);
    console.log(`[harvest] ${clientName}: +${added.length}, keeping ${keep.length}`);
    return { added: added.length, kept: keep.length, skipped };
  } catch (e) {
    console.warn("[harvest] failed:", e);
    return { added: 0, kept: 0, skipped: [String((e as Error)?.message || e)] };
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
    const { data: client } = await admin.from("clients").select("id, name, website_url").eq("id", clientId).maybeSingle();
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
      // Same resolution the import screen and the analysis workflow use:
      // focus-company name, then website, then landscape name. Matching on
      // the name alone missed clients whose RivalIQ company carries a suffix
      // or is stored as a domain.
      const list = await rivaliq("/landscapes", key);
      const match = bestLandscapeMatch(summarizeLandscapes(list.landscapes || [], client.name, (client as any).website_url));
      if (!match) return json({ error: `No RivalIQ landscape tracks ${client.name}. Import or create one first.` }, 422);
      landscapeId = match.id;
    }

    const days = Math.min(30, Math.max(1, Number(body.days) || 7));
    const end = new Date(Date.now() - DAY);
    const start = new Date(end.getTime() - (days - 1) * DAY);
    const window = { start: iso(start), end: iso(end) };
    // RivalIQ caps socialposts at 100 unless `limit` is sent (verified 2026-09-06: limit=500 returned 357).
    const PAGE_LIMIT = 500;
    const resp = await rivaliq(`/landscapes/${landscapeId}/socialposts?mainPeriodStart=${window.start}&mainPeriodEnd=${window.end}&limit=${PAGE_LIMIT}`, key);
    const socialPosts: any[] = Array.isArray(resp?.socialPosts) ? resp.socialPosts : [];

    await admin.from("rivaliq_snapshots").insert({
      client_id: clientId,
      landscape_id: landscapeId,
      endpoint: "feed",
      payload: { window, socialPosts, fetched_at: new Date().toISOString(), truncated: socialPosts.length >= PAGE_LIMIT },
    });

    // The client's own creative, pulled from the same response.
    //
    // The design language is synthesized from references, and until now the
    // only ones were whatever staff uploaded at onboarding — usually five
    // images from the day the client was set up, going stale from then on.
    // The client's own recent posts are in hand here already, at no extra
    // RivalIQ call, so the newest of them become references too.
    const harvest = await harvestOwnCreative(admin, clientId, landscapeId, key, socialPosts, client.name);

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

    return json({ client_id: clientId, landscape_id: landscapeId, window, posts: socialPosts.length, truncated: socialPosts.length >= PAGE_LIMIT, alerts: saved, design_refs: harvest });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    console.error("[refresh-competitor-feed]", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, status);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
