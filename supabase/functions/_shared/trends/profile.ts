// The trend profile: what the app tracks for a client's industry landscape,
// written by Claude from the client's own data (spec section 1). The
// lifecycle steps trend_profile and trend_hashtags (lifecycle/steps.ts) call
// this; nobody has to fill anything in.
//
// The profile's topics, hashtags and exclusions live in trend_terms, one row
// each. A person's add or remove is never overwritten: a row a person added
// keeps source 'person', and a row a person removed stays as a tombstone
// (removed_at set), so a rewrite never brings it back.

import { parseAnswer } from "../pipelines/competitive/analysis.ts";
import { topCounts } from "../competitive/postSample.ts";
import { textHash } from "../lifecycle/names.ts";
import { clip } from "./text.ts";
import { HASHTAG_PLATFORMS, TREND_PLATFORMS, type HashtagPlatform, type Term, type TrendPlatform, type TrendProfile } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Any = any;

export const TREND_PROFILE_MODEL = "claude-opus-5-5";
const MAX_TOKENS = 4000;
const DAY = 86_400_000;
/** The best posts the hashtag evidence is counted from, own and competitors' each. */
const BEST_POSTS = 30;
const HASHTAGS_SHOWN = 25;
const SITE_CHARS = 2500;
const MIN_SITE_CHARS = 80;
const EVIDENCE_DAYS = 90;

/** What the profile reads outside the client row, so the tests can stand in for it. */
export interface ProfileIO {
  ownPosts(db: Db, client: Any, snapshots: Array<{ payload: Any }>, now: Date): Promise<{ posts: Array<{ text: string; engagement: number }> }>;
  feedSnapshots(db: Db, clientId: string): Promise<Array<{ payload: Any }>>;
  competitorSet(db: Db, clientId: string): Promise<Array<{ name: string; rivaliq_company_id: string | null }>>;
  siteText(url: string): Promise<string>;
}

export interface ProfileEvidence {
  client: {
    name: string;
    geo: string;
    language: string;
    location: { locality: string; region: string; country: string } | null;
    primary_platforms: string[];
  };
  brief: string;
  pillars: Array<{ name: string; description: string }>;
  keywords: string[];
  brand_notes: string;
  brand_book: string;
  voice_examples: string[];
  site: string;
  competitors: string[];
  hashtags: { own: Array<{ key: string; count: number }>; competitors: Array<{ key: string; count: number }> };
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Hashtags in a set of texts, counted case-insensitively. */
export function hashtagCounts(texts: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of texts) {
    for (const tag of String(t ?? "").match(/#[\p{L}0-9_]+/gu) ?? []) {
      const k = tag.toLowerCase();
      out[k] = (out[k] ?? 0) + 1;
    }
  }
  return out;
}

function pillarsOf(v: unknown): Array<{ name: string; description: string }> {
  if (!Array.isArray(v)) return [];
  return v.map((p) => (typeof p === "string" ? { name: p.trim(), description: "" } : { name: str(p?.name), description: str(p?.description) }))
    .filter((p) => p.name);
}

/** The brand book and voice examples, which the lifecycle's client columns leave out. */
async function clientExtras(db: Db, clientId: string): Promise<{ brand_book: string; voice_examples: string[] }> {
  const { data } = await db.from("clients").select("brand_book_text, social_voice").eq("id", clientId).maybeSingle();
  const examples = Array.isArray(data?.social_voice?.examples) ? data.social_voice.examples : [];
  return {
    brand_book: clip(str(data?.brand_book_text), SITE_CHARS),
    voice_examples: examples.map((e: Any) => clip(str(typeof e === "string" ? e : e?.text), 600)).filter(Boolean).slice(0, 5),
  };
}

async function tryOr<T>(f: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await f();
  } catch {
    return fallback;
  }
}

/**
 * Everything the profile is written from. Null when there is nothing to read
 * (no brief, no pillars and no site text): the step then waits rather than
 * write a profile from nothing.
 */
export async function profileEvidence(db: Db, client: Any, now: Date, io: ProfileIO): Promise<ProfileEvidence | null> {
  const brief = str(client.brief_text);
  const pillars = pillarsOf(client.content_pillars);
  const website = str(client.website_url);
  const site = website ? clip(await tryOr(() => io.siteText(website), ""), SITE_CHARS) : "";
  if (!brief && pillars.length === 0 && site.length < MIN_SITE_CHARS) return null;

  const extras = await tryOr(() => clientExtras(db, client.id), { brand_book: "", voice_examples: [] });
  const snapshots = await tryOr(() => io.feedSnapshots(db, client.id), []);
  const own = await tryOr(() => io.ownPosts(db, client, snapshots, now), { posts: [] });
  const competitors = await tryOr(() => io.competitorSet(db, client.id), []);

  const ownBest = [...own.posts].sort((a, b) => (b.engagement || 0) - (a.engagement || 0)).slice(0, BEST_POSTS);
  const since = new Date(now.getTime() - EVIDENCE_DAYS * DAY).toISOString().slice(0, 10);
  const theirs: Array<{ text: string; engagement: number }> = [];
  for (const s of snapshots) {
    const clientCompany = String(s.payload?.client_company_id ?? "");
    for (const p of (s.payload?.socialPosts ?? []) as Any[]) {
      if (p?.source === "sprout" || String(p?.companyId ?? "") === clientCompany) continue;
      if (String(p?.publishedAt ?? "").slice(0, 10) < since) continue;
      theirs.push({ text: String(p?.message ?? ""), engagement: Number(p?.engagementTotal) || 0 });
    }
  }
  const theirBest = theirs.sort((a, b) => b.engagement - a.engagement).slice(0, BEST_POSTS);
  const loc = client.location && typeof client.location === "object" ? client.location : null;

  return {
    client: {
      name: str(client.name),
      geo: str(client.geo),
      language: str(client.language) || "en",
      location: loc ? { locality: str(loc.locality), region: str(loc.region), country: str(loc.country) } : null,
      primary_platforms: Array.isArray(client.primary_platforms) ? client.primary_platforms.map(String) : [],
    },
    brief,
    pillars,
    keywords: Array.isArray(client.social_keywords) ? client.social_keywords.map(String) : [],
    brand_notes: str(client.brand_notes),
    brand_book: extras.brand_book,
    voice_examples: extras.voice_examples,
    site,
    competitors: competitors.map((c) => str(c.name)).filter(Boolean),
    hashtags: {
      own: topCounts(hashtagCounts(ownBest.map((p) => p.text)), HASHTAGS_SHOWN),
      competitors: topCounts(hashtagCounts(theirBest.map((p) => p.text)), HASHTAGS_SHOWN),
    },
  };
}

/** A key for what a profile was written from, kept with it. */
export function evidenceKey(e: ProfileEvidence): string {
  return textHash(JSON.stringify({ ...e, hashtags: null }));
}

const PROFILE_SYSTEM = `You set up industry-trend tracking for a brand whose social media Moburst, a marketing agency, manages.
Trends show the broader landscape of the brand's industry: posts by other creators and companies that this brand would want to learn from. The brand's own accounts and its direct competitors are tracked elsewhere.

From the evidence, write the brand's trend profile:
- audience: one or two sentences on who the brand speaks to and what that audience wants to learn or see.
- topics: 6 to 10 search phrases that find posts in the brand's industry landscape, each with a one-line reason. Write them the way people search on social platforms, in the brand's language. Never the brand's own name, a competitor's name, or a place name on its own (a place may narrow a topic, as in "car accident tips Atlanta").
- hashtags: up to 10 each for instagram, tiktok and linkedin, each with a reason, written with the leading #. Prefer hashtags the best posts in this space already use (the evidence lists them with how often they appear). Never the brand's own name.
- exclusions: words or kinds of content that would pull in posts this brand would never want, such as another meaning of its words, job ads, giveaways or money-making schemes, each with a reason.
- fit_rubric: three to six sentences describing a post this brand would want to learn from, and what to drop.
- platforms: every primary platform of the brand that is one of tiktok, instagram, linkedin, youtube, pinterest, facebook, plus any of those six where this industry's audience is clearly active, each with a reason.

Answer with one JSON object and nothing else.`;

const PROFILE_FORMAT = `{"audience": "...", "topics": [{"term": "...", "reason": "..."}], "hashtags": {"instagram": [{"term": "#...", "reason": "..."}], "tiktok": [], "linkedin": []}, "exclusions": [{"term": "...", "reason": "..."}], "fit_rubric": "...", "platforms": [{"platform": "instagram", "reason": "..."}]}`;

function evidenceText(e: ProfileEvidence): string {
  const lines: string[] = [];
  const c = e.client;
  const place = c.location ? [c.location.locality, c.location.region, c.location.country].filter(Boolean).join(", ") : "";
  lines.push(`Brand: ${c.name}`);
  lines.push(`Market: ${c.geo}${place ? ` (based in ${place})` : ""}; language: ${c.language}`);
  lines.push(`Primary platforms: ${c.primary_platforms.join(", ") || "not set"}`);
  if (e.brief) lines.push(`\nBrief:\n${e.brief}`);
  if (e.pillars.length) lines.push(`\nContent pillars:\n${e.pillars.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`).join("\n")}`);
  if (e.keywords.length) lines.push(`\nKeywords the team uses for the brand: ${e.keywords.join(", ")}`);
  if (e.brand_notes) lines.push(`\nBrand notes:\n${e.brand_notes}`);
  if (e.brand_book) lines.push(`\nBrand book (excerpt):\n${e.brand_book}`);
  if (e.voice_examples.length) lines.push(`\nThe brand's own recent posts:\n${e.voice_examples.map((t) => `- ${t}`).join("\n")}`);
  if (e.site) lines.push(`\nWebsite (excerpt):\n${e.site}`);
  if (e.competitors.length) lines.push(`\nDirect competitors (tracked elsewhere; never search for them): ${e.competitors.join(", ")}`);
  const tags = (list: Array<{ key: string; count: number }>) => list.map((h) => `${h.key} (${h.count})`).join(", ") || "none";
  lines.push(`\nHashtags in the brand's best posts of the last 90 days: ${tags(e.hashtags.own)}`);
  lines.push(`Hashtags in competitors' best posts of the last 90 days: ${tags(e.hashtags.competitors)}`);
  return lines.join("\n");
}

/** The Messages API request for a profile. */
export function profileRequest(e: ProfileEvidence): Record<string, unknown> {
  return {
    model: TREND_PROFILE_MODEL,
    max_tokens: MAX_TOKENS,
    system: PROFILE_SYSTEM,
    messages: [{ role: "user", content: `${evidenceText(e)}\n\nAnswer in this shape:\n${PROFILE_FORMAT}` }],
  };
}

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}0-9]+/u).filter(Boolean);
const squash = (s: string): string => words(s).join("");

/** A text names the brand: its words appear in order (so "Calm" is not found in "calming"). */
function namesBrand(text: string, brand: string): boolean {
  const b = words(brand);
  const t = words(text);
  if (!b.length) return false;
  for (let i = 0; i + b.length <= t.length; i++) if (b.every((w, j) => t[i + j] === w)) return true;
  return false;
}

/** A hashtag is the brand's own: #baderlaw, #moburstlife. */
function tagNamesBrand(tag: string, brand: string): boolean {
  const b = squash(brand);
  const t = squash(tag);
  if (!b) return false;
  return b.length >= 4 ? t.includes(b) : t === b;
}

function placesOf(e: ProfileEvidence): Set<string> {
  const l = e.client.location;
  return new Set([l?.locality, l?.region, l?.country].map((p) => str(p).toLowerCase()).filter(Boolean));
}

const PLATFORM_ALIASES: Record<string, TrendPlatform> = {
  tiktok: "tiktok", instagram: "instagram", linkedin: "linkedin", youtube: "youtube", pinterest: "pinterest", facebook: "facebook",
};

/** The client's primary platforms that Trends can watch. */
export function primaryTrendPlatforms(primary: string[]): TrendPlatform[] {
  return [...new Set(primary.map((p) => PLATFORM_ALIASES[squash(p)]).filter(Boolean))];
}

/** What a profile does not meet; empty when it is fine. */
export function profileProblems(p: TrendProfile, e: ProfileEvidence): string[] {
  const out: string[] = [];
  const brand = e.client.name;
  const places = placesOf(e);
  if (!str(p.audience)) out.push("The audience is missing.");
  if (p.topics.length < 6 || p.topics.length > 10) out.push(`There must be 6 to 10 topics; there are ${p.topics.length}.`);
  for (const t of p.topics) {
    if (!str(t.term) || !str(t.reason)) out.push("Every topic needs a phrase and a reason.");
    else if (namesBrand(t.term, brand)) out.push(`The topic "${t.term}" searches for the brand's own name.`);
    else if (places.has(str(t.term).toLowerCase())) out.push(`The topic "${t.term}" is only a place name.`);
  }
  for (const platform of HASHTAG_PLATFORMS) {
    const list = p.hashtags[platform] ?? [];
    if (list.length > 10) out.push(`There are more than 10 ${platform} hashtags.`);
    for (const h of list) {
      if (!/^#[\p{L}0-9_]+$/u.test(h.term) || !str(h.reason)) out.push(`The ${platform} hashtag "${h.term}" needs to be one #tag with a reason.`);
      else if (tagNamesBrand(h.term, brand)) out.push(`The ${platform} hashtag "${h.term}" is the brand's own name.`);
    }
  }
  if (p.exclusions.length > 20) out.push("There are more than 20 exclusions.");
  if (p.exclusions.some((x) => !str(x.term))) out.push("Every exclusion needs a term.");
  if (!str(p.fit_rubric)) out.push("The fit rubric is missing.");
  for (const pl of p.platforms) {
    if (!TREND_PLATFORMS.includes(pl.platform) || !str(pl.reason)) out.push(`The platform "${pl.platform}" is not one Trends watches, or has no reason.`);
  }
  const watched = new Set(p.platforms.map((x) => x.platform));
  const missing = primaryTrendPlatforms(e.client.primary_platforms).filter((x) => !watched.has(x));
  if (missing.length) out.push(`The platforms leave out the brand's primary ${missing.join(", ")}.`);
  return out;
}

const termOf = (v: Any): Term => ({ term: str(v?.term), reason: str(v?.reason) });
const termsOf = (v: unknown): Term[] => (Array.isArray(v) ? v.map(termOf) : []);
const tagOf = (v: Any): Term => {
  const t = termOf(v);
  return { term: t.term && !t.term.startsWith("#") ? `#${t.term}` : t.term, reason: t.reason };
};
const tagsOf = (v: unknown): Term[] => (Array.isArray(v) ? v.map(tagOf) : []);

function hashtagsOf(v: Any): Record<HashtagPlatform, Term[]> {
  return { instagram: tagsOf(v?.instagram), tiktok: tagsOf(v?.tiktok), linkedin: tagsOf(v?.linkedin) };
}

/** The profile in an answer, or what is wrong with it. */
export function parseProfile(text: string, e: ProfileEvidence): { value: TrendProfile } | { error: string } {
  const parsed = parseAnswer(text);
  if ("error" in parsed) return parsed;
  const v = parsed.value ?? {};
  const profile: TrendProfile = {
    audience: str(v.audience),
    topics: termsOf(v.topics),
    hashtags: hashtagsOf(v.hashtags),
    exclusions: termsOf(v.exclusions),
    fit_rubric: str(v.fit_rubric),
    platforms: Array.isArray(v.platforms) ? v.platforms.map((x: Any) => ({ platform: str(x?.platform).toLowerCase() as TrendPlatform, reason: str(x?.reason) })) : [],
  };
  const problems = profileProblems(profile, e);
  return problems.length ? { error: problems.join(" ") } : { value: profile };
}

const HASHTAGS_SYSTEM = `You keep the hashtags of a brand's industry-trend tracking current. Moburst, a marketing agency, manages the brand's social media.
Given the brand's trend profile and the hashtags its best posts and its competitors' best posts used in the last 90 days, give up to 10 hashtags each for instagram, tiktok and linkedin, each with a reason, written with the leading #. Prefer hashtags that perform in this space now. Never the brand's own name.
Answer with one JSON object and nothing else.`;

/** The Messages API request for the monthly hashtag refresh. */
export function hashtagsRequest(current: { audience: string; fit_rubric: string; topics: Term[]; hashtags: Record<HashtagPlatform, Term[]> }, e: ProfileEvidence): Record<string, unknown> {
  const list = (ts: Term[]) => ts.map((t) => `- ${t.term}: ${t.reason}`).join("\n") || "- none";
  const content = [
    evidenceText(e),
    `\nThe trend profile:\nAudience: ${current.audience}\nWhat fits: ${current.fit_rubric}\nTopics:\n${list(current.topics)}`,
    ...HASHTAG_PLATFORMS.map((p) => `\nCurrent ${p} hashtags:\n${list(current.hashtags[p] ?? [])}`),
    `\nAnswer in this shape:\n{"hashtags": {"instagram": [{"term": "#...", "reason": "..."}], "tiktok": [], "linkedin": []}}`,
  ].join("\n");
  return { model: TREND_PROFILE_MODEL, max_tokens: 2000, system: HASHTAGS_SYSTEM, messages: [{ role: "user", content }] };
}

/** The refreshed hashtags in an answer, or what is wrong with them. */
export function parseHashtags(text: string, e: ProfileEvidence): { value: Record<HashtagPlatform, Term[]> } | { error: string } {
  const parsed = parseAnswer(text);
  if ("error" in parsed) return parsed;
  const tags = hashtagsOf(parsed.value?.hashtags);
  const problems: string[] = [];
  for (const p of HASHTAG_PLATFORMS) {
    if (tags[p].length > 10) problems.push(`There are more than 10 ${p} hashtags.`);
    for (const h of tags[p]) {
      if (!/^#[\p{L}0-9_]+$/u.test(h.term) || !h.reason) problems.push(`The ${p} hashtag "${h.term}" needs to be one #tag with a reason.`);
      else if (tagNamesBrand(h.term, e.client.name)) problems.push(`The ${p} hashtag "${h.term}" is the brand's own name.`);
    }
  }
  return problems.length ? { error: problems.join(" ") } : { value: tags };
}

export type ClaudeCall = (args: { apiKey: string; body: Record<string, unknown> }) => Promise<{ text: string }>;

/** One request, and one more with the problems named when the first answer does not parse. */
export async function askTwice<T>(call: ClaudeCall, apiKey: string, body: Record<string, unknown>, parse: (text: string) => { value: T } | { error: string }): Promise<{ value: T } | { error: string }> {
  const first = await call({ apiKey, body });
  const got = parse(first.text);
  if ("value" in got) return got;
  const messages = [...(body.messages as unknown[]), { role: "assistant", content: first.text }, {
    role: "user", content: `That answer has these problems: ${got.error} Send the whole JSON object again with them fixed.`,
  }];
  const second = await call({ apiKey, body: { ...body, messages } });
  return parse(second.text);
}

/** A client's topics, hashtags and exclusions that nobody removed. */
export async function activeTerms(db: Db, clientId: string): Promise<{ topics: Term[]; hashtags: Record<HashtagPlatform, Term[]>; exclusions: Term[] }> {
  const { data, error } = await db.from("trend_terms").select("kind, platform, term, reason, created_at").eq("client_id", clientId).is("removed_at", null);
  if (error) throw new Error(`Could not read what trends track: ${error.message}`);
  const out = { topics: [] as Term[], hashtags: { instagram: [], tiktok: [], linkedin: [] } as Record<HashtagPlatform, Term[]>, exclusions: [] as Term[] };
  for (const r of (data ?? []) as Any[]) {
    const t = { term: String(r.term), reason: String(r.reason ?? "") };
    if (r.kind === "topic") out.topics.push(t);
    else if (r.kind === "exclusion") out.exclusions.push(t);
    else if (r.kind === "hashtag" && HASHTAG_PLATFORMS.includes(r.platform)) out.hashtags[r.platform as HashtagPlatform].push(t);
  }
  return out;
}

/**
 * Brings one group of the lifecycle's terms in line with a new answer: adds
 * what is new, updates reasons, and deletes the lifecycle's own terms the
 * answer dropped. Rows a person added, rows a person removed and dismissals
 * are never touched.
 */
export async function syncLifecycleTerms(db: Db, clientId: string, kind: "topic" | "hashtag" | "exclusion", platform: HashtagPlatform | null, items: Term[]): Promise<void> {
  let q = db.from("trend_terms").select("id, term, reason, source, removed_at").eq("client_id", clientId).eq("kind", kind);
  q = platform ? q.eq("platform", platform) : q.is("platform", null);
  const { data, error } = await q;
  if (error) throw new Error(`Could not read what trends track: ${error.message}`);
  const existing = new Map<string, Any>(((data ?? []) as Any[]).map((r) => [String(r.term).toLowerCase(), r]));
  const wanted = new Set<string>();
  for (const item of items) {
    const term = str(item.term);
    if (!term) continue;
    const key = term.toLowerCase();
    if (wanted.has(key)) continue;
    wanted.add(key);
    const hit = existing.get(key);
    if (!hit) {
      const { error: e } = await db.from("trend_terms").insert({ client_id: clientId, kind, platform, term, reason: item.reason, source: "lifecycle" });
      if (e) throw new Error(`Could not save a trend term: ${e.message}`);
    } else if (hit.source === "lifecycle" && !hit.removed_at && hit.reason !== item.reason) {
      await db.from("trend_terms").update({ reason: item.reason }).eq("id", hit.id);
    }
  }
  for (const [key, r] of existing) {
    if (r.source === "lifecycle" && !r.removed_at && !wanted.has(key)) await db.from("trend_terms").delete().eq("id", r.id);
  }
}

/** Saves a new profile. A rewrite clears the coverage rewrite's searches, which were made from the old one. */
export async function writeTrendProfile(db: Db, clientId: string, p: TrendProfile, inputsKey: string, now: Date): Promise<void> {
  const at = now.toISOString();
  const { error } = await db.from("trend_profiles").upsert({
    client_id: clientId, audience: p.audience, fit_rubric: p.fit_rubric, platforms: p.platforms,
    search_overrides: {}, inputs_key: inputsKey, written_at: at, hashtags_at: at,
  }, { onConflict: "client_id" });
  if (error) throw new Error(`Could not save the trend profile: ${error.message}`);
  await syncLifecycleTerms(db, clientId, "topic", null, p.topics);
  for (const platform of HASHTAG_PLATFORMS) await syncLifecycleTerms(db, clientId, "hashtag", platform, p.hashtags[platform] ?? []);
  await syncLifecycleTerms(db, clientId, "exclusion", null, p.exclusions);
}

/** The calendar month of a moment, in Israel time (YYYY-MM). */
export function monthIn(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit" }).format(at).slice(0, 7);
}
