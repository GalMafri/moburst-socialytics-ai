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
//   brand_read      the website: brand identity, logo, location and timezone, country, language
//   brief_pillars   a brief from the strategy document or the site when there is none, then pillars and keywords
//   accounts        Sprout profiles matched by Sprout's brand name and by the site's profile links
//   social_read     the client's profiles and posts, weekly: logo, brand, location, regions, languages and scored posts (socialRead.ts)
//   access          the company slug, by the portal's slug rule
//   design_refs     the client's designed posts per platform, checked weekly, and the visual style learned from them
//   competitors     identify, pick the three closest with a website, confirm as the system
//   trend_profile   what Trends tracks: audience, topics, hashtags, exclusions, fit rubric, platforms
//   trend_hashtags  the profile's hashtags refreshed from the newest best posts, once a month
//   content_strategy the client's content strategy, written from all of the above once the profile is current
//   tracking        RivalIQ tracking for the confirmed set (decision 1), then handles from RivalIQ
//   design_settings logo file, placement and background derived from data (decision 2)
//   first_output    this week and next planned, and the first monthly report
// A demo copy (a client the API demo made) runs only the steps its demo job asks for (run.ts).

import { referenceFingerprint } from "../brand-references/candidates.ts";
import { choicesKey } from "../brand-references/corpus.ts";
import { StyleError } from "../brand-references/errors.ts";
import { liveRefsIO, readChoices, refreshReferences } from "../brand-references/learnStyle.ts";
import { defaultSproutCustomerId } from "../sprout/customer.ts";
import { listCustomerProfiles } from "../sprout/profiles.ts";
import { listBrandPosts, MAX_POST_PAGES, POSTS_YEAR_DAYS } from "../sprout/posts.ts";
import { searchWebsite, searchWebsiteByName, statedWebsite, webReader } from "../sprout/website.ts";
import { fetchSiteHtml, logoOnPage, normalizeWebsite, openaiKeyFor, ResearchError, researchBrand } from "../brand/research.ts";
import { anthropicKey, briefFromStrategyDoc, derivePillars, isGenericPillars, PillarsError, type PillarClient, type PillarPost } from "../brand/pillars.ts";
import { fetchSiteText, identifyCompetitors, IdentifyError } from "../competitive/identify.ts";
import { detectCompetitorHandles } from "../competitive/detectHandles.ts";
import { confirmDraftSet } from "../competitive/confirmSet.ts";
import { advanceSetupOnServer, resetTracking, rivalIqApi, SetupError, syncTrackedHandles } from "../competitive/rivaliqSetupRun.ts";
import { LANDSCAPE_MISSING } from "../competitive/landscapeCheck.ts";
import { scrapeMarkdown, searchWeb } from "../net/firecrawl.ts";
import { FollowFailure } from "../competitive/rivaliqFollowFailure.ts";
import { followerMarkets, pageOf, runSocialRead, socialResult, socialVersionKey, topPostsText } from "./socialRead.ts";
import { liveSocialIO } from "./socialIO.ts";
import { matchProfiles, platformsOf, profileKeyOf, profileListKey, siteProfileLinks, type SproutProfile } from "./accounts.ts";
import { libraryPaths, MAX_REFS, pickBackground, placementFor } from "./designSettings.ts";
import { referencesFor } from "../design-prompts/designRefs.ts";
import { lifecycleMayWrite, setBy, sourceOf, writeClientFields } from "./fields.ts";
import { countryCode, htmlLanguage, regionsFor, replacesLocation, resolveLocation, SOURCE_RANK, zoneCountry } from "./location.ts";
import { normName, slugify, textHash } from "./names.ts";
import { cleanSiteText } from "./siteText.ts";
import { anthropicMessages } from "../anthropic.ts";
import { competitorSet, feedSnapshots, ownPosts } from "../calendar/runWeek.ts";
import { companyKey } from "../calendar/evidence.ts";
import { activeTerms, askTwice, evidenceKey, hashtagsRequest, monthIn, parseHashtags, parseProfile, profileEvidence, profileRequest, syncLifecycleTerms, writeTrendProfile, type ProfileIO } from "../trends/profile.ts";
import { HASHTAG_PLATFORMS } from "../trends/types.ts";
import { liveStrategyIO, readPending, savePending, saveStrategy, startStrategy, strategyEvidence, strategyPhase, type StrategyIO } from "../strategy/write.ts";
import { advancePublicRead, POLL_MINUTES } from "../strategy/publicRead.ts";
import { desiredProfiles, profileInputs, profilesKey } from "../strategy/profiles.ts";
import { apifyClient, APIFY_TOKEN_ENV } from "../apify/client.ts";
import type { StepOutcome, StepPolicy, StepRow } from "./policy.ts";
import { clipText } from "../text/clip.ts";

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
    { tracking: rows.get("tracking")?.result ?? null, brand_read: rows.get("brand_read")?.result ?? null }, deps.now(), {
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

/** The platforms the client's content strategy marks "not now". */
async function notNowPlatforms(db: Db, clientId: string): Promise<string[]> {
  const { data } = await db.from("content_strategies").select("platforms").eq("client_id", clientId).maybeSingle();
  const list = Array.isArray(data?.platforms) ? data.platforms : [];
  return [...new Set(list.filter((p: { state?: unknown }) => p?.state === "not_now").map((p: { platform?: unknown }) => String(p.platform ?? "")).filter(Boolean))].sort() as string[];
}

/** Steps in the order a new client goes through them. */
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
  // first, as stated (subdomain and path kept) and with no search. The website it confirms is brand_read's input; a
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
      const stated = statedWebsite(pageOf(socialResult(rows)));
      if (stated) {
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
      if (!website) return { status: "waiting", reason: "website", recheckDays: 7, result: { ...looked, most_linked: found.most_linked, tried } };
      // Which of the client's profiles the site links to, for the setup page's line.
      const keys = new Set(linked);
      const linkedNetwork = profiles.map((p) => ({ p, k: profileKeyOf(p) })).find((x) => x.k && keys.has(x.k))?.p.network_type ?? null;
      const written = await writeClientFields(db, client.id, { website_url: website });
      return { status: "done", result: { ...looked, website, confirmed_by: confirmedBy, linked_network: linkedNetwork, found_at: now.toISOString(), written: written.written, kept: written.skipped } };
    },
  },

  // The website: brand identity, logo, where the business is (and so its
  // timezone), its country and its language. Re-read every 180 days and
  // whenever the website changes. The model call is made only when something
  // it reads can still be written. The site's values replace what the social
  // profiles gave where the site ranks higher (location.ts); the posts'
  // languages outrank the site's language tag, and the regions keep the
  // followers' countries (onboarding from social profiles, section 3).
  brand_read: {
    policy: { refreshDays: 180 },
    async inputs(_db, client) {
      const site = siteKey(client.website_url);
      // A new look in the client's posts (design_refs) reads the site again, so the logo file and colors follow a rebrand.
      return site && str(client.look_since) ? `${site}|look:${str(client.look_since)}` : site;
    },
    async run(db, client, { rows }) {
      const fs = client.field_sources;
      const may = (f: string) => lifecycleMayWrite(fs, f);
      const website = normalizeWebsite(String(client.website_url));
      const key = siteKey(client.website_url)!;
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
      const needModel = may("brand_identity") || (may("timezone") && !exactZone) || (may("geo") && !freeCountry) || (may("language") && !lang.language);
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
      if (read?.brand_identity && may("brand_identity")) fields.brand_identity = read.brand_identity;
      // The logo the site shows. An inline SVG is kept in the project's storage so it has an address.
      const logo = read?.logo ?? logoOnPage(page.html, new URL(website).origin);
      if (may("logo_url") && logo) {
        let url: string | null = null;
        if ("url" in logo) url = logo.url;
        else {
          const path = `${client.id}/brand/logo-site-${textHash(logo.svg)}.svg`;
          const { error } = await db.storage.from("generated-media").upload(path, new TextEncoder().encode(logo.svg), { contentType: "image/svg+xml", upsert: true });
          if (!error) url = db.storage.from("generated-media").getPublicUrl(path).data.publicUrl;
        }
        if (url && url !== str(client.logo_url)) fields.logo_url = url;
      }
      const stored = client.location && typeof client.location === "object" ? client.location : null;
      const better = replacesLocation(stored, { source: location.source, website: key });
      if (better) {
        fields.location = { ...location, website: key, read_at: now.toISOString() };
        if (location.timezone && may("timezone") && location.timezone !== str(client.timezone)) fields.timezone = location.timezone;
      }
      const country = location.country ?? personZone ?? lang.country ?? countryCode(read?.headquarters?.country);
      const regions = regionsFor(country, (socialResult(rows)?.follower_countries ?? []) as Array<{ country: string; share: number }>);
      if (regions.length && may("geo") && regions.join(",") !== str(client.geo)) fields.geo = regions.join(",");
      const language = lang.language ?? read?.site_language ?? null;
      if (language && may("language") && sourceOf(fs, "language") !== "posts" && language !== str(client.language)) fields.language = language;
      const written = await writeClientFields(db, client.id, fields, "lifecycle", {
        brand_identity: "website", logo_url: "website", language: "website", timezone: location.source ?? "", geo: regions.some((r) => r !== country) ? "followers" : "website",
      });
      return {
        status: "done",
        result: {
          website: key, fetched_via: page.via, model_read: needModel,
          timezone: location.timezone, timezone_source: location.source, country, language,
          logo: logo ? ("url" in logo ? "file" : "inline_svg") : "none",
          written: written.written, kept: written.skipped,
          // The profiles the homepage links to, for the accounts step.
          site_profiles: siteProfileLinks(page.html),
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
  // of the posts' evidence version runs it again (socialVersionKey).
  brief_pillars: {
    policy: {},
    async inputs(db, client, rows) {
      const site = siteKey(client.website_url);
      const fromPosts = postsOnly(client);
      if (fromPosts && !str(client.brief_text) && !socialResult(rows)) return null;
      if (site && !settled(rows, "brand_read")) return null;
      // A client with Sprout profiles reads its posts first, so the first pillars already stand on them.
      if (!settled(rows, "social_read") && (await activeProfiles(db, client.id)).length) return null;
      const fs = client.field_sources;
      // A brief the lifecycle wrote is not an input (the step wrote it), so writing it never re-runs the step.
      const brief = !str(client.brief_text) || setBy(fs, "brief_text") === "lifecycle" ? "site" : textHash(client.brief_text);
      const own = ["brief_text", "content_pillars", "social_keywords"].map((f) => (lifecycleMayWrite(fs, f) ? "p" : "x")).join("");
      return `brief:${brief}|doc:${str(client.strategy_doc_file_path)}|site:${site ?? ""}|own:${own}${socialVersionKey(rows, fromPosts)}`;
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
      // A client whose posts are its only evidence needs 5 organic posts with text (in 90 days, else 12 months).
      if (postsOnly(client) && social && !social.enough) {
        return { status: "waiting", reason: "posts", recheckDays: 7, result: { text_posts: Number(social.text_posts) || 0, window_days: social.window_days ?? null } };
      }

      const fields: Record<string, unknown> = {};
      const from: Record<string, string> = {};
      let brief: "from_doc" | "drafted" | "from_posts" | "kept" | "none" = personBrief ? "kept" : "none";
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
      // 3. The client's posts, when there is no document or website to take the brief from: the same call as the pillars writes it.
      const briefFromPosts = wantBrief && brief === "none" && posts.length > 0;
      let pillars: "derived" | "kept" | "none" = wantPillars ? "none" : "kept";
      let derivedNames: string[] = [];
      let derivedKeywords = 0;
      let source: string | null = null;
      if (wantPillars || wantKeywords || briefFromPosts) {
        const key = await deps.anthropicKey(db);
        if (!key) return { status: "failed", error: "The AI connection is not configured." };
        // The derivation reads the strategy document itself, so a brief copied from it is not given twice.
        const evidence = { ...client, brief_text: brief === "drafted" ? (fields.brief_text as string | undefined) ?? str(client.brief_text) : personBrief };
        try {
          const d = await deps.derivePillars(db, evidence as PillarClient, key, {
            siteText: brief === "drafted" ? null : siteText || null, language: str(client.language) || null,
            ...(posts.length ? { posts, briefFromPosts, bio: (social?.instagram?.bio?.biography as string | undefined) ?? null } : {}),
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
      return { status: "done", result: { brief, brief_doc: briefDoc, pillars, pillar_names: derivedNames, keywords: derivedKeywords, source, site_chars: siteText.length, posts: posts.length, drafted_at: deps.now().toISOString(), written: written.written, kept: written.skipped } };
    },
  },

  // Sprout profiles that belong to the client, by Sprout's own brand name and
  // by the profiles the client's homepage links to (accounts.ts). Looked at
  // every day, so profiles added to Sprout later are picked up within a day.
  // A profile a person removed stays removed.
  accounts: {
    policy: { refreshDays: 0.5 },
    async inputs(db, client, rows) {
      const site = siteKey(client.website_url);
      if (site && !settled(rows, "brand_read")) return null;
      const links = (rows.get("brand_read")?.result?.site_profiles as string[] | undefined) ?? [];
      const { data, error } = await db.from("sprout_profile_removals").select("sprout_profile_id").eq("client_id", client.id);
      if (error) throw new Error(`Could not read the client's removed accounts: ${error.message}`);
      const removed = (data ?? []).map((r: { sprout_profile_id: unknown }) => String(r.sprout_profile_id)).sort().join(",");
      return `name:${normName(client.name)}|site:${site ?? ""}|links:${textHash(links.join(","))}|removed:${textHash(removed)}`;
    },
    async run(db, client, { rows }) {
      const customer = String(client.sprout_customer_id || defaultSproutCustomerId());
      const profiles = await deps.listCustomerProfiles(customer);
      let links = (rows.get("brand_read")?.result?.site_profiles as string[] | undefined) ?? null;
      if (!links && client.website_url) {
        try {
          links = siteProfileLinks((await deps.fetchSiteHtml(normalizeWebsite(String(client.website_url)), {})).html);
        } catch {
          links = [];
        }
      }
      const { data: assignedRows, error } = await db.from("sprout_profiles").select("client_id, sprout_profile_id, network_type, is_active");
      if (error) throw new Error(`Could not read the assigned accounts: ${error.message}`);
      const assigned = new Map<string, string[]>();
      for (const r of assignedRows ?? []) {
        const id = String(r.sprout_profile_id);
        assigned.set(id, [...(assigned.get(id) ?? []), String(r.client_id)]);
      }
      const { data: removedRows, error: removedError } = await db.from("sprout_profile_removals").select("sprout_profile_id").eq("client_id", client.id);
      if (removedError) throw new Error(`Could not read the client's removed accounts: ${removedError.message}`);
      const removed = new Set<string>((removedRows ?? []).map((r: { sprout_profile_id: unknown }) => String(r.sprout_profile_id)));
      const matches = matchProfiles({ client: { id: client.id, name: client.name }, profiles, siteLinks: links ?? [], assigned, removed });
      if (matches.length) {
        const insert = matches.map((m) => ({
          client_id: client.id, sprout_profile_id: Number(m.profile.id), profile_name: m.profile.name, native_name: m.profile.native_name,
          network_type: m.profile.network_type, native_link: m.profile.native_link, is_active: true,
        }));
        const { error: insertError } = await db.from("sprout_profiles").upsert(insert, { onConflict: "client_id,sprout_profile_id", ignoreDuplicates: true });
        if (insertError) throw new Error(`Could not assign the matched accounts: ${insertError.message}`);
      }
      const mine = [...(assignedRows ?? []).filter((r: { client_id: string; is_active: boolean | null }) => r.client_id === client.id && r.is_active !== false).map((r: { network_type: string }) => r.network_type),
        ...matches.map((m) => m.profile.network_type)];
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
          assigned: mine.length, platforms, written,
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
  // its last references and is checked again in a week.
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
      return `${referenceFingerprint(ids, String(client.sprout_customer_id || defaultSproutCustomerId()))}|chosen:${choicesKey(choices, uploads)}${notNow.length ? `|not_now:${notNow.join(",")}` : ""}`;
    },
    async run(db, client, { rows }) {
      try {
        // The social read's scores order each platform's slots; a platform the strategy marks "not now" gets no section.
        const multiples = (socialResult(rows)?.multiples ?? undefined) as Record<string, number> | undefined;
        const out = await refreshReferences(db, String(client.id), deps.refsIO(), { multiples, notNow: await notNowPlatforms(db, client.id) });
        if (out.kind === "no_accounts") return { status: "waiting", reason: "social_accounts" };
        if (out.kind === "in_progress") return { status: "waiting", reason: "in_progress", recheckMinutes: 1, result: { reviewed: out.reviewed, left: out.left } };
        if (out.kind === "too_few") return { status: "waiting", reason: "designed_posts", recheckDays: 7, result: { designed: out.designed, posts_read: out.posts_read } };
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
      const profiles = desiredProfiles(await profileInputs(db, { id: client.id, name: client.name }, { tracking: rows.get("tracking")?.result ?? null, brand_read: rows.get("brand_read")?.result ?? null }));
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
  // when a website is found or a place opens.
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
      return `${set.id}|${set.rivaliq_landscape_id ?? "none"}|${set.tracking_check?.code ?? ""}|${selection}|${siteKey(client.website_url) ?? ""}`;
    },
    async run(db, client, { rows }) {
      const set = await currentSet(db, client.id);
      if (!set) return { status: "waiting", reason: "competitor_set" };
      // RivalIQ follows companies by their website: nothing is asked of it until the client has one.
      if (!siteKey(client.website_url) && !set.rivaliq_landscape_id) return { status: "waiting", reason: "client_website", result: { set_id: set.id } };
      const key = deps.rivaliqKey();
      if (!key) return { status: "failed", error: "The RivalIQ connection is not configured." };
      const api = deps.rivalIqApi(key);
      let landscape: string | null = str(set.rivaliq_landscape_id) || null;
      const check = set.tracking_check as { code?: string; landscape_id?: string | null } | null;
      if (landscape && check?.code === LANDSCAPE_MISSING && String(check.landscape_id ?? "") === landscape) {
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
          // The plan is full: tracking waits for a free place, looked at again daily.
          if (e instanceof FollowFailure && e.planFull) return { status: "waiting", reason: "rivaliq_full", recheckDays: 1, result: { set_id: set.id } };
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
  // replaced.
  design_settings: {
    policy: {},
    async inputs(db, client, rows) {
      const refs = rows.get("design_refs");
      if (!refs || !refs.done_at) return null;
      if (!str(client.logo_url)) return null;
      if (!libraryPaths(client.design_references, client.harvested_design_references).length) return null;
      const { data, error } = await db.from("design_brand_settings").select("source").eq("client_id", client.id).maybeSingle();
      if (error) throw new Error(`Could not read the design settings: ${error.message}`);
      if (data?.source === "person") return "person";
      const b = client.brand_identity ?? {};
      return `refs:${refs.result?.synthesized_at ?? refs.done_at}|logo:${client.logo_url}|colors:${[b.primary_color, b.secondary_color, b.accent_color].join(",")}`;
    },
    async run(db, client) {
      const { data: existing, error } = await db.from("design_brand_settings").select("source").eq("client_id", client.id).maybeSingle();
      if (error) throw new Error(`Could not read the design settings: ${error.message}`);
      if (existing?.source === "person") return { status: "done", result: { kept: "person" } };
      const key = await deps.anthropicKey(db);
      if (!key) return { status: "failed", error: "The AI connection is not configured." };
      const imaging = await deps.imaging();
      const logo = await imaging.logoPng(db, client.id, String(client.logo_url));
      if (!logo) return { status: "waiting", reason: "logo_file", result: { logo_url: client.logo_url } };
      // Where the client's own posts put the logo, read from its posts, not its uploads.
      const posts = referencesFor([], (Array.isArray(client.harvested_design_references) ? client.harvested_design_references : []).filter((r: { upload?: boolean }) => !r?.upload), MAX_REFS, null);
      const spot = posts.length ? await imaging.readLogoSpot(db, client.name, posts, key) : null;
      const { placement, from } = placementFor(spot, logo.width / Math.max(1, logo.height));
      const b = client.brand_identity ?? {};
      const background = pickBackground([b.primary_color, b.secondary_color, b.accent_color], logo.ink);
      const paths = libraryPaths(client.design_references, client.harvested_design_references);
      const derived = { logo_from: client.logo_url, logo_file: logo.converted, placement_from: from, logo_read: spot, background_from: background.from, at: deps.now().toISOString() };
      const { data: wrote, error: writeError } = await db.rpc("lifecycle_write_design_settings", {
        p_client: client.id, p_logo_path: logo.path, p_placement: placement, p_background: background.hex, p_reference_paths: paths, p_derived: derived,
      });
      if (writeError) throw new Error(`Could not save the design settings: ${writeError.message}`);
      return { status: "done", result: { written: wrote === true, logo_path: logo.path, placement, placement_from: from, background: background.hex, background_from: background.from, references: paths.length } };
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
      const { data, error } = await db.rpc("lifecycle_first_output", { p_client: client.id });
      if (error) throw new Error(`Could not start the client's first output: ${error.message}`);
      return { status: "done", result: (data ?? {}) as Record<string, unknown> };
    },
  },
};

export const STEP_NAMES = Object.keys(STEPS);
