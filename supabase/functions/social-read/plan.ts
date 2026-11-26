// supabase/functions/social-read/plan.ts
//
// Which profiles a round of reads covers, what it would cost, and (only
// when asked, never in a dry run) the social_read jobs that do it. Nothing
// calls this on a schedule in step 1 of the plan of 25 Nov 2026: the first
// 90-day read (step 2) is started by hand once Lital approves its spend, and
// the weekly cron comes with it. run-scheduled-jobs exposes it as
// POST {"mode":"social_reads"}, a dry run unless "dry_run": false is sent.
//
// A round covers every active client with a confirmed competitor set
// (demo and test clients left out). Each client's profiles are first kept in
// line with its handles (profiles.ts); then every active profile that is not
// known to be unconfirmed gets one job. An unconfirmed profile is checked
// again only when its handle or its source changes (a new row, or
// profiles.ts clearing its confirmation).

import { READABLE_SET_STATUSES } from "../_shared/strategy/competitorSet.ts";
import { type StoredProfile, syncSocialProfiles } from "./profiles.ts";
import type { SocialPlatform } from "./readers/index.ts";
import { FIRST_READ_DAYS, FIRST_READ_MAX_POSTS, WEEKLY_READ_DAYS, WEEKLY_READ_MAX_POSTS } from "./readJob.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

/** The planning pace of the plan (section 3): 30 posts a month per profile. */
export const PLANNING_POSTS_PER_MONTH = 30;

/**
 * Apify's published prices at Moburst's tier (Silver), read 25 Nov 2026
 * (plan, section 3), for the estimate only: the real cost of every run is
 * recorded through the paying desk. check: one profile record, where a price
 * was measured (Instagram's profile run, USD 0.002 in the strategy reads;
 * TikTok's one-post run); null where none was, counted apart.
 */
export const UNIT_PRICES: Record<SocialPlatform, { post: number; run: number; check: number | null }> = {
  instagram: { post: 0.0013, run: 0, check: 0.002 },
  facebook: { post: 0.0025 + 0.0008, run: 0.001, check: null },
  tiktok: { post: 0.0023, run: 0, check: 0.0023 },
  linkedin: { post: 0.00175, run: 0, check: null },
};

export interface PlannedRead {
  client_id: string;
  profile_id: string;
  platform: SocialPlatform;
  handle: string;
  first: boolean;
  usd: number;
}

export interface ReadRound {
  dry_run: boolean;
  at: string;
  clients: number;
  reads: PlannedRead[];
  /** Profiles not read: known unconfirmed, with their reasons. */
  unconfirmed: number;
  estimate: { usd: number; first_reads: number; weekly_reads: number; unpriced_checks: number; basis: string };
  queued: number;
}

/** The estimated cost of one read at the planning pace, the posts asked for capped as the read caps them. */
export function readEstimate(platform: SocialPlatform, first: boolean): { usd: number; unpricedCheck: boolean } {
  const p = UNIT_PRICES[platform];
  const days = first ? FIRST_READ_DAYS : WEEKLY_READ_DAYS;
  const posts = Math.min(first ? FIRST_READ_MAX_POSTS : WEEKLY_READ_MAX_POSTS, Math.ceil((PLANNING_POSTS_PER_MONTH * days) / 30));
  return { usd: posts * p.post + p.run + (p.check ?? 0), unpricedCheck: p.check === null };
}

/** The ISO week a read belongs to, for its job's dedupe key: one read per profile a week. */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The profiles a round reads: active, and not known to be unconfirmed. */
export const toRead = (profiles: StoredProfile[]) => profiles.filter((p) => p.active && p.confirmed !== false);

/** The clients a round covers: active, not a demo or test client, with a confirmed competitor set. */
export async function roundClients(db: Db, clientId?: string | null): Promise<string[]> {
  let q = db.from("competitor_sets").select("client_id, clients!inner(id, archived_at, demo_job_id, exclude_from_reporting)")
    .in("status", [...READABLE_SET_STATUSES]).is("clients.archived_at", null).is("clients.demo_job_id", null).eq("clients.exclude_from_reporting", false);
  if (clientId) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error) throw new Error(`Could not read the clients with a competitor set: ${error.message}`);
  return [...new Set(((data ?? []) as Array<{ client_id: string }>).map((r) => r.client_id))];
}

export async function planReadRound(db: Db, now: Date, o: { dryRun: boolean; clientId?: string | null }): Promise<ReadRound> {
  const clients = await roundClients(db, o.clientId);
  const reads: PlannedRead[] = [];
  let unconfirmed = 0;
  let unpriced = 0;
  for (const clientId of clients) {
    const { profiles, changes } = await syncSocialProfiles(db, clientId, now, { dryRun: o.dryRun });
    // A dry run counts the profiles syncing would add as profiles to read.
    const planned: StoredProfile[] = [
      ...profiles,
      ...(o.dryRun ? changes.insert.map((r, i) => ({ ...(r as unknown as StoredProfile), id: `new-${clientId}-${i}`, last_read_at: null, last_read_status: null, confirmed: (r.confirmed as boolean | undefined) ?? null })) : []),
    ];
    const deactivated = new Set(o.dryRun ? changes.update.filter((u) => u.patch.active === false).map((u) => u.id) : []);
    const ids = planned.map((p) => p.id).filter((id) => !id.startsWith("new-"));
    const done = new Set<string>();
    if (ids.length) {
      const { data, error } = await db.from("social_reads").select("profile_id").in("profile_id", ids).eq("status", "done");
      if (error) throw new Error(`Could not read the earlier reads: ${error.message}`);
      for (const r of (data ?? []) as Array<{ profile_id: string }>) done.add(r.profile_id);
    }
    for (const p of planned) {
      if (deactivated.has(p.id)) continue;
      if (p.active && p.confirmed === false) { unconfirmed++; continue; }
      if (!toRead([p]).length) continue;
      const first = !done.has(p.id);
      const e = readEstimate(p.platform, first);
      if (e.unpricedCheck) unpriced++;
      reads.push({ client_id: clientId, profile_id: p.id, platform: p.platform, handle: p.handle, first, usd: Math.round(e.usd * 10_000) / 10_000 });
    }
  }
  let queued = 0;
  if (!o.dryRun && reads.length) {
    const week = isoWeek(now);
    const rows = reads.map((r, i) => ({
      kind: "social_read", client_id: r.client_id, dedupe_key: `social_read:${r.profile_id}:${week}`, priority: 60,
      // Spread over a few minutes so one tick does not start every run at once.
      available_at: new Date(now.getTime() + Math.floor(i / 4) * 60_000).toISOString(), payload: { profile_id: r.profile_id },
    }));
    const { data, error } = await db.from("scheduled_jobs").upsert(rows, { onConflict: "dedupe_key", ignoreDuplicates: true }).select("id");
    if (error) throw new Error(`Could not queue the reads: ${error.message}`);
    queued = (data ?? []).length;
  }
  const usd = Math.round(reads.reduce((s, r) => s + r.usd, 0) * 100) / 100;
  return {
    dry_run: o.dryRun, at: now.toISOString(), clients: clients.length, reads, unconfirmed,
    estimate: {
      usd, first_reads: reads.filter((r) => r.first).length, weekly_reads: reads.filter((r) => !r.first).length, unpriced_checks: unpriced,
      basis: `${PLANNING_POSTS_PER_MONTH} posts a month per profile at Apify's published prices of 25 Nov 2026; Facebook and LinkedIn profile checks are not priced here`,
    },
    queued,
  };
}
