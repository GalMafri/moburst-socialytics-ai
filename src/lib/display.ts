/**
 * The one display layer: every stored value that reaches a screen as words
 * goes through here. Platform names, dates and date ranges, run statuses for
 * both report tables, country and language names, usage events and roles,
 * client notes' states and kinds, and stored text with escaped characters.
 *
 * Pure module: no React, no Supabase client, so libraries, edge code and
 * tests can import it. src/test/displayGuard.test.ts fails the build when a
 * screen prints one of these values raw.
 */

import { competitiveReportQuality, HELD_REDOS } from "../../supabase/functions/_shared/competitive/reportEvidence";

// ── Platforms ──────────────────────────────────────────────────────────────

export const PLATFORM_NAMES: Record<string, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  x: "X",
  pinterest: "Pinterest",
  threads: "Threads",
  snapchat: "Snapchat",
};

/**
 * One key per network, from whatever the source sent: RivalIQ channels
 * ("instagram"), Sprout network types ("fb_instagram_account",
 * "linkedin_company", "TWITTER"), display names ("Twitter/X") and post URLs.
 */
export function platformKey(value: string | null | undefined): string {
  const v = String(value ?? "").toLowerCase().trim();
  if (!v) return "";
  if (v.includes("insta") || v === "ig") return "instagram";
  if (v.includes("tiktok") || v.includes("tik tok") || v.startsWith("tik")) return "tiktok";
  if (v.includes("linkedin")) return "linkedin";
  if (v.includes("youtu") || v === "yt") return "youtube";
  if (v.includes("facebook") || v === "fb" || v.startsWith("fb_") || v === "fb page") return "facebook";
  if (v.includes("pinterest")) return "pinterest";
  if (v.includes("threads")) return "threads";
  if (v.includes("snapchat")) return "snapchat";
  if (v === "x" || v.includes("twitter") || v === "x.com") return "x";
  return v;
}

/** A network's name as people write it. Unknown networks are capitalized, never shown as a raw key. */
export function platformName(value: string | null | undefined): string {
  const key = platformKey(value);
  if (!key) return "";
  if (PLATFORM_NAMES[key]) return PLATFORM_NAMES[key];
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

// ── Dates ──────────────────────────────────────────────────────────────────

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function toDate(value: string | number | Date | null | undefined): { date: Date; dateOnly: boolean } | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? { date: value, dateOnly: false } : null;
  const s = String(value);
  // A calendar date has no time zone; read it as that day everywhere.
  if (DATE_ONLY.test(s)) return { date: new Date(s + "T00:00:00Z"), dateOnly: true };
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? { date, dateOnly: false } : null;
}

/** "Oct 7, 2026". Calendar dates (yyyy-mm-dd) stay on their day in every time zone. */
export function formatDate(value: string | number | Date | null | undefined, opts: { timeZone?: string; year?: boolean } = {}): string {
  const parsed = toDate(value);
  if (!parsed) return "";
  return parsed.date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(opts.year === false ? {} : { year: "numeric" }),
    timeZone: parsed.dateOnly ? "UTC" : opts.timeZone,
  });
}

/** "Oct 7, 2026, 2:35 PM" in the viewer's time zone, or the one given; "Oct 7, 2:35 PM" with year: false. */
export function formatDateTime(value: string | number | Date | null | undefined, opts: { timeZone?: string; year?: boolean } = {}): string {
  const parsed = toDate(value);
  if (!parsed) return "";
  if (parsed.dateOnly) return formatDate(value, { year: opts.year });
  return parsed.date.toLocaleString("en-US", { month: "short", day: "numeric", ...(opts.year === false ? {} : { year: "numeric" }), hour: "numeric", minute: "2-digit", timeZone: opts.timeZone });
}

/**
 * A post's line about Sprout: "Sent to Sprout as a draft for Nov 9, 6:45 PM."
 * in the client's time zone, or "Not sent to Sprout yet." Sprout's API takes
 * posts as drafts only (supabase/functions/_shared/sprout/publishing.ts), so
 * every post sent, for a set time or now, is a draft for its time.
 */
export function sproutDraftLine(sendTime: string | null | undefined, timeZone?: string): string {
  const at = formatDateTime(sendTime, { timeZone, year: false });
  return at ? `Sent to Sprout as a draft for ${at}.` : "Not sent to Sprout yet.";
}

/** "Sep 1, 2026 to Sep 30, 2026". Empty when either end is missing. */
export function formatRange(range: { start?: string | null; end?: string | null } | null | undefined): string {
  if (!range?.start || !range?.end) return "";
  const s = formatDate(String(range.start).slice(0, 10));
  const e = formatDate(String(range.end).slice(0, 10));
  return s && e ? `${s} to ${e}` : "";
}

// ── Run statuses (monthly reports and competitive analyses) ────────────────

export type RunState = "ready" | "running" | "scheduled" | "held";

export interface RunStatus {
  state: RunState;
  label: string;
  variant: "default" | "secondary" | "outline";
  /** True when this viewer should not see the row at all. */
  hidden: boolean;
}

export interface Viewer { isStaff: boolean }

const RUNNING = ["running", "pending", "queued", "processing", "started"];
const DONE = ["completed", "complete", "done"];

const STATUS: Record<RunState, Omit<RunStatus, "hidden">> = {
  ready: { state: "ready", label: "Ready", variant: "default" },
  running: { state: "running", label: "Running", variant: "secondary" },
  // A run that did not finish is taken away and made again by the product
  // (run-scheduled-jobs/dispatch.ts); no screen lists it.
  scheduled: { state: "scheduled", label: "Scheduled", variant: "outline" },
  // Finished, but its sources did not pass the checks: not shared with the
  // client, and made again once a day (HELD_REDOS times) by the dispatch.
  held: { state: "held", label: "Being redone", variant: "outline" },
};

/** A held period whose redos are used up: it stays unshared until the next scheduled run. */
const HELD_DONE_LABEL = "Not shared";

function statusFor(state: RunState, viewer: Viewer): RunStatus {
  // Clients see finished work only; nobody sees a run that did not finish.
  return { ...STATUS[state], hidden: state === "scheduled" || (!viewer.isStaff && state !== "ready") };
}

/** A monthly report row ("completed", "running", "failed" in the reports table). */
export function monthlyReportStatus(row: { status?: string | null }, viewer: Viewer): RunStatus {
  const s = String(row?.status ?? "").toLowerCase();
  if (DONE.includes(s)) return statusFor("ready", viewer);
  if (RUNNING.includes(s)) return statusFor("running", viewer);
  return statusFor("scheduled", viewer);
}

/**
 * A competitive run row ("complete", "running", "failed" in
 * competitive_reports). It takes the whole row and works out whether the run
 * is held back itself, so no screen can show a held run as ready.
 */
export function competitiveRunStatus(row: { status?: string | null; report_data?: unknown }, viewer: Viewer): RunStatus {
  const s = String(row?.status ?? "").toLowerCase();
  if (RUNNING.includes(s)) return statusFor("running", viewer);
  if (DONE.includes(s)) return statusFor(competitiveReportQuality(row.report_data).ready ? "ready" : "held", viewer);
  return statusFor("scheduled", viewer);
}

type RunRow = { id?: string; client_id?: string | null; status?: string | null; report_data?: unknown; date_range_start?: string | null; date_range_end?: string | null; created_at?: string | null };

function periodKey(row: RunRow): string {
  const rd = (Array.isArray(row.report_data) ? row.report_data[0] : row.report_data) as { period?: { start?: string; end?: string } } | null | undefined;
  const start = row.date_range_start || rd?.period?.start || "";
  const end = row.date_range_end || rd?.period?.end || "";
  return `${row.client_id ?? ""}|${String(start).slice(0, 10)}|${String(end).slice(0, 10)}`;
}

/**
 * The runs a list shows. Rows this viewer may not see are left out (a run
 * that did not finish is never listed). A held run is hidden behind a ready
 * or running run for the same client and period, and a period held more than
 * once shows its newest held run only, which reads "Not shared" once the
 * product has made it again HELD_REDOS times.
 */
export function listedRuns<T extends RunRow>(kind: "monthly" | "competitive", rows: T[] | null | undefined, viewer: Viewer): Array<T & { display: RunStatus }> {
  const status = (row: T) => (kind === "monthly" ? monthlyReportStatus(row, viewer) : competitiveRunStatus(row, viewer));
  const all = (rows ?? []).map((row) => ({ ...row, display: status(row) }));
  const covered = new Set(all.filter((r) => r.display.state === "ready" || r.display.state === "running").map((r) => periodKey(r)));
  const held = new Map<string, Array<T & { display: RunStatus }>>();
  for (const r of all) if (r.display.state === "held") held.set(periodKey(r), [...(held.get(periodKey(r)) ?? []), r]);
  const newestHeld = new Map([...held].map(([key, list]) => [key, [...list].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0]]));
  return all
    .filter((r) => !r.display.hidden && (r.display.state === "ready" || r.display.state === "running" || (!covered.has(periodKey(r)) && newestHeld.get(periodKey(r)) === r)))
    .map((r) => (r.display.state === "held" && (held.get(periodKey(r))?.length ?? 0) > HELD_REDOS ? { ...r, display: { ...r.display, label: HELD_DONE_LABEL } } : r));
}

// ── Countries and languages ────────────────────────────────────────────────

function displayName(code: string, type: "region" | "language"): string {
  const c = code.trim();
  if (!c) return "";
  try {
    const names = new Intl.DisplayNames(["en-US"], { type });
    const name = names.of(type === "region" ? c.toUpperCase() : c.toLowerCase());
    return name && name.toLowerCase() !== c.toLowerCase() ? name : c;
  } catch {
    // Not a code ("United States" stored as a name): it is already words.
    return c;
  }
}

const list = (value: string | string[] | null | undefined) =>
  (Array.isArray(value) ? value : String(value ?? "").split(",")).map((v) => String(v).trim()).filter(Boolean);

/** "US" becomes "United States"; a list becomes "United States, Canada". */
export function countryNames(value: string | string[] | null | undefined): string {
  return list(value).map((c) => displayName(c, "region")).join(", ");
}

/** "en" becomes "English"; a list becomes "English, Spanish". */
export function languageNames(value: string | string[] | null | undefined): string {
  return list(value).map((c) => displayName(c, "language")).join(", ");
}

// ── Usage: roles, people's states and events ───────────────────────────────

const ROLE_NAMES: Record<string, string> = {
  admin: "Admin",
  moburst_user: "Moburst team",
  user: "Moburst team",
  client: "Client",
};

export function roleName(role: string | null | undefined): string {
  const r = String(role ?? "").trim();
  return r ? ROLE_NAMES[r] ?? humanize(r) : "";
}

const USAGE_STATES: Record<string, string> = {
  habit: "Regular",
  active: "Active",
  lapsed: "Lapsed",
  "logged in, no output": "Signed in, no work yet",
  "never logged in": "Never signed in",
};

export function usageStateName(state: string | null | undefined): string {
  const s = String(state ?? "").trim();
  return s ? USAGE_STATES[s] ?? humanize(s) : "";
}

/** Usage events and recorded actions, as a sentence fragment a person reads. */
const EVENT_NAMES: Record<string, string> = {
  // Work records (usage_actions)
  report_run: "Monthly report",
  competitive_report_run: "Competitive analysis",
  competitors_found: "Competitors found",
  competitors_confirmed: "Competitors confirmed",
  post_created: "Post written",
  post_iterated: "Post revised",
  post_approved: "Post approved",
  post_scheduled: "Post scheduled",
  client_created: "Client added",
  design_request: "Design requested",
  media_image: "Image made",
  media_video: "Video made",
  media_design: "Design made",
  // Tracked events (app_events)
  page_viewed: "Viewed a page",
  page_left: "Left a page",
  ui_clicked: "Clicked",
  report_opened: "Opened a report",
  report_closed: "Closed a report",
  analysis_started: "Started a monthly report",
  analysis_completed: "Monthly report finished",
  analysis_failed: "Monthly report did not finish",
  analysis_timed_out: "Monthly report took too long",
  competitive_analysis_started: "Started a competitive analysis",
  competitive_analysis_completed: "Competitive analysis finished",
  competitive_analysis_failed: "Competitive analysis did not finish",
  competitive_landscape_import_started: "Started a competitor import",
  competitor_identification_started: "Started finding competitors",
  competitor_identification_completed: "Found competitors",
  competitor_identification_failed: "Finding competitors did not finish",
  competitor_set_confirmed: "Confirmed competitors",
  post_copy_edit_started: "Started editing post copy",
  post_copy_edited: "Edited post copy",
  post_copy_edit_cancelled: "Stopped editing post copy",
  post_copy_regenerated: "Rewrote post copy",
  error_thrown: "Screen error",
  promise_rejected: "Screen error",
};

export function eventName(event: string | null | undefined): string {
  const e = String(event ?? "").trim();
  if (!e) return "";
  if (EVENT_NAMES[e]) return EVENT_NAMES[e];
  if (e.startsWith("media_")) return `${humanize(e.slice(6))} made`;
  return humanize(e);
}

/** The kind of an entry in a person's activity timeline. */
const TIMELINE_KINDS: Record<string, string> = {
  run: "Report",
  test: "Test",
  strategic: "Plan",
  post: "Post",
  publish: "Scheduling",
  setup: "Setup",
  event: "Activity",
};

export function timelineKindName(kind: string | null | undefined): string {
  const k = String(kind ?? "").trim();
  return k ? TIMELINE_KINDS[k] ?? humanize(k) : "";
}

const REPORT_TYPES: Record<string, string> = { social: "Monthly report", monthly: "Monthly report", competitive: "Competitive analysis" };

/**
 * The detail line of a timeline entry, which the database writes as parts
 * joined by " · ". Platform keys and report types become names; page paths
 * and error codes are left out; durations and counts stay.
 */
export function timelineDetail(kind: string | null | undefined, detail: string | null | undefined): string {
  const parts = String(detail ?? "").split(" · ").map((p) => p.trim()).filter(Boolean);
  const out = parts.flatMap((p) => {
    if (/^\d+(\.\d+)?(s|m)$/.test(p)) return [p.endsWith("m") ? `${p.slice(0, -1)} min` : `${p.slice(0, -1)} sec`];
    if (/^v\d+$/.test(p)) return [`version ${p.slice(1)}`];
    if (REPORT_TYPES[p.toLowerCase()]) return [REPORT_TYPES[p.toLowerCase()]];
    if (PLATFORM_NAMES[platformKey(p)]) return [platformName(p)];
    if (kind === "event") return [];
    if (/^\//.test(p) || /^[A-Z0-9_]+$/.test(p) || /^[a-z]+(_[a-z]+)+$/.test(p)) return [];
    return [humanize(p)];
  });
  return out.join(" · ");
}

function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

// ── Text ───────────────────────────────────────────────────────────────────

const ESCAPE = /\\u([0-9a-fA-F]{4})/g;
const RUN = /(?:\\u[0-9a-fA-F]{4})+|&amp;/g;

function decodeRun(run: string): string {
  if (run === "&amp;") return "&";
  const units = [...run.matchAll(ESCAPE)].map((m) => parseInt(m[1], 16));
  let out = "";
  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const next = units[i + 1];
    if (u >= 0xd800 && u <= 0xdbff && next !== undefined && next >= 0xdc00 && next <= 0xdfff) {
      out += String.fromCodePoint(0x10000 + ((u - 0xd800) << 10) + (next - 0xdc00));
      i++;
    } else if (u >= 0xd800 && u <= 0xdfff) {
      // A lone surrogate cannot be decoded; it stays as it was stored.
      out += "\\u" + u.toString(16).padStart(4, "0");
    } else {
      out += String.fromCharCode(u);
    }
  }
  return out;
}

/**
 * Stored text as people should read it. Captions saved by the report
 * workflow carry escaped characters ("\\ud83d\\udd25", "\\u0026") and the
 * line and paragraph separators some apps write; they become the emoji, the
 * ampersand and ordinary line breaks. Nothing else in the text changes. The
 * decoder is the one proven on all 281 affected TikTok captions (19 Oct 2026).
 */
export function cleanText(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value).replace(RUN, decodeRun).replace(/[\u2028\u2029]/g, "\n");
}

/**
 * Long numbers inside stored report text, written the way a person reads
 * them: "climbed to 1581992, making it" becomes "climbed to 1,581,992,
 * making it". A year on its own (1900 to 2099), a number already grouped or
 * with decimals, and digits inside a handle, hashtag, date, time or link stay
 * as they are.
 */
export function formatNumbersInText(text: string): string {
  return String(text ?? "").replace(/(?<![\w.,:/#@-])(\d{4,})(?![\w:/-]|[.,]\d)/g, (m) => {
    const n = Number(m);
    return m.length === 4 && n >= 1900 && n <= 2099 ? m : n.toLocaleString("en-US");
  });
}

// ── Schedules ──────────────────────────────────────────────────────────────

/**
 * When the first report of a kind runs, as a fact: "The first competitive
 * analysis runs on Nov 7, 2026." Empty when nothing is scheduled, so a
 * screen shows nothing rather than asking anyone to set something up.
 */
export function firstRunSentence(kind: "monthly" | "competitive", nextRunAt: string | null | undefined, timeZone?: string, opts: { first?: boolean } = {}): string {
  const when = formatDate(nextRunAt, { timeZone });
  if (!when) return "";
  return `The ${opts.first === false ? "next" : "first"} ${kind === "competitive" ? "competitive analysis" : "monthly report"} runs on ${when}.`;
}

/** A report's period: "Sep 2026" for a whole calendar month, else its dates. */
export function periodLabel(range: { start?: string | null; end?: string | null } | null | undefined): string {
  const start = String(range?.start ?? "").slice(0, 10);
  const end = String(range?.end ?? "").slice(0, 10);
  if (!DATE_ONLY.test(start) || !DATE_ONLY.test(end)) return "";
  const s = new Date(start + "T00:00:00Z");
  const lastDay = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  if (start.endsWith("-01") && end === lastDay) return s.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return formatRange({ start, end });
}

/**
 * Where a monthly schedule stands, in sentences built from its own fields and
 * its latest finished report: "Last report: Sep 2026, ran Oct 7, 2026." and
 * "The next one runs on Nov 7, 2026." The scheduler's own note is never shown.
 */
export function scheduleLines(args: {
  kind: "monthly" | "competitive";
  active: boolean;
  nextRunAt?: string | null;
  latest?: { start?: string | null; end?: string | null; ranAt?: string | null } | null;
  timeZone?: string;
}): string[] {
  const out: string[] = [];
  const noun = args.kind === "competitive" ? "analysis" : "report";
  const period = periodLabel(args.latest);
  const ran = formatDate(args.latest?.ranAt, { timeZone: args.timeZone });
  if (period || ran) out.push(`Last ${noun}: ${[period, ran ? `ran ${ran}` : ""].filter(Boolean).join(", ")}.`);
  if (!args.active) out.push("Paused.");
  else {
    const next = formatDate(args.nextRunAt, { timeZone: args.timeZone });
    if (next) out.push(`The ${out.length ? "next" : "first"} one runs on ${next}.`);
  }
  return out;
}

// ── Where the product's own values came from ───────────────────────────────

const LOCATION_SOURCES: Record<string, string> = {
  "schema.org": "the business address the website publishes",
  page_footer: "the address in the website's footer",
  page_text: "an address on the website",
  site_read: "where the website says the business is based",
  country: "the main time zone of the business's country",
  profile_address: "the address on the client's local business profile",
  post_text: "an address in the client's posts",
  post_read: "where the client's posts say the business is based",
  followers: "where most of the client's followers are",
};

/** Where the client's time zone was read from (clients.location.source), as words. */
export function locationSourceWords(source: string | null | undefined): string {
  return LOCATION_SOURCES[String(source ?? "")] ?? "";
}

const LOCAL_PROFILES: Record<string, string> = { google_my_business: "Google Business Profile", yelp: "Yelp page", tripadvisor: "Tripadvisor page" };

/** Where the client's time zone was read from, with the profile or the followers' city it names. */
export function locationOrigin(location: { source?: string | null; via?: string | null; locality?: string | null } | null | undefined): string {
  const source = String(location?.source ?? "");
  if (source === "profile_address" && LOCAL_PROFILES[String(location?.via ?? "")]) return `the address on the client's ${LOCAL_PROFILES[String(location!.via)]}`;
  if (source === "followers" && location?.locality) return `${LOCATION_SOURCES.followers} (${location.locality})`;
  return locationSourceWords(source);
}

// ── What the product read from a client's social profiles ──────────────────

/** A client lifecycle step as the setup page reads it. */
export interface OnboardingStep {
  step: string;
  status?: string | null;
  done_at?: string | null;
  result?: Record<string, unknown> | null;
}

export interface OnboardingFacts {
  website: string;
  logo: string;
  timezone: string;
  regions: string;
  languages: string;
  brief: string;
  competitors: { names: string[]; tracking: string };
}

/** The value's record in field_sources: who set it, when, and where the lifecycle's value came from. */
function sourceEntry(fieldSources: unknown, field: string): { by: string; at: string; from: string } {
  const e = fieldSources && typeof fieldSources === "object" ? (fieldSources as Record<string, unknown>)[field] : null;
  const o = e && typeof e === "object" ? (e as Record<string, unknown>) : {};
  return { by: String(o.by ?? ""), at: String(o.at ?? ""), from: String(o.from ?? "") };
}

const SITE_FOUND: Record<string, string> = {
  domain_name: "the site's domain is the brand's name",
  site_name: "the site gives the brand's name as its own",
};

/**
 * Each line the setup page shows about what the product read from the
 * client's Sprout profiles and posts (spec: docs/superpowers/specs/2026-11-03-
 * onboarding-complete-design.md, section 6): facts with a date or a count,
 * never a step name, a status or an error. An empty line shows nothing.
 */
export function onboardingFacts(client: Record<string, unknown> | null | undefined, steps: OnboardingStep[] | null | undefined): OnboardingFacts {
  const c = client ?? {};
  const fs = c.field_sources;
  const by = (step: string) => (steps ?? []).find((s) => s.step === step) ?? null;
  const result = (step: string) => (by(step)?.result ?? {}) as Record<string, unknown>;
  const waitingFor = (step: string) => (by(step)?.status === "waiting" ? String(result(step).waiting_for ?? "") : "");
  const hasSite = !!String(c.website_url ?? "").trim();
  const social = by("social_read")?.result ? result("social_read") : null;

  // The website.
  let website = "";
  const site = result("website");
  const siteSource = sourceEntry(fs, "website_url");
  if (!hasSite && by("website") && Number.isFinite(Number(site.posts))) {
    const span = Number(site.months) === 12 ? "the last 12 months" : "the last 90 days";
    const searched = formatDate(site.searched_at as string | undefined);
    website = `No website found yet. Looked through ${Number(site.posts)} ${Number(site.posts) === 1 ? "post" : "posts"} from ${span}${searched ? ` and searched the web for ${String(c.name ?? "the brand")} on ${searched}` : ""}.`;
  } else if (hasSite && siteSource.by === "lifecycle" && site.website && site.found_at) {
    const how = String(site.confirmed_by ?? "");
    const network = platformName(site.linked_network as string | undefined);
    const what = how.startsWith("bio_") ? "the client's Instagram bio links to it"
      : how.endsWith("profile_link") ? `the site links to the client's ${network || "profiles"}`
      : SITE_FOUND[how] ?? "";
    if (what) website = `Found on ${formatDate(site.found_at as string)}: ${what}.`;
  }

  // The logo.
  let logo = "";
  const logoSource = sourceEntry(fs, "logo_url");
  if (logoSource.by === "lifecycle" && logoSource.from.startsWith("profile_picture:")) {
    const network = platformName(logoSource.from.slice("profile_picture:".length)) || "social";
    const on = formatDate(logoSource.at);
    logo = `From the client's ${network} profile picture${on ? `, ${on}` : ""}. ${hasSite ? "A logo you upload is kept." : "The website's logo replaces it once the website is found; a logo you upload is kept."}`;
  }

  // The time zone.
  let timezone = "";
  const zoneSource = sourceEntry(fs, "timezone");
  const location = (c.location && typeof c.location === "object" ? c.location : null) as { source?: string; via?: string; locality?: string; website?: string | null } | null;
  if (zoneSource.by !== "person" && social) {
    const zone = String(c.timezone ?? "").trim();
    const words = location?.source ? locationOrigin(location) : "";
    if (words && zone && zone !== "UTC") timezone = `Worked out from ${words}. You can change it here.`;
    else if (!zone || zone === "UTC") timezone = "Not known yet: no address or location in the client's profiles or posts. Calendar times show in UTC until then.";
  }

  // Regions and languages.
  let regions = "";
  const geoSource = sourceEntry(fs, "geo");
  const geo = String(c.geo ?? "").split(",").map((g) => g.trim()).filter(Boolean);
  const countries = (Array.isArray(social?.follower_countries) ? social!.follower_countries : []) as Array<{ country: string; share: number }>;
  if (geoSource.by === "lifecycle" && geoSource.from === "followers") {
    const shown = countries.filter((f) => geo.includes(f.country)).map((f) => `${countryNames(f.country)} ${Math.round(f.share * 100)}%`);
    if (shown.length) regions = `From where the client's followers are: ${shown.join(", ")}.`;
  } else if (geoSource.by === "lifecycle" && geoSource.from === "posts") {
    regions = "From where the client's posts say the business is.";
  }
  let languages = "";
  const languageSource = sourceEntry(fs, "language");
  const counted = (Array.isArray(social?.languages) ? social!.languages : []) as Array<{ language: string; posts: number }>;
  const total = Number(social?.language_posts) || 0;
  if (languageSource.by === "lifecycle" && languageSource.from === "posts" && total) {
    const chosen = String(c.language ?? "").split(",").map((l) => l.trim()).filter(Boolean);
    const shown = counted.filter((l) => chosen.includes(l.language)).map((l) => `${languageNames(l.language)} in ${l.posts} of ${total}`);
    if (shown.length) languages = `From the client's posts: ${shown.join(", ")}.`;
  }

  // The brief and pillars.
  let brief = "";
  const briefSource = sourceEntry(fs, "brief_text");
  if (waitingFor("brief_pillars") === "posts") {
    brief = `Written once the client has 5 posts with text. It has ${Number(result("brief_pillars").text_posts) || 0}.`;
  } else if (briefSource.by === "lifecycle" && briefSource.from === "posts") {
    const on = formatDate(briefSource.at || (result("brief_pillars").drafted_at as string | undefined));
    brief = `Drafted from the client's posts${on ? ` on ${on}` : ""}.`;
  }

  // Competitors and tracking.
  const picked = by("competitors")?.status === "done" && Array.isArray(result("competitors").selected) ? (result("competitors").selected as unknown[]).map(String) : [];
  const trackingWait = waitingFor("tracking");
  const tracking = trackingWait === "client_website" ? "RivalIQ follows companies by their website, so tracking starts once the client's website is found."
    : trackingWait === "rivaliq_full" ? "The RivalIQ plan is full. Tracking starts when a place opens." : "";

  return { website, logo, timezone, regions, languages, brief, competitors: { names: picked, tracking } };
}

/** "America/New_York" as people say it: "Eastern Time (New York)". */
export function timeZoneName(zone: string | null | undefined): string {
  const z = String(zone ?? "").trim();
  if (!z) return "";
  if (z === "UTC") return "UTC";
  const city = z.split("/").pop()!.replace(/_/g, " ");
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: z, timeZoneName: "longGeneric" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value;
    return part && !/^GMT/.test(part) ? `${part} (${city})` : city;
  } catch {
    return city;
  }
}

// ── Where a client came from ───────────────────────────────────────────────

/**
 * The line under a client's name on staff screens when the product made the
 * client (clients.origin): "Added from Sprout Social on Nov 9, 2026". Empty
 * for a client a person made.
 */
export function clientOriginLine(origin: unknown): string {
  const o = origin && typeof origin === "object" ? (origin as { source?: unknown; at?: unknown }) : null;
  if (o?.source !== "sprout") return "";
  const on = formatDate(typeof o.at === "string" ? o.at : null);
  return on ? `Added from Sprout Social on ${on}` : "Added from Sprout Social";
}

// ── Client notes ───────────────────────────────────────────────────────────

const NOTE_POINT_KINDS: Record<string, string> = { avoid: "Avoid", do: "Do", upcoming: "Coming up", fact: "Facts" };

/** A point's kind (client_note_points.kind), as the copy's section heads it. */
export function notePointKindName(kind: string | null | undefined): string {
  const k = String(kind ?? "").trim();
  return k ? NOTE_POINT_KINDS[k] ?? humanize(k) : "";
}

/** Where a note stands (client_notes.state), with how many of its points count: "Reading", "12 points learned". */
export function noteStateLine(state: string | null | undefined, points: number): string {
  if (state === "reading") return "Reading";
  if (state === "learned" && points > 0) return `${points.toLocaleString("en-US")} point${points === 1 ? "" : "s"} learned`;
  return "Nothing in this note for the copy";
}

/**
 * Who added a client note, and from where: "Added by Sinead on Oct 28, 2026",
 * or for a note a person saved from Claude (client_notes.source claude)
 * "From Claude, by Sinead on Nov 3, 2026".
 */
export function noteAddedLine(note: { added_by_name?: string | null; created_at?: string | null; source?: string | null }, timeZone?: string): string {
  const on = formatDate(note.created_at, { timeZone });
  const by = String(note.added_by_name ?? "").trim();
  if (note.source === "claude") return by ? `From Claude, by ${by} on ${on}` : `From Claude on ${on}`;
  return by ? `Added by ${by} on ${on}` : `Added on ${on}`;
}

/**
 * A deck on a report (report_decks). Staff see who saved it from Claude:
 * "From Claude, by Sinead on Nov 3, 2026"; everyone else sees when it was
 * added: "Added on Nov 3, 2026".
 */
export function deckAddedLine(deck: { added_by_name?: string | null; created_at?: string | null; source?: string | null }, opts: { staff: boolean; timeZone?: string }): string {
  const on = formatDate(deck.created_at, { timeZone: opts.timeZone });
  return opts.staff ? noteAddedLine(deck, opts.timeZone) : `Added on ${on}`;
}

/** For a file longer than one note reads (client_notes.text_chars), how much of it was read; empty otherwise. */
export function noteReadLine(textChars: number | null | undefined, max: number): string {
  const n = Number(textChars);
  if (!Number.isFinite(n) || n <= max) return "";
  return `About the first ${max.toLocaleString("en-US")} of ${n.toLocaleString("en-US")} characters were read.`;
}

/**
 * A Sprout brand a person chose not to add as a client
 * (sprout_brand_declines), on the staff list of Sprout profiles:
 * "Declined as a client on Nov 2, 2026". Empty when it was not declined.
 */
export function declinedBrandLine(declined: { brand?: string | null; declined_at?: string | null } | null | undefined): string {
  if (!declined) return "";
  const on = formatDate(declined.declined_at ?? null);
  return on ? `Declined as a client on ${on}` : "Declined as a client";
}

// ── Competitor profiles ────────────────────────────────────────────────────

/** True for a handle that is a provider's id rather than a name: numeric page ids, YouTube channel ids. */
export function isRawProfileId(handle: string | null | undefined): boolean {
  const h = String(handle ?? "").trim().replace(/^@/, "");
  return !h || /^\d+$/.test(h) || /^UC[A-Za-z0-9_-]{22}$/.test(h);
}

/**
 * How a competitor's profile is named on screen: its display name when it
 * is known (the channel or page title), else its handle when that is a
 * readable name, else the competitor's own name. Never a raw id.
 */
export function profileName(h: { handle?: string | null; display_name?: string | null }, ownerName: string): string {
  const name = String(h.display_name ?? "").trim();
  if (name) return name;
  const handle = String(h.handle ?? "").trim().replace(/^@/, "");
  return isRawProfileId(handle) ? ownerName : `@${handle}`;
}
