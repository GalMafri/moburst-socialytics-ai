// The competitor feed refresh: the client's RivalIQ landscape posts for the
// last few days (one call, well inside the 100-per-hour budget), the reviewed
// LinkedIn sources and the client's own posts, stored as a `feed` snapshot in
// rivaliq_snapshots; then the model is asked which topics two or more
// companies posted about inside the window, and each becomes a
// competitive_alerts row with a confidence score.
//
// Shared by refresh-competitor-feed (the feed page, staff) and the
// scheduled-jobs worker (the weekly refresh), which runs it in-process.
// Moved out of refresh-competitor-feed on 2026-10-06; the behaviour is unchanged.

import {collectOwnedCompetitive,mergeOwnedCompetitivePosts} from './ownedSource.ts';
import { checkClientLandscape, isTrackingProblem, recordTrackingCheck } from "./landscapeCheck.ts";
import { selectedFeedSources, collectLinkedInSource } from "./linkedinSource.ts";
import { rivalIqFetch } from "./rivaliqFetch.ts";
import { harvestedPaths, type HarvestedRef } from "../design-prompts/designRefs.ts";

/** A refresh that stopped with an answer for the caller: an HTTP status and, for a known case, a code. */
export class FeedRefreshError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "FeedRefreshError";
    this.status = status;
    this.code = code;
  }
}

export interface FeedRefreshEnv {
  rivaliqKey: string | undefined;
  anthropicKey: string | undefined;
  /** SOCIALYTICS_N8N_SECRET, sent to the LinkedIn source workflow. */
  secret: string | null | undefined;
  /** Window length in days (1 to 30, default 7). */
  days?: number;
}

const RIVALIQ = "https://api.rivaliq.com/v3";
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const slug = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "topic";

async function rivaliq(path: string, key: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await rivalIqFetch(`${RIVALIQ}${path}${sep}apiKey=${encodeURIComponent(key)}`, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`RivalIQ ${path.split("?")[0]} failed [${r.status}]: ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

type Topic = { topic: string; summary: string; companies: string[]; platforms: string[]; post_urls: string[]; confidence: number; key?: string };

/** A topic found in an earlier window, offered to the model so a theme keeps one identity. */
export type KnownTopic = { topic_key: string; topic: string; window_start: string; status?: string | null };

/** How many earlier feed windows the model sees when it names this week's topics. */
export const KNOWN_TOPIC_WINDOWS = 4;

/**
 * The topics of the four newest earlier windows, and of this window when it
 * was pulled before, one row per key with its newest wording.
 */
export function knownTopics(rows: KnownTopic[], currentWindowStart: string): KnownTopic[] {
  const windows = [...new Set(rows.map((r) => String(r.window_start)).filter((w) => w < currentWindowStart))].sort().reverse().slice(0, KNOWN_TOPIC_WINDOWS);
  const keep = new Set([...windows, currentWindowStart]);
  const byKey = new Map<string, KnownTopic>();
  for (const r of [...rows].sort((a, b) => String(b.window_start).localeCompare(String(a.window_start)))) {
    if (!keep.has(String(r.window_start)) || !r.topic_key || byKey.has(r.topic_key)) continue;
    byKey.set(r.topic_key, r);
  }
  return [...byKey.values()];
}

type CompactPost = { company: string; is_client: boolean; channel: unknown; date: string; text: string; engagement: number; url: string | null };

/** The model prompt for one window's shared topics, with the earlier topics and their keys. */
export function topicPrompt(clientName: string, posts: CompactPost[], start: string, end: string, known: KnownTopic[]): string {
  const earlier = known.length
    ? `

TOPICS FROM THE PREVIOUS WEEKS (key: topic):
${known.map((k) => `${k.topic_key}: ${k.topic}`).join("\n")}

A topic keeps one identity from week to week. When a topic you find is the same theme as one of these (the same subject or campaign, even in other words or with a narrower or broader name), set "key" to that exact key. When it is a new theme, set "key" to "". Never invent a key that is not in this list.`
    : "";
  return `You monitor a social media competitive landscape for the client "${clientName}". Below are the posts every company in the landscape published between ${start} and ${end}.

Find TOPICS (themes, formats, news hooks, campaigns, moments) that at least TWO DIFFERENT companies posted about inside this window. For each, give a short topic name, a one-sentence summary of how the companies approached it, the list of companies, the platforms involved, the post URLs that prove it (only URLs from the data), and a confidence between 0 and 1 that this is a real shared trend rather than a coincidence (more companies, more posts, closer dates and clearer wording mean higher confidence). Ignore generic always-on themes such as "posts about the company" unless the framing is clearly shared. Return at most 8 topics, best first.${earlier}

Return ONLY JSON in this shape:
{"topics":[{"key":"","topic":"...","summary":"...","companies":["..."],"platforms":["instagram"],"post_urls":["https://..."],"confidence":0.8}]}

POSTS:
${JSON.stringify(posts)}`;
}

/**
 * Each topic's stored identity. A key the model reused from the earlier
 * topics is kept; any other topic is keyed by its own wording. Two topics
 * that land on one key in the same window are one topic: the first (the
 * model lists them best first) is kept. A key somebody dismissed stays
 * dismissed.
 */
export function topicRows<T extends { topic: string; key?: string }>(topics: T[], known: KnownTopic[], dismissedKeys: Set<string>): Array<T & { topic_key: string; dismissed: boolean }> {
  const knownKeys = new Set(known.map((k) => k.topic_key));
  const seen = new Set<string>();
  const out: Array<T & { topic_key: string; dismissed: boolean }> = [];
  for (const t of topics) {
    const reused = typeof t.key === "string" ? t.key.trim() : "";
    const topicKey = reused && knownKeys.has(reused) ? reused : slug(t.topic);
    if (seen.has(topicKey)) continue;
    seen.add(topicKey);
    out.push({ ...t, topic_key: topicKey, dismissed: dismissedKeys.has(topicKey) });
  }
  return out;
}

/** Topics that two or more companies posted about in the window, with confidence. */
async function detectTopics(clientName: string, posts: any[], start: string, end: string, key: string | undefined, known: KnownTopic[]): Promise<Topic[]> {
  if (!key || posts.length < 2) return [];
  const compact: CompactPost[] = posts
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
  const prompt = topicPrompt(clientName, compact, start, end, known);
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
    const urls = new Set(compact.map((p) => p.url).filter(Boolean));
    return topics
      .filter((t) => t && t.topic && Array.isArray(t.companies) && t.companies.length >= 2)
      .map((t) => ({
        key: typeof t.key === "string" ? t.key : "",
        topic: String(t.topic).slice(0, 120),
        summary: String(t.summary || "").slice(0, 600),
        companies: [...new Set(t.companies.map(String))],
        platforms: [...new Set((t.platforms || []).map((p: string) => String(p).toLowerCase()))],
        post_urls: [...new Set((t.post_urls || []).filter((u: string) => urls.has(u)))],
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
 * Selection uses the uniquely verified tracked client, which need not be
 * the landscape's focus company.
 */
async function harvestOwnCreative(
  admin: any,
  clientId: string,
  clientCompanyId: string,
  socialPosts: any[],
  clientName: string,
): Promise<{ added: number; kept: number; skipped: string[] }> {
  const skipped: string[] = [];
  try {
    const { data: row } = await admin
      .from("clients")
      .select("harvested_design_references")
      .eq("id", clientId)
      .maybeSingle();
    const existing: HarvestedRef[] = Array.isArray(row?.harvested_design_references)
      ? (row!.harvested_design_references as HarvestedRef[]).filter((r) => r && typeof r.path === "string")
      : [];
    // Onboarded clients use quality-reviewed Sprout references. The legacy
    // competitor-feed thumbnail harvest must never overwrite that corpus.
    if (existing.some(r => r.quality_checked === true)) return { added: 0, kept: existing.length, skipped };
    const seen = new Set(existing.map((r) => String(r.source_post_id || "")));

    const mine = socialPosts
      .filter((p) => String(p?.companyId) === clientCompanyId)
      // Non-empty, not merely a string: RivalIQ sends "" for a post with no
      // image, which passed this test and then threw "Invalid URL" inside the
      // loop. Four posts a run were being reported as failures for it.
      .filter((p) => typeof (p?.imageLarge || p?.image) === "string" && String(p.imageLarge || p.image).trim().length > 0)
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
        // The message, not just the class: "TypeError" told nobody which
        // url failed or why, and four of these appeared in one live run.
        skipped.push(`${id}: ${(e as Error)?.message || (e as Error)?.name || "failed"}`);
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

export async function refreshCompetitorFeed(admin: any, clientId: string, env: FeedRefreshEnv) {
  const { data: client } = await admin.from("clients").select("id, name, website_url, sprout_customer_id").eq("id", clientId).maybeSingle();
  if (!client) throw new FeedRefreshError("Client not found", 404);
  const key = env.rivaliqKey;
  if (!key) throw new FeedRefreshError("RIVALIQ_API_KEY is not configured", 500);

  // The landscape comes from the confirmed set when it was imported from
  // RivalIQ; otherwise match the landscape whose focus company is the client.
  // Newest confirmation first with unconfirmed rows last, as run-report and
  // the scheduler order it: without nullsFirst: false, Postgres puts NULLs
  // first in a descending sort and an older set could win.
  const { data: set } = await admin
    .from("competitor_sets")
    .select("id, rivaliq_landscape_id")
    .eq("client_id", clientId)
    .in("status", ["confirmed", "analyzing", "complete", "failed"])
    .order("confirmed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  // An explicit ID is a selection, not proof of client identity. Validate
  // before fetching posts, saving snapshots, generating alerts or harvesting.
  // The same check run-report and the scheduled dispatch use.
  const check = await checkClientLandscape(key, client, set?.rivaliq_landscape_id);
  await recordTrackingCheck(admin, set?.id, set?.rivaliq_landscape_id, check);
  if (isTrackingProblem(check)) {
    // Not set up (RIVALIQ_CLIENT_NOT_TRACKED) and a linked landscape that
    // vanished or stopped matching (RIVALIQ_LANDSCAPE_MISSING) are different
    // facts: the scheduler skips the first and alerts on the second.
    throw new FeedRefreshError(check.message, 422, check.code);
  }
  // A provider that could not be asked stays an ordinary error, so the
  // scheduled refresh retries it and the page says what happened.
  if (check.ok === false) throw new Error(`RivalIQ /landscapes failed [${check.status ?? "network"}]: ${check.message}`);
  const match = check.summary;
  const landscapeId = match.id;

  const days = Math.min(30, Math.max(1, Number(env.days) || 7));
  const end = new Date(Date.now() - DAY);
  const start = new Date(end.getTime() - (days - 1) * DAY);
  const window = { start: iso(start), end: iso(end) };
  // RivalIQ caps socialposts at 100 unless `limit` is sent (verified 2026-09-06: limit=500 returned 357).
  const PAGE_LIMIT = 500;
  const resp = await rivaliq(`/landscapes/${landscapeId}/socialposts?mainPeriodStart=${window.start}&mainPeriodEnd=${window.end}&limit=${PAGE_LIMIT}`, key);
  const rivalPosts: any[] = Array.isArray(resp?.socialPosts) ? resp.socialPosts : [];
  if (rivalPosts.length >= PAGE_LIMIT) throw new Error('The feed source reached its result limit. No partial refresh was saved.');
  const {data: selected, error: selectionError} = await admin.from("competitors").select("*,competitor_handles(*)").eq("set_id",set?.id).eq("is_selected",true);
  if (selectionError) throw new Error('Could not load reviewed feed profiles.');
  const plan = selectedFeedSources(match.companies, match.client_company_id, selected || [], []);
  const {data: setting, error: settingError} = await admin.from("app_settings").select("value").eq("key","competitive_linkedin_webhook_url").maybeSingle();
  if (settingError) throw new Error('Could not load the LinkedIn source connection.');
  const [linkedin,owned] = await Promise.all([collectLinkedInSource(plan.sources, window, env.secret || '', setting?.value || ''),collectOwnedCompetitive(admin,client,window)]);
  const selectedIds = new Set(plan.companyIds);
  const socialPosts = mergeOwnedCompetitivePosts([...rivalPosts.filter(p=>selectedIds.has(String(p.companyId))), ...linkedin.socialPosts],owned,{id:match.client_company_id,name:client.name});

  const {error: snapshotError} = await admin.from("rivaliq_snapshots").insert({
    client_id: clientId,
    landscape_id: landscapeId,
    endpoint: "feed",
    payload: { window, client_company_id: match.client_company_id, socialPosts, owned_source: {profiles:owned.profiles,coverage:owned.coverage}, owned_metrics:owned.metrics, linkedin_sources: plan.sources, additional_metrics: linkedin.additional_metrics, fetched_at: new Date().toISOString(), truncated: false },
  });

  if (snapshotError) throw new Error('Could not save the refreshed feed.');

  // The client's own creative, pulled from the same response.
  //
  // The design language is synthesized from references, and until now the
  // only ones were whatever staff uploaded at onboarding — usually five
  // images from the day the client was set up, going stale from then on.
  // The client's own recent posts are in hand here already, at no extra
  // RivalIQ call, so the newest of them become references too.
  const harvest = await harvestOwnCreative(admin, clientId, match.client_company_id, socialPosts, client.name);

  // The earlier windows' topics, dismissed ones included: the model is asked
  // to reuse a key when the theme is the same, so a theme is counted once
  // and a dismissed theme stays dismissed. The alert's identity includes the
  // window it was found in, so without a shared key every week made a new
  // row and a dismissal only ever applied to the week it was made in.
  const { data: prior } = await admin
    .from("competitive_alerts")
    .select("topic, topic_key, window_start, status")
    .eq("client_id", clientId)
    .lte("window_start", window.start)
    .gte("window_start", iso(new Date(Date.now() - 90 * DAY)))
    .order("window_start", { ascending: false })
    .limit(200);
  const known = knownTopics((prior || []) as KnownTopic[], window.start);
  const dismissedKeys = new Set<string>((prior || []).filter((r: any) => r.status === "dismissed" && r.topic_key).map((r: any) => String(r.topic_key)));

  const topics = topicRows(await detectTopics(client.name, socialPosts, window.start, window.end, env.anthropicKey, known), known, dismissedKeys);

  let saved = 0;
  for (const t of topics) {
    const { error } = await admin.from("competitive_alerts").upsert(
      {
        client_id: clientId,
        window_start: window.start,
        window_end: window.end,
        // Carried forward rather than re-raised. The row is still written,
        // so the topic stays in the record and a person can bring it back.
        ...(t.dismissed ? { status: "dismissed" } : {}),
        topic: t.topic,
        topic_key: t.topic_key,
        summary: t.summary,
        companies: t.companies,
        platforms: t.platforms,
        post_urls: t.post_urls,
        post_count: t.post_urls.length,
        confidence: t.confidence,
      },
      { onConflict: "client_id,window_start,topic_key", ignoreDuplicates: false },
    );
    // Two separate questions. Folding them into one condition sent a
    // SUCCESSFUL write of a carried-forward dismissal into the error branch,
    // where error is null, and the whole refresh died on the dereference.
    if (error) console.error("[refresh-competitor-feed] alert upsert failed", error.message);
    else if (!t.dismissed) saved += 1;
  }

  return { client_id: clientId, landscape_id: landscapeId, window, posts: socialPosts.length, truncated: socialPosts.length >= PAGE_LIMIT, alerts: saved, design_refs: harvest };
}
