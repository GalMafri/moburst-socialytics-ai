// Replay: the in-app competitive pipeline run again on a past report's saved
// RivalIQ answers, so it can be compared with what n8n made.
//
// n8n saves what it read for every report attempt in rivaliq_snapshots
// (Cache Status / Companies / Metrics / Posts Snapshot, through
// update-competitive-report): the readiness status, the landscape's
// companies, the four metrics answers, and the posts after the LinkedIn and
// Sprout collections were merged in (with the LinkedIn figures and the
// client's Sprout figures). A replay reads those and nothing else: no
// RivalIQ, Apify or Sprout call is made. The posts are taken apart by
// source (RivalIQ's carry none, LinkedIn's "apify/harvestapi", the
// client's own "sprout") and put back together by the same merge code the
// live run uses, so everything from the merge on is the code a live run
// runs. The only paid call is the analysis (Claude), and with
// reuse_analysis the real report's analysis is used instead, for a figures
// comparison that costs nothing.
//
// What a replay takes from outside the snapshots: the landscape's name,
// focus company and how it was matched (stored on the real report), and the
// request n8n got, which is not stored anywhere: it is built again from the
// competitor set, its handles and the team's feedback as they are now
// (buildCompetitivePayload), so a selection or feedback changed since the
// report was made shows up as a difference.

import { checkReadiness, mergeOwnedPosts, resolveLandscape, type RunConfig } from "./nodes.ts";

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
type Db = any;

/** What a replay run carries in its input (input.replay). */
export interface ReplayInput {
  report_id: string;
  /** The attempt whose snapshots are read; null for reports saved before attempts were recorded. */
  attempt_started_at: string | null;
  landscape: { id: Any; name: string | null; focus_company_id: Any; matched_by: string | null };
  /** Use the real report's analysis instead of asking Claude: a figures comparison with no paid call. */
  reuse_analysis?: boolean;
}

export const REPLAY_ENDPOINTS = ["status", "companies", "metrics", "socialposts"] as const;
export type ReplaySnapshots = Record<(typeof REPLAY_ENDPOINTS)[number], Any> & { landscape_id: string };

export const sameInstant = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && Date.parse(String(a)) === Date.parse(String(b)));

/** The newest snapshot of each endpoint the attempt saved; throws when one is missing. */
export function pickReplaySnapshots(rows: Array<{ endpoint: string; landscape_id: string; payload: Any; fetched_at?: string; attempt_started_at: string | null }>, attempt: string | null): ReplaySnapshots {
  const mine = rows.filter((r) => sameInstant(r.attempt_started_at, attempt)).sort((a, b) => String(b.fetched_at ?? "").localeCompare(String(a.fetched_at ?? "")));
  const out: Record<string, Any> = {};
  for (const endpoint of REPLAY_ENDPOINTS) {
    const row = mine.find((r) => r.endpoint === endpoint);
    if (!row) throw new Error(`The report has no saved ${endpoint} answer for this attempt, so it cannot be replayed.`);
    out[endpoint] = row.payload;
    out.landscape_id ??= String(row.landscape_id);
  }
  return out as ReplaySnapshots;
}

/** The attempt to replay: the report's own (its created_at), else the snapshots saved before attempts were recorded. */
export function replayAttempt(rows: Array<{ endpoint: string; attempt_started_at: string | null }>, createdAt: string): string | null {
  const has = (attempt: string | null) => REPLAY_ENDPOINTS.every((e) => rows.some((r) => r.endpoint === e && sameInstant(r.attempt_started_at, attempt)));
  if (has(createdAt)) return createdAt;
  if (has(null)) return null;
  throw new Error("The report's saved RivalIQ answers are incomplete (status, companies, metrics and posts are all needed), so it cannot be replayed.");
}

export async function loadReplaySnapshots(db: Db, replay: Pick<ReplayInput, "report_id" | "attempt_started_at">): Promise<ReplaySnapshots> {
  const { data, error } = await db.from("rivaliq_snapshots").select("endpoint, landscape_id, payload, fetched_at, attempt_started_at").eq("report_id", replay.report_id);
  if (error) throw new Error(`The saved RivalIQ answers could not be read: ${error.message}`);
  return pickReplaySnapshots(data ?? [], replay.attempt_started_at);
}

const LINKEDIN_SOURCE = "apify/harvestapi";
const isLinkedIn = (p: Any) => p?.source === LINKEDIN_SOURCE;
const isOwned = (p: Any) => p?.source === "sprout" || String(p?.postId || "").startsWith("sprout:");

/**
 * Everything the live steps would have put in the run's payload store up to
 * Merge Owned Posts, from the snapshots: the landscape, the RivalIQ answers,
 * the merged post pages, the LinkedIn merge and the owned merge.
 */
export function replaySources(cfg: RunConfig, body: Any, snaps: ReplaySnapshots, replay: ReplayInput) {
  const status = snaps.status?.status;
  checkReadiness(status, 0);
  if (status !== 1) throw new Error("The saved readiness status says RivalIQ was still collecting; that attempt has no report to replay.");
  const landscapeId = replay.landscape.id ?? snaps.landscape_id;
  const resolved = resolveLandscape({ ...cfg, landscape_hint: String(landscapeId) }, body, {
    landscapes: [{ id: landscapeId, name: replay.landscape.name, focusCompanyId: replay.landscape.focus_company_id, companies: snaps.companies?.companies ?? [] }],
  });
  // The landscape the report was made on, matched as it was then.
  const landscape = { ...resolved, matched_by: replay.landscape.matched_by ?? resolved.matched_by };
  const saved = snaps.socialposts ?? {};
  const all: Any[] = Array.isArray(saved.socialPosts) ? saved.socialPosts : [];
  const rivalPosts = all.filter((p) => !isLinkedIn(p) && !isOwned(p));
  const rival = { socialPosts: rivalPosts, pages: saved.pages, expected_windows: saved.expected_windows, failed_windows: saved.failed_windows, truncated_pages: saved.truncated_pages, page_limit: saved.page_limit };
  const linkedin = {
    ...rival,
    socialPosts: [...rivalPosts, ...all.filter(isLinkedIn)],
    additional_metrics: saved.additional_metrics ?? {},
    linkedin_sources: saved.linkedin_sources ?? [],
    linkedin_posts: saved.linkedin_posts ?? all.filter(isLinkedIn).length,
  };
  const owned = saved.owned_source;
  const collected = owned
    ? { client_id: owned.client_id, coverage: owned.coverage, period: owned.period, collected_at: owned.collected_at, profiles: owned.profiles ?? saved.owned_profiles ?? [], posts: all.filter(isOwned), metrics: saved.owned_metrics?.[String(landscape.client_company_id)] ?? null }
    // Saved before the client's Sprout profiles were collected (30 Sep 2026): as a client with none connected.
    : { client_id: cfg.client_id, coverage: "not_connected", profiles: [], posts: [], metrics: null, period: { start: cfg.range_start, end: cfg.range_end } };
  const merged = mergeOwnedPosts(cfg, landscape, collected, linkedin);
  return {
    landscape,
    companies: snaps.companies,
    metrics: { summary: snaps.metrics?.summary, previous: snaps.metrics?.summary_previous, timeseries: snaps.metrics?.timeseries, audience: snaps.metrics?.audience_snapshot },
    rival,
    linkedin,
    collected,
    merged,
  };
}
