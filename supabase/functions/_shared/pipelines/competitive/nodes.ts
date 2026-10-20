// The competitive workflow's small nodes, ported from n8n
// "Socialytics - Competitive Analysis (RivalIQ) - v1" (EBiAwSay3H2R8krv,
// live version 079ef9fd) as plain functions, line for line:
//
//   Run Config                     runConfig
//   Resolve Landscape              resolveLandscape
//   Check RivalIQ Readiness        checkReadiness
//   Landscape Metrics Summary
//     Previous (its dates)         previousPeriodOf
//   Landscape Audience Snapshot
//     (its date)                   audienceDayOf
//   Build Post Windows             buildPostWindows
//   Merge Post Pages               mergePostPages
//   Merge Owned Posts              mergeOwnedPosts
//   Assemble Report Data           assembleReportData
//
// The repo mirrors n8n/code/competitive-resolve.js, check-rivaliq-
// readiness.js, merge-owned-posts.js and competitive-report.js hold the same
// code as the live version (checked on 20 Oct 2026); a test runs each mirror
// next to its function here. Assembly uses the app's current
// normalizedCompetitiveMetrics (reportMetrics.ts), which every screen also
// applies when it reads a report.

import { mergeOwnedCompetitivePosts } from "../../competitive/ownedMerge.ts";
import { normalizedCompetitiveMetrics } from "../../competitive/reportMetrics.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Run Config's output: the webhook body's fields as n8n holds them (lists as JSON text). */
export interface RunConfig {
  report_id: string;
  client_id: string;
  client_name: string;
  set_id: string;
  landscape_hint: string;
  competitors_json: string;
  range_start: string;
  range_end: string;
  started_at: string;
  suppressed_insights_json: string;
  attempt_started_at: string;
}

/** Run Config: the request's fields, the last 30 days when it names no range. */
export function runConfig(body: Any, startedAt: Date): RunConfig {
  const b = body ?? {};
  return {
    report_id: b.report_id || "",
    client_id: b.client_id || "",
    client_name: b.client_name || "",
    set_id: b.set_id || "",
    landscape_hint: b.rivaliq_landscape_id || "",
    competitors_json: JSON.stringify(b.competitors ?? []),
    range_start: b.date_range_start || isoDay(startedAt.getTime() - 30 * DAY),
    range_end: b.date_range_end || isoDay(startedAt.getTime()),
    started_at: startedAt.toISOString(),
    suppressed_insights_json: JSON.stringify(b.suppressed_insights ?? []),
    attempt_started_at: b.attempt_started_at || "",
  };
}

/** The previous period of equal length (Landscape Metrics Summary Previous). */
export function previousPeriodOf(cfg: Pick<RunConfig, "range_start" | "range_end">): { start: string; end: string } {
  const start = Date.parse(cfg.range_start.slice(0, 10) + "T00:00:00Z");
  const end = Date.parse(cfg.range_end.slice(0, 10) + "T00:00:00Z");
  const days = Math.round((end - start) / DAY) + 1;
  return { start: isoDay(start - days * DAY), end: isoDay(start - DAY) };
}

/** The day Landscape Audience Snapshot asks for: the day before the run started, in UTC. */
export function audienceDayOf(cfg: Pick<RunConfig, "started_at">): string {
  return isoDay(Date.parse(cfg.started_at) - DAY);
}

/** Resolve Landscape: the RivalIQ landscape that tracks the client and the confirmed competitors, each exactly once. */
export function resolveLandscape(cfg: RunConfig, body: Any, resp: Any) {
  const list = resp.landscapes || resp.data || resp.items || (Array.isArray(resp) ? resp : []);
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("NO_LANDSCAPES on this RivalIQ account");
  }
  const host = (value: unknown) => {
    const raw = String(value || "").trim();
    if (!raw || /\s/.test(raw)) return "";
    const hostname = raw.replace(/^[a-z]+:\/\//i, "").split(/[/?#]/)[0].toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    return hostname.includes(".") && /^[a-z0-9.-]+$/.test(hostname) ? hostname : "";
  };
  const normalizedName = (value: unknown) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/(?:\s+(?:inc|incorporated|ltd|limited|llc|llp|plc|corp|corporation))+$/, "").trim();
  const clientHost = host(body?.website_url) || host(cfg.client_name);
  const clientMatchesIn = (l: Any) => (l.companies || []).filter((c: Any) => clientHost ? host(c.url) === clientHost : !!normalizedName(cfg.client_name) && normalizedName(c.name) === normalizedName(cfg.client_name));
  let selected: Any[] = [];
  try { selected = JSON.parse(cfg.competitors_json || "[]"); } catch { selected = []; }
  const selectedMatchesIn = (l: Any) => selected.map((s) => (l.companies || []).filter((c: Any) => {
    if (clientMatchesIn(l).some((client: Any) => String(client.id) === String(c.id))) return false;
    const website = host(s.website_url);
    // A saved provider id does not override a conflicting reviewed website.
    if (s.rivaliq_company_id != null && String(c.id) !== String(s.rivaliq_company_id)) return false;
    return website ? host(c.url) === website : normalizedName(c.name) === normalizedName(s.name);
  }));
  const selectionFits = (l: Any) => {
    const matches = selectedMatchesIn(l);
    return matches.every((a: Any[]) => a.length === 1) && new Set(matches.flat().map((c: Any) => String(c.id))).size === selected.length;
  };
  let match: Any;
  let matchedBy: string;
  if (cfg.landscape_hint) {
    match = list.find((l: Any) => String(l.id) === String(cfg.landscape_hint));
    matchedBy = "explicit id";
  } else {
    const candidates = list.filter((l: Any) => clientMatchesIn(l).length === 1 && selectionFits(l));
    candidates.sort((a: Any, b: Any) => Number(String(clientMatchesIn(b)[0].id) === String(b.focusCompanyId)) - Number(String(clientMatchesIn(a)[0].id) === String(a.focusCompanyId)));
    match = candidates[0];
    matchedBy = "verified client and selected companies";
  }
  if (!match) throw new Error("LANDSCAPE_NOT_FOUND: no RivalIQ landscape tracks the client and the confirmed competitors. Connect tracking for this selection.");
  const clientMatches = clientMatchesIn(match);
  if (clientMatches.length !== 1) throw new Error("CLIENT_IDENTITY_UNVERIFIED: the selected landscape does not uniquely track the client website.");
  if (!selectionFits(match)) throw new Error("TRACKING_SELECTION_MISMATCH: the selected landscape must track every confirmed competitor with the reviewed website exactly once.");
  const companies = (match.companies || []).map((c: Any) => ({
    id: c.id,
    name: c.name,
    url: c.url || null,
    is_focus: String(c.id) === String(match.focusCompanyId),
    handles: {
      instagram: c.instagram ? c.instagram.handle : null,
      facebook: c.facebook ? c.facebook.handle : null,
      tiktok: c.tikTok ? c.tikTok.handle : null,
      twitter: c.twitter ? c.twitter.handle : null,
      youtube: c.youTube ? c.youTube.url : null,
      linkedin: c.linkedin ? c.linkedin.handle : null,
    },
  }));
  return { landscape_id: match.id, landscape_name: match.name, matched_by: matchedBy, focus_company_id: match.focusCompanyId, client_company_id: clientMatches[0].id, selected_company_ids: selectedMatchesIn(match).flat().map((c: Any) => c.id), companies };
}

/** How many times the readiness is checked (once a minute) before a still-collecting landscape fails the try. */
export const READINESS_CHECKS = 30;

/** Check RivalIQ Readiness: 1 ready, 2 still collecting; runIndex is the checks already made. */
export function checkReadiness(status: unknown, runIndex: number) {
  if (status !== 1 && status !== 2) {
    throw new Error("RivalIQ did not return a valid data-readiness status. No analysis was started.");
  }
  if (status === 2 && runIndex >= READINESS_CHECKS) {
    throw new Error("RivalIQ is still collecting source data after 30 minutes. Retry this report after tracking has finished; no incomplete figures were released.");
  }
  return { status, ready: status === 1, checks: runIndex + 1 };
}

export interface PostWindow { landscape_id: Any; mainPeriodStart: string; mainPeriodEnd: string; window_index: number }

/**
 * Build Post Windows: RivalIQ caps socialposts per call, so the period is
 * asked for in windows of at most 7 days, one call per window, in order (the
 * account allows one concurrent call).
 */
export function buildPostWindows(cfg: Pick<RunConfig, "range_start" | "range_end">, landscapeId: Any): PostWindow[] {
  const start = new Date(cfg.range_start + "T00:00:00Z");
  const end = new Date(cfg.range_end + "T00:00:00Z");
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) throw new Error("Invalid date range: " + cfg.range_start + " to " + cfg.range_end);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const windows: PostWindow[] = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    const stop = new Date(Math.min(cursor.getTime() + 6 * DAY, end.getTime()));
    windows.push({ landscape_id: landscapeId, mainPeriodStart: fmt(cursor), mainPeriodEnd: fmt(stop), window_index: windows.length });
    cursor = new Date(stop.getTime() + DAY);
  }
  if (windows.length > 60) throw new Error("Range too long for a single run (" + windows.length + " windows)");
  return windows;
}

/** The posts RivalIQ returns per call at most (limit=500); a page that reaches it may be missing posts. */
export const POSTS_PAGE_LIMIT = 500;

/**
 * Merge Post Pages: one socialposts answer from the windows, shaped like a
 * single RivalIQ response, each post once, with the windows that never
 * arrived and the pages that reached the limit counted.
 */
export function mergePostPages(pages: Any[], expectedWindows: number) {
  const failed_windows = Math.max(0, expectedWindows - pages.length);
  const seen = new Set<string>();
  const socialPosts: Any[] = [];
  let truncated_pages = 0;
  for (const json of pages) {
    const list = json?.socialPosts || json?.posts || json?.data || (Array.isArray(json) ? json : []);
    if (list.length >= POSTS_PAGE_LIMIT) truncated_pages += 1;
    for (const p of list) {
      const key = String(p.postId ?? p.postLink ?? p.nativeId ?? JSON.stringify([p.companyId, p.publishedAt, p.message]));
      if (seen.has(key)) continue;
      seen.add(key);
      socialPosts.push(p);
    }
  }
  return { socialPosts, pages: pages.length, expected_windows: expectedWindows, failed_windows, truncated_pages, page_limit: POSTS_PAGE_LIMIT };
}

/**
 * Merge Owned Posts: the client's posts from its assigned Sprout profiles
 * replace the public copies of the same networks; other client networks
 * stay. collected is what competitive-owned-source answers (the client id
 * and collectOwnedCompetitive's result).
 */
export function mergeOwnedPosts(cfg: RunConfig, landscape: Any, collected: Any, input: Any) {
  if (collected.client_id !== cfg.client_id || collected.period?.start !== cfg.range_start || collected.period?.end !== cfg.range_end) throw new Error("Owned social source identity or period does not match this report");
  if (!["complete", "not_connected"].includes(collected.coverage)) throw new Error("Owned client source is incomplete");
  const company = { id: String(landscape.client_company_id), name: cfg.client_name };
  return {
    ...input,
    socialPosts: mergeOwnedCompetitivePosts(input.socialPosts || [], collected, company),
    owned_profiles: collected.profiles,
    owned_metrics: collected.metrics ? { [company.id]: collected.metrics } : {},
    owned_source: { client_id: collected.client_id, coverage: collected.coverage, period: collected.period, collected_at: collected.collected_at, profiles: collected.profiles },
  };
}

/** Text the database and the page can hold: lone surrogates out, control characters as spaces. */
function sanitizeStr(s: unknown): string {
  return String(s)
    .replace(/[\ud800-\udbff](?![\udc00-\udfff])/g, "")
    .replace(/(^|[^\ud800-\udbff])[\udc00-\udfff]/g, "$1")
    .replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u")
    // deno-lint-ignore no-control-regex
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\b\u000b\f\u000e-\u001f]/g, " ");
}
function sanitize(v: Any): Any {
  if (typeof v === "string") return sanitizeStr(v);
  if (Array.isArray(v)) return v.map(sanitize);
  if (v && typeof v === "object") { const o: Any = {}; for (const k of Object.keys(v)) o[sanitizeStr(k)] = sanitize(v[k]); return o; }
  return v;
}

/** Assemble Report Data: the stored report_data and the run's length in minutes. */
export function assembleReportData(a: { landscape: Any; aggregates: Any; pages: number; analysis: Any; startedAt: string; now: Date }) {
  const durationMinutes = Math.max(1, Math.round((a.now.getTime() - new Date(a.startedAt).getTime()) / 60000));
  const reportData = sanitize(normalizedCompetitiveMetrics({
    source: "rivaliq",
    provider_status: 1,
    landscape: { id: a.landscape.landscape_id, name: a.landscape.landscape_name, matched_by: a.landscape.matched_by, focus_company_id: a.landscape.focus_company_id, companies: a.landscape.companies },
    period: a.aggregates.period,
    // rivaliq_calls: landscapes list + status + companies + one socialposts call per weekly window.
    totals: { posts_analyzed: a.aggregates.total_posts_analyzed, post_windows: a.pages, rivaliq_calls: 3 + a.pages },
    aggregates: a.aggregates,
    ai_analysis: a.analysis,
    generated_at: a.now.toISOString(),
    schema_note: a.aggregates.schema_note || "",
  }));
  return { report_data: JSON.parse(JSON.stringify(reportData)), duration_minutes: durationMinutes };
}
