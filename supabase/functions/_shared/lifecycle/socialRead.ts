// supabase/functions/_shared/lifecycle/socialRead.ts
//
// The lifecycle's social_read step (spec: docs/superpowers/specs/2026-11-03-
// onboarding-complete-design.md): a client's Sprout profiles as a source the
// way its website is one, read every week.
//
// One Sprout read, no model call: 90 days of the client's posts with the
// owned source's fields and metrics and each post's profile picture (12
// months when 90 days hold fewer than 5 organic posts with text), the
// followers' countries and cities, and the addresses Sprout gives a local
// profile. Code scores the posts with the calendar's own score
// (calendar/evidence.ts scoreOwnPosts), picks the logo from the profile
// pictures (the largest by pixel width, read from the file header; on a tie
// the LinkedIn page, then Facebook, Instagram, YouTube, TikTok, X), counts
// each post's language, finds addresses in the posts and the bio (a ZIP or a
// street number required) and tallies the followers. The client's Instagram
// bio and bio links are read through Apify once per profile, and again only
// when the profile changed (its handle or its picture).
//
// The evidence keeps a version that moves only when the posts moved enough
// (versionMove): otherwise it is a quiet week, with no model call and no
// write to the client. A move writes, through lifecycle_write_client and
// never over a person's value: the logo (a person's, then the website's, then
// a profile picture: a picture replaces only an earlier picture), the brand
// identity and where the posts say the business is (one gpt-4.1 call, only
// when a field it fills is still the lifecycle's and no better source has
// it), the time zone (location.ts resolveSocialLocation and its ranks), the
// regions and the languages (posts outrank the site's language tag). The
// result keeps the posts the brief and pillars read, labeled with their
// multiple, and each post's multiple for the design references.

import { engagementsOf, isPublishedPost } from "../competitive/reportMetrics.ts";
import { ownedNetwork } from "../competitive/ownedMerge.ts";
import { median, OWN_DAYS, platformName, scoreOwnPosts, SETTLE_HOURS, type OwnPost } from "../calendar/evidence.ts";
import { followerLocations, profileAddress, type FollowerLocations } from "../sprout/audience.ts";
import type { CustomerProfile } from "../sprout/profiles.ts";
import { defaultSproutCustomerId } from "../sprout/customer.ts";
import type { BioRead, InstagramBio } from "../apify/instagramProfile.ts";
import { pageUrlOf, type LinkedInPage, type PageRead } from "../apify/linkedinPage.ts";
import type { SocialBrandInput, SocialBrandRead } from "../brand/research.ts";
import { countryCode, followersZone, regionsFor, replacesLocation, resolveSocialLocation, SOURCE_RANK, zoneOf, type Address, type Headquarters, type LocationSource } from "./location.ts";
import { lifecycleMayWrite, setBy, sourceOf, writeClientFields } from "./fields.ts";
import { textHash } from "./names.ts";
import type { StepOutcome, StepRow } from "./policy.ts";
import { clipText } from "../text/clip.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const DAY = 86_400_000;
export const SOCIAL_DAYS = 90;
export const YEAR_DAYS = 365;
/** Organic posts with text the brief and pillars need (calendar/evidence.ts MIN_SAMPLE). */
export const MIN_TEXT_POSTS = 5;
export const TOP_POSTS = 12;
export const NEWEST_POSTS = 12;
/** A language counts once it is in this share of the posts with text. */
export const LANGUAGE_SHARE = 0.25;
/** The floor of the weekly refresh: this many days with MONTHLY_POSTS new posts moves the version. */
export const MONTHLY_DAYS = 28;
export const MONTHLY_POSTS = 5;
/** Top designed posts the brand read is shown, after the profile picture. */
export const DESIGNED_IMAGES = 6;
/** Top posts the brand read is given as text. */
export const MODEL_POSTS = 30;
/** Picture tie order: page logos are square and uncropped; Instagram and TikTok crop to a circle. */
export const NETWORK_ORDER = ["LinkedIn", "Facebook", "Instagram", "YouTube", "TikTok", "X"];

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

// ── Posts ──────────────────────────────────────────────────────────────────

/** A post as the step reads it: the calendar's own post, with its Sprout identity, its profile picture and its language. */
export interface SocialPost extends OwnPost {
  guid: string;
  profileId: string;
  picture: string | null;
  language: string | null;
  hasText: boolean;
}

export interface ProfileRef {
  id: string;
  network_type: string;
  native_name: string;
}

const number = (v: unknown): number | null => (v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);
const metric = (row: Row, ...keys: string[]) => keys.map((k) => number(row.metrics?.[k])).find((n) => n !== null) ?? null;

/** Text as a post says it: links, @mentions and #hashtags left out. */
export function plainText(text: string | null | undefined): string {
  return String(text ?? "").replace(/https?:\/\/\S+|www\.\S+/gi, " ").replace(/[@#][\p{L}\p{N}_.]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** The client's organic posts from Sprout's rows, counted the way the owned source counts them (competitive/ownedSource.ts). */
export function toSocialPosts(rows: Row[], profiles: ProfileRef[]): SocialPost[] {
  const byId = new Map(profiles.map((p) => [String(p.id), p]));
  const seen = new Set<string>();
  const out: SocialPost[] = [];
  for (const row of rows ?? []) {
    const id = String(row.customer_profile_id ?? row.dimensions?.customer_profile_id ?? "");
    const profile = byId.get(id);
    if (!profile || row.sent === false || !isPublishedPost(row)) continue;
    const key = String(row.guid || row.perma_link || "");
    if (!key || seen.has(key) || !Number.isFinite(Date.parse(row.created_time))) continue;
    seen.add(key);
    const network = ownedNetwork(profile.network_type);
    const applause = (network === "instagram" || network === "youtube" || network === "twitter" ? metric(row, "lifetime.likes", "lifetime.reactions") : metric(row, "lifetime.reactions", "lifetime.likes")) ?? 0;
    const conversation = metric(row, "lifetime.comments_count") ?? 0;
    const shares = metric(row, "lifetime.shares_count", "lifetime.post_shares_count") ?? 0;
    const category = String(row.content_category || "").toLowerCase();
    const picture = str(row.from?.profile_picture ?? row["from.profile_picture"]);
    const text = String(row.text || "");
    const words = plainText(text);
    out.push({
      id: `sprout:${key}`, guid: String(row.guid || key), profileId: id, platform: platformName(network),
      format: category === "album" || category === "document" ? "carousel" : category === "photo" ? "image" : category || "unknown",
      publishedAt: String(row.created_time), text, link: row.perma_link ?? null,
      impressions: metric(row, "lifetime.impressions") ?? (network === "youtube" ? metric(row, "lifetime.video_views") : null),
      engagement: engagementsOf(network, { applause, conversation, amplification: shares }) ?? 0,
      boosted: row.is_boosted === true,
      picture: /^https?:\/\//i.test(picture) ? picture : null,
      language: detectLanguage(words), hasText: /\p{L}{3}/u.test(words),
    });
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

const organic = (posts: SocialPost[]) => posts.filter((p) => !p.boosted);
const within = (posts: SocialPost[], now: Date, days: number) => posts.filter((p) => Date.parse(p.publishedAt) >= now.getTime() - days * DAY);
export const textPosts = (posts: SocialPost[]) => organic(posts).filter((p) => p.hasText);

// ── Languages ──────────────────────────────────────────────────────────────

const SCRIPTS: Array<[RegExp, string]> = [
  [/[֐-׿]/g, "he"], [/[؀-ۿݐ-ݿ]/g, "ar"], [/[Ѐ-ӿ]/g, "ru"], [/[Ͱ-Ͽ]/g, "el"],
  [/[฀-๿]/g, "th"], [/[가-힯ᄀ-ᇿ]/g, "ko"], [/[぀-ヿ]/g, "ja"], [/[一-鿿]/g, "zh"], [/[ऀ-ॿ]/g, "hi"],
];
/** The most common short words of each language the Latin alphabet writes. */
const COMMON: Record<string, string[]> = {
  en: ["the", "and", "you", "for", "with", "this", "that", "our", "your", "are", "is", "to", "of", "on", "we", "it", "be", "at", "from", "will"],
  es: ["el", "los", "las", "que", "con", "para", "por", "una", "del", "es", "y", "nuestro", "tu", "más", "como", "pero", "este", "esta", "lo", "su"],
  fr: ["le", "les", "des", "est", "et", "pour", "avec", "une", "dans", "sur", "vous", "nous", "qui", "pas", "du", "au", "ce", "cette", "plus", "notre"],
  de: ["der", "die", "das", "und", "ist", "mit", "für", "ein", "eine", "nicht", "auf", "den", "dem", "zu", "wir", "sie", "ihr", "auch", "von", "bei"],
  pt: ["os", "as", "que", "com", "para", "uma", "não", "por", "mais", "do", "da", "dos", "das", "em", "é", "você", "nosso", "seu", "na", "no"],
  it: ["il", "gli", "che", "con", "per", "una", "non", "del", "della", "sono", "è", "di", "un", "ci", "anche", "più", "questo", "nostro", "alla", "nel"],
  nl: ["het", "een", "en", "van", "is", "met", "voor", "niet", "op", "zijn", "wij", "je", "ook", "aan", "dat", "bij", "naar", "om", "onze", "wordt"],
};

/** A post's language, from its script, or for the Latin alphabet its most common short words. Null when the text does not say clearly. */
export function detectLanguage(text: string): string | null {
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < 3) return null;
  const counts = SCRIPTS.map(([re, lang]) => [lang, (text.match(re) ?? []).length] as const);
  const kana = counts.find(([l]) => l === "ja")![1];
  const best = counts.filter(([l]) => l !== "ja" || kana).sort((a, b) => b[1] - a[1])[0];
  if (best && best[1] * 2 >= letters) return best[0] === "zh" && kana ? "ja" : best[0];
  const words = text.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const scores = Object.entries(COMMON).map(([lang, list]) => [lang, words.filter((w) => list.includes(w)).length] as const).sort((a, b) => b[1] - a[1]);
  return scores[0][1] >= 2 && scores[0][1] > scores[1][1] ? scores[0][0] : null;
}

/** Each language's count among the posts with text, most used first. */
export function languageCounts(posts: SocialPost[]): { total: number; languages: Array<{ language: string; posts: number }> } {
  const withText = textPosts(posts);
  const counts = new Map<string, number>();
  for (const p of withText) if (p.language) counts.set(p.language, (counts.get(p.language) ?? 0) + 1);
  return { total: withText.length, languages: [...counts].map(([language, n]) => ({ language, posts: n })).sort((a, b) => b.posts - a.posts) };
}

/** The languages in a quarter or more of the posts with text, most used first. */
export function postLanguages(c: { total: number; languages: Array<{ language: string; posts: number }> }): string[] {
  return c.total ? c.languages.filter((l) => l.posts / c.total >= LANGUAGE_SHARE).map((l) => l.language) : [];
}

// ── Profile pictures ───────────────────────────────────────────────────────

export interface ImageSize {
  width: number;
  height: number;
  ext: "png" | "jpg" | "gif" | "webp";
  mime: string;
}

/** An image's pixel size, read from its file header (PNG, JPEG, GIF, WebP), or null. */
export function imageSize(b: Uint8Array): ImageSize | null {
  const at = (i: number) => b[i] ?? 0;
  const be16 = (i: number) => (at(i) << 8) | at(i + 1);
  if (b.length >= 24 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return { width: ((at(16) << 24) >>> 0) + (at(17) << 16) + (at(18) << 8) + at(19), height: ((at(20) << 24) >>> 0) + (at(21) << 16) + (at(22) << 8) + at(23), ext: "png", mime: "image/png" };
  }
  if (b.length >= 10 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return { width: at(6) | (at(7) << 8), height: at(8) | (at(9) << 8), ext: "gif", mime: "image/gif" };
  if (b.length >= 30 && at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    const chunk = String.fromCharCode(at(12), at(13), at(14), at(15));
    if (chunk === "VP8 ") return { width: (at(26) | (at(27) << 8)) & 0x3fff, height: (at(28) | (at(29) << 8)) & 0x3fff, ext: "webp", mime: "image/webp" };
    if (chunk === "VP8L") return { width: 1 + (((at(22) & 0x3f) << 8) | at(21)), height: 1 + (((at(24) & 0xf) << 10) | (at(23) << 2) | ((at(22) & 0xc0) >> 6)), ext: "webp", mime: "image/webp" };
    if (chunk === "VP8X") return { width: 1 + (at(24) | (at(25) << 8) | (at(26) << 16)), height: 1 + (at(27) | (at(28) << 8) | (at(29) << 16)), ext: "webp", mime: "image/webp" };
    return null;
  }
  if (at(0) === 0xff && at(1) === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (at(i) !== 0xff) { i++; continue; }
      const marker = at(i + 1);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0xff) { i += marker === 0xff ? 1 : 2; continue; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: be16(i + 7), height: be16(i + 5), ext: "jpg", mime: "image/jpeg" };
      }
      i += 2 + be16(i + 2);
    }
  }
  return null;
}

export interface Picture {
  platform: string;
  profileId: string;
  url: string;
  width: number;
  height: number;
  ext: ImageSize["ext"];
  mime: string;
  hash: string;
  bytes: Uint8Array;
}

/** Each profile's picture, from its newest post that carries one. */
export function pictureUrls(posts: SocialPost[]): Array<{ platform: string; profileId: string; url: string }> {
  const out = new Map<string, { platform: string; profileId: string; url: string }>();
  for (const p of posts) if (p.picture && !out.has(p.profileId)) out.set(p.profileId, { platform: p.platform, profileId: p.profileId, url: p.picture });
  return [...out.values()];
}

const orderOf = (platform: string) => {
  const i = NETWORK_ORDER.indexOf(platform);
  return i < 0 ? NETWORK_ORDER.length : i;
};

/** The logo among the profile pictures: the largest by pixel width; on a tie, by NETWORK_ORDER. */
export function pickLogo<T extends { platform: string; width: number; profileId: string }>(pictures: T[]): T | null {
  return [...pictures].sort((a, b) => b.width - a.width || orderOf(a.platform) - orderOf(b.platform) || a.profileId.localeCompare(b.profileId))[0] ?? null;
}

/** True when a profile picture may become the client's logo: there is none, or the one on file is an earlier picture the lifecycle took. Never a person's, never the website's. */
export function pictureMayReplaceLogo(client: Row): boolean {
  if (!str(client.logo_url)) return lifecycleMayWrite(client.field_sources, "logo_url");
  return setBy(client.field_sources, "logo_url") === "lifecycle" && (sourceOf(client.field_sources, "logo_url") ?? "").startsWith("profile_picture");
}

async function sha16(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

// ── The evidence and its version ───────────────────────────────────────────

export interface Snapshot {
  /** When this version was set. */
  at: string;
  /** The top posts by multiple. */
  top: string[];
  /** Each platform's organic posts in 90 days and their median engagement. */
  platforms: Record<string, { posts: number; median: number | null }>;
  /** The languages in a quarter or more of the posts with text. */
  languages: string[];
  top_country: string | null;
  /** Every profile picture's bytes, hashed together: a new picture on any profile is a change. */
  picture: string | null;
  /** The day a new look began in the client's posts (design_refs). */
  look: string | null;
}

export function snapshotOf(posts: SocialPost[], now: Date, extra: { top: string[]; languages: string[]; topCountry: string | null; picture: string | null; look: string | null }): Snapshot {
  const recent = organic(within(posts, now, SOCIAL_DAYS));
  const platforms: Snapshot["platforms"] = {};
  for (const name of [...new Set(recent.map((p) => p.platform))].sort()) {
    const mine = recent.filter((p) => p.platform === name);
    platforms[name] = { posts: mine.length, median: median(mine.map((p) => p.engagement)) };
  }
  return { at: now.toISOString(), top: extra.top, platforms, languages: extra.languages, top_country: extra.topCountry, picture: extra.picture, look: extra.look };
}

/**
 * Why the evidence moved since its version was set, or null for a quiet
 * week: 4 or more of the top 12 posts new to it; a platform reaching or
 * dropping below 5 organic posts, or posting starting or stopping on one;
 * a platform's median engagement per post moving by half or more with 5 or
 * more posts on both sides; a language crossing 25% or the top follower
 * country changing; the profile picture or the look changing; 28 days with
 * 5 or more new posts.
 */
export function versionMove(prev: Snapshot | null | undefined, cur: Snapshot, posts: SocialPost[], now: Date): string | null {
  if (!prev || !prev.at) return "first";
  if (cur.top.filter((id) => !(prev.top ?? []).includes(id)).length >= 4) return "top_posts";
  const names = new Set([...Object.keys(prev.platforms ?? {}), ...Object.keys(cur.platforms)]);
  for (const name of names) {
    const was = prev.platforms?.[name] ?? { posts: 0, median: null };
    const is = cur.platforms[name] ?? { posts: 0, median: null };
    if ((was.posts > 0) !== (is.posts > 0)) return "posting";
    if ((was.posts >= MIN_TEXT_POSTS) !== (is.posts >= MIN_TEXT_POSTS)) return "platform_minimum";
    if (was.posts >= MIN_TEXT_POSTS && is.posts >= MIN_TEXT_POSTS && was.median !== null && is.median !== null && Math.abs(is.median - was.median) >= 0.5 * Math.max(was.median, 1)) return "engagement";
  }
  if ([...prev.languages ?? []].sort().join(",") !== [...cur.languages].sort().join(",")) return "language";
  if (cur.top_country && prev.top_country !== cur.top_country) return "followers";
  if (cur.picture && prev.picture && cur.picture !== prev.picture) return "picture";
  if ((prev.look ?? null) !== (cur.look ?? null)) return "look";
  const since = Date.parse(prev.at);
  if (now.getTime() - since >= MONTHLY_DAYS * DAY && organic(posts).filter((p) => Date.parse(p.publishedAt) > since).length >= MONTHLY_POSTS) return "monthly";
  return null;
}

// ── What the brief and pillars read ────────────────────────────────────────

/** A post as the brief and pillars read it: P1, P2, ... */
export interface EvidencePost {
  id: string;
  platform: string;
  format: string;
  date: string;
  text: string;
  /** "2.4x its platform's median for carousels", for a top post. */
  label: string | null;
  top: boolean;
}

const FORMAT_WORDS: Record<string, string> = { carousel: "carousels", image: "images", video: "videos", text: "text posts", link: "link posts", reel: "reels" };

/** A top post's label: its multiple of its platform's median for its format. */
export function multipleLabel(multiple: number, format: string): string {
  return `${multiple}x its platform's median for ${FORMAT_WORDS[format] ?? "posts"}`;
}

/** The top 12 posts by multiple, labeled, then the 12 newest not already listed: the posts with text only. */
export function evidencePosts(top: Array<{ post: SocialPost; multiple: number }>, posts: SocialPost[]): EvidencePost[] {
  const out: EvidencePost[] = [];
  const taken = new Set<string>();
  const add = (p: SocialPost, label: string | null) => {
    taken.add(p.id);
    out.push({ id: `P${out.length + 1}`, platform: p.platform, format: p.format, date: p.publishedAt.slice(0, 10), text: clipText(plainTextKeepLinks(p.text), 500), label, top: label !== null });
  };
  for (const t of top.filter((t) => t.post.hasText).slice(0, TOP_POSTS)) add(t.post, multipleLabel(t.multiple, t.post.format));
  for (const p of textPosts(posts).filter((p) => !taken.has(p.id)).slice(0, NEWEST_POSTS)) add(p, null);
  return out;
}

const plainTextKeepLinks = (t: string) => String(t ?? "").replace(/\s+/g, " ").trim();

// ── Where the posts say the business is ────────────────────────────────────

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const named = (blob: string, word: string | null | undefined) => {
  const w = str(word).toLowerCase();
  return w.length >= 2 && new RegExp(`(^|[^\\p{L}])${escapeRe(w)}([^\\p{L}]|$)`, "u").test(blob);
};

/** The place the model read, kept only when a post (or the bio) names its city or its country. */
export function statedInPosts(stated: Headquarters | null | undefined, texts: string[]): Headquarters | null {
  if (!stated) return null;
  const blob = texts.join("\n").toLowerCase();
  const code = countryCode(stated.country);
  return named(blob, stated.city) || named(blob, stated.country) || (code === "US" && /\b(usa|u\.s\.a?\.?)\b/i.test(blob)) ? stated : null;
}

// ── The step ───────────────────────────────────────────────────────────────

export interface SocialIO {
  now(): Date;
  /** The profiles' posts with the owned source's fields and metrics and the profile picture (sprout/posts.ts listOwnedPostRows). */
  posts(profileIds: string[], since: Date, until: Date, customer: string): Promise<Row[]>;
  /** The profiles' follower-location readings (sprout/audience.ts listFollowerLocations). */
  followers(profileIds: string[], since: Date, until: Date, customer: string): Promise<Row[]>;
  /** The Sprout account's profiles, for their network metadata. */
  customerProfiles(customer: string): Promise<CustomerProfile[]>;
  /** A picture's bytes, or null. */
  image(url: string): Promise<Uint8Array | null>;
  /** The Instagram profile's bio through Apify, or the answer of a run started earlier. Throws when no run can be made. */
  instagram(handle: string, runId: string | null): Promise<BioRead>;
  /** The client's LinkedIn company page through Apify, or the answer of a run started earlier. Throws when no run can be made. */
  linkedinPage(url: string, runId: string | null): Promise<PageRead>;
  openaiKey(db: Db): Promise<string | null>;
  brandRead(input: Omit<SocialBrandInput, "fetchImpl">): Promise<SocialBrandRead>;
}

export interface InstagramState {
  profile_id: string;
  handle: string;
  /** The profile as it was read: its id, handle and picture. A change reads the bio again. */
  key: string;
  read_at: string | null;
  bio: InstagramBio | null;
  /** A run still going, read on the next look. */
  run_id?: string | null;
  status?: string;
}

export interface LinkedInPageState {
  profile_id: string;
  url: string;
  /** The profile as it was read: its id and page name. A change reads the page again. */
  key: string;
  read_at: string | null;
  page: LinkedInPage | null;
  /** A run still going, read on the next look. */
  run_id?: string | null;
  status?: string;
}

/** The LinkedIn page the last social_read kept, for the steps after it. */
export function pageOf(result: Row | null): LinkedInPage | null {
  const state = result?.linkedin_page as LinkedInPageState | null | undefined;
  return state?.page ?? null;
}

const PAGE_REREAD_DAYS = 30;

/** The client's active Sprout profiles with what the read needs. */
async function profilesOf(db: Db, clientId: string): Promise<ProfileRef[]> {
  const { data, error } = await db.from("sprout_profiles").select("sprout_profile_id, network_type, native_name").eq("client_id", clientId).eq("is_active", true);
  if (error) throw new Error(`Could not read the client's social accounts: ${error.message}`);
  return (data ?? []).map((r: Row) => ({ id: String(r.sprout_profile_id), network_type: str(r.network_type), native_name: str(r.native_name) }))
    .sort((a: ProfileRef, b: ProfileRef) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

async function readPictures(posts: SocialPost[], io: SocialIO): Promise<Picture[]> {
  const out: Picture[] = [];
  for (const p of pictureUrls(posts)) {
    const bytes = await io.image(p.url).catch(() => null);
    const size = bytes ? imageSize(bytes) : null;
    if (!bytes || !size) continue;
    out.push({ ...p, ...size, bytes, hash: await sha16(bytes) });
  }
  return out;
}

/** The Instagram bio: the one read before while the profile is the same, else a new read (a run under way is collected first). Quiet: a read that cannot be made keeps the last one. */
async function readBio(profiles: ProfileRef[], pictures: Picture[], prev: InstagramState | null, io: SocialIO, now: Date): Promise<InstagramState | null> {
  const ig = profiles.find((p) => platformName(ownedNetwork(p.network_type)) === "Instagram" && p.native_name);
  if (!ig) return null;
  const key = `${ig.id}:${ig.native_name.toLowerCase()}:${pictures.find((p) => p.profileId === ig.id)?.hash ?? ""}`;
  if (prev?.key === key && !prev.run_id) return prev;
  const pending = prev?.key === key ? prev.run_id ?? null : null;
  try {
    const got = await io.instagram(ig.native_name, pending);
    const base = { profile_id: ig.id, handle: ig.native_name, key };
    if (got.state === "pending") return { ...base, read_at: prev?.read_at ?? null, bio: prev?.bio ?? null, run_id: got.run_id };
    if (got.state === "failed") return { ...base, read_at: now.toISOString(), bio: prev?.bio ?? null, status: got.status };
    return { ...base, read_at: now.toISOString(), bio: got.bio };
  } catch (e) {
    console.warn("[social_read] Instagram bio not read:", e instanceof Error ? e.message : String(e));
    return prev ? { ...prev } : null;
  }
}

/** The LinkedIn company page: the one read before while the profile is the same and under 30 days old, else a new read (a run under way is collected first). Quiet: a read that cannot be made keeps the last one. Not part of the evidence version. */
async function readPage(profiles: ProfileRef[], prev: LinkedInPageState | null, io: SocialIO, now: Date): Promise<LinkedInPageState | null> {
  const li = profiles.find((p) => p.network_type === "linkedin_company" && p.native_name);
  if (!li) return null;
  const key = `${li.id}:${li.native_name.toLowerCase()}`;
  const same = prev?.key === key;
  const age = prev?.read_at ? now.getTime() - new Date(prev.read_at).getTime() : Infinity;
  if (same && !prev.run_id && age < PAGE_REREAD_DAYS * DAY) return prev;
  const url = pageUrlOf(li.native_name);
  const base = { profile_id: li.id, url, key };
  const last = same ? prev : null;
  try {
    const got = await io.linkedinPage(url, same ? prev.run_id ?? null : null);
    if (got.state === "pending") return { ...base, read_at: last?.read_at ?? null, page: last?.page ?? null, run_id: got.run_id };
    // A failed read, or one that found no page, is read again on the next look; the 30 days are for a page that was read.
    if (got.state === "failed") return { ...base, read_at: null, page: last?.page ?? null, status: got.status };
    if (!got.page) return { ...base, read_at: null, page: last?.page ?? null };
    return { ...base, read_at: now.toISOString(), page: got.page };
  } catch (e) {
    console.warn("[social_read] LinkedIn page not read:", e instanceof Error ? e.message : String(e));
    // The last page is kept only for the same profile; a changed profile has no page until it is read.
    if (!prev) return null;
    return same ? { ...prev } : { ...base, read_at: null, page: null };
  }
}

/** The images the brand read is shown: the chosen profile picture, then the top designed posts in the client's library. */
async function readImages(db: Db, client: Row, logo: Picture | null, multiples: Record<string, number>): Promise<SocialBrandInput["images"]> {
  const images: SocialBrandInput["images"] = logo ? [{ bytes: logo.bytes, label: `${logo.platform} profile picture` }] : [];
  const library = (Array.isArray(client.harvested_design_references) ? client.harvested_design_references : []).filter((r: Row) => r?.path && !r.upload);
  const ranked = [...library].sort((a: Row, b: Row) => (multiples[String(b.source_post_id)] ?? 0) - (multiples[String(a.source_post_id)] ?? 0) || String(b.posted_at ?? "").localeCompare(String(a.posted_at ?? "")));
  for (const r of ranked.slice(0, DESIGNED_IMAGES)) {
    try {
      const { data } = await db.storage.from("design-references").download(String(r.path));
      if (!data) continue;
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.byteLength <= 4 * 1024 * 1024) images.push({ bytes, label: `${r.platform ?? "Post"} designed post${r.posted_at ? `, ${String(r.posted_at).slice(0, 10)}` : ""}` });
    } catch {
      // a post that cannot be read is left out of the read
    }
  }
  return images;
}

const slugOf = (platform: string) => platform.toLowerCase().replace(/[^a-z]/g, "") || "profile";

/** The country the profiles and posts give for the business, or the website's when it was read from one. */
function businessCountryOf(stored: Row | null, profileAddresses: Address[], postTexts: string[], stated: Headquarters | null): string | null {
  if (stored?.website && stored.country) return String(stored.country);
  const loc = resolveSocialLocation({ profileAddresses, postTexts, stated });
  return loc.source ? loc.country : null;
}

/** Each post's multiple of its platform-and-format median (1 for a settled post at its median), by Sprout guid. */
function multiplesOf(posts: SocialPost[], scored: ReturnType<typeof scoreOwnPosts>, now: Date): Record<string, number> {
  const t = now.getTime();
  const out: Record<string, number> = {};
  for (const p of organic(posts)) {
    const at = Date.parse(p.publishedAt);
    if (at <= t - SETTLE_HOURS * 3600_000 && at >= t - OWN_DAYS * DAY) out[p.guid] = 1;
  }
  for (const s of [...scored.top, ...scored.low]) out[(s.post as SocialPost).guid] = s.multiple;
  return out;
}

/** The social_read step's run. `prev` is the step's last result, whatever its inputs were: the version lives across them. */
export async function runSocialRead(db: Db, client: Row, ctx: { rows: Map<string, StepRow> }, io: SocialIO): Promise<StepOutcome> {
  const profiles = await profilesOf(db, client.id);
  if (!profiles.length) return { status: "waiting", reason: "social_accounts" };
  const now = io.now();
  const customer = String(client.sprout_customer_id || defaultSproutCustomerId());
  const ids = profiles.map((p) => p.id);
  const prev = (ctx.rows.get("social_read")?.result ?? null) as Row | null;

  // 90 days, or 12 months when 90 days hold fewer than 5 organic posts with text.
  let windowDays = SOCIAL_DAYS;
  let rows = await io.posts(ids, new Date(now.getTime() - SOCIAL_DAYS * DAY), now, customer);
  let posts = toSocialPosts(rows, profiles);
  if (textPosts(posts).length < MIN_TEXT_POSTS) {
    windowDays = YEAR_DAYS;
    rows = await io.posts(ids, new Date(now.getTime() - YEAR_DAYS * DAY), now, customer);
    posts = toSocialPosts(rows, profiles);
  }
  const scored = scoreOwnPosts(within(posts, now, SOCIAL_DAYS), now, { top: 1000, low: 1000 });
  const top = scored.top.map((s) => ({ post: s.post as SocialPost, multiple: s.multiple }));
  const multiples = multiplesOf(posts, scored, now);
  const pictures = await readPictures(posts, io);
  const logo = pickLogo(pictures);
  const audience: FollowerLocations = await io.followers(ids, new Date(now.getTime() - 3 * DAY), now, customer).then(followerLocations)
    .catch((e) => { console.warn("[social_read] follower locations not read:", e instanceof Error ? e.message : String(e)); return { countries: [], cities: [] }; });
  const meta = await io.customerProfiles(customer).catch(() => [] as CustomerProfile[]);
  const local = meta.filter((p) => ids.includes(String(p.id))).map((p) => ({ address: profileAddress(p.network_metadata), network: p.network_type }))
    .filter((x): x is { address: Address; network: string } => !!x.address);
  const profileAddresses = local.map((x) => x.address);
  const instagram = await readBio(profiles, pictures, (prev?.instagram ?? null) as InstagramState | null, io, now);
  const linkedin_page = await readPage(profiles, (prev?.linkedin_page ?? null) as LinkedInPageState | null, io, now);
  const langs = languageCounts(posts);
  const snapshot = snapshotOf(posts, now, {
    top: top.slice(0, TOP_POSTS).map((t) => t.post.id), languages: postLanguages(langs), topCountry: audience.countries[0]?.country ?? null,
    picture: pictures.length ? textHash(pictures.map((p) => `${p.profileId}:${p.hash}`).sort().join(",")) : null, look: str(client.look_since) || null,
  });
  const text = textPosts(posts).length;
  const base = {
    checked_at: now.toISOString(), window_days: windowDays, posts_read: rows.length, organic_posts: organic(posts).length, text_posts: text,
    enough: text >= MIN_TEXT_POSTS, multiples, instagram, linkedin_page,
  };
  const moved = versionMove(prev?.snapshot as Snapshot | undefined, snapshot, posts, now);
  // A quiet week: no model call, no write; the evidence stays as its version set it.
  if (!moved) return { status: "done", result: { ...(prev ?? {}), ...base, moved: null } };

  const fs = client.field_sources;
  const may = (f: string) => lifecycleMayWrite(fs, f);
  const fields: Record<string, unknown> = {};
  const from: Record<string, string> = {};
  const bio = instagram?.bio?.biography ?? "";
  const postTexts = [...textPosts(posts).map((p) => p.text), ...(bio ? [bio] : [])];
  const stored = client.location && typeof client.location === "object" ? client.location as Row : null;
  const storedRank = stored?.source ? SOURCE_RANK[stored.source as LocationSource] ?? 99 : 99;

  // The logo: a person's, then the website's, then a profile picture; a picture replaces only an earlier picture.
  let logoUrl: string | null = null;
  if (logo && pictureMayReplaceLogo(client)) {
    const path = `${client.id}/brand/logo-profile-${slugOf(logo.platform)}-${logo.hash}.${logo.ext}`;
    const { error } = await db.storage.from("generated-media").upload(path, logo.bytes, { contentType: logo.mime, upsert: true });
    if (!error) logoUrl = db.storage.from("generated-media").getPublicUrl(path).data.publicUrl;
    if (logoUrl && logoUrl !== str(client.logo_url)) {
      fields.logo_url = logoUrl;
      from.logo_url = `profile_picture:${slugOf(logo.platform)}`;
    }
  }

  // The brand read: only when a field it fills is still the lifecycle's and no better source has it.
  const identityMay = may("brand_identity") && (!client.brand_identity || (setBy(fs, "brand_identity") === "lifecycle" && sourceOf(fs, "brand_identity") === "posts"));
  const exact = resolveSocialLocation({ profileAddresses, postTexts });
  const exactRank = exact.source && exact.source !== "country" ? SOURCE_RANK[exact.source] : 99;
  const zoneMay = may("timezone") && storedRank > SOURCE_RANK.post_read && exactRank > SOURCE_RANK.post_text;
  let read: SocialBrandRead | null = null;
  const key = identityMay || zoneMay ? await io.openaiKey(db) : null;
  if (key) {
    const modelPosts = [...top.map((t) => t.post), ...textPosts(posts)].filter((p, i, all) => p.hasText && all.findIndex((x) => x.id === p.id) === i).slice(0, MODEL_POSTS);
    try {
      read = await io.brandRead({
        clientName: String(client.name ?? ""), openaiKey: key, images: await readImages(db, client, logo, multiples), bio: bio || null,
        postsText: modelPosts.map((p) => `[${p.platform}, ${p.publishedAt.slice(0, 10)}] ${plainTextKeepLinks(p.text).slice(0, 400)}`).join("\n"),
      });
    } catch (e) {
      // The read is tried again on the next move; the code's own values are written now.
      console.warn("[social_read] brand read did not finish:", e instanceof Error ? e.message : String(e));
    }
  }
  if (read?.identity && identityMay) {
    fields.brand_identity = read.identity;
    from.brand_identity = "posts";
  }

  // Where the business is, and its time zone.
  const stated = statedInPosts(read?.stated, postTexts);
  const followers = followersZone(audience.cities);
  const location = resolveSocialLocation({ profileAddresses, postTexts, stated, followers, countries: audience.countries.map((c) => c.country) });
  if (location.source && replacesLocation(stored, { source: location.source, website: null })) {
    // A local profile's address names the profile it came from (a Google Business Profile, Yelp or Tripadvisor page).
    const via = location.source === "profile_address" ? (local.find((x) => zoneOf(x.address)?.zone === location.timezone) ?? local[0])?.network ?? null : null;
    fields.location = { ...location, website: null, ...(via ? { via } : {}), read_at: now.toISOString() };
    if (location.timezone && may("timezone") && (location.timezone !== str(client.timezone) || sourceOf(fs, "timezone") !== location.source)) {
      fields.timezone = location.timezone;
      from.timezone = location.source;
    }
  }

  // Regions: the business's country, then each country with 20% or more of followers, else the top one.
  const business = businessCountryOf(stored, profileAddresses, postTexts, stated);
  const regions = regionsFor(business, audience.countries);
  const regionsFrom = regions.some((r) => r !== business) ? "followers" : "posts";
  if (regions.length && may("geo") && (regions.join(",") !== str(client.geo) || sourceOf(fs, "geo") !== regionsFrom)) {
    fields.geo = regions.join(",");
    from.geo = regionsFrom;
  }

  // Languages: each in 25% or more of the posts with text, most used first; the posts outrank the site's language tag.
  const languages = postLanguages(langs).length ? postLanguages(langs) : (read?.languages ?? []).slice(0, 3);
  if (languages.length && may("language") && (languages.join(",") !== str(client.language) || sourceOf(fs, "language") !== "posts")) {
    fields.language = languages.join(",");
    from.language = "posts";
  }

  const written = await writeClientFields(db, client.id, fields as never, "lifecycle", from as never);
  return {
    status: "done",
    result: {
      ...base, moved, version: (Number(prev?.version) || 0) + 1, version_at: now.toISOString(), snapshot,
      posts: evidencePosts(top, posts),
      logo: logo ? { platform: logo.platform, width: logo.width, height: logo.height, hash: logo.hash, url: logoUrl } : null,
      location: location.source ? { source: location.source, timezone: location.timezone, country: location.country, region: location.region, locality: location.locality } : null,
      follower_countries: audience.countries.slice(0, 10), follower_city: followers,
      languages: langs.languages.slice(0, 5), language_posts: langs.total,
      model_read: !!read, written: written.written, kept: written.skipped,
    },
  };
}

// ── What the other steps read of it ────────────────────────────────────────

/** The social_read step's result, once it has one. */
export function socialResult(rows: Map<string, StepRow>): Row | null {
  const r = rows.get("social_read");
  return r?.result && typeof r.result === "object" && (r.result as Row).checked_at ? (r.result as Row) : null;
}

/**
 * The part of a step's inputs key the social evidence gives: its version.
 * The first version is a client's baseline: a step whose client has other
 * evidence (a website, a brief, a strategy document) keys on it only from
 * its first move, so shipping the read rewrites nothing for clients already
 * set up. A client with only its posts keys on every version.
 */
export function socialVersionKey(rows: Map<string, StepRow>, postsOnly: boolean): string {
  const v = Number(socialResult(rows)?.version) || 0;
  return v >= 2 || (postsOnly && v >= 1) ? `|social:${v}` : "";
}

/** The client's top posts' text, for a competitor read that has no homepage to read. */
export function topPostsText(result: Row | null, max = 6000): string {
  const posts = (Array.isArray(result?.posts) ? result!.posts : []) as EvidencePost[];
  return posts.map((p) => `[${p.platform}${p.label ? `, ${p.label}` : ""}] ${p.text}`).join("\n").slice(0, max);
}

/** The followers' countries as markets: the regions rule over the followers alone. */
export function followerMarkets(result: Row | null): string[] {
  const countries = (Array.isArray(result?.follower_countries) ? result!.follower_countries : []) as Array<{ country: string; share: number }>;
  return regionsFor(null, countries);
}
