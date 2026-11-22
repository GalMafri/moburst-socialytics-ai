// supabase/functions/_shared/lifecycle/steps.ts
//
// The steps of a client's lifecycle, each with the inputs it depends on, its
// policy, and how it runs (spec: docs/superpowers/specs/2026-10-19-self-serve-
// lifecycle-design.md, section 1). Every step writes through fields.ts, so a
// value a person set is never overwritten. A step whose input does not exist
// yet waits for it and shows nothing; a step that does not finish is tried
// again quietly (policy.ts). No step's inputs include what the step itself
// writes, so a run never sets off another run of the same step.
//
// In the order a new client goes through them:
//   website         a website for a client with none, confirmed from its own posts (a client added from Sprout)
//   brand_read      the website: brand identity, logo, location and timezone, country, language (a page on another client's site: its language only)
//   brief_pillars   a brief from the strategy document or the site when there is none, then pillars and keywords
//   accounts        Sprout profiles matched by Sprout's brand name and by the site's profile links (none from another client's site); one own account per network, any other parked
//   social_read     the client's profiles and posts, weekly: logo, brand, location, regions, languages and scored posts (socialRead.ts)
//   voice           the voice profile checked, and built again only when it holds a decorated display name or an own account was parked since
//   access          the company slug, by the portal's slug rule
//   design_refs     the client's designed posts per platform, checked weekly, and the visual style learned from them
//   competitors     identify, pick the three closest with a website, confirm as the system
//   trend_profile   what Trends tracks: audience, topics, hashtags, exclusions, fit rubric, platforms
//   trend_hashtags  the profile's hashtags refreshed from the newest best posts, once a month
//   content_strategy the client's content strategy, written from all of the above once the profile is current
//   tracking        RivalIQ tracking for the confirmed set (decision 1), then handles from RivalIQ; a client on another client's site waits for its own
//   design_settings logo file, placement and background derived from data (decision 2)
//   first_output    this week and next planned, and the first monthly report
//   calendar_recheck the upcoming calendar checked against the copy rules when they or the voice change: names corrected, weeks re-planned
// A demo copy (a client the API demo made) runs only the steps its demo job asks for (run.ts).
// A strategy-only client (no active account in Sprout, sprout/strategyOnly.ts) goes through every step up to its
// strategy. trend_hashtags and calendar_recheck wait until an account is connected, and first_output plans nothing and
// starts no report: it only asks for the voice profile the strategy is written in, as the client's first plan would have.

import { referenceFingerprint } from "../brand-references/candidates.ts";
import { choicesKey, LIBRARY_RULE } from "../brand-references/corpus.ts";
import { brandPosts } from "../brand-references/posts.ts";
import { StyleError } from "../brand-references/errors.ts";
import { liveRefsIO, readChoices, refreshReferences } from "../brand-references/learnStyle.ts";
import { defaultSproutCustomerId } from "../sprout/customer.ts";
import { isStrategyOnly } from "../sprout/strategyOnly.ts";
import { listCustomerGroups, listCustomerProfiles } from "../sprout/profiles.ts";
import { networkKey } from "../sprout/publishRules.ts";
import { listBrandPosts, MAX_POST_PAGES, POSTS_YEAR_DAYS } from "../sprout/posts.ts";
import { searchWebsite, searchWebsiteByName, statedWebsite, webReader } from "../sprout/website.ts";
import { fetchSiteHtml, LOGO_MARKS_RULE, logoFilesOnPage, logoOnPage, normalizeWebsite, openaiKeyFor, ownMarksOnPage, ResearchError, researchBrand, standaloneSvg, type PageMark } from "../brand/research.ts";
import { anthropicKey, briefFromStrategyDoc, derivePillars, isGenericPillars, pageEvidence, PillarsError, type PillarClient, type PillarPost } from "../brand/pillars.ts";
import { fetchSiteText, identifyCompetitors, IdentifyError } from "../competitive/identify.ts";
import { detectCompetitorHandles } from "../competitive/detectHandles.ts";
import { confirmDraftSet } from "../competitive/confirmSet.ts";
import { advanceSetupOnServer, resetTracking, rivalIqApi, SetupError, syncTrackedHandles } from "../competitive/rivaliqSetupRun.ts";
import { LANDSCAPE_MISSING } from "../competitive/landscapeCheck.ts";
import { scrapeMarkdown, searchWeb } from "../net/firecrawl.ts";
import { FollowFailure } from "../competitive/rivaliqFollowFailure.ts";
import { followerMarkets, pageOf, runSocialRead, socialResult, socialVersionKey, topPostsText } from "./socialRead.ts";
import { liveSocialIO } from "./socialIO.ts";
import { linksTo, siteLinkSet } from "./siteLinks.ts";
import { matchProfiles, ONE_PER_NETWORK_RULE, ownPerNetwork, parkedReason, parkingNetwork, platformsOf, profileKeyOf, profileListKey, siteProfileLinks, type OwnRow, type ProfileMatch, type SproutProfile } from "./accounts.ts";
import { libraryPaths, LOGO_READ_RULE, MAX_REFS, personKey, personOther, pickBackground, placementFor, readKeyTail, storedSpotRead, toneKeyTail, type LogoSpot, type Placement } from "./designSettings.ts";
import { referencesFor } from "../design-prompts/designRefs.ts";
import { lifecycleMayWrite, setBy, sourceOf, writeClientFields } from "./fields.ts";
import { parentPageFor, sameSiteClient } from "./parentPage.ts";
import { zoneFromAgency } from "./agencyZone.ts";
import { countryCode, htmlLanguage, regionsFor, replacesLocation, resolveLocation, SOURCE_RANK, zoneCountry } from "./location.ts";
import { normName, slugify, textHash } from "./names.ts";
import { cleanSiteText } from "./siteText.ts";
import { anthropicMessages } from "../anthropic.ts";
import { competitorSet, feedSnapshots, ownPosts, revisedByPerson, workedOn } from "../calendar/runWeek.ts";
import { COPY_RULE } from "../calendar/copyChecks.ts";
import { REPLAN_NOTE, replanWhy } from "../calendar/replan.ts";
import { isStoryPost } from "../design/story.ts";
import { namesInVoice, plainVoice, VOICE_RULE } from "../voice/voice.ts";
import { companyKey } from "../calendar/evidence.ts";
import { activeTerms, askTwice, evidenceKey, hashtagsRequest, monthIn, parseHashtags, parseProfile, profileEvidence, profileRequest, syncLifecycleTerms, writeTrendProfile, type ProfileIO } from "../trends/profile.ts";
import { HASHTAG_PLATFORMS } from "../trends/types.ts";
import { liveStrategyIO, readPending, savePending, saveStrategy, startStrategy, strategyEvidence, strategyPhase, type StrategyIO } from "../strategy/write.ts";
import { advancePublicRead, POLL_MINUTES } from "../strategy/publicRead.ts";
import { desiredProfiles, profileInputs, profilesKey, syncProfiles } from "../strategy/profiles.ts";
import { apifyClient, APIFY_TOKEN_ENV } from "../apify/client.ts";
import { LONG_RETRY_MINUTES, type StepOutcome, type StepPolicy, type StepRow } from "./policy.ts";
import { NotInStorage, PictureError } from "../picture/client.ts";
import type { LogoSetResult, PostLogo } from "../picture/contract.ts";
import { chooseSet, postSearchPlan, TONE_RULE, type SetPaths } from "../design/logoTone.ts";
import { askLogoSet, liveIo, readingOf, readNextPosts, type PictureIo, type Reading } from "../design/logoSetWork.ts";
import { chooseLogo, eitherRead, LOGO_PICK_RULE, measuredPlacement, postsCarrying, type FoundAt } from "../design/logoPick.ts";
import type { LogoFile } from "./imaging.ts";
import { clipText } from "../text/clip.ts";
import { listedNames, NAME_TAGLINE, plainDisplayName, plainNames, storedNames, type ListedName } from "../text/displayName.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
export type ClientRow = Record<string, any>;

/** What a step reads of the client. */
export const CLIENT_COLUMNS = [
  "id", "name", "archived_at", "demo_job_id", "exclude_from_reporting", "sprout_customer_id", "website_url", "field_sources", "location",
  "brand_identity", "logo_url", "timezone", "geo", "language", "brief_text", "brief_file_id", "strategy_doc_file_path", "brand_notes",
  "competitor_seed_notes", "content_pillars", "social_keywords", "primary_platforms", "company_slug", "hub_company_name",
  "design_references", "harvested_design_references", "voice_built_at:social_voice->>built_at", "posting_rhythm",
  // The day a new look began in the client's posts (design_refs): brand_read reads the site again for it.
  "look_since:design_style_synthesis->look_change->>since",
].join(", ");

/** The most other logo files kept from a client's website (brand_read), and so the most the picture service is sent for one logo set. */
export const MAX_SITE_LOGOS = 6;

export interface StepContext {
  force: boolean;
  /** The step's row before this run, when it ran on the same inputs; null otherwise. */
  previous: StepRow | null;
  /** Every step row of the client, as they were when this run started. */
  rows: Map<string, StepRow>;
}

export interface StepDef {
  policy: StepPolicy;
  /** What the step depends on, as one key; null while an input does not exist yet. */
  inputs(db: Db, client: ClientRow, rows: Map<string, StepRow>): Promise<string | null>;
  run(db: Db, client: ClientRow, ctx: StepContext): Promise<StepOutcome>;
}

function env(k: string): string | undefined {
  return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(k);
}

/** Everything a step calls outside the database, so the tests can stand in for it. */
export const deps = {
  now: () => new Date(),
  researchBrand,
  fetchSiteHtml,
  openaiKey: (db: Db) => openaiKeyFor(db),
  anthropicKey: (db: Db) => anthropicKey(db),
  firecrawlKey: () => env("FIRECRAWL_API_KEY") ?? null,
  rivaliqKey: () => env("RIVALIQ_API_KEY") ?? null,
  projectUrl: () => env("SUPABASE_URL") ?? "",
  derivePillars,
  briefFromStrategyDoc,
  scrapeMarkdown,
  fetchSiteText,
  listCustomerProfiles,
  /** The Sprout account's groups, for the names a profile's short name may be known by (text/displayName.ts). */
  listCustomerGroups,
  listBrandPosts,
  searchWebsite,
  siteReader: () => webReader(),
  searchWebsiteByName,
  searchWeb: (query: string) => searchWeb(query),
  socialIO: () => liveSocialIO(),
  identifyCompetitors,
  detectCompetitorHandles,
  confirmDraftSet,
  rivalIqApi,
  advanceSetupOnServer,
  resetTracking,
  syncTrackedHandles,
  refsIO: () => liveRefsIO(),
  imaging: () => import("./imaging.ts"),
  /** The picture service, for a client's logo set (design_settings). */
  picture: (db: Db): PictureIo => liveIo(db),
  claudeMessages: anthropicMessages,
  trendIO: (): ProfileIO => ({
    ownPosts: (db, client, snapshots, now) => ownPosts(db, client, snapshots, now),
    feedSnapshots,
    competitorSet,
    async siteText(url) {
      const scraped = await deps.scrapeMarkdown(url);
      const text = cleanSiteText(scraped?.markdown ?? "");
      return text.length >= 80 ? text : await deps.fetchSiteText(url);
    },
  }),
  strategyIO: (): StrategyIO => liveStrategyIO((url) => deps.trendIO().siteText(url)),
  /** The strategy's 90-day public read (strategy/publicRead.ts): the stored feed, and the app's Apify actors for what it does not cover. */
  strategyPublicRead: (db: Db, client: ClientRow, rows: Map<string, StepRow>) => advancePublicRead(db, { id: client.id, name: client.name },
    { tracking: rows.get("tracking")?.result ?? null, brand_read: rows.get("brand_read")?.result ?? null, accounts: rows.get("accounts")?.result ?? null }, deps.now(), {
      apify: () => (env(APIFY_TOKEN_ENV) ? apifyClient({ token: env(APIFY_TOKEN_ENV) }) : null),
      feedSnapshots: (d, id) => feedSnapshots(d, id),
    }),
};

const DAY = 86_400_000;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const day = (d: Date) => d.toISOString().slice(0, 10);

/** A website as the steps key it: host and path, lowercase, without www or a trailing slash. */
export function siteKey(website: string | null | undefined): string | null {
  const raw = str(website);
  if (!raw) return null;
  try {
    const u = new URL(normalizeWebsite(raw));
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return null;
  }
}

/** A step has produced a result: done, or waiting for data that is not there (a failure that is being retried has not). */
export function produced(rows: Map<string, StepRow>, step: string): boolean {
  const r = rows.get(step);
  return !!r && (r.status === "done" || r.status === "waiting" || !!r.done_at);
}

/** A step has produced something or tried at least once, so the steps after it may go ahead. */
export function settled(rows: Map<string, StepRow>, step: string): boolean {
  const r = rows.get(step);
  if (!r) return false;
  if (r.status === "running") return !!r.done_at || r.attempts > 0;
  return true;
}

/** The client has pillars (not the five generic ones) and keywords, whoever wrote them. */
function hasPillarsAndKeywords(client: ClientRow): boolean {
  return !isGenericPillars(client.content_pillars) && Array.isArray(client.social_keywords) && client.social_keywords.length > 0;
}

/**
 * The LinkedIn page's part of brief_pillars' inputs key. While the client
 * has no pillars and keywords, the page's text is an input, so a page read
 * runs the step again (Kitcaster, 8 Nov: its posts alone gave none). A
 * client with both keeps the part the step last ran on: a page read never
 * runs a complete client again, and the run that completes one sets off no
 * other (no step's inputs move on what it writes).
 */
function briefPageKey(client: ClientRow, rows: Map<string, StepRow>): string {
  if (hasPillarsAndKeywords(client)) return str(rows.get("brief_pillars")?.inputs_key).match(/\|page:[0-9a-f]{8}(?=\||$)/)?.[0] ?? "";
  const page = pageEvidence(pageOf(socialResult(rows)));
  return page ? `|page:${textHash(page)}` : "";
}

/** A client whose own posts are its only evidence: no website, no strategy document, no brief a person wrote. */
export function postsOnly(client: ClientRow): boolean {
  const personBrief = !!str(client.brief_text) && setBy(client.field_sources, "brief_text") !== "lifecycle";
  return !siteKey(client.website_url) && !str(client.strategy_doc_file_path) && !personBrief;
}

/**
 * A competitor set the system chose from the client's posts alone, untouched
 * (the selection it chose, confirmed by nobody) and never tracked, for a
 * client that now has a website: it is identified once more with the site.
 */
// deno-lint-ignore no-explicit-any
async function chosenFromPostsAgain(db: Db, client: ClientRow, rows: Map<string, StepRow>, set: Record<string, any>): Promise<boolean> {
  const before = rows.get("competitors")?.result as Record<string, unknown> | null | undefined;
  if (!siteKey(client.website_url) || before?.chosen_from !== "posts" || before?.set_id !== set.id) return false;
  if (set.status !== "confirmed" || set.confirmed_by || set.rivaliq_landscape_id) return false;
  const [{ data: job }, { data: selected, error }] = await Promise.all([
    db.from("rivaliq_setup_jobs").select("set_id").eq("set_id", set.id).maybeSingle(),
    db.from("competitors").select("name").eq("set_id", set.id).eq("is_selected", true),
  ]);
  if (error) throw new Error(`Could not read the selected competitors: ${error.message}`);
  if (job) return false;
  const chosen = Array.isArray(before.selected) ? (before.selected as string[]).map(String).sort().join("|") : "";
  return chosen === (selected ?? []).map((c: { name: string }) => String(c.name)).sort().join("|");
}

/** The client's current competitor set: the newest confirmed, analyzing, complete or failed one. */
// deno-lint-ignore no-explicit-any
async function currentSet(db: Db, clientId: string): Promise<Record<string, any> | null> {
  const { data, error } = await db.from("competitor_sets").select("id, status, rivaliq_landscape_id, tracking_check, confirmed_at, confirmed_by, created_at")
    .eq("client_id", clientId).in("status", ["confirmed", "analyzing", "complete", "failed"])
    .order("confirmed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the client's competitor set: ${error.message}`);
  return data ?? null;
}

/**
 * The current set's chosen competitors as a strategy names them, for its
 * inputs key: a competitor swapped in or out is a new strategy, the same
 * companies in a new set (or named a little differently) are not.
 */
async function competitorsKey(db: Db, clientId: string): Promise<string> {
  const set = await currentSet(db, clientId);
  if (!set) return "none";
  const { data, error } = await db.from("competitors").select("name").eq("set_id", set.id).eq("is_selected", true);
  if (error) throw new Error(`Could not read the client's competitors: ${error.message}`);
  const names = [...new Set((data ?? []).map((c: { name: unknown }) => companyKey(c.name)).filter(Boolean))].sort();
  return names.length ? names.join(",") : "none";
}

/** This week's Monday and the next, in the client's timezone, and whether this week has a day after today. */
export function weeksFor(timeZone: string | null | undefined, now: Date): { today: string; monday: string; next: string; daysLeft: boolean } {
  let today: string;
  try {
    today = new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    today = day(now);
  }
  const t = Date.parse(`${today}T00:00:00Z`);
  const isoDow = ((new Date(t).getUTCDay() + 6) % 7) + 1;
  const monday = day(new Date(t - (isoDow - 1) * DAY));
  return { today, monday, next: day(new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * DAY)), daysLeft: isoDow < 7 };
}

/** The client's active Sprout profiles, as Sprout lists a profile. */
async function activeProfiles(db: Db, clientId: string): Promise<SproutProfile[]> {
  const { data, error } = await db.from("sprout_profiles").select("sprout_profile_id, profile_name, native_name, network_type, native_link")
    .eq("client_id", clientId).eq("is_active", true);
  if (error) throw new Error(`Could not read the client's social accounts: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: String(r.sprout_profile_id), name: str(r.profile_name), native_name: str(r.native_name), network_type: str(r.network_type), native_link: str(r.native_link), status: "active",
  })).sort((a: SproutProfile, b: SproutProfile) => a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * What the accounts step last stored under the one-account-per-network rule,
 * while it stands: the decorated display names and the time an own account
 * was parked. Null for a row from before the rule, and for one whose result
 * a failed run on new inputs took away (policy.ts keeps a result only for the
 * inputs it was made on). A run that is under way, or a refresh that failed,
 * leaves the result standing.
 */
function accountsFacts(rows: Map<string, StepRow>): { names: ListedName[]; ownDroppedAt: string | null } | null {
  const row = rows.get("accounts");
  const result = row?.result as { display_names?: unknown; own_dropped_at?: unknown } | null | undefined;
  if (!str(row?.inputs_key).includes(`|own:${ONE_PER_NETWORK_RULE}`) || !Array.isArray(result?.display_names)) return null;
  return { names: storedNames(result!.display_names), ownDroppedAt: str(result!.own_dropped_at) || null };
}

/**
 * The display names Sprout's whole account list writes with decoration, each
 * with its plain form (text/displayName.ts). A name is shortened at a tagline
 * only when the short form is known to be the name by an exact fact about
 * that profile: the name of a client it is assigned to, the name of a Sprout
 * group it is in, or the name another profile of the same client or group
 * carries on another network. Other clients' names and the groups' names are
 * read only when a listed name has a tagline that could be cut by them; a
 * read that fails leaves those names whole, never fails the step.
 */
async function listedDisplayNames(db: Db, client: ClientRow, profiles: SproutProfile[], assigned: Map<string, string[]>): Promise<ListedName[]> {
  const withTagline = profiles.filter((p) => String(p.name ?? "").search(NAME_TAGLINE) > 0);
  const ownersOf = (p: SproutProfile) => assigned.get(String(p.id)) ?? [];
  const clientNames = new Map<string, string>([[String(client.id), String(client.name ?? "")]]);
  const others = [...new Set(withTagline.flatMap(ownersOf))].filter((id) => !clientNames.has(id));
  if (others.length) {
    const { data, error } = await db.from("clients").select("id, name").in("id", others);
    if (error) console.warn("[accounts] other clients' names were not read:", error.message);
    for (const c of data ?? []) clientNames.set(String(c.id), String(c.name ?? ""));
  }
  const groupNames = new Map<string, string>();
  if (withTagline.some((p) => (p.groups ?? []).length)) {
    try {
      for (const g of await deps.listCustomerGroups(String(client.sprout_customer_id || defaultSproutCustomerId()))) groupNames.set(String(g.id), String(g.name ?? ""));
    } catch (e) {
      console.warn("[accounts] Sprout's groups were not read:", e instanceof Error ? e.message : String(e));
    }
  }
  const sharesOwner = (a: SproutProfile, b: SproutProfile) =>
    ownersOf(a).some((id) => ownersOf(b).includes(id)) || (a.groups ?? []).map(String).some((g) => (b.groups ?? []).map(String).includes(g));
  return listedNames(profiles.map((p) => ({
    name: p.name,
    known: withTagline.includes(p) ? [
      ...ownersOf(p).map((id) => clientNames.get(id)),
      ...(p.groups ?? []).map((g) => groupNames.get(String(g))),
      ...profiles.filter((q) => q !== p && networkKey(q.network_type) !== networkKey(p.network_type) && sharesOwner(p, q)).map((q) => plainDisplayName(q.name)),
    ] : [],
  })));
}

/** The platforms the client's content strategy marks "not now". */
async function notNowPlatforms(db: Db, clientId: string): Promise<string[]> {
  const { data } = await db.from("content_strategies").select("platforms").eq("client_id", clientId).maybeSingle();
  const list = Array.isArray(data?.platforms) ? data.platforms : [];
  return [...new Set(list.filter((p: { state?: unknown }) => p?.state === "not_now").map((p: { platform?: unknown }) => String(p.platform ?? "")).filter(Boolean))].sort() as string[];
}

/** Steps in the order a new client goes through them. */
// ── design_settings: the settings, and the client's logo set ────────────────

/** A client's design settings row, as the design_settings step reads it. */
interface SettingsRow {
  source: string;
  logo_path: string;
  placement: Placement;
  background: string;
  reference_paths: string[];
  derived?: Record<string, unknown> | null;
  logo_set?: unknown;
}
const SETTINGS_COLUMNS = "source, logo_path, placement, background, reference_paths, derived, logo_set";

/**
 * The step's work on a client's logo set, kept in its result between runs so
 * nothing is asked twice: the logo the work is for, the stored path of each
 * of the website's logo files by its address (null for one that could not be
 * fetched or converted), what the service answered about the files with a
 * signature of what it was asked with, and what each post gave with a
 * signature of what it was searched with. A changed signature asks again.
 */
interface ToneWork {
  of: string;
  hash?: string;
  site: Record<string, string | null>;
  asked?: string;
  facts?: LogoSetResult;
  paths?: SetPaths;
  searched?: string;
  posts: Record<string, PostLogo | null>;
  /** The post whose search the service did not finish within its time, and how far it got: sent with the next read, which starts with that post. */
  reading?: Reading;
  settled?: string;
  unusable?: string;
  ms?: { logo_set?: number; post_logos?: number };
}

function toneWork(result: Record<string, unknown> | null | undefined): ToneWork | null {
  const t = result?.tone as Partial<ToneWork> | null | undefined;
  if (!t || typeof t !== "object" || typeof t.of !== "string") return null;
  return { ...t, of: t.of, site: t.site && typeof t.site === "object" ? t.site : {}, posts: t.posts && typeof t.posts === "object" ? t.posts : {}, reading: readingOf(t.reading) };
}

/** The parts of a lifecycle row's key the read of the logo's spot depends on (designSettings.ts, readInputs). */
function spotInputs(client: ClientRow, refs: StepRow | undefined): string {
  return `refs:${refs?.result?.synthesized_at ?? refs?.done_at}|logo:${client.logo_url}`;
}

function samePlacement(a: Placement | null | undefined, b: Placement): boolean {
  return !!a && a.anchor === b.anchor && a.width === b.width && a.top === b.top && (a.left ?? null) === (b.left ?? null);
}

/** The settings keys of the step's result, as they were before the logo set. */
const SETTINGS_KEYS = ["written", "logo_path", "placement", "placement_from", "background", "background_from", "references"] as const;
function settingsOf(result: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return Object.fromEntries(SETTINGS_KEYS.filter((k) => result && k in result).map((k) => [k, result![k]]));
}

/**
 * The settings of a row the lifecycle writes: the logo file, where the
 * client's posts put it, the background from the brand colors, written
 * through lifecycle_write_design_settings as before. The read of the logo's
 * spot is the one paid model call here, and a stored read that is current
 * for the client's posts and logo is reused (designSettings.ts,
 * storedSpotRead), so the model, and its key, are asked for only when a read
 * is needed. The date the settings were derived on moves only when
 * something in them did.
 *
 * A read that fails (its reply cut off, unreadable or too long in coming,
 * imaging.ts readLogoSpot; or the call itself failing) is never kept as an
 * answer, and the step fails so the lifecycle asks again with its backoff:
 *   a row that exists keeps what it has, nothing is written, and the work
 *     the step's row held is handed back with the failure (CARRIED), so the
 *     retry asks the picture service nothing it already answered;
 *   a client with no row yet gets its row at the default place, with no read
 *     recorded on it, so its designs can start and the next run asks again.
 */
async function writeDesignSettings(db: Db, client: ClientRow, ctx: StepContext, existing: SettingsRow | null): Promise<{ outcome: StepOutcome } | { row: SettingsRow; settings: Record<string, unknown> }> {
  const imaging = await deps.imaging();
  // A logo chosen from the client's posts stands (logoPick.ts): it is written again with its own place, never the website's first logo.
  const standing = standingPick(existing, client);
  const logo: LogoFile | null = standing ? standing.logo : await imaging.logoPng(db, client.id, String(client.logo_url));
  if (!logo) return { outcome: { status: "waiting", reason: "logo_file", result: { logo_url: client.logo_url } } };
  // Where the client's own posts put the logo, read from its posts, not its uploads.
  const posts = referencesFor([], await brandPosts(db, { id: String(client.id), harvested_design_references: client.harvested_design_references }), MAX_REFS, null);
  const inputs = spotInputs(client, ctx.rows.get("design_refs"));
  const kept = storedSpotRead(existing, ctx.rows.get("design_settings") ?? null, inputs);
  let spot: LogoSpot | null = null;
  /** Why the read failed, when it did. */
  let unread: string | null = null;
  if (kept) spot = kept.read;
  else if (posts.length) {
    const key = await deps.anthropicKey(db);
    if (!key) return { outcome: { status: "failed", error: "The AI connection is not configured." } };
    try {
      spot = await imaging.readLogoSpot(db, client.name, posts, key);
    } catch (e) {
      unread = e instanceof Error ? e.message : String(e);
      if (existing) return { outcome: failedRead(unread, ctx) };
    }
  }
  const { placement, from }: { placement: Placement; from: LogoPick["placement_from"] } = standing
    ? { placement: standing.placement, from: standing.placement_from }
    : placementFor(spot, logo.width / Math.max(1, logo.height));
  const b = client.brand_identity ?? {};
  // Held to the logo's weakest whole part, never to the average of its ink (17 Nov 2026).
  const background = pickBackground([b.primary_color, b.secondary_color, b.accent_color], logo.inks?.length ? logo.inks : logo.ink ? [logo.ink] : null, logo.own);
  const paths = libraryPaths(client.design_references, client.harvested_design_references);
  const unchanged = !!kept && existing?.logo_path === logo.path && existing.background === background.hex && samePlacement(existing.placement, placement);
  const at = unchanged && typeof existing?.derived?.at === "string" ? existing.derived.at : deps.now().toISOString();
  // A read that failed is not recorded: the row says nothing of a read, and the next run asks.
  const read = unread === null ? { logo_read: spot, logo_read_for: inputs, logo_read_rule: LOGO_READ_RULE } : {};
  const derived = { logo_from: standing?.from ?? client.logo_url, logo_file: logo.converted, placement_from: from, ...read, background_from: background.from, at, ...(standing ? { logo_pick: standing } : {}) };
  const { data: wrote, error: writeError } = await db.rpc("lifecycle_write_design_settings", {
    p_client: client.id, p_logo_path: logo.path, p_placement: placement, p_background: background.hex, p_reference_paths: paths, p_derived: derived,
  });
  if (writeError) throw new Error(`Could not save the design settings: ${writeError.message}`);
  const settings = { written: wrote === true, logo_path: logo.path, placement, placement_from: from, background: background.hex, background_from: background.from, references: paths.length };
  // A person's row appeared in between: it is theirs, and this run ends as it always did.
  if (wrote !== true) return { outcome: { status: "done", result: settings } };
  // The new client's row is written at the default place. The read is still owed: the step fails, to be run again.
  if (unread !== null) return { outcome: { status: "failed", error: unread } };
  return { row: { source: "lifecycle", logo_path: logo.path, placement, background: background.hex, reference_paths: paths.slice(0, MAX_REFS), logo_set: existing?.logo_set ?? null }, settings };
}

/**
 * Marks a step result as the work its row held before the step's inputs
 * changed, handed back by a run whose read of the logo's place failed.
 */
const CARRIED = "carried_over";

/**
 * The failure of a run whose read of the logo's place failed for a row that
 * exists. The lifecycle keeps a failed step's result only while its inputs
 * are the same (policy.ts), so under changed inputs the work the row held
 * (the logo set's files and what every post gave, the candidates read for
 * the logo) would be thrown away and asked of the picture service again on
 * the retry. It is handed back instead, marked as the older work it is. A
 * run on the same inputs has its own row's result kept as always.
 */
function failedRead(error: string, ctx: StepContext): StepOutcome {
  const held = ctx.previous ? null : ctx.rows.get("design_settings")?.result;
  return { status: "failed", error, ...(held ? { result: { ...held, [CARRIED]: true } } : {}) };
}

/**
 * The client's logo set, made from its stored logo and its own posts with
 * no model call (spec: docs/superpowers/specs/2026-11-16-logo-tone-design.md,
 * section 4). In order, each part kept between runs:
 *   the website's other logo files, converted like the main logo, one to a
 *     run (each decodes an image here);
 *   the files: one logo-set call makes the two recolored copies and tests
 *     the website files;
 *   the posts: post-logos calls, one call to a run. A call asks for the
 *     next posts not yet read (up to POSTS_PER_CALL) and the service reads
 *     as many as its time budget allows: what it finished is kept, and so is
 *     how far it got in the next post, which the next run's call carries on
 *     from. How long a client's logo takes to search for therefore decides
 *     only how many runs the read takes, never whether it ends;
 *   the choice (chooseSet), and its write, which holds only while the logo
 *     and a person's second file are what this run read.
 * While work remains the step waits a minute and is looked at again, so no
 * run holds more than one such call. A service that is unavailable is a
 * quiet wait of ten minutes with everything read so far kept; a call it
 * refuses is a failure with the
 * lifecycle's own backoff; a logo it cannot use ends the step with no set.
 * In every case designs start with the one file, as before, until a set is
 * settled. `settings` are the result keys the step always had.
 */
async function settleLogoSet(db: Db, client: ClientRow, ctx: StepContext, row: SettingsRow, settings: Record<string, unknown>): Promise<StepOutcome> {
  const same = toneWork(ctx.previous?.result);
  const kept = same ?? toneWork(ctx.rows.get("design_settings")?.result);
  const tone: ToneWork = { of: row.logo_path, hash: kept?.hash, site: {}, asked: kept?.asked, facts: kept?.facts, paths: kept?.paths, searched: kept?.searched, posts: { ...(kept?.posts ?? {}) }, ms: kept?.ms };
  // How far the service got in a post is kept like the posts it finished: while they are searched the same way.
  if (kept?.reading) tone.reading = kept.reading;
  const result = () => ({ ...settings, tone });
  const wait = (): StepOutcome => ({ status: "waiting", reason: "in_progress", recheckMinutes: 1, result: result() });

  // The website's other logo files. A file that could not be fetched is tried again when the step's inputs next change, never while they stay the same.
  const listed = ctx.rows.get("brand_read")?.result?.logo_files;
  const addresses: string[] = (Array.isArray(listed) ? listed : []).filter((a): a is string => typeof a === "string" && !!a).slice(0, MAX_SITE_LOGOS);
  for (const a of addresses) {
    const path = kept?.site[a];
    if (typeof path === "string" || (path === null && same)) tone.site[a] = path;
  }
  const unconverted = addresses.filter((a) => !(a in tone.site));
  if (unconverted.length) {
    const imaging = await deps.imaging();
    try {
      tone.site[unconverted[0]] = (await imaging.logoPng(db, client.id, unconverted[0]))?.path ?? null;
    } catch {
      tone.site[unconverted[0]] = null;
    }
    if (unconverted.length > 1) return wait();
  }
  const sitePaths = [...new Set(addresses.map((a) => tone.site[a]).filter((p): p is string => !!p && p !== row.logo_path))];

  const person = personOther(row);
  const refs = (Array.isArray(row.reference_paths) ? row.reference_paths : []).slice(0, MAX_REFS);
  const io = deps.picture(db);
  try {
    // The files.
    const asked = JSON.stringify([row.logo_path, sitePaths, person?.path ?? null, TONE_RULE]);
    if (tone.asked !== asked || !tone.facts || !tone.paths) {
      const hash = await (await deps.imaging()).fileHash(db, row.logo_path);
      const out = { other: `${client.id}/design-settings/logo-${hash}-other.png`, white: `${client.id}/design-settings/logo-${hash}-white.png` };
      const { facts, ms } = await askLogoSet(io, { clientId: client.id, logoPath: row.logo_path, site: sitePaths, person: person?.path ?? null, out });
      tone.hash = hash;
      tone.asked = asked;
      tone.facts = facts;
      tone.paths = {
        other: facts.made.other ? out.other : null,
        white: facts.made.white ? out.white : null,
        site: facts.site ? sitePaths[facts.site.index] ?? null : null,
        person: facts.person ? person?.path ?? null : null,
      };
      tone.ms = { ...(tone.ms ?? {}), logo_set: ms };
    }
    // The posts.
    const plan = postSearchPlan(row.logo_path, tone.facts, tone.paths);
    const searched = JSON.stringify([plan, [row.placement.anchor, row.placement.width, row.placement.top, row.placement.left ?? null], TONE_RULE]);
    if (tone.searched !== searched) {
      tone.searched = searched;
      tone.posts = {};
      delete tone.reading;
    }
    tone.posts = Object.fromEntries(refs.filter((p) => p in tone.posts).map((p) => [p, tone.posts[p]]));
    const unread = refs.filter((p) => !(p in tone.posts));
    if (unread.length) {
      // The next posts not yet read. The service reads as many as its time allows and says how far it got in the one after them (logoSetWork.ts, readNextPosts).
      const looked = await readNextPosts(io, { clientId: client.id, unread, placement: row.placement, plan, reading: tone.reading });
      for (const { post, logo } of looked.read) tone.posts[post] = logo;
      if (looked.reading) tone.reading = looked.reading;
      else delete tone.reading;
      // A read with no post left in storage made no call, and has no time to keep.
      if (looked.ms) tone.ms = { ...(tone.ms ?? {}), post_logos: looked.ms };
      if (unread.length > looked.read.length) return wait();
    } else {
      delete tone.reading;
    }
  } catch (e) {
    if (!(e instanceof PictureError)) throw e;
    // The service could not be reached or did not answer: what was read so far is kept, and the same read is asked again later.
    if (e.why === "unavailable") return { status: "waiting", reason: "picture_service", recheckMinutes: 10, result: result() };
    // The service ran and could not use the stored logo (its pixels cannot be read, or it has no ink): no set, and designs run with the one file.
    if (e.why === "unusable" && e.route === "logo-set") {
      tone.unusable = e.message;
      return { status: "done", result: result() };
    }
    return { status: "failed", error: e.message };
  }

  // The choice, and its write.
  const set = chooseSet({
    of: row.logo_path, source: row.source === "person" ? "person" : "lifecycle", background: row.background,
    facts: tone.facts, paths: tone.paths, posts: refs.map((p) => tone.posts[p] ?? null), at: deps.now().toISOString(),
  });
  const { data: settled, error } = await db.rpc("settle_design_logo_set", {
    p_client: client.id, p_of: row.logo_path, p_person: (row.logo_set as { person?: unknown } | null | undefined)?.person ?? null, p_set: set,
  });
  if (error) throw new Error(`Could not save the logo set: ${error.message}`);
  // The logo or a person's second file changed while the set was being made: theirs wins, and the next look reads the row again.
  if (settled !== true) return wait();
  tone.settled = set.at;
  return { status: "done", result: result() };
}

// ── design_settings: the logo the client's posts show ───────────────────────

/** A candidate as the design path uses it: the whole record the conversion gave (imaging.logoPng), so whatever the settings are chosen from for the website's first logo is there for a chosen one too. */
type PickFile = LogoFile;

/** What was asked about one candidate and what each post gave: the same two calls the client's logo gets for its set. */
interface PickUnit {
  hash?: string;
  asked?: string;
  facts?: LogoSetResult;
  paths?: SetPaths;
  searched?: string;
  posts: Record<string, PostLogo | null>;
  /** The post whose search the service did not finish within its time, and how far it got: sent with this file's next read, which starts with that post. */
  reading?: Reading;
  /** The service ran and could not use this file: it is no candidate. */
  unusable?: string;
}

/**
 * The step's work on the logo the client's posts show, kept in its result
 * between runs so nothing is asked twice: the logo the candidates are
 * compared with, the marks the homepage serves when the step read the page
 * itself, each mark's converted file by its address (null for one that could
 * not be fetched or converted), each file's two calls, how many posts show
 * each, and the choice (null when the client keeps its logo).
 */
interface PickWork {
  rule: number;
  of: string;
  open?: true;
  /** Carried from before the step's inputs changed: its files and what its posts gave are reused, and its list of the page's marks and what it could not fetch are asked for again. */
  before?: true;
  /** The brand's own marks on the homepage, by address. `unread` counts the reads of the page that failed: it is read again, up to SITE_READS times in all. */
  listed?: { site: string; files: string[]; unread?: number };
  files: Record<string, PickFile | null>;
  units: Record<string, PickUnit>;
  candidates?: number;
  /** How many posts count for each file (logoPick.ts, postsCarrying): the logo the client has counts every post it is found on, a candidate the posts it matches best. */
  counts?: Record<string, number>;
  chosen?: string | null;
  /** The found rectangles the row's logo was last placed from, as a short hash, so a place is measured again only when they change. */
  placed?: { of: string; from: string };
  kept?: "person_logo" | "not_own_site";
}

/** How many times in all the step reads a homepage that does not answer, half an hour apart, before the client keeps its logo until its inputs next change. */
const SITE_READS = 3;

/**
 * A choice, as design_brand_settings.derived.logo_pick records it: the
 * website logo it was made against (`for`), where the chosen mark came from
 * and the file it was converted to (the record the conversion gave), its
 * place and where that came from, how many of the posts showed it, and the
 * logo it replaced with its count.
 */
interface LogoPick {
  rule: number;
  for: string;
  from: string;
  logo: PickFile;
  placement: Placement;
  placement_from: "logo_on_posts" | "client_posts" | "default";
  found: number;
  posts: number;
  over: { path: string; found: number };
  at: string;
}

function pickWork(result: Record<string, unknown> | null | undefined): PickWork | null {
  const p = result?.pick as Partial<PickWork> | null | undefined;
  if (!p || typeof p !== "object" || p.rule !== LOGO_PICK_RULE || typeof p.of !== "string") return null;
  return { ...p, rule: p.rule, of: p.of, files: p.files && typeof p.files === "object" ? p.files : {}, units: p.units && typeof p.units === "object" ? p.units : {} };
}

function withoutPick(result: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const { pick: _pick, ...rest } = result ?? {};
  return rest;
}

/**
 * The choice that stands for a row: the lifecycle's own row still names the
 * chosen file, the choice was made by this rule against the website logo the
 * client still has, and the logo is still the lifecycle's to choose. Null
 * otherwise, and the website's first logo is then where the step starts.
 */
function standingPick(row: SettingsRow | null | undefined, client: ClientRow): LogoPick | null {
  const pick = row?.derived?.logo_pick as Partial<LogoPick> | null | undefined;
  if (!row || row.source !== "lifecycle" || !pick || typeof pick !== "object") return null;
  const logo = pick.logo;
  if (pick.rule !== LOGO_PICK_RULE || pick.for !== str(client.logo_url) || !logo || logo.path !== row.logo_path || !lifecycleMayWrite(client.field_sources, "logo_url")) return null;
  const p = pick.placement;
  if (!p || typeof p.width !== "number" || typeof p.top !== "number" || typeof logo.width !== "number" || typeof logo.height !== "number" || typeof pick.from !== "string") return null;
  return pick as LogoPick;
}

/**
 * The addresses of marks a homepage serves (research.ts: logoFilesOnPage,
 * the wide list for a brand's second logo file, or ownMarksOnPage, the
 * marks that can be the client's logo itself), at most six, without `main`
 * and without repeats. An inline SVG is kept in the project's storage so it
 * has an address; `stored` remembers the ones already kept, so two lists of
 * one page store each once. Nothing is fetched.
 */
async function markAddresses(db: Db, clientId: string, marks: PageMark[], main: string, stored: Map<string, string | null> = new Map()): Promise<string[]> {
  const addresses: string[] = [];
  for (const file of marks) {
    if (addresses.length >= MAX_SITE_LOGOS) break;
    let url: string | null = null;
    if ("url" in file) url = file.url;
    else {
      const path = `${clientId}/brand/logo-site-${textHash(file.svg)}.svg`;
      const address = db.storage.from("generated-media").getPublicUrl(path).data.publicUrl;
      if (address === main || addresses.includes(address)) continue;
      if (!stored.has(address)) {
        // Stored as a file of its own (the namespace an inline SVG leaves out), under the name of the text the page has.
        const { error } = await db.storage.from("generated-media").upload(path, new TextEncoder().encode(standaloneSvg(file.svg)), { contentType: "image/svg+xml", upsert: true });
        stored.set(address, error ? null : address);
      }
      url = stored.get(address) ?? null;
    }
    if (url && url !== main && !addresses.includes(url)) addresses.push(url);
  }
  return addresses;
}

/**
 * The logo the client's posts show (spec section 12; the rule is in
 * _shared/design/logoPick.ts). It runs once the logo set is made, for a row
 * the lifecycle wrote and a logo the lifecycle chose, with no model call:
 *   the candidates: the marks the homepage ties to its own brand (research.ts,
 *     ownMarksOnPage: the header's, a link to the home page's, the schema.org
 *     logo; never a logo the footer or the nav merely names, never an inline
 *     SVG the page would color), from the website read's list when this
 *     listing made it, else from one direct read of the homepage (no
 *     scraping service), each converted the way the main logo is, one to a
 *     run. A homepage that does not answer is read again half an hour
 *     later, three times in all;
 *   the test: each candidate gets the two calls the client's logo gets for
 *     its set (logo-set, then post-logos, one call to a run, each worked
 *     to the service's time budget and carried on by the next, as for the
 *     set), searched where the model's stored read says the posts carry
 *     the logo;
 *   the count (postsCarrying): the logo the client has counts every post
 *     it is found on, whatever a candidate scores there; a candidate counts
 *     a post only where it is found, scores higher than the client's logo
 *     (found or not) and is the candidate with the highest score;
 *   the choice (chooseLogo): a logo the posts carry, found on two or more,
 *     is never replaced; one they do not carry gives way to the candidate
 *     they carry on the most posts;
 *   a change: the settings are written again with the chosen file, its
 *     place from the rectangles of the posts that count for it and the
 *     background for its whole parts, and the step looks again in a minute
 *     to make its set.
 * A choice stands (standingPick): the website's first logo is then one of
 * the candidates, every mark gets the same search, the standing logo also
 * counts the posts its set finds it on (read at its measured place), and
 * when the posts are learned again and carry the logo somewhere else its
 * place is measured again, from the posts it matches best. A client whose
 * posts carry no candidate keeps what it has. `base` is the step's result
 * so far: the settings keys and the set's work. `busy` says this run may
 * already have asked the service for the set: it then lists the page's
 * marks and leaves every conversion and every read of posts to the next
 * look, so no run holds two reads of posts.
 */
async function pickLogo(db: Db, client: ClientRow, ctx: StepContext, base: Record<string, unknown>, busy: boolean): Promise<StepOutcome> {
  const { data: row, error } = await db.from("design_brand_settings").select(SETTINGS_COLUMNS).eq("client_id", client.id).maybeSingle();
  if (error) throw new Error(`Could not read the design settings: ${error.message}`);
  if (!row || row.source !== "lifecycle") return { status: "done", result: base };
  const settings = row as SettingsRow;
  // Work from before the step's inputs changed is reused for what it read, never for what it listed or could not fetch.
  const last = pickWork(ctx.previous?.result);
  const same = last && !last.before ? last : null;
  const kept = last ?? pickWork(ctx.rows.get("design_settings")?.result);
  const pick: PickWork = { rule: LOGO_PICK_RULE, of: settings.logo_path, files: {}, units: {} };
  const done = (): StepOutcome => ({ status: "done", result: { ...base, pick } });
  const wait = (): StepOutcome => ({ status: "waiting", reason: "in_progress", recheckMinutes: 1, result: { ...base, pick: { ...pick, open: true } } });

  // A logo a person gave is theirs. A page on another client's site is not the brand's own site.
  if (!lifecycleMayWrite(client.field_sources, "logo_url")) { pick.kept = "person_logo"; return done(); }
  const read = ctx.rows.get("brand_read")?.result;
  const site = siteKey(client.website_url);
  if (site && (read?.parent_page === true || await parentPageFor(db, client))) { pick.kept = "not_own_site"; return done(); }

  // What an earlier look read of the posts is kept through every wait of this one, so no post is read twice for the same file.
  // A file the service could not use is asked about again once the step's inputs have changed.
  for (const [path, unit] of Object.entries(kept?.units ?? {})) {
    pick.units[path] = { ...unit, posts: { ...(unit.posts ?? {}) }, reading: readingOf(unit.reading) };
    if (!pick.units[path].reading) delete pick.units[path].reading;
    if (!same) delete pick.units[path].unusable;
  }
  if (kept?.placed) pick.placed = kept.placed;

  // The brand's own marks on the homepage.
  let listed: string[] = [];
  const earlier = site && same?.listed?.site === site ? same.listed : null;
  if (site && read?.logo_marks === LOGO_MARKS_RULE && Array.isArray(read.logo_own)) listed = read.logo_own.filter((a: unknown): a is string => typeof a === "string" && !!a);
  else if (earlier && !(earlier.unread && earlier.unread < SITE_READS)) {
    pick.listed = earlier;
    listed = earlier.files;
  } else if (site) {
    // The website was read before this listing: one direct read of the homepage, with no scraping service and no model.
    const address = normalizeWebsite(String(client.website_url));
    try {
      const page = await deps.fetchSiteHtml(address, {});
      listed = await markAddresses(db, client.id, ownMarksOnPage(page.html, new URL(address).origin), "");
      pick.listed = { site, files: listed };
    } catch (e) {
      if (!(e instanceof ResearchError)) throw e;
      // A page that did not answer is no page without marks: it is read again in half an hour, SITE_READS times in all.
      // Designs run meanwhile on the logo and the set the client has. After that the client keeps its logo until its inputs next change.
      const unread = (earlier?.unread ?? 0) + 1;
      pick.listed = { site, files: [], unread };
      if (unread < SITE_READS) return { status: "waiting", reason: "website", recheckMinutes: 30, result: { ...base, pick: { ...pick, open: true } } };
    }
  }
  const standing = standingPick(settings, client);
  const main = str(client.logo_url);
  // When a choice stands, the website's first logo is a candidate again, ahead of the page's other marks.
  const addresses = [...new Set([...(standing ? [main] : []), ...listed])].filter((a) => a && a !== (standing ? standing.from : main)).slice(0, MAX_SITE_LOGOS + 1);

  // Each mark as the PNG the design path uses, one conversion to a run. A file that could not be fetched is tried again when the step's inputs next change.
  for (const a of addresses) {
    const file = kept?.files[a];
    if (file || (file === null && same)) pick.files[a] = file;
  }
  const unconverted = addresses.filter((a) => !(a in pick.files));
  if (unconverted.length) {
    if (busy) return wait();
    const imaging = await deps.imaging();
    try {
      const f = await imaging.logoPng(db, client.id, unconverted[0]);
      pick.files[unconverted[0]] = f ?? null;
    } catch {
      pick.files[unconverted[0]] = null;
    }
    if (unconverted.length > 1) return wait();
  }
  const candidates: Array<{ address: string; file: PickFile }> = [];
  for (const a of addresses) {
    const file = pick.files[a];
    if (file && file.path !== settings.logo_path && !candidates.some((c) => c.file.path === file.path)) candidates.push({ address: a, file });
  }
  pick.candidates = candidates.length;
  if (!candidates.length) {
    pick.units = {};
    return done();
  }

  // The test: each file is looked for on the client's posts where the model's stored read says they carry the logo, for the file's own shape.
  const refs = (Array.isArray(settings.reference_paths) ? settings.reference_paths : []).slice(0, MAX_REFS);
  const spot = (settings.derived?.logo_read ?? null) as LogoSpot | null;
  const searchPlace = (width: number, height: number) => placementFor(spot, width / Math.max(1, height)).placement;
  // A standing choice gets the same search as the candidates, so the scores compare like with like. Its count also takes its set's read (below).
  const paths = [...(standing ? [standing.logo.path] : []), ...candidates.map((c) => c.file.path)];
  pick.units = Object.fromEntries(paths.filter((path) => pick.units[path]).map((path) => [path, pick.units[path]]));
  const io = deps.picture(db);
  let called = busy;
  for (const path of paths) {
    const unit = (pick.units[path] ??= { posts: {} });
    if (unit.unusable) continue;
    try {
      const asked = JSON.stringify([path, TONE_RULE]);
      if (unit.asked !== asked || !unit.facts || !unit.paths) {
        if (called) return wait();
        const hash = await (await deps.imaging()).fileHash(db, path);
        const out = { other: `${client.id}/design-settings/logo-${hash}-other.png`, white: `${client.id}/design-settings/logo-${hash}-white.png` };
        const { facts } = await askLogoSet(io, { clientId: client.id, logoPath: path, site: [], person: null, out });
        Object.assign(unit, { hash, asked, facts, paths: { other: facts.made.other ? out.other : null, white: facts.made.white ? out.white : null, site: null, person: null }, searched: undefined, posts: {} });
        delete unit.unusable;
        delete unit.reading;
      }
      const plan = postSearchPlan(path, unit.facts!, unit.paths!);
      const placement = searchPlace(unit.facts!.size.width, unit.facts!.size.height);
      const searched = JSON.stringify([plan, placement, TONE_RULE]);
      if (unit.searched !== searched) {
        unit.searched = searched;
        unit.posts = {};
        delete unit.reading;
      }
      unit.posts = Object.fromEntries(refs.filter((p) => p in unit.posts).map((p) => [p, unit.posts[p]]));
      const unread = refs.filter((p) => !(p in unit.posts));
      if (!unread.length) {
        delete unit.reading;
        continue;
      }
      if (called) return wait();
      // The next posts not yet read for this file, asked as the set's are (logoSetWork.ts, readNextPosts): the service settles as many as its
      // time allows and says how far it got in the one after them. Only a post it settled is kept, so a post it did not reach is never taken for one with no logo.
      const looked = await readNextPosts(io, { clientId: client.id, unread, placement, plan, reading: unit.reading });
      for (const { post, logo } of looked.read) unit.posts[post] = logo;
      if (looked.reading) unit.reading = looked.reading;
      else delete unit.reading;
      called = true;
      if (unread.length > looked.read.length) return wait();
    } catch (e) {
      // A file that is gone from storage is no candidate.
      if (e instanceof NotInStorage) {
        unit.unusable = e.message;
        continue;
      }
      if (!(e instanceof PictureError)) throw e;
      // As for the set: the service could not be reached or did not answer. What was read so far is kept, and the same read is asked again later.
      if (e.why === "unavailable") return { status: "waiting", reason: "picture_service", recheckMinutes: 10, result: { ...base, pick: { ...pick, open: true } } };
      // The service could not use this file (no ink, pixels it cannot read) or turned the call away: it is no candidate.
      // The set is settled already, so a candidate never fails the step.
      unit.unusable = e.message;
      continue;
    }
  }
  // A standing choice the service can no longer read is compared with nothing: the client keeps it.
  if (standing && pick.units[standing.logo.path]?.unusable) return done();

  // The count (logoPick.ts, postsCarrying). The logo the client has counts every post it is found on, whatever a candidate scores there.
  // A candidate counts a post only where it is found, scores higher than the client's logo and is the candidate that matches the post best.
  // So a second file of the same logo takes no post from the logo, and a mark that matches a part of the logo a post really carries gets nothing for that post.
  const tone = toneWork(base);
  const usable = candidates.filter((c) => !pick.units[c.file.path]?.unusable);
  // The logo the client has, post by post: what its set read. A standing choice also has its own search at the model's spot (above),
  // while its set is read at the place measured from its posts, so it counts a post either read finds it on (eitherRead). Its posts
  // are then never fewer than its set shows, and a logo its set finds on its posts is not taken for one the posts do not carry.
  const setPosts = tone && tone.of === settings.logo_path ? tone.posts : undefined;
  const ownPosts = standing ? pick.units[standing.logo.path]?.posts : undefined;
  const carried = postsCarrying([refs.map((p) => eitherRead(ownPosts?.[p], setPosts?.[p])), ...usable.map((c) => refs.map((p) => pick.units[c.file.path]?.posts[p]))]);
  const current = carried.counts[0];
  pick.counts = { [settings.logo_path]: current, ...Object.fromEntries(candidates.map((c) => [c.file.path, 0])), ...Object.fromEntries(usable.map((c, i) => [c.file.path, carried.counts[i + 1]])) };
  // The choice: a logo the posts carry is never replaced; one they do not carry gives way to the candidate they carry (chooseLogo).
  const chosenPath = chooseLogo(current, usable.map((c) => ({ id: c.file.path, found: pick.counts![c.file.path] })));
  pick.chosen = chosenPath;
  const chosen = usable.find((c) => c.file.path === chosenPath);

  /** The place of the mark at `index` of the count, from the rectangles of the posts that match it best (`by`), each as shares of its own post; and a short hash of those rectangles. */
  const imaging = await deps.imaging();
  const rectsOf = (index: number, posts: Record<string, PostLogo | null> | undefined) => refs.flatMap((p, i) => {
    const got = posts?.[p];
    return carried.by[i] === index && got && got.found ? [{ post: p, rect: got.rect }] : [];
  });
  const sigOf = (rects: Array<{ post: string; rect: FoundAt["rect"] }>) => textHash(JSON.stringify(rects.map((r) => [r.post, r.rect.x, r.rect.y, r.rect.width, r.rect.height])));
  const measure = async (rects: Array<{ post: string; rect: FoundAt["rect"] }>): Promise<Placement | null> => {
    const at: FoundAt[] = [];
    for (const r of rects) {
      const frame = await imaging.postSize(db, r.post).catch(() => null);
      if (frame) at.push({ rect: r.rect, frame });
    }
    return measuredPlacement(at);
  };
  const old = settings.derived ?? {};

  if (!chosen) {
    // A choice that stands keeps its logo, and its place follows the posts: when they are learned again and carry it elsewhere,
    // the place is measured again from where it is found now. The file and the place then never part, with nobody doing anything.
    if (!standing) return done();
    const rects = rectsOf(0, pick.units[standing.logo.path]?.posts);
    const from = sigOf(rects);
    if (!rects.length || (pick.placed?.of === settings.logo_path && pick.placed.from === from)) return done();
    const measured = await measure(rects);
    pick.placed = { of: settings.logo_path, from };
    if (!measured || samePlacement(settings.placement, measured)) return done();
    const now = deps.now().toISOString();
    const record: LogoPick = { ...standing, placement: measured, placement_from: "logo_on_posts", found: current, posts: refs.length, at: now };
    const { data: wrote, error: writeError } = await db.rpc("lifecycle_write_design_settings", {
      p_client: client.id, p_logo_path: settings.logo_path, p_placement: measured, p_background: settings.background, p_reference_paths: settings.reference_paths,
      p_derived: { ...old, placement_from: "logo_on_posts", at: now, logo_pick: record },
    });
    if (writeError) throw new Error(`Could not save the design settings: ${writeError.message}`);
    const result: Record<string, unknown> = { ...base, written: wrote === true, placement: measured, placement_from: "logo_on_posts", pick };
    // A person's row appeared in between: it is theirs.
    if (wrote !== true) return { status: "done", result };
    // The set was read at the old place: it is not settled for the new one, and the next look reads the posts there and settles it again.
    if (tone) {
      const { settled: _settled, ...unsettled } = tone;
      result.tone = unsettled;
    }
    return { status: "waiting", reason: "in_progress", recheckMinutes: 1, result };
  }

  // A change. The chosen mark's place comes from the rectangles of the posts that count for it.
  const index = usable.indexOf(chosen) + 1;
  const rects = rectsOf(index, pick.units[chosen.file.path].posts);
  const read0 = placementFor(spot, chosen.file.width / Math.max(1, chosen.file.height));
  const measured = await measure(rects);
  const placement = measured ?? read0.placement;
  const placementFrom: LogoPick["placement_from"] = measured ? "logo_on_posts" : read0.from;
  pick.placed = { of: chosen.file.path, from: sigOf(rects) };
  const b = client.brand_identity ?? {};
  // By the rule every lifecycle row gets (writeDesignSettings): held to the file's weakest whole part. A file recorded without its parts has its one ink.
  const background = pickBackground([b.primary_color, b.secondary_color, b.accent_color], chosen.file.inks?.length ? chosen.file.inks : chosen.file.ink ? [chosen.file.ink] : null, chosen.file.own);
  const now = deps.now().toISOString();
  const record: LogoPick = {
    rule: LOGO_PICK_RULE, for: main, from: chosen.address, logo: chosen.file,
    placement, placement_from: placementFrom, found: pick.counts[chosen.file.path], posts: refs.length, over: { path: settings.logo_path, found: current }, at: now,
  };
  // The read of where the posts carry the logo is about the posts, whichever file is the logo: it stays, with what it was made for.
  const derived = {
    logo_from: chosen.address, logo_file: chosen.file.converted, placement_from: placementFrom, logo_read: old.logo_read ?? null,
    logo_read_for: old.logo_read_for ?? spotInputs(client, ctx.rows.get("design_refs")), ...("logo_read_rule" in old ? { logo_read_rule: old.logo_read_rule } : {}),
    background_from: background.from, at: now, logo_pick: record,
  };
  // The logo that was replaced is a candidate from now on. What its set's work read is the same search, so it is kept as that candidate's work.
  if (!standing && tone && tone.of === settings.logo_path && tone.facts && tone.paths && !tone.paths.site && !tone.paths.person && samePlacement(settings.placement, searchPlace(tone.facts.size.width, tone.facts.size.height))) {
    const paths0: SetPaths = { other: tone.paths.other, white: tone.paths.white, site: null, person: null };
    pick.units[settings.logo_path] = {
      hash: tone.hash, asked: JSON.stringify([settings.logo_path, TONE_RULE]), facts: tone.facts, paths: paths0,
      searched: JSON.stringify([postSearchPlan(settings.logo_path, tone.facts, paths0), searchPlace(tone.facts.size.width, tone.facts.size.height), TONE_RULE]), posts: { ...tone.posts },
    };
  }
  const { data: wrote, error: writeError } = await db.rpc("lifecycle_write_design_settings", {
    p_client: client.id, p_logo_path: chosen.file.path, p_placement: placement, p_background: background.hex, p_reference_paths: settings.reference_paths, p_derived: derived,
  });
  if (writeError) throw new Error(`Could not save the design settings: ${writeError.message}`);
  const result = { ...base, written: wrote === true, logo_path: chosen.file.path, placement, placement_from: placementFrom, background: background.hex, background_from: background.from, pick };
  // A person's row appeared in between: it is theirs.
  if (wrote !== true) return { status: "done", result };
  // The set of the new logo is made by the next look, a minute from now.
  return { status: "waiting", reason: "in_progress", recheckMinutes: 1, result };
}

/** How often tracking is asked again for a selection with a website that refused the visit (the weekly wait of policy.ts LONG_RETRY_MINUTES). */
export const SITE_REFUSED_RECHECK_DAYS = LONG_RETRY_MINUTES / (24 * 60);

export const STEPS: Record<string, StepDef> = {
  // A website for a client that has none and that nobody set (spec:
  // docs/superpowers/specs/2026-11-02-sprout-auto-onboarding-design.md,
  // section 5, and 2026-11-03-onboarding-complete-design.md, section 4): the
  // search the Sprout onboarding job runs (sprout/website.ts) over the posts
  // of the client's assigned profiles in the last 12 months, every page
  // Sprout returns, with the client's Instagram bio links (social_read) as
  // one more post; then, at creation, when the name or profiles change and
  // monthly while there is none, a web search by name that counts only a
  // site linking to one of the client's profiles. Looked at again every 7
  // days as posts arrive. A website the client's LinkedIn page states comes
  // first, as stated (subdomain and path kept) and with no search, unless it
  // is another active client's own site (the same host and path,
  // parentPage.ts sameSiteClient): that is recorded on the result and the
  // search goes on as if none were stated. The website it confirms is brand_read's input; a
  // website the client has, or one a person set, is never replaced.
  website: {
    policy: { recheckDays: 7 },
    async inputs(db, client, rows) {
      if (siteKey(client.website_url) || !lifecycleMayWrite(client.field_sources, "website_url")) return null;
      const ids = (await activeProfiles(db, client.id)).map((p) => p.id);
      const links = ((socialResult(rows)?.instagram?.bio?.links ?? []) as string[]).join(" ");
      const stated = siteKey(statedWebsite(pageOf(socialResult(rows))));
      return ids.length ? `profiles:${ids.join(",")}|name:${normName(client.name)}${links ? `|bio:${textHash(links)}` : ""}${stated ? `|page:${stated}` : ""}` : null;
    },
    async run(db, client, { previous, rows }) {
      if (siteKey(client.website_url) || !lifecycleMayWrite(client.field_sources, "website_url")) return { status: "done", result: { kept: true } };
      // The website the client's LinkedIn page states is the first evidence: it is kept as stated, with no search.
      // Another active client's own site is that client's: recorded, and searched past as if none were stated.
      const stated = statedWebsite(pageOf(socialResult(rows)));
      const owner = stated ? await sameSiteClient(db, client.id, stated) : null;
      const statedOther = owner ? { stated_website: stated, stated_site_of: owner.name } : {};
      if (stated && !owner) {
        const at = deps.now();
        const written = await writeClientFields(db, client.id, { website_url: stated });
        return { status: "done", result: { website: stated, confirmed_by: "profile_website", linked_network: "linkedin_company", found_at: at.toISOString(), written: written.written, kept: written.skipped } };
      }
      const profiles = await activeProfiles(db, client.id);
      if (!profiles.length) return { status: "waiting", reason: "social_accounts" };
      const now = deps.now();
      const posts = await deps.listBrandPosts(profiles.map((p) => p.id), {
        since: new Date(now.getTime() - POSTS_YEAR_DAYS * DAY), until: now, customerId: String(client.sprout_customer_id || defaultSproutCustomerId()), pages: MAX_POST_PAGES,
      });
      const bio = ((socialResult(rows)?.instagram?.bio?.links ?? []) as string[]).filter((l) => typeof l === "string");
      const reader = deps.siteReader();
      const brand = { name: client.name, profiles };
      // 1. The links in the posts; 2. the Instagram bio's links, confirmed the same way.
      const found = await deps.searchWebsite(brand, posts, reader);
      let website = found.website;
      let confirmedBy: string | null = found.confirmed_by;
      let linked = found.site_profiles;
      const tried = [...found.tried];
      if (!website && bio.length) {
        const fromBio = await deps.searchWebsite(brand, [{ text: bio.join(" ") }], reader);
        tried.push(...fromBio.tried);
        if (fromBio.website) {
          website = fromBio.website;
          confirmedBy = `bio_${fromBio.confirmed_by}`;
          linked = fromBio.site_profiles;
        }
      }
      // The web search by name: at creation, when the name or profiles change, and monthly while there is no website.
      const before = previous?.result as Record<string, unknown> | null | undefined;
      const searchedAt = typeof before?.searched_at === "string" ? before.searched_at : null;
      let searched: { searched_at: string; queries: string[]; tried: unknown } | null = null;
      if (!website && (!searchedAt || now.getTime() - Date.parse(searchedAt) >= 30 * DAY)) {
        const byName = await deps.searchWebsiteByName(brand, { search: (q: string) => deps.searchWeb(q) }, reader, { skip: tried.map((t) => t.domain) });
        searched = { searched_at: now.toISOString(), queries: byName.queries, tried: byName.tried };
        if (byName.website) {
          website = byName.website;
          confirmedBy = "search_profile_link";
          linked = byName.site_profiles;
        }
      }
      const search = searched ?? (searchedAt ? { searched_at: searchedAt, queries: before?.queries ?? [], tried: before?.searched ?? [] } : null);
      const looked = { posts: posts.length, months: 12, ...(search ? { searched_at: search.searched_at, queries: search.queries, searched: search.tried } : {}) };
      if (!website) return { status: "waiting", reason: "website", recheckDays: 7, result: { ...looked, most_linked: found.most_linked, tried, ...statedOther } };
      // Which of the client's profiles the site links to, for the setup page's line.
      const keys = siteLinkSet(linked);
      const linkedNetwork = profiles.map((p) => ({ p, k: profileKeyOf(p) })).find((x) => x.k && linksTo(keys, x.k))?.p.network_type ?? null;
      const written = await writeClientFields(db, client.id, { website_url: website });
      return { status: "done", result: { ...looked, website, confirmed_by: confirmedBy, linked_network: linkedNetwork, found_at: now.toISOString(), written: written.written, kept: written.skipped, ...statedOther } };
    },
  },

  // The website: brand identity, logo, where the business is (and so its
  // timezone), its country and its language. Re-read every 180 days and
  // whenever the website changes. The model call is made only when something
  // it reads can still be written. The site's values replace what the social
  // profiles gave where the site ranks higher (location.ts); the posts'
  // languages outrank the site's language tag, and the regions keep the
  // followers' countries (onboarding from social profiles, section 3). A
  // zone the agency gave is labeled by the website's source when the website
  // finds the same zone. A page on another client's site (parentPage.ts) is
  // read for its language only: never that client's brand, logo, place or
  // profile links; becoming one, or ceasing to be one, reads it again.
  brand_read: {
    policy: { refreshDays: 180 },
    async inputs(db, client) {
      const site = siteKey(client.website_url);
      if (!site) return null;
      // A new look in the client's posts (design_refs) reads the site again, so the logo file and colors follow a rebrand.
      const key = str(client.look_since) ? `${site}|look:${str(client.look_since)}` : site;
      return (await parentPageFor(db, client)) ? `${key}|text_only` : key;
    },
    async run(db, client, { rows }) {
      const fs = client.field_sources;
      const may = (f: string) => lifecycleMayWrite(fs, f);
      const website = normalizeWebsite(String(client.website_url));
      const key = siteKey(client.website_url)!;
      // A page on another client's site gives its text and language, nothing about the client's brand, logo or place.
      const textOnly = await parentPageFor(db, client);
      const own = (f: string) => !textOnly && may(f);
      let page: { html: string; via: "direct" | "firecrawl" };
      try {
        page = await deps.fetchSiteHtml(website, { firecrawlKey: deps.firecrawlKey() });
      } catch (e) {
        if (e instanceof ResearchError) return { status: "failed", error: e.message };
        throw e;
      }
      const lang = htmlLanguage(page.html);
      const free = resolveLocation(page.html, { website });
      const exactZone = !!free.source && SOURCE_RANK[free.source] <= SOURCE_RANK.page_text;
      const personZone = !may("timezone") ? zoneCountry(client.timezone) : null;
      const freeCountry = (exactZone ? free.country : null) ?? personZone ?? lang.country;
      const needModel = own("brand_identity") || (own("timezone") && !exactZone) || (own("geo") && !freeCountry) || (may("language") && !lang.language);
      let read = null;
      if (needModel) {
        const openaiKey = await deps.openaiKey(db);
        if (!openaiKey) return { status: "failed", error: "The AI connection for brand research is not configured." };
        try {
          read = await deps.researchBrand({ websiteUrl: website, clientName: client.name, openaiKey, page });
        } catch (e) {
          if (e instanceof ResearchError) return { status: "failed", error: e.message };
          throw e;
        }
      }
      const location = resolveLocation(page.html, { headquarters: read?.headquarters ?? null, website });
      const now = deps.now();
      const fields: Record<string, unknown> = {};
      if (read?.brand_identity && own("brand_identity")) fields.brand_identity = read.brand_identity;
      // The logo the site shows. An inline SVG is kept in the project's storage so it has an address.
      const logo = textOnly ? null : read?.logo ?? logoOnPage(page.html, new URL(website).origin);
      if (own("logo_url") && logo) {
        let url: string | null = null;
        if ("url" in logo) url = logo.url;
        else {
          const path = `${client.id}/brand/logo-site-${textHash(logo.svg)}.svg`;
          const { error } = await db.storage.from("generated-media").upload(path, new TextEncoder().encode(standaloneSvg(logo.svg)), { contentType: "image/svg+xml", upsert: true });
          if (!error) url = db.storage.from("generated-media").getPublicUrl(path).data.publicUrl;
        }
        if (url && url !== str(client.logo_url)) fields.logo_url = url;
      }
      // The other logo files the page shows (a brand's own logo for the ground its main file was not made for),
      // from the page already read: nothing more is fetched and no model is asked. The main logo is left out,
      // at most six are kept, and an inline SVG is stored so it has an address. The design_settings step
      // decides whether any of them is the client's logo (_shared/design/logoTone.ts, sameLogo).
      // Beside them, the marks that can be the client's logo itself (logoPick.ts): only those the page ties to its own brand.
      const mainLogo = str(fields.logo_url) || str(client.logo_url);
      const keptSvgs = new Map<string, string | null>();
      const marks = textOnly ? { files: [], own: [] } : {
        files: await markAddresses(db, client.id, logoFilesOnPage(page.html, new URL(website).origin), mainLogo, keptSvgs),
        own: await markAddresses(db, client.id, ownMarksOnPage(page.html, new URL(website).origin), mainLogo, keptSvgs),
      };
      const stored = client.location && typeof client.location === "object" ? client.location : null;
      const better = !textOnly && replacesLocation(stored, { source: location.source, website: key });
      if (better) {
        fields.location = { ...location, website: key, read_at: now.toISOString() };
        // The same zone is written again when the agency gave it, so it is labeled by its real source.
        if (location.timezone && may("timezone") && (location.timezone !== str(client.timezone) || zoneFromAgency(fs))) fields.timezone = location.timezone;
      }
      const country = textOnly ? null : location.country ?? personZone ?? lang.country ?? countryCode(read?.headquarters?.country);
      const regions = regionsFor(country, (socialResult(rows)?.follower_countries ?? []) as Array<{ country: string; share: number }>);
      if (regions.length && own("geo") && regions.join(",") !== str(client.geo)) fields.geo = regions.join(",");
      const language = lang.language ?? read?.site_language ?? null;
      if (language && may("language") && sourceOf(fs, "language") !== "posts" && language !== str(client.language)) fields.language = language;
      const written = await writeClientFields(db, client.id, fields, "lifecycle", {
        brand_identity: "website", logo_url: "website", language: "website", timezone: location.source ?? "", geo: regions.some((r) => r !== country) ? "followers" : "website",
      });
      return {
        status: "done",
        result: {
          website: key, fetched_via: page.via, model_read: needModel,
          timezone: textOnly ? null : location.timezone, timezone_source: textOnly ? null : location.source, country, language,
          logo: logo ? ("url" in logo ? "file" : "inline_svg") : "none",
          written: written.written, kept: written.skipped,
          logo_files: marks.files,
          logo_own: marks.own,
          // Which listing made the list (research.ts): a list from before a change of the listing is known to be older.
          logo_marks: LOGO_MARKS_RULE,
          // The profiles the homepage links to, for the accounts step; another client's, on a page of its site.
          site_profiles: textOnly ? [] : siteProfileLinks(page.html),
          ...(textOnly ? { parent_page: true } : {}),
        },
      };
    },
  },

  // A brief and the client's content pillars. The reports send only
  // brief_text to the workflow, so a client always gets one: when nobody
  // wrote a brief, it is taken from the strategy document in its own words,
  // else drafted from the website. A brief file id alone is not a brief (the
  // server cannot open a Google Doc), and a brief a person wrote is never
  // replaced. Pillars and keywords are then derived from the evidence; the
  // five generic default pillars count as none. Runs again when the brief,
  // the strategy document or the website changes, or when a person hands a
  // field back. The client's posts from social_read (its top 12 by multiple,
  // labeled, and its 12 newest) are the posts the pillars read, and for a
  // client with no website or document the brief is drafted from them; one
  // with fewer than 5 posts with text waits and looks again weekly. A move
  // of the posts' evidence version runs it again (socialVersionKey). The
  // client's LinkedIn page (social_read) is evidence for the pillars like the
  // website's text, and its about text is the brief when there is no
  // document or site text, before the posts. Keywords are written even when
  // no pillar stands; the step then waits for evidence. A page read runs it
  // again only while the client has no pillars and keywords (briefPageKey).
  brief_pillars: {
    policy: {},
    async inputs(db, client, rows) {
      const site = siteKey(client.website_url);
      // Posts-only by the client's own fields, not the page: a page exists only inside a social result, so the guard
      // below never holds for it, and the social part of the key stays as it was when a page is read.
      const fromPosts = postsOnly(client);
      if (fromPosts && !str(client.brief_text) && !socialResult(rows)) return null;
      if (site && !settled(rows, "brand_read")) return null;
      // A client with Sprout profiles reads its posts first, so the first pillars already stand on them.
      if (!settled(rows, "social_read") && (await activeProfiles(db, client.id)).length) return null;
      const fs = client.field_sources;
      // A brief the lifecycle wrote is not an input (the step wrote it), so writing it never re-runs the step.
      const brief = !str(client.brief_text) || setBy(fs, "brief_text") === "lifecycle" ? "site" : textHash(client.brief_text);
      const own = ["brief_text", "content_pillars", "social_keywords"].map((f) => (lifecycleMayWrite(fs, f) ? "p" : "x")).join("");
      return `brief:${brief}|doc:${str(client.strategy_doc_file_path)}|site:${site ?? ""}|own:${own}${socialVersionKey(rows, fromPosts)}${briefPageKey(client, rows)}`;
    },
    async run(db, client, { rows }) {
      const fs = client.field_sources;
      const may = (f: string) => lifecycleMayWrite(fs, f);
      const personBrief = str(client.brief_text) && setBy(fs, "brief_text") !== "lifecycle" ? String(client.brief_text) : "";
      // Empty, or the lifecycle's own: the lifecycle keeps it filled.
      const wantBrief = may("brief_text") && !personBrief;
      const wantPillars = may("content_pillars") && (isGenericPillars(client.content_pillars) || setBy(fs, "content_pillars") === "lifecycle");
      const keywords = Array.isArray(client.social_keywords) ? client.social_keywords : [];
      const wantKeywords = may("social_keywords") && (keywords.length === 0 || setBy(fs, "social_keywords") === "lifecycle");
      if (!wantBrief && !wantPillars && !wantKeywords) return { status: "done", result: { brief: "kept", pillars: "kept" } };
      const social = socialResult(rows);
      const posts = (Array.isArray(social?.posts) ? social!.posts : []) as PillarPost[];
      const page = pageOf(social);
      // A client whose posts are its only evidence needs 5 organic posts with text (in 90 days, else 12 months).
      // A LinkedIn page with text to read is evidence like the website's text, so its client does not wait for posts.
      if (postsOnly(client) && !pageEvidence(page) && social && !social.enough) {
        return { status: "waiting", reason: "posts", recheckDays: 7, result: { text_posts: Number(social.text_posts) || 0, window_days: social.window_days ?? null } };
      }

      const fields: Record<string, unknown> = {};
      const from: Record<string, string> = {};
      let brief: "from_doc" | "drafted" | "from_page" | "from_posts" | "kept" | "none" = personBrief ? "kept" : "none";
      const docPath = str(client.strategy_doc_file_path) || null;
      let briefDoc: string | null = null;
      // 1. The strategy document's own words. One already copied from this document is not read again.
      if (wantBrief && docPath) {
        const before = rows.get("brief_pillars")?.result as Record<string, unknown> | null | undefined;
        if (before?.brief_doc === docPath && str(client.brief_text)) {
          brief = "from_doc";
          briefDoc = docPath;
        } else {
          try {
            const fromDoc = await deps.briefFromStrategyDoc(db, docPath, await deps.anthropicKey(db));
            if (fromDoc) {
              fields.brief_text = `From the strategy document, read on ${day(deps.now())}:\n\n${fromDoc.text}`;
              from.brief_text = "strategy_doc";
              brief = "from_doc";
              briefDoc = docPath;
            }
          } catch (e) {
            if (e instanceof PillarsError) return { status: "failed", error: e.message };
            throw e;
          }
        }
      }
      // 2. The site's text: the brief when there is no document to take it from, and evidence for the pillars.
      const needSite = !personBrief && brief !== "from_doc" && !!client.website_url;
      let siteText = "";
      if (needSite) {
        const scraped = await deps.scrapeMarkdown(String(client.website_url));
        siteText = cleanSiteText(scraped?.markdown ?? "");
        if (siteText.length < 80) siteText = await deps.fetchSiteText(String(client.website_url));
      }
      if (wantBrief && brief !== "from_doc" && siteText.length >= 80) {
        const body = clipText(siteText, 2500);
        const current = str(client.brief_text);
        if (!current.endsWith(body)) {
          fields.brief_text = `Drafted from the website on ${day(deps.now())}:\n\n${body}`;
          from.brief_text = "website";
        }
        brief = "drafted";
      }
      // 3. The LinkedIn page's about text, when there is no document or site text to take the brief from.
      const about = str(page?.about);
      if (wantBrief && brief === "none" && about.length >= 80) {
        const body = clipText(about, 2500);
        if (!str(client.brief_text).endsWith(body)) {
          fields.brief_text = `Drafted from the LinkedIn page on ${day(deps.now())}:\n\n${body}`;
          from.brief_text = "linkedin_page";
        }
        brief = "from_page";
      }
      // 4. The client's posts, when there is nothing else to take the brief from: the same call as the pillars writes it.
      const briefFromPosts = wantBrief && brief === "none" && posts.length > 0;
      let pillars: "derived" | "kept" | "none" = wantPillars ? "none" : "kept";
      let derivedNames: string[] = [];
      let derivedKeywords = 0;
      let source: string | null = null;
      if (wantPillars || wantKeywords || briefFromPosts) {
        const key = await deps.anthropicKey(db);
        if (!key) return { status: "failed", error: "The AI connection is not configured." };
        // The derivation reads the strategy document and the LinkedIn page itself, so a brief taken from either is not given twice.
        const evidence = { ...client, brief_text: brief === "drafted" ? (fields.brief_text as string | undefined) ?? str(client.brief_text) : personBrief };
        try {
          const d = await deps.derivePillars(db, evidence as PillarClient, key, {
            siteText: brief === "drafted" ? null : siteText || null, language: str(client.language) || null,
            ...(posts.length ? { posts, briefFromPosts, bio: (social?.instagram?.bio?.biography as string | undefined) ?? null } : {}),
            ...(page ? { page } : {}),
          });
          if (briefFromPosts && d.brief) {
            fields.brief_text = `Drafted from the client's posts on ${day(deps.now())}:\n\n${d.brief}`;
            from.brief_text = "posts";
            brief = "from_posts";
          }
          if (wantPillars && d.pillars.length) {
            Object.assign(fields, { content_pillars: d.pillars, pillars_source: d.source, pillars_derived_at: d.derived_at });
            pillars = "derived";
            derivedNames = d.pillars.map((p) => p.name);
          }
          if (wantKeywords && d.keywords.length) {
            fields.social_keywords = d.keywords;
            derivedKeywords = d.keywords.length;
          }
          source = d.source;
        } catch (e) {
          if (!(e instanceof PillarsError)) throw e;
          if (e.code === "no_evidence") {
            await writeClientFields(db, client.id, fields, "lifecycle", from);
            return { status: "waiting", reason: "evidence", recheckDays: 7, result: { brief, brief_doc: briefDoc } };
          }
          // The brief is kept even when the pillars must be tried again.
          await writeClientFields(db, client.id, fields, "lifecycle", from);
          return { status: "failed", error: e.message };
        }
      }
      const written = await writeClientFields(db, client.id, fields, "lifecycle", from);
      const result = { brief, brief_doc: briefDoc, pillars, pillar_names: derivedNames, keywords: derivedKeywords, source, site_chars: siteText.length, posts: posts.length, drafted_at: deps.now().toISOString(), written: written.written, kept: written.skipped };
      // No pillar stood: the brief and keywords are written, and the step looks for evidence again in a week.
      if (wantPillars && pillars === "none") return { status: "waiting", reason: "evidence", recheckDays: 7, result };
      return { status: "done", result };
    },
  },

  // Sprout profiles that belong to the client, by Sprout's own brand name and
  // by the profiles the client's homepage links to (accounts.ts). Looked at
  // every day, so profiles added to Sprout later are picked up within a day.
  // A profile a person removed stays removed. A page on another client's
  // site gives no links: they are that client's profiles. Its result also
  // lists the display names Sprout's account writes with decorations, which
  // the calendar and the voice write plainly (text/displayName.ts).
  //
  // A client has at most one own account per network (accounts.ts
  // ownPerNetwork, copy sources 17 Nov 2026): among the brand accounts the
  // client had when the rule began, the one an exact fact says is the
  // brand's stays and any other on that network is parked. The rule never
  // guesses: with no exact fact nothing is parked and the choice is recorded
  // as open (own_open); a personal LinkedIn profile is never part of it; an
  // archived client is never touched. So that the step itself never makes
  // the choice necessary, it does not assign a profile on a network where
  // the client already has an account, nor two profiles on one network in
  // one run: those are listed (skipped) for a person to add on the setup
  // page. The record of a parked account is on its row
  // (sprout_profiles.parked_at, parked_reason), so a run that fails loses
  // nothing; the result repeats it for the steps that follow: each decision
  // (own) and when an account was last parked (own_dropped_at), both read
  // from the rows on every run. The key ends in the rule's version, and
  // names the networks that hold two active brand accounts while there are
  // any: a second account changes the key, so the step runs at once; after
  // it parks one the key changes back, which costs one more cheap run.
  accounts: {
    policy: { refreshDays: 0.5 },
    async inputs(db, client, rows) {
      const site = siteKey(client.website_url);
      if (site && !settled(rows, "brand_read")) return null;
      const links = (rows.get("brand_read")?.result?.site_profiles as string[] | undefined) ?? [];
      const { data, error } = await db.from("sprout_profile_removals").select("sprout_profile_id").eq("client_id", client.id);
      if (error) throw new Error(`Could not read the client's removed accounts: ${error.message}`);
      const removed = (data ?? []).map((r: { sprout_profile_id: unknown }) => String(r.sprout_profile_id)).sort().join(",");
      const { data: active, error: activeError } = await db.from("sprout_profiles").select("network_type").eq("client_id", client.id).eq("is_active", true);
      if (activeError) throw new Error(`Could not read the client's social accounts: ${activeError.message}`);
      const perNetwork = new Map<string, number>();
      for (const r of active ?? []) { const n = parkingNetwork(str((r as { network_type: unknown }).network_type)); if (n) perNetwork.set(n, (perNetwork.get(n) ?? 0) + 1); }
      const twice = [...perNetwork].filter(([, n]) => n > 1).map(([n]) => n).sort();
      return `name:${normName(client.name)}|site:${site ?? ""}|links:${textHash(links.join(","))}|removed:${textHash(removed)}|own:${ONE_PER_NETWORK_RULE}${twice.length ? `|dup:${twice.join(",")}` : ""}`;
    },
    async run(db, client, { rows }) {
      // An archived client is never looked at (run.ts). The step holds the same line whoever calls it: nothing is read, matched, parked or written.
      if (client.archived_at) return { status: "waiting", reason: "archived" };
      const customer = String(client.sprout_customer_id || defaultSproutCustomerId());
      const profiles = await deps.listCustomerProfiles(customer);
      const textOnly = await parentPageFor(db, client);
      // The homepage's links are read here with a free page fetch, every run, and added to what the brand read stored: the stored list may predate the way a handle's own case is kept, and the brand read itself is a paid read that comes round every 180 days.
      const stored = textOnly ? [] : (rows.get("brand_read")?.result?.site_profiles as string[] | undefined) ?? [];
      let fresh: string[] = [];
      if (!textOnly && client.website_url) {
        try {
          fresh = siteProfileLinks((await deps.fetchSiteHtml(normalizeWebsite(String(client.website_url)), {})).html);
        } catch {
          fresh = [];
        }
      }
      const links = [...new Set([...stored, ...fresh])].sort();
      const { data: assignedRows, error } = await db.from("sprout_profiles").select("client_id, sprout_profile_id, network_type, is_active, profile_name, native_name, assigned_at, parked_at, parked_reason");
      if (error) throw new Error(`Could not read the assigned accounts: ${error.message}`);
      const assigned = new Map<string, string[]>();
      for (const r of assignedRows ?? []) {
        const id = String(r.sprout_profile_id);
        assigned.set(id, [...(assigned.get(id) ?? []), String(r.client_id)]);
      }
      const { data: removedRows, error: removedError } = await db.from("sprout_profile_removals").select("sprout_profile_id").eq("client_id", client.id);
      if (removedError) throw new Error(`Could not read the client's removed accounts: ${removedError.message}`);
      const removed = new Set<string>((removedRows ?? []).map((r: { sprout_profile_id: unknown }) => String(r.sprout_profile_id)));
      const found = matchProfiles({ client: { id: client.id, name: client.name }, profiles, siteLinks: links, assigned, removed });
      // The step never makes a second account on a network: not beside one the client has, and not two at once. Those are a person's to add.
      const has = new Set<string>();
      for (const r of assignedRows ?? []) {
        const n = r.client_id === client.id && r.is_active !== false ? parkingNetwork(str(r.network_type)) : null;
        if (n) has.add(n);
      }
      const perNetwork = new Map<string, number>();
      for (const m of found) { const n = parkingNetwork(m.profile.network_type); if (n) perNetwork.set(n, (perNetwork.get(n) ?? 0) + 1); }
      const matches: ProfileMatch[] = [];
      const skipped: Array<{ id: string; network: string; handle: string; why: string }> = [];
      for (const m of found) {
        const n = parkingNetwork(m.profile.network_type);
        const why = !n ? null : has.has(n) ? "the client already has an account on this network" : (perNetwork.get(n) ?? 0) > 1 ? "two profiles match on this network" : null;
        if (why) skipped.push({ id: String(m.profile.id), network: m.profile.network_type, handle: m.profile.native_name, why });
        else matches.push(m);
      }
      const at = deps.now().toISOString();
      if (matches.length) {
        const insert = matches.map((m) => ({
          client_id: client.id, sprout_profile_id: Number(m.profile.id), profile_name: m.profile.name, native_name: m.profile.native_name,
          network_type: m.profile.network_type, native_link: m.profile.native_link, is_active: true,
        }));
        const { error: insertError } = await db.from("sprout_profiles").upsert(insert, { onConflict: "client_id,sprout_profile_id", ignoreDuplicates: true });
        if (insertError) throw new Error(`Could not assign the matched accounts: ${insertError.message}`);
      }
      // The client's public profiles follow the same links, so a stored handle written without its case is mended here, not by a paid read.
      if (!textOnly) {
        const pi = await profileInputs(db, { id: client.id, name: client.name }, { tracking: rows.get("tracking")?.result ?? null, brand_read: null, accounts: { site_profiles: links } });
        await syncProfiles(db, client.id, pi.rows, desiredProfiles(pi), deps.now());
      }
      // One own account per network: the client's rows as they are now, with what was just matched.
      const ownRows = new Map<string, OwnRow>();
      for (const r of assignedRows ?? []) {
        if (r.client_id !== client.id) continue;
        const id = String(r.sprout_profile_id);
        ownRows.set(id, { id, name: str(r.profile_name), native_name: str(r.native_name), network_type: str(r.network_type), is_active: r.is_active !== false, assigned_at: str(r.assigned_at) || null, parked_at: str(r.parked_at) || null, removed: removed.has(id) });
      }
      for (const m of matches) {
        const id = String(m.profile.id);
        if (!ownRows.has(id)) ownRows.set(id, { id, name: str(m.profile.name), native_name: str(m.profile.native_name), network_type: str(m.profile.network_type), is_active: true, assigned_at: at, parked_at: null });
      }
      const { data: publicRows, error: publicError } = await db.from("client_public_profiles").select("platform, handle, source").eq("client_id", client.id);
      if (publicError) throw new Error(`Could not read the client's public profiles: ${publicError.message}`);
      const own = ownPerNetwork({
        clientName: String(client.name ?? ""), rows: [...ownRows.values()],
        publicProfiles: (publicRows ?? []).map((p: Record<string, unknown>) => ({ platform: str(p.platform), handle: str(p.handle), source: str(p.source) })),
      });
      // Only what changed is written, with the service role, so no removal is recorded: a parked account is not one a person removed.
      // Parked: off, with when and why on the row. Brought back by the rule: on, with the record cleared. An account a person
      // switched back on keeps its record while another account is parked beside it: that record is the person's choice.
      const reasonOf = new Map(own.picks.flatMap((p) => p.dropped.map((id) => [id, parkedReason(p.network, ownRows.get(p.kept)!)] as [string, string])));
      const onlyNow = new Set(own.picks.filter((p) => p.by === "only").map((p) => p.kept));
      const toPark = own.park.filter((id) => ownRows.get(id)?.is_active);
      const toRestore = own.keep.filter((id) => ownRows.get(id) && !ownRows.get(id)!.is_active);
      const toClear = own.keep.filter((id) => ownRows.get(id)?.is_active && ownRows.get(id)!.parked_at && onlyNow.has(id));
      const writes: Array<[string[], Record<string, unknown>, string]> = [
        [toPark, { is_active: false, parked_at: at }, "park"],
        [toRestore, { is_active: true, parked_at: null, parked_reason: null }, "bring back"],
        [toClear, { parked_at: null, parked_reason: null }, "keep"],
      ];
      for (const [ids, patch, what] of writes) {
        for (const id of ids) {
          const { error: ownError } = await db.from("sprout_profiles").update(what === "park" ? { ...patch, parked_reason: reasonOf.get(id) ?? null } : patch).eq("client_id", client.id).eq("sprout_profile_id", Number(id));
          if (ownError) throw new Error(`Could not ${what} one of the client's accounts: ${ownError.message}`);
        }
      }
      const parkedNow = new Set(own.park);
      const mine = [...ownRows.values()].filter((r) => !parkedNow.has(r.id) && (r.is_active || toRestore.includes(r.id))).map((r) => r.network_type);
      // When an account was last parked, of the accounts that are parked now: read from the rows, so it outlives any one run.
      const parkedTimes = [...ownRows.values()].filter((r) => (parkedNow.has(r.id) || (!r.is_active && r.parked_at && !r.removed)) && !toRestore.includes(r.id))
        .map((r) => (toPark.includes(r.id) ? at : r.parked_at ?? "")).filter((t) => t && Number.isFinite(Date.parse(t))).sort((a, b) => Date.parse(a) - Date.parse(b));
      const droppedAt = parkedTimes.length ? parkedTimes[parkedTimes.length - 1] : null;
      const platforms = platformsOf(mine);
      const current = Array.isArray(client.primary_platforms) ? client.primary_platforms : [];
      let written: string[] = [];
      if (platforms.length && lifecycleMayWrite(client.field_sources, "primary_platforms") && platforms.join(",") !== current.join(",")) {
        written = (await writeClientFields(db, client.id, { primary_platforms: platforms })).written;
      }
      return {
        status: "done",
        result: {
          profiles: profiles.length, list: textHash(profileListKey(profiles)),
          matched: matches.map((m) => ({ id: m.profile.id, network: m.profile.network_type, handle: m.profile.native_name, by: m.by })),
          assigned: mine.length, platforms, written, site_profiles: links,
          // The display names Sprout's whole list writes with decorations (stars, emoji, a tagline): written plainly wherever copy is learned or written (text/displayName.ts).
          display_names: await listedDisplayNames(db, client, profiles, new Map([...assigned, ...matches.map((m) => [String(m.profile.id), [String(client.id)]] as [string, string[]])])),
          // Each network that has, or had, two own accounts: which one stays and why; where no exact fact decides and both stay; when an account was last parked.
          own: own.picks, own_open: own.open, own_dropped_at: droppedAt,
          // Profiles that match the client but would be a second account on a network: left for a person to add.
          skipped,
        },
      };
    },
  },

  // The client's Sprout profiles and posts as a source, read weekly (spec:
  // docs/superpowers/specs/2026-11-03-onboarding-complete-design.md;
  // socialRead.ts): logo, brand, location, regions and languages when the
  // evidence moves, and the scored posts the brief, pillars, competitors and
  // design references read. A quiet week is one Sprout read and no write.
  social_read: {
    policy: { refreshDays: 7, recheckDays: 7 },
    async inputs(db, client) {
      const ids = (await activeProfiles(db, client.id)).map((p) => p.id);
      return ids.length ? `profiles:${ids.join(",")}|look:${str(client.look_since)}` : null;
    },
    run: (db, client, { rows }) => runSocialRead(db, client, { rows }, deps.socialIO()),
  },

  // The client's voice profile checked against what a voice is built from, and built again only
  // when something in it can be wrong (copy sources, 17 Nov 2026). Two exact facts decide:
  //   names     the stored voice still holds one of the decorated display names the accounts
  //             step lists for the client (voice.ts namesInVoice);
  //   accounts  one of the client's own accounts was parked after the voice was built, so it
  //             was learned from an account that is no longer read.
  // Otherwise the voice already conforms: the step says so in its result and changes nothing,
  // not the voice and not the date it was built, so no step that keys on the voice runs
  // because of this one (a rebuild sets off the trend profile and the content strategy, by their
  // own keys). A rebuild is one voice_profile job (one model call, calendar/runWeek.ts
  // runVoiceProfile). It cannot chain: there is one rebuild for each set of facts (the rule, the
  // listed names, the time an account was parked), under a job key made of those facts, so a
  // voice that was built again and still holds a listed name is never built a second time for
  // it. That voice is corrected here in code instead: each listed name in its stored text is
  // replaced exactly by its plain form (voice.ts plainVoice), with no model call and without
  // changing the date it was built. Plans and revisions wait for a queued voice job as they
  // always do. The first profile belongs to the first plan (calendar_request_week); the monthly
  // rebuild stays there too. The step waits for an accounts result under the
  // one-account-per-network rule (accountsFacts), so a second account is parked and the names are
  // known before the voice is looked at. It looks again whenever the voice, the names or the
  // parked time change: a look is one or two reads, never a model call.
  voice: {
    policy: {},
    async inputs(_db, client, rows) {
      if (!client.voice_built_at) return null;
      const facts = accountsFacts(rows);
      if (!facts) return null;
      return `rule:${VOICE_RULE}|built:${client.voice_built_at}|own:${facts.ownDroppedAt ?? ""}|names:${textHash(facts.names.map((n) => `${n.name}>${n.plain}`).join("\n"))}`;
    },
    async run(db, client, { rows }) {
      const facts = accountsFacts(rows);
      if (!facts) return { status: "waiting", reason: "accounts" };
      const { data, error } = await db.from("clients").select("social_voice").eq("id", client.id).maybeSingle();
      if (error) throw new Error(`Could not read the client's voice: ${error.message}`);
      const voice = (data?.social_voice ?? null) as { built_at?: unknown } | null;
      const builtAt = str(voice?.built_at);
      if (!voice || !builtAt) return { status: "waiting", reason: "voice" };
      const held = namesInVoice(voice, facts.names).length;
      const parkedSince = !!facts.ownDroppedAt && Date.parse(facts.ownDroppedAt) > Date.parse(builtAt);
      // Nothing in it can be wrong: recorded here, and nothing else is written.
      if (!held && !parkedSince) return { status: "done", result: { conforms: true, rule: VOICE_RULE, built_at: builtAt } };
      const why = [...(held ? ["names"] : []), ...(parkedSince ? ["accounts"] : [])];
      // One rebuild for these facts, whatever voice they are found in: the rule, the listed names and the parked time.
      const key = `voice_profile:${client.id}:rule${VOICE_RULE}:${textHash(`${facts.names.map((n) => `${n.name}>${n.plain}`).join("\n")}|${facts.ownDroppedAt ?? ""}`)}`;
      const { data: asked, error: askedError } = await db.from("scheduled_jobs").select("status").eq("dedupe_key", key).limit(1);
      if (askedError) throw new Error(`Could not read the voice profile's job: ${askedError.message}`);
      const job = (asked ?? [])[0] as { status?: string } | undefined;
      if (!job) {
        const at = deps.now().toISOString();
        const { error: queueError } = await db.from("scheduled_jobs").upsert(
          { kind: "voice_profile", client_id: client.id, dedupe_key: key, priority: 39, available_at: at },
          { onConflict: "dedupe_key", ignoreDuplicates: true });
        if (queueError) return { status: "failed", error: `Could not queue the voice profile: ${queueError.message}` };
        return { status: "done", result: { conforms: false, rule: VOICE_RULE, built_at: builtAt, why, names: held, queued: key, at } };
      }
      // The rebuild for these facts is on its way: the look that follows it (runVoiceProfile) reads the new voice.
      if (!job.status || job.status === "queued" || job.status === "running") return { status: "done", result: { conforms: false, rule: VOICE_RULE, built_at: builtAt, why, names: held, queued: key } };
      // The rebuild for these facts has been made, and the voice still holds a listed name: no second rebuild. The names are
      // written plainly in the stored text, exactly, and the date the voice was built stays, so nothing downstream runs.
      let corrected = 0;
      if (held) {
        const { data: changed, error: fixError } = await db.from("clients").update({ social_voice: plainVoice(voice, facts.names) }).eq("id", client.id).eq("social_voice->>built_at", builtAt).select("id");
        if (fixError) throw new Error(`Could not correct the names in the client's voice: ${fixError.message}`);
        corrected = changed?.length ? held : 0;
      }
      // An account parked since the voice was built, with the one rebuild already made: the monthly rebuild is the next one.
      return { status: "done", result: { conforms: !parkedSince && (!held || corrected > 0), rule: VOICE_RULE, built_at: builtAt, why, names: held, corrected, rebuilt: key } };
    },
  },

  // The company slug the portal scopes client users by, from the client's
  // name with the portal's slug rule, when nobody set one. Looked at every
  // day. A slug another client already holds is left alone; the portal's
  // own sign-in then links the right one by exact name (portal.ts).
  access: {
    policy: { refreshDays: 0.5 },
    async inputs(_db, client) {
      return str(client.name) ? `name:${client.name}` : null;
    },
    async run(db, client) {
      if (str(client.company_slug)) return { status: "done", result: { slug: client.company_slug, set_by: setBy(client.field_sources, "company_slug") ?? "earlier" } };
      if (!lifecycleMayWrite(client.field_sources, "company_slug")) return { status: "done", result: { slug: null, set_by: "person" } };
      const slug = slugify(client.name);
      const { data, error } = await db.from("clients").select("id").eq("company_slug", slug).neq("id", client.id).limit(1);
      if (error) throw new Error(`Could not check the company slug: ${error.message}`);
      if ((data ?? []).length) return { status: "waiting", reason: "slug_taken", recheckDays: 1, result: { slug } };
      const written = await writeClientFields(db, client.id, { company_slug: slug });
      return { status: "done", result: { slug: written.written.includes("company_slug") ? slug : null, set_by: "lifecycle" } };
    },
  },

  // The client's designed posts and the visual style learned from them
  // (spec: docs/superpowers/specs/2026-11-02-design-refs-refresh-design.md).
  // Checked every week, and at once when its accounts change or a person
  // keeps, leaves out or uploads a post. A check is one Sprout read; new posts
  // are reviewed once each; the look is learned again only when the library
  // changed by two posts, a platform reached its minimum, or a person chose
  // (brand-references/learnStyle.ts refreshReferences). done_at is the check;
  // the result's synthesized_at is the last real learning, which
  // design_settings keys on. A client with fewer than 3 designed posts keeps
  // its last references and is checked again in a week. The key ends in the
  // library rule's version (corpus.ts LIBRARY_RULE): when the rule changes,
  // every client's library is rebuilt once, on its next look. A check that
  // needs more than one run keeps how far it got in its result (progress),
  // and the next run, a minute later, goes on from there.
  design_refs: {
    policy: { refreshDays: 7, recheckDays: 7 },
    async inputs(db, client) {
      const { data, error } = await db.from("sprout_profiles").select("sprout_profile_id").eq("client_id", client.id).eq("is_active", true);
      if (error) throw new Error(`Could not read the client's social accounts: ${error.message}`);
      const ids = (data ?? []).map((p: { sprout_profile_id: string }) => String(p.sprout_profile_id));
      if (!ids.length) return null;
      const uploads = Array.isArray(client.design_references) ? client.design_references.filter((p: unknown): p is string => typeof p === "string" && !!p) : [];
      const choices = await readChoices(db, client.id);
      const notNow = await notNowPlatforms(db, client.id);
      return `${referenceFingerprint(ids, String(client.sprout_customer_id || defaultSproutCustomerId()))}|chosen:${choicesKey(choices, uploads)}${notNow.length ? `|not_now:${notNow.join(",")}` : ""}|rule:${LIBRARY_RULE}`;
    },
    async run(db, client, { rows, previous }) {
      try {
        // The social read's scores order each platform's slots; a platform the strategy marks "not now" gets no section.
        const multiples = (socialResult(rows)?.multiples ?? undefined) as Record<string, number> | undefined;
        // A check that did not finish in one run goes on from where it stopped (the result's progress), so a run reads
        // only what is left; a check that failed before says how many times in a row.
        const out = await refreshReferences(db, String(client.id), deps.refsIO(), {
          multiples, notNow: await notNowPlatforms(db, client.id), resume: previous?.result?.progress, failedBefore: previous?.status === "failed" ? previous.attempts : 0,
        });
        if (out.kind === "no_accounts") return { status: "waiting", reason: "social_accounts" };
        if (out.kind === "in_progress") return { status: "waiting", reason: "in_progress", recheckMinutes: 1, result: { reviewed: out.reviewed, left: out.left, progress: out.progress } };
        if (out.kind === "too_few") return { status: "waiting", reason: "designed_posts", recheckDays: 7, result: { designed: out.designed, posts_read: out.posts_read, ...out.detail, progress: null } };
        return { status: "done", result: out.result };
      } catch (e) {
        if (!(e instanceof StyleError)) throw e;
        if (e.code === "no_accounts") return { status: "waiting", reason: "social_accounts" };
        if (e.code === "too_few" || e.code === "no_sources") return { status: "waiting", reason: "designed_posts", recheckDays: 7 };
        if (e.code === "accounts_changed") return { status: "failed", error: e.message, soonMinutes: 5 };
        return { status: "failed", error: e.message };
      }
    },
  },

  // A confirmed competitor set for a client that has none: identify, pick the
  // three closest that have a website (RivalIQ tracks by website, so handles
  // are not needed to pick), look up their profiles, confirm as the system.
  // A client that already has a confirmed, analyzing, complete or failed set
  // is never touched, and drafts made by people are ignored. Two runs: the
  // identification, then the pick and the confirmation a minute later. A
  // client with no website is identified once its pillars are written, from
  // its top posts' text and its followers' countries; that set is identified
  // once more when a website is found, if nobody changed it and it was never
  // tracked (onboarding from social profiles, sections 1 and 4).
  competitors: {
    policy: {},
    async inputs(db, client, rows) {
      const site = siteKey(client.website_url);
      const set = await currentSet(db, client.id);
      if (set) return (await chosenFromPostsAgain(db, client, rows, set)) ? `again:${set.id}|site:${site}` : `existing:${set.id}`;
      if (!settled(rows, "brief_pillars")) return null;
      if (!site && isGenericPillars(client.content_pillars)) return null;
      return `site:${site ?? ""}|notes:${textHash(client.competitor_seed_notes)}`;
    },
    async run(db, client, { previous, rows }) {
      const set = await currentSet(db, client.id);
      const again = !!set && (await chosenFromPostsAgain(db, client, rows, set));
      if (set && !again) return { status: "done", result: { set_id: set.id, status: set.status, source: "existing" } };
      const site = siteKey(client.website_url);
      const social = socialResult(rows);
      const before = rows.get("competitors")?.result as Record<string, unknown> | null | undefined;
      // While the set chosen from posts is identified again, the step keeps saying so.
      const carry = again ? { chosen_from: "posts", set_id: set!.id, selected: before?.selected ?? [] } : {};
      let draftId = (previous?.result?.draft_set_id as string | null | undefined) ?? null;
      if (draftId) {
        const { data: draft } = await db.from("competitor_sets").select("id, status").eq("id", draftId).maybeSingle();
        if (!draft || draft.status !== "draft") draftId = null;
      }
      if (!draftId) {
        const key = await deps.anthropicKey(db);
        if (!key) return { status: "failed", error: "The AI connection is not configured." };
        try {
          // With no website: the top posts' text where the homepage's would be, the followers' countries as markets.
          const markets = site ? [] : followerMarkets(social);
          const made = await deps.identifyCompetitors(db, markets.length ? { ...client, geo: markets.join(",") } : client, key, { generatedBy: null, ...(site ? {} : { postsText: topPostsText(social) }) });
          return { status: "waiting", reason: "in_progress", recheckMinutes: 1, result: { ...carry, draft_set_id: made.set_id, proposed: made.competitors.length } };
        } catch (e) {
          if (e instanceof IdentifyError && e.code === "too_few") return { status: "waiting", reason: "competitors", recheckDays: 30, result: { ...carry, draft_set_id: null } };
          throw e;
        }
      }
      const { data: comps, error } = await db.from("competitors").select("id, client_id, name, website_url, similarity_score, is_selected, selected_rank").eq("set_id", draftId);
      if (error) throw new Error(`Could not read the proposed competitors: ${error.message}`);
      const chosen = (comps ?? []).filter((c: { website_url: string | null }) => str(c.website_url))
        .sort((a: { similarity_score: number | null }, b: { similarity_score: number | null }) => (Number(b.similarity_score) || 0) - (Number(a.similarity_score) || 0)).slice(0, 3);
      if (chosen.length < 3) return { status: "waiting", reason: "competitors", recheckDays: 30, result: { ...carry, draft_set_id: null } };
      for (const c of comps ?? []) {
        const rank = chosen.indexOf(c);
        const want = rank >= 0 ? { is_selected: true, selected_rank: rank + 1 } : { is_selected: false, selected_rank: null };
        if (!!c.is_selected !== want.is_selected || (c.selected_rank ?? null) !== want.selected_rank) {
          const { error: e } = await db.from("competitors").update(want).eq("id", c.id);
          if (e) throw new Error(`Could not select the competitors: ${e.message}`);
        }
      }
      // Their profiles, for the screens; tracking does not need them.
      await Promise.all(chosen.map((c: { id: string; client_id: string; name: string; website_url: string | null }) =>
        deps.detectCompetitorHandles(db, [c]).catch((e: unknown) => console.warn("[lifecycle] profile lookup skipped", c.name, e instanceof Error ? e.message : e))));
      await deps.confirmDraftSet(db, draftId, { confirmedBy: null, notes: site ? "Chosen automatically: the three closest competitors with a website." : "Chosen automatically from the client's posts: the three closest competitors with a website." });
      return { status: "done", result: { set_id: draftId, selected: chosen.map((c: { name: string }) => c.name), proposed: (comps ?? []).length, created: true, chosen_from: site ? "website" : "posts", ...(again ? { replaced: set!.id } : {}) } };
    },
  },

  // RivalIQ tracking for the confirmed set (decision 1), run on the server
  // until it is linked, retried quietly. A landscape that disappears is set
  // up again. Once linked, each tracked company's id and handles come from
  // RivalIQ's own record of it.
  // What Trends tracks for the client (spec: docs/superpowers/specs/2026-10-
  // 28-trends-redesign-design.md, section 1), written from the client's own
  // data once the brief and pillars are settled and, for a client with a
  // website, its competitors. Written again whenever a brand input changes;
  // a client with nothing to read waits instead of getting a thin profile.
  trend_profile: {
    policy: {},
    async inputs(db, client, rows) {
      if (!settled(rows, "brief_pillars")) return null;
      // Competitors are identified for a client with a website, and for one without once its pillars are written.
      if ((siteKey(client.website_url) || !isGenericPillars(client.content_pillars)) && !settled(rows, "competitors")) return null;
      let names: string[] = [];
      try {
        names = (await deps.trendIO().competitorSet(db, client.id)).map((c) => c.name).sort();
      } catch {
        names = [];
      }
      const { data: extra } = await db.from("clients").select("brand_book_text").eq("id", client.id).maybeSingle();
      return `profile:${textHash([
        str(client.brief_text), JSON.stringify(client.content_pillars ?? []), JSON.stringify(client.social_keywords ?? []), str(client.brand_notes),
        str(extra?.brand_book_text), str(client.voice_built_at), siteKey(client.website_url) ?? "", str(client.geo), str(client.language),
        JSON.stringify(client.primary_platforms ?? []), names.join(","),
      ].join("|"))}`;
    },
    async run(db, client) {
      const key = await deps.anthropicKey(db);
      if (!key) return { status: "failed", error: "The AI connection is not configured." };
      const e = await profileEvidence(db, client, deps.now(), deps.trendIO());
      if (!e) return { status: "waiting", reason: "nothing_to_read", recheckDays: 1 };
      const got = await askTwice(deps.claudeMessages, key, profileRequest(e), (text) => parseProfile(text, e));
      if ("error" in got) return { status: "failed", error: `The trend profile could not be written: ${got.error}` };
      await writeTrendProfile(db, client.id, got.value, evidenceKey(e), deps.now());
      return { status: "done", result: { topics: got.value.topics.length, platforms: got.value.platforms.map((p) => p.platform) } };
    },
  },

  // The profile's hashtags, refreshed once a calendar month (Israel time)
  // from the newest best posts, since that is when the performance data has
  // moved. A fresh profile already has this month's hashtags.
  trend_hashtags: {
    policy: {},
    async inputs(db, client, rows) {
      if (rows.get("trend_profile")?.status !== "done") return null;
      const { data: p } = await db.from("trend_profiles").select("written_at").eq("client_id", client.id).maybeSingle();
      if (!p) return null;
      // The hashtags only steer the weekly trends collection, which a strategy-only client does not get.
      if (await isStrategyOnly(db, client.id)) return null;
      return `${monthIn(deps.now())}:${p.written_at}`;
    },
    async run(db, client) {
      const { data: p } = await db.from("trend_profiles").select("audience, fit_rubric, hashtags_at").eq("client_id", client.id).maybeSingle();
      if (!p) return { status: "waiting", reason: "no_profile", recheckDays: 1 };
      const now = deps.now();
      if (p.hashtags_at && monthIn(new Date(p.hashtags_at)) === monthIn(now)) return { status: "done", result: { skipped: "this_month" } };
      const key = await deps.anthropicKey(db);
      if (!key) return { status: "failed", error: "The AI connection is not configured." };
      const e = await profileEvidence(db, client, now, deps.trendIO());
      if (!e) return { status: "waiting", reason: "nothing_to_read", recheckDays: 1 };
      const terms = await activeTerms(db, client.id);
      const body = hashtagsRequest({ audience: String(p.audience), fit_rubric: String(p.fit_rubric), topics: terms.topics, hashtags: terms.hashtags }, e);
      const got = await askTwice(deps.claudeMessages, key, body, (text) => parseHashtags(text, e));
      if ("error" in got) return { status: "failed", error: `The trend hashtags could not be refreshed: ${got.error}` };
      for (const platform of HASHTAG_PLATFORMS) await syncLifecycleTerms(db, client.id, "hashtag", platform, got.value[platform]);
      // Instagram searches by these hashtags, so a coverage rewrite of Instagram made from the old ones goes; other platforms' stay.
      // Merged in the database (trend_hashtags_refreshed), so a "Go back" made meanwhile stays.
      const { error: refreshError } = await db.rpc("trend_hashtags_refreshed", { p_client: client.id, p_at: now.toISOString() });
      if (refreshError) return { status: "failed", error: `The trend hashtags were saved but the refresh was not recorded: ${refreshError.message}` };
      return { status: "done", result: { refreshed: true } };
    },
  },

  // The client's content strategy (spec: docs/superpowers/specs/2026-11-02-
  // content-strategy-tab-design.md), written from what the steps above read,
  // once the trend profile is done and current: a brand change gives one
  // profile write, then one strategy write. Written again when the profile is
  // rewritten, the client's Sprout networks or posting rhythm change, and
  // monthly so it follows the posts. A person's edit is never an input, and
  // the step writes only content_strategies, so people's versions stay.
  // One model call per run (strategy/write.ts): write, check, fix if flagged,
  // check again, each its own run a minute apart, with the draft kept on the
  // client's strategy row. A call that does not get through keeps the draft
  // for the retry; a write that does not pass its checks drops it and is
  // tried again quietly from the start. The last good strategy stays.
  content_strategy: {
    policy: { refreshDays: 30 },
    async inputs(db, client, rows) {
      const profile = rows.get("trend_profile");
      if (profile?.status !== "done") return null;
      if ((await STEPS.trend_profile.inputs(db, client, rows)) !== profile.inputs_key) return null;
      const { data: p } = await db.from("trend_profiles").select("written_at").eq("client_id", client.id).maybeSingle();
      if (!p?.written_at) return null;
      const { data, error } = await db.from("sprout_profiles").select("network_type").eq("client_id", client.id).eq("is_active", true);
      if (error) throw new Error(`Could not read the client's social accounts: ${error.message}`);
      const networks = [...new Set((data ?? []).map((r: { network_type: unknown }) => String(r.network_type ?? "")))].filter(Boolean).sort().join(",");
      // Version 2 (fields, public reads): each client gets one rewrite after release, and another when its public profiles change.
      const profiles = desiredProfiles(await profileInputs(db, { id: client.id, name: client.name }, { tracking: rows.get("tracking")?.result ?? null, brand_read: rows.get("brand_read")?.result ?? null, accounts: rows.get("accounts")?.result ?? null }));
      return `v2|profile:${p.written_at}|networks:${networks}|rhythm:${textHash(JSON.stringify(client.posting_rhythm ?? null))}|public:${profilesKey(profiles)}|set:${await competitorsKey(db, client.id)}${socialVersionKey(rows, postsOnly(client))}`;
    },
    async run(db, client, { rows }) {
      const key = await deps.anthropicKey(db);
      if (!key) return { status: "failed", error: "The AI connection is not configured." };
      const inputsKey = await STEPS.content_strategy.inputs(db, client, rows);
      if (!inputsKey) return { status: "waiting", reason: "trend_profile", recheckDays: 1 };
      // A draft for other inputs is dropped: the write starts over.
      let pending = await readPending(db, client.id);
      if (pending?.inputs_key !== inputsKey) {
        // The 90-day public read first, across runs while the app's Apify actors read what the feed does not cover.
        const read = await deps.strategyPublicRead(db, client, rows);
        if (read.status === "reading") return { status: "waiting", reason: "public_read", recheckMinutes: POLL_MINUTES, result: { reading: read.runs.length } };
        const e = await strategyEvidence(db, client, deps.now(), deps.strategyIO(), read);
        if (!e) return { status: "waiting", reason: "trend_profile", recheckDays: 1 };
        pending = startStrategy(e, inputsKey, deps.now());
      }
      const out = await strategyPhase(deps.claudeMessages, key, pending);
      if (out.kind === "next") {
        await savePending(db, client.id, out.pending, deps.now());
        return { status: "waiting", reason: "in_progress", recheckMinutes: 1, result: { phase: out.pending.phase } };
      }
      if (out.kind === "over") {
        await savePending(db, client.id, null, deps.now());
        return { status: "failed", error: `The content strategy could not be written: ${out.error}` };
      }
      await saveStrategy(db, client.id, out, deps.now());
      const count = (state: string) => out.value.platforms.filter((x) => x.state === state).length;
      return { status: "done", result: { platforms: { posting: count("posting"), new: count("new"), not_now: count("not_now") }, calls: out.usage.calls } };
    },
  },

  // Without a client website RivalIQ cannot follow the client, and with its
  // plan full it cannot follow anyone new (Lital, 3 Nov 2026: 40 of 40,
  // pinned): tracking waits, as a plain fact on the setup page, and starts
  // when a website is found or a place opens. A chosen competitor whose
  // website refuses the visit is the same kind of fact: tracking waits until
  // a different competitor is chosen, and is asked again once a week. A client whose website is a
  // page on another client's site (parentPage.ts) waits for a site of its
  // own: RivalIQ would take that client's company as this one's.
  tracking: {
    policy: {},
    async inputs(db, client, rows) {
      const set = await currentSet(db, client.id);
      if (!set) return null;
      // A set chosen from posts alone is identified again with the new website first, never tracked.
      if (await chosenFromPostsAgain(db, client, rows, set)) return null;
      const { data, error } = await db.from("competitors").select("id, website_url, selected_rank").eq("set_id", set.id).eq("is_selected", true).order("selected_rank");
      if (error) throw new Error(`Could not read the selected competitors: ${error.message}`);
      const selection = textHash((data ?? []).map((c: { id: string; website_url: string | null; selected_rank: number | null }) => `${c.selected_rank}:${c.id}:${c.website_url}`).join("|"));
      const key = `${set.id}|${set.rivaliq_landscape_id ?? "none"}|${set.tracking_check?.code ?? ""}|${selection}|${siteKey(client.website_url) ?? ""}`;
      return (await parentPageFor(db, client)) ? `${key}|text_only` : key;
    },
    async run(db, client, { rows }) {
      const set = await currentSet(db, client.id);
      if (!set) return { status: "waiting", reason: "competitor_set" };
      if (await parentPageFor(db, client)) return { status: "waiting", reason: "own_site", result: { set_id: set.id } };
      // RivalIQ follows companies by their website: nothing is asked of it until the client has one.
      if (!siteKey(client.website_url) && !set.rivaliq_landscape_id) return { status: "waiting", reason: "client_website", result: { set_id: set.id } };
      const key = deps.rivaliqKey();
      if (!key) return { status: "failed", error: "The RivalIQ connection is not configured." };
      const api = deps.rivalIqApi(key);
      let landscape: string | null = str(set.rivaliq_landscape_id) || null;
      const check = set.tracking_check as { code?: string; landscape_id?: string | null; gone?: unknown } | null;
      // The only place a set loses its link. A link is hard to win back (the plan can be full), so it goes only when
      // the selection decision recorded that this very landscape is gone: not in a readable, non-empty list of the
      // account's landscapes (landscapeCheck.ts). A landscape that is there but does not cover the selection
      // (SELECTION_NOT_COVERED), a record from another kind of check, and one about another landscape all keep it.
      if (landscape && check?.code === LANDSCAPE_MISSING && check.gone === true && String(check.landscape_id ?? "") === landscape) {
        await deps.resetTracking(db, set.id, landscape);
        landscape = null;
      }
      if (!landscape) {
        if (set.status === "analyzing") return { status: "waiting", reason: "analysis_running", recheckMinutes: 60 };
        try {
          const out = await deps.advanceSetupOnServer(db, set.id, api, { budgetMs: 90_000 });
          if (out.state === "busy") return { status: "waiting", reason: "in_progress", recheckMinutes: 3 };
          if (out.state === "pending") {
            const age = out.since ? deps.now().getTime() - Date.parse(out.since) : 0;
            return { status: "waiting", reason: "in_progress", recheckMinutes: age < 3_600_000 ? 5 : age < DAY ? 60 : 360, result: { set_id: set.id, phase: out.phase } };
          }
          landscape = out.landscape_id;
        } catch (e) {
          if (e instanceof SetupError && e.code === "selection") return { status: "waiting", reason: "selection", result: { set_id: set.id, detail: e.message } };
          if (e instanceof SetupError && e.code === "busy") return { status: "waiting", reason: "analysis_running", recheckMinutes: 60 };
          if (e instanceof SetupError && e.code === "changed") return { status: "failed", error: e.message, soonMinutes: 5 };
          // RivalIQ has not yet listed one company for every website it follows (rivaliqSetup.ts, verify): it is
          // still settling, so tracking waits, asked again hourly for a day and then every six hours (QA 22 Nov 2026,
          // P39-01: this was a failure, retried weekly, while the screens showed tracking as not started).
          if (e instanceof Error && /check status later/i.test(e.message)) {
            const was = rows.get("tracking")?.result as Record<string, unknown> | null | undefined;
            const since = typeof was?.verify_since === "string" ? was.verify_since : deps.now().toISOString();
            const age = deps.now().getTime() - Date.parse(since);
            return { status: "waiting", reason: "in_progress", recheckMinutes: age < DAY ? 60 : 360, result: { set_id: set.id, phase: "verify", verify_since: since } };
          }
          // The plan is full: tracking waits for a free place, looked at again daily.
          if (e instanceof FollowFailure && e.planFull) return { status: "waiting", reason: "rivaliq_full", recheckDays: 1, result: { set_id: set.id } };
          // A chosen website refused the visit: tracking waits on the selection instead of failing every two hours.
          // A different competitor starts it again at once (the selection is part of this step's inputs), and it is
          // asked again once a week, so a refusal that was only passing does not hold tracking for good. Only when
          // every website that was not followed refused: any other reason is a fault with its usual retry.
          if (e instanceof FollowFailure && e.refused.length && !e.others) {
            return { status: "waiting", reason: "site_refused", recheckDays: SITE_REFUSED_RECHECK_DAYS, result: { set_id: set.id, refused: e.refused } };
          }
          throw e;
        }
      }
      const before = rows.get("tracking")?.result as Record<string, unknown> | null | undefined;
      if (before?.synced_landscape === landscape && before?.set_id === set.id) return { status: "done", result: before };
      const synced = await deps.syncTrackedHandles(db, set.id, landscape!, client.website_url ?? null, api);
      return { status: "done", result: { set_id: set.id, landscape_id: landscape, synced_landscape: landscape, client_company: synced.client, competitors_matched: synced.competitors, handles: synced.handles } };
    },
  },

  // Design settings derived from data once the client's references are
  // learned (decision 2): the logo file, where the client's posts put it, and
  // the background from the brand colors. Confirmed by the system
  // (confirmed_by null). Designs are made only when someone asks: a post's
  // own button or the week's design button (Lital, 2 Nov; the automatic
  // designs are gone). Settings a person confirmed or changed are never
  // replaced: the row keeps its logo, placement, background and date, and
  // only its logo set is made (owner decision 2, 16 Nov 2026).
  //
  // The same step then makes the client's logo set (16 Nov 2026): the logo
  // files for light and dark pictures and what a design starts from, from
  // the stored logo and the client's own posts, with no model call. Its key
  // ends in the website's other logo files, a person's second file and the
  // version of the tone rule, so the set follows each of them and every
  // client gets one with nobody doing anything.
  //
  // Last, the logo itself (17 Nov 2026, pickLogo above): every mark the
  // homepage ties to its own brand is looked for on the client's posts. A
  // logo the posts carry stays; one they do not carry gives way to the mark
  // they do, with its place from where it was found. The key of a row the
  // lifecycle wrote ends in that rule's version.
  //
  // The read of the logo's place (18 Nov 2026): a read that came back cut
  // off or unreadable fails the step, which asks again on the lifecycle's
  // own schedule, and is never kept as an answer. A row that holds such a
  // read from before (a null read, designSettings.ts staleRead) has the
  // read's version at the end of its key, so its step runs once and asks
  // again. Every other row keeps the key it had, and nothing runs for it.
  design_settings: {
    policy: {},
    async inputs(db, client, rows) {
      const refs = rows.get("design_refs");
      const site = rows.get("brand_read")?.result?.logo_files;
      const { data, error } = await db.from("design_brand_settings").select("source, logo_path, placement, logo_set, derived").eq("client_id", client.id).maybeSingle();
      if (error) throw new Error(`Could not read the design settings: ${error.message}`);
      // A row a person set has its logo, its place and its posts already: it waits for nothing (owner decision 2).
      if (data?.source === "person") return personKey(data, String(refs?.result?.synthesized_at ?? refs?.done_at ?? ""), site);
      if (!refs || !refs.done_at) return null;
      if (!str(client.logo_url)) return null;
      if (!libraryPaths(client.design_references, client.harvested_design_references).length) return null;
      const b = client.brand_identity ?? {};
      return `${spotInputs(client, refs)}|colors:${[b.primary_color, b.secondary_color, b.accent_color].join(",")}${toneKeyTail(site, data)}|pick:${LOGO_PICK_RULE}${readKeyTail(data, rows.get("design_settings")?.inputs_key)}`;
    },
    async run(db, client, given) {
      // A run whose read of the logo's place failed handed back the work its row held from before its inputs changed
      // (failedRead). It is still that older work: on these inputs the step has done none of its own, until a run
      // writes the settings and marks the result its own (CARRIED false below). The mark alone decides: a run in
      // between that only waited (for the logo file, say) keeps the result it was given, and clears the row's error.
      const handedBack = given.previous?.result?.[CARRIED] === true;
      const ctx: StepContext = handedBack ? { ...given, previous: null } : given;
      const { data: existing, error } = await db.from("design_brand_settings").select(SETTINGS_COLUMNS).eq("client_id", client.id).maybeSingle();
      if (error) throw new Error(`Could not read the design settings: ${error.message}`);
      // A row a person set: its logo file, placement, background and date are theirs and are never written.
      // The set is made from their file and their posts by the same rule, and stored beside them.
      if (existing?.source === "person") return settleLogoSet(db, client, ctx, existing as SettingsRow, { kept: "person" });
      const prev = ctx.previous?.result;
      const before = toneWork(prev);
      // The work on the logo the client's posts show is carried through every wait, so nothing is asked twice.
      // Work from before the step's inputs changed is marked, so what it listed or could not fetch is asked for again.
      const open = pickWork(prev);
      const older = open ? null : pickWork(ctx.rows.get("design_settings")?.result);
      const carried: PickWork | null = open ?? (older ? { ...older, before: true } : null);
      const carry = carried ? { pick: carried } : {};
      const current = !!existing && !!before && before.of === existing.logo_path;
      const settledBefore = current && !!(before.settled || before.unusable);
      // The set is settled and the candidates are still being read: straight on with them.
      if (settledBefore && open?.open && open.of === existing.logo_path) return pickLogo(db, client, ctx, withoutPick(prev), false);
      let set: StepOutcome;
      // The settings, unless an earlier run on these same inputs wrote them for the logo the row still names.
      if (current) set = await settleLogoSet(db, client, ctx, existing as SettingsRow, { ...settingsOf(prev), ...carry });
      else {
        const made = await writeDesignSettings(db, client, ctx, (existing ?? null) as SettingsRow | null);
        if ("outcome" in made) return made.outcome;
        // The read is made: what was handed back is this run's own work from here on.
        set = await settleLogoSet(db, client, ctx, made.row, { ...made.settings, ...carry, ...(handedBack ? { [CARRIED]: false } : {}) });
      }
      if (set.status !== "done") return set;
      // The set is made. Now the logo itself: is it the mark the client's posts carry (logoPick.ts)?
      // A run that may have made the set's last calls converts and reads no candidate: that starts with the next look.
      return pickLogo(db, client, ctx, withoutPick(set.result), !settledBefore);
    },
  },

  // The first output for a client that has none: this week's remaining days
  // and next week planned, and the first monthly report for the last full
  // month through the scheduled dispatch path (never a second run), once
  // the client has a brief. The voice profile is built before the first plan
  // (calendar_request_week queues it). The competitive report runs on its
  // schedule once tracking has data.
  first_output: {
    policy: {},
    async inputs(db, client, rows) {
      if (client.exclude_from_reporting) return null;
      // The first report goes out with a brief: brief_pillars has run, and when there was no brief it has written one
      // (or found nothing to write one from). A brief_pillars run that failed and is being retried holds this step.
      if (!settled(rows, "brief_pillars") || !settled(rows, "accounts")) return null;
      if (!str(client.brief_text) && !produced(rows, "brief_pillars")) return null;
      const w = weeksFor(client.timezone, deps.now());
      // A strategy-only client gets no plan and no report. What its first plan would also have asked for, the voice profile its
      // strategy is written in, is asked for here instead, once a week as the Monday plan would (run below). The key is its own,
      // so the step runs in full on the look the client's first account sets off.
      if (await isStrategyOnly(db, client.id)) return `strategy_only|week:${w.monday}|voice:${client.voice_built_at ? 1 : 0}`;
      const [{ data: plans, error: pe }, { data: reports, error: re }, { data: schedules, error: se }] = await Promise.all([
        db.from("calendar_plans").select("week_start").eq("client_id", client.id).in("week_start", [w.monday, w.next]),
        db.from("reports").select("id").eq("client_id", client.id).eq("status", "completed").limit(1),
        db.from("report_schedules").select("id").eq("client_id", client.id),
      ]);
      if (pe || re || se) throw new Error(`Could not read the client's plans and reports: ${(pe ?? re ?? se).message}`);
      const weeks = new Set((plans ?? []).map((p: { week_start: string }) => String(p.week_start).slice(0, 10)));
      const cur = !w.daysLeft || weeks.has(w.monday) ? 1 : 0;
      return `week:${w.monday}|plans:${cur}${weeks.has(w.next) ? 1 : 0}|voice:${client.voice_built_at ? 1 : 0}|report:${(reports ?? []).length ? 1 : 0}|schedules:${(schedules ?? []).length}`;
    },
    async run(db, client) {
      // Asked again here, so a client whose last account went between the look and the run gets no plan either.
      if (await isStrategyOnly(db, client.id)) {
        const { data: asked, error: voiceError } = await db.rpc("voice_profile_request", { p_client: client.id });
        if (voiceError) throw new Error(`Could not ask for the client's voice profile: ${voiceError.message}`);
        return { status: "done", result: { strategy_only: true, voice_requested: asked === true } };
      }
      const { data, error } = await db.rpc("lifecycle_first_output", { p_client: client.id });
      if (error) throw new Error(`Could not start the client's first output: ${error.message}`);
      return { status: "done", result: (data ?? {}) as Record<string, unknown> };
    },
  },

  // The upcoming calendar checked against the copy rules whenever they or the voice change (copy
  // sources, 17 Nov 2026): decorated names corrected in place, and one revision asked for each week
  // that holds posts written from an outside post, with time codes, or before the client's accounts
  // changed (calendar/replan.ts). It waits for the voice, and for a voice profile on its way, so a
  // week is written again in the voice that was just built. What it never does: it sets no
  // touched_at and writes no revision for a corrected name, it asks nothing for a post a person
  // worked on or a person's own revision rewrote (the revision keeps those too), and it leaves
  // what Sprout already holds alone. No model call here: each week asked for is one week_revise job.
  calendar_recheck: {
    policy: {},
    async inputs(db, client, rows) {
      if (!client.voice_built_at || !settled(rows, "voice")) return null;
      // The names to correct and the time an account was parked are the accounts step's: without its result there is nothing to check by.
      const facts = accountsFacts(rows);
      if (!facts) return null;
      // A voice profile on its way: wait for it.
      const { data: onItsWay, error } = await db.from("scheduled_jobs").select("id")
        .eq("client_id", client.id).eq("kind", "voice_profile").in("status", ["queued", "running"]).limit(1);
      if (error) throw new Error(`Could not check the voice profile: ${error.message}`);
      if ((onItsWay ?? []).length) return null;
      // A strategy-only client's calendar is closed: nothing in it is corrected or planned again until an account is connected.
      if (await isStrategyOnly(db, client.id)) return null;
      return `rules:${COPY_RULE}|voice:${client.voice_built_at}|own:${facts.ownDroppedAt ?? ""}`;
    },
    async run(db, client, { rows }) {
      const today = weeksFor(client.timezone, deps.now()).today;
      const { names, ownDroppedAt } = accountsFacts(rows) ?? { names: [], ownDroppedAt: null };
      // Ready plans with days to come, and every post still to come.
      const { data: planRows, error: plansError } = await db.from("calendar_plans").select("id, week_start, ready_at, evidence, revisions, pending_revision")
        .eq("client_id", client.id).eq("status", "ready").gte("week_start", day(new Date(Date.parse(`${today}T00:00:00Z`) - 6 * DAY))).order("week_start", { ascending: true });
      if (plansError) throw new Error(`Could not read the planned weeks: ${plansError.message}`);
      const { data: postRows, error: postsError } = await db.from("calendar_posts").select("id, post_key, plan_id, post_date, platform, format, copy, cta, reasons, touched_at, story_of")
        .eq("client_id", client.id).gte("post_date", today).order("post_date", { ascending: true });
      if (postsError) throw new Error(`Could not read the upcoming posts: ${postsError.message}`);
      // deno-lint-ignore no-explicit-any
      const plans = (planRows ?? []) as any[];
      // deno-lint-ignore no-explicit-any
      const posts = (postRows ?? []) as any[];

      // The weeks that hold a post to write again that nobody worked on. Decided on the posts as they are read, before any name is corrected.
      let kept = 0;
      let busy = false;
      // deno-lint-ignore no-explicit-any
      const toAsk: any[] = [];
      for (const plan of plans) {
        const candidates = posts.filter((p) => p.plan_id === plan.id && !isStoryPost(p) && replanWhy(p, plan, { ownDroppedAt }) !== null);
        if (!candidates.length) continue;
        const worked = await workedOn(db, client.id, candidates);
        for (const id of revisedByPerson(plan.revisions)) worked.add(id);
        const open = candidates.filter((p) => !worked.has(p.id));
        kept += candidates.length - open.length;
        if (!open.length) continue;
        // A week being revised right now is looked at again once that revision is done.
        if (plan.pending_revision) busy = true;
        else toAsk.push(plan);
      }

      // Decorated display names written plainly, in every upcoming post whatever its state, and in its design options' captions.
      // Each write holds only while the text is as it was read; one that does not go through changes nothing and is tried at the next check.
      let renamed = 0;
      const warn = (what: string, message: string) => console.warn(`[calendar_recheck] ${what}: ${message}`);
      // deno-lint-ignore no-explicit-any
      const asRead = (q: any, column: string, was: unknown) => (was == null ? q.is(column, null) : q.eq(column, was));
      for (const p of names.length ? posts : []) {
        const copy = typeof p.copy === "string" ? plainNames(p.copy, names) : p.copy;
        const cta = typeof p.cta === "string" ? plainNames(p.cta, names) : p.cta;
        if (copy !== p.copy || cta !== p.cta) {
          const { data: changed, error } = await asRead(db.from("calendar_posts").update({ copy, cta }).eq("id", p.id), "copy", p.copy).select("id");
          if (error) warn("a post's name was not corrected", error.message);
          else if (changed?.length) renamed++;
        }
        const { data: options, error: optionsError } = await db.from("post_iterations").select("id, post_copy, cta").eq("client_id", client.id).eq("calendar_post_key", p.post_key);
        if (optionsError) { warn("a post's design options were not read", optionsError.message); continue; }
        for (const o of options ?? []) {
          const optionCopy = typeof o.post_copy === "string" ? plainNames(o.post_copy, names) : o.post_copy;
          const optionCta = typeof o.cta === "string" ? plainNames(o.cta, names) : o.cta;
          if (optionCopy === o.post_copy && optionCta === o.cta) continue;
          const { data: changed, error } = await asRead(db.from("post_iterations").update({ post_copy: optionCopy, cta: optionCta }).eq("id", o.id), "post_copy", o.post_copy).select("id");
          if (error) warn("a design option's name was not corrected", error.message);
          else if (changed?.length) renamed++;
        }
      }

      // One revision for each of those weeks. A week that got a revision meanwhile is looked at again in ten minutes.
      const asked: string[] = [];
      for (const plan of toAsk) {
        const { error } = await db.rpc("calendar_request_revision", { p_plan: plan.id, p_note: REPLAN_NOTE, p_user: null, p_scope: "replan" });
        if (error) { busy = true; warn(`no revision asked for ${plan.week_start}`, error.message); }
        else asked.push(String(plan.week_start).slice(0, 10));
      }
      const result = { renamed, asked, kept };
      return busy ? { status: "waiting", reason: "in_progress", recheckMinutes: 10, result } : { status: "done", result };
    },
  },
};

export const STEP_NAMES = Object.keys(STEPS);
