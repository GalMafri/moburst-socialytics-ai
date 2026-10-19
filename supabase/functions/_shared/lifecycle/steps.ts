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
//   brand_read      the website: brand identity, logo, location and timezone, country, language
//   brief_pillars   a brief from the strategy document or the site when there is none, then pillars and keywords
//   accounts        Sprout profiles matched by Sprout's brand name and by the site's profile links
//   access          the company slug, by the portal's slug rule
//   design_refs     the client's designed posts and the visual style learned from them
//   competitors     identify, pick the three closest with a website, confirm as the system
//   tracking        RivalIQ tracking for the confirmed set (decision 1), then handles from RivalIQ
//   design_settings logo file, placement and background derived from data (decision 2)
//   first_output    this week and next planned, and the first monthly report
// A demo copy (a client the API demo made) runs only the steps its demo job asks for (run.ts).

import { referenceFingerprint } from "../brand-references/candidates.ts";
import { StyleError } from "../brand-references/errors.ts";
import { learnBrandStyle } from "../brand-references/learnStyle.ts";
import { defaultSproutCustomerId } from "../sprout/customer.ts";
import { listCustomerProfiles } from "../sprout/profiles.ts";
import { fetchSiteHtml, logoOnPage, normalizeWebsite, openaiKeyFor, ResearchError, researchBrand } from "../brand/research.ts";
import { anthropicKey, briefFromStrategyDoc, derivePillars, isGenericPillars, PillarsError, type PillarClient } from "../brand/pillars.ts";
import { fetchSiteText, identifyCompetitors, IdentifyError } from "../competitive/identify.ts";
import { detectCompetitorHandles } from "../competitive/detectHandles.ts";
import { confirmDraftSet } from "../competitive/confirmSet.ts";
import { advanceSetupOnServer, resetTracking, rivalIqApi, SetupError, syncTrackedHandles } from "../competitive/rivaliqSetupRun.ts";
import { LANDSCAPE_MISSING } from "../competitive/landscapeCheck.ts";
import { scrapeMarkdown } from "../net/firecrawl.ts";
import { matchProfiles, platformsOf, profileListKey, siteProfileLinks } from "./accounts.ts";
import { pickBackground, placementFor, referencePaths } from "./designSettings.ts";
import { lifecycleMayWrite, setBy, writeClientFields } from "./fields.ts";
import { countryCode, htmlLanguage, replacesLocation, resolveLocation, SOURCE_RANK, zoneCountry } from "./location.ts";
import { normName, slugify, textHash } from "./names.ts";
import { cleanSiteText } from "./siteText.ts";
import type { StepOutcome, StepPolicy, StepRow } from "./policy.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
export type ClientRow = Record<string, any>;

/** What a step reads of the client. */
export const CLIENT_COLUMNS = [
  "id", "name", "archived_at", "demo_job_id", "exclude_from_reporting", "sprout_customer_id", "website_url", "field_sources", "location",
  "brand_identity", "logo_url", "timezone", "geo", "language", "brief_text", "brief_file_id", "strategy_doc_file_path", "brand_notes",
  "competitor_seed_notes", "content_pillars", "social_keywords", "primary_platforms", "company_slug", "hub_company_name",
  "design_references", "harvested_design_references", "voice_built_at:social_voice->>built_at",
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
  identifyCompetitors,
  detectCompetitorHandles,
  confirmDraftSet,
  rivalIqApi,
  advanceSetupOnServer,
  resetTracking,
  syncTrackedHandles,
  learnBrandStyle,
  imaging: () => import("./imaging.ts"),
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

/** The client's current competitor set: the newest confirmed, analyzing, complete or failed one. */
// deno-lint-ignore no-explicit-any
async function currentSet(db: Db, clientId: string): Promise<Record<string, any> | null> {
  const { data, error } = await db.from("competitor_sets").select("id, status, rivaliq_landscape_id, tracking_check, confirmed_at, created_at")
    .eq("client_id", clientId).in("status", ["confirmed", "analyzing", "complete", "failed"])
    .order("confirmed_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Could not read the client's competitor set: ${error.message}`);
  return data ?? null;
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

/** Steps in the order a new client goes through them. */
export const STEPS: Record<string, StepDef> = {
  // The website: brand identity, logo, where the business is (and so its
  // timezone), its country and its language. Re-read every 180 days and
  // whenever the website changes. The model call is made only when something
  // it reads can still be written.
  brand_read: {
    policy: { refreshDays: 180 },
    async inputs(_db, client) {
      return siteKey(client.website_url);
    },
    async run(db, client) {
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
      if (country && may("geo") && country !== str(client.geo)) fields.geo = country;
      const language = lang.language ?? read?.site_language ?? null;
      if (language && may("language") && language !== str(client.language)) fields.language = language;
      const written = await writeClientFields(db, client.id, fields);
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
  // field back.
  brief_pillars: {
    policy: {},
    async inputs(_db, client, rows) {
      const site = siteKey(client.website_url);
      if (!site && !str(client.brief_text) && !client.strategy_doc_file_path) return null;
      if (site && !settled(rows, "brand_read")) return null;
      const fs = client.field_sources;
      // A brief the lifecycle wrote is not an input (the step wrote it), so writing it never re-runs the step.
      const brief = !str(client.brief_text) || setBy(fs, "brief_text") === "lifecycle" ? "site" : textHash(client.brief_text);
      const own = ["brief_text", "content_pillars", "social_keywords"].map((f) => (lifecycleMayWrite(fs, f) ? "p" : "x")).join("");
      return `brief:${brief}|doc:${str(client.strategy_doc_file_path)}|site:${site ?? ""}|own:${own}`;
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

      const fields: Record<string, unknown> = {};
      let brief: "from_doc" | "drafted" | "kept" | "none" = personBrief ? "kept" : "none";
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
        const body = siteText.slice(0, 2500);
        const current = str(client.brief_text);
        if (!current.endsWith(body)) fields.brief_text = `Drafted from the website on ${day(deps.now())}:\n\n${body}`;
        brief = "drafted";
      }
      let pillars: "derived" | "kept" | "none" = wantPillars ? "none" : "kept";
      let derivedNames: string[] = [];
      let derivedKeywords = 0;
      let source: string | null = null;
      if (wantPillars || wantKeywords) {
        const key = await deps.anthropicKey(db);
        if (!key) return { status: "failed", error: "The AI connection is not configured." };
        // The derivation reads the strategy document itself, so a brief copied from it is not given twice.
        const evidence = { ...client, brief_text: brief === "drafted" ? (fields.brief_text as string | undefined) ?? str(client.brief_text) : personBrief };
        try {
          const d = await deps.derivePillars(db, evidence as PillarClient, key, { siteText: brief === "drafted" ? null : siteText || null, language: str(client.language) || null });
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
            await writeClientFields(db, client.id, fields);
            return { status: "waiting", reason: "evidence", recheckDays: 7, result: { brief, brief_doc: briefDoc } };
          }
          // The brief is kept even when the pillars must be tried again.
          await writeClientFields(db, client.id, fields);
          return { status: "failed", error: e.message };
        }
      }
      const written = await writeClientFields(db, client.id, fields);
      return { status: "done", result: { brief, brief_doc: briefDoc, pillars, pillar_names: derivedNames, keywords: derivedKeywords, source, site_chars: siteText.length, written: written.written, kept: written.skipped } };
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

  // The client's designed posts and the visual style learned from them. Runs
  // when its social accounts change, and every 90 days (the posts window), so
  // the style follows what the brand publishes now.
  design_refs: {
    policy: { refreshDays: 90, recheckDays: 30 },
    async inputs(db, client) {
      const { data, error } = await db.from("sprout_profiles").select("sprout_profile_id").eq("client_id", client.id).eq("is_active", true);
      if (error) throw new Error(`Could not read the client's social accounts: ${error.message}`);
      const ids = (data ?? []).map((p: { sprout_profile_id: string }) => String(p.sprout_profile_id));
      return ids.length ? referenceFingerprint(ids, String(client.sprout_customer_id || defaultSproutCustomerId())) : null;
    },
    async run(db, client, { force }) {
      try {
        const learned = await deps.learnBrandStyle(db, String(client.id), { discover: true, force });
        const learnedAt = learned.synthesis?.synthesized_at ?? null;
        // A reused style keeps its own date, so the 90-day refresh counts from when it was learned.
        return { status: "done", result: { references: learned.refs?.length ?? 0, cached: learned.cached, synthesized_at: learnedAt }, doneAt: learnedAt };
      } catch (e) {
        if (!(e instanceof StyleError)) throw e;
        if (e.code === "no_accounts") return { status: "waiting", reason: "social_accounts" };
        if (e.code === "too_few" || e.code === "no_sources") return { status: "waiting", reason: "designed_posts", recheckDays: 30 };
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
  // identification, then the pick and the confirmation a minute later.
  competitors: {
    policy: {},
    async inputs(db, client, rows) {
      if (!siteKey(client.website_url)) return null;
      const set = await currentSet(db, client.id);
      if (set) return `existing:${set.id}`;
      if (!settled(rows, "brief_pillars")) return null;
      return `site:${siteKey(client.website_url)}|notes:${textHash(client.competitor_seed_notes)}`;
    },
    async run(db, client, { previous }) {
      const set = await currentSet(db, client.id);
      if (set) return { status: "done", result: { set_id: set.id, status: set.status, source: "existing" } };
      let draftId = (previous?.result?.draft_set_id as string | null | undefined) ?? null;
      if (draftId) {
        const { data: draft } = await db.from("competitor_sets").select("id, status").eq("id", draftId).maybeSingle();
        if (!draft || draft.status !== "draft") draftId = null;
      }
      if (!draftId) {
        const key = await deps.anthropicKey(db);
        if (!key) return { status: "failed", error: "The AI connection is not configured." };
        try {
          const made = await deps.identifyCompetitors(db, client, key, { generatedBy: null });
          return { status: "waiting", reason: "in_progress", recheckMinutes: 1, result: { draft_set_id: made.set_id, proposed: made.competitors.length } };
        } catch (e) {
          if (e instanceof IdentifyError && e.code === "too_few") return { status: "waiting", reason: "competitors", recheckDays: 30, result: { draft_set_id: null } };
          throw e;
        }
      }
      const { data: comps, error } = await db.from("competitors").select("id, client_id, name, website_url, similarity_score, is_selected, selected_rank").eq("set_id", draftId);
      if (error) throw new Error(`Could not read the proposed competitors: ${error.message}`);
      const chosen = (comps ?? []).filter((c: { website_url: string | null }) => str(c.website_url))
        .sort((a: { similarity_score: number | null }, b: { similarity_score: number | null }) => (Number(b.similarity_score) || 0) - (Number(a.similarity_score) || 0)).slice(0, 3);
      if (chosen.length < 3) return { status: "waiting", reason: "competitors", recheckDays: 30, result: { draft_set_id: null } };
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
      await deps.confirmDraftSet(db, draftId, { confirmedBy: null, notes: "Chosen automatically: the three closest competitors with a website." });
      return { status: "done", result: { set_id: draftId, selected: chosen.map((c: { name: string }) => c.name), proposed: (comps ?? []).length, created: true } };
    },
  },

  // RivalIQ tracking for the confirmed set (decision 1), run on the server
  // until it is linked, retried quietly. A landscape that disappears is set
  // up again. Once linked, each tracked company's id and handles come from
  // RivalIQ's own record of it.
  tracking: {
    policy: {},
    async inputs(db, client) {
      const set = await currentSet(db, client.id);
      if (!set) return null;
      const { data, error } = await db.from("competitors").select("id, website_url, selected_rank").eq("set_id", set.id).eq("is_selected", true).order("selected_rank");
      if (error) throw new Error(`Could not read the selected competitors: ${error.message}`);
      const selection = textHash((data ?? []).map((c: { id: string; website_url: string | null; selected_rank: number | null }) => `${c.selected_rank}:${c.id}:${c.website_url}`).join("|"));
      return `${set.id}|${set.rivaliq_landscape_id ?? "none"}|${set.tracking_check?.code ?? ""}|${selection}|${siteKey(client.website_url) ?? ""}`;
    },
    async run(db, client, { rows }) {
      const key = deps.rivaliqKey();
      if (!key) return { status: "failed", error: "The RivalIQ connection is not configured." };
      const set = await currentSet(db, client.id);
      if (!set) return { status: "waiting", reason: "competitor_set" };
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
  // (confirmed_by null). Automatic designs stay off until decision 3 is
  // turned on (Lital, 19 Oct 16:40). Settings a person confirmed or changed
  // are never replaced.
  design_settings: {
    policy: {},
    async inputs(db, client, rows) {
      const refs = rows.get("design_refs");
      if (!refs || !refs.done_at) return null;
      if (!str(client.logo_url)) return null;
      if (!referencePaths(client.design_references, client.harvested_design_references).length) return null;
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
      const harvested = referencePaths([], client.harvested_design_references);
      const spot = harvested.length ? await imaging.readLogoSpot(db, client.name, harvested, key) : null;
      const { placement, from } = placementFor(spot, logo.width / Math.max(1, logo.height));
      const b = client.brand_identity ?? {};
      const background = pickBackground([b.primary_color, b.secondary_color, b.accent_color], logo.ink);
      const paths = referencePaths(client.design_references, client.harvested_design_references);
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
