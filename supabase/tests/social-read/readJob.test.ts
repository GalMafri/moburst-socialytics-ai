// @vitest-environment node
// One public profile read as a social_read job: profile check, then posts,
// then stored rows; an unconfirmed profile is not read; a failed run is
// started again and then recorded as failed, never as "no posts"; no token
// means no read.
import { describe, expect, it } from "vitest";
import { ApifyTokenMissing, type ApifyClient, type ApifyRun } from "../../functions/_shared/apify/client";
import { engagementOf, FIRST_READ_DAYS, runSocialRead, RUN_RETRIES, WEEKLY_READ_DAYS } from "../../functions/social-read/readJob";
import type { JobOutcome, ScheduledJob } from "../../functions/_shared/scheduled-jobs/types";
import { memDb } from "./memDb";

const NOW = new Date("2026-11-26T10:00:00.000Z");

function fakeApify(script: Record<string, { status: string; items: unknown[]; usd?: number }[]>) {
  const started: Array<{ actor: string; input: unknown }> = [];
  const runs = new Map<string, { status: string; items: unknown[]; usd?: number }>();
  const client: ApifyClient = {
    async startRun(actor, input) {
      started.push({ actor, input });
      const next = script[actor]?.shift() ?? { status: "SUCCEEDED", items: [] };
      const id = `run-${started.length}`;
      runs.set(id, next);
      return { id, status: "RUNNING", defaultDatasetId: `ds-${id}` } as ApifyRun;
    },
    async getRun(id) {
      const r = runs.get(id)!;
      return { id, status: r.status, defaultDatasetId: `ds-${id}`, usageTotalUsd: r.usd ?? 0.01 } as ApifyRun;
    },
    async datasetPage() { return []; },
    async datasetItems(ds) { return runs.get(ds.replace(/^ds-/, ""))!.items; },
  };
  return { client, started };
}

function setup(profile: Record<string, unknown> = {}, extra: Record<string, Record<string, unknown>[]> = {}) {
  return memDb({
    clients: [{ id: "c1", name: "Client", website_url: "https://client.com" }],
    competitors: [{ id: "k1", name: "Brand Co", website_url: "https://brand.com" }],
    competitor_handles: [{ competitor_id: "k1", platform: "instagram", handle: "brand", detection_confidence: 0.95, source: "auto" }],
    social_profiles: [{ id: "p1", client_id: "c1", competitor_id: "k1", platform: "instagram", handle: "brand", url: "https://www.instagram.com/brand/", handle_source: "auto", active: true, confirmed: null, ...profile }],
    ...extra,
  });
}

const job = (payload: Record<string, unknown>, id = "j1"): ScheduledJob => ({ id, kind: "social_read", client_id: "c1", payload, attempts: 1, max_attempts: 3 } as unknown as ScheduledJob);

/** Runs the job, feeding each outcome's payload back in, until it ends. */
async function drive(db: unknown, apify: ApifyClient, now = NOW) {
  let payload: Record<string, unknown> = { profile_id: "p1" };
  const outcomes: JobOutcome[] = [];
  for (let i = 0; i < 12; i++) {
    const out = await runSocialRead(db, job(payload), { now: () => new Date(now.getTime() + i * 3 * 60_000), apify: () => apify });
    outcomes.push(out);
    if (out.status !== "queued") break;
    payload = out.payload as Record<string, unknown>;
  }
  return outcomes;
}

const profileItem = { username: "brand", fullName: "Brand Co", externalUrl: "https://brand.com", followersCount: 1500 };
const post = (id: string, at: string, likes = 10) => ({ id, type: "Image", url: `https://www.instagram.com/p/${id}/`, likesCount: likes, commentsCount: 2, timestamp: at, ownerUsername: "brand" });

describe("runSocialRead", () => {
  it("checks the profile, reads 90 days of posts on the first read and stores them", async () => {
    const m = setup();
    const { client, started } = fakeApify({
      "apify~instagram-profile-scraper": [{ status: "SUCCEEDED", items: [profileItem], usd: 0.002 }],
      "apify~instagram-post-scraper": [{ status: "SUCCEEDED", items: [post("a", "2026-11-20T10:00:00.000Z"), post("b", "2026-10-01T10:00:00.000Z", -1), post("old", "2026-08-01T10:00:00.000Z")], usd: 0.004 }],
    });
    const outcomes = await drive(m.db, client);
    expect(outcomes.map((o) => o.status)).toEqual(["queued", "queued", "done"]);
    expect(outcomes.slice(0, 2).every((o) => o.deferred)).toBe(true);
    expect(started.map((s) => s.actor)).toEqual(["apify~instagram-profile-scraper", "apify~instagram-post-scraper"]);
    const since = new Date(NOW.getTime() - FIRST_READ_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(started[1].input).toMatchObject({ onlyPostsNewerThan: since, resultsLimit: 150 });
    expect(m.rows("social_posts").map((p) => p.post_key).sort()).toEqual(["a", "b"]);
    expect(m.rows("social_post_metrics").map((x) => x.engagement).sort()).toEqual([12, null]);
    const read = m.rows("social_reads")[0];
    expect(read).toMatchObject({ status: "done", posts: 2, followers: 1500, usd: 0.006 });
    expect(m.rows("social_profiles")[0]).toMatchObject({ confirmed: true, confirmed_reason: "links_brand_site", followers: 1500, last_read_status: "done", display_name: "Brand Co" });
    expect(m.rows("social_profile_snapshots")).toEqual([expect.objectContaining({ profile_id: "p1", day: "2026-11-26", followers: 1500 })]);
  });

  it("reads 14 days once the profile has a read, and adds a second counts row to a post read before", async () => {
    const m = setup({ confirmed: true }, { social_reads: [{ id: "r0", profile_id: "p1", client_id: "c1", status: "done" }] });
    const { client, started } = fakeApify({
      "apify~instagram-profile-scraper": [{ status: "SUCCEEDED", items: [profileItem] }, { status: "SUCCEEDED", items: [profileItem] }],
      "apify~instagram-post-scraper": [{ status: "SUCCEEDED", items: [post("a", "2026-11-20T10:00:00.000Z", 10)] }, { status: "SUCCEEDED", items: [post("a", "2026-11-20T10:00:00.000Z", 30)] }],
    });
    await drive(m.db, client);
    await drive(m.db, client, new Date(NOW.getTime() + 7 * 86_400_000));
    const since = new Date(NOW.getTime() - WEEKLY_READ_DAYS * 86_400_000).toISOString().slice(0, 10);
    expect(started[1].input).toMatchObject({ onlyPostsNewerThan: since, resultsLimit: 60 });
    expect(m.rows("social_posts")).toHaveLength(1);
    expect(m.rows("social_post_metrics").map((x) => x.likes)).toEqual([10, 30]);
  });

  it("does not read an unconfirmed profile, and says why", async () => {
    const m = setup({}, { competitor_handles: [{ competitor_id: "k1", platform: "instagram", handle: "brand", detection_confidence: 0.6, source: "auto" }] });
    const { client, started } = fakeApify({ "apify~instagram-profile-scraper": [{ status: "SUCCEEDED", items: [{ ...profileItem, externalUrl: "https://elsewhere.com" }] }] });
    const outcomes = await drive(m.db, client);
    expect(outcomes.at(-1)).toMatchObject({ status: "done", result: { confirmed: false, reason: "no_link_to_brand" } });
    expect(started).toHaveLength(1);
    expect(m.rows("social_reads")[0]).toMatchObject({ status: "not_confirmed", reason: "no_link_to_brand" });
    expect(m.rows("social_profiles")[0]).toMatchObject({ confirmed: false, confirmed_reason: "no_link_to_brand", last_read_status: "not_confirmed" });
    expect(m.rows("social_posts")).toHaveLength(0);
  });

  it("starts a failed run again, then records the read as failed, never as no posts", async () => {
    const m = setup({ confirmed: true, handle_source: "manual" });
    const failed = { status: "FAILED", items: [] };
    const { client, started } = fakeApify({
      "apify~instagram-profile-scraper": [{ status: "SUCCEEDED", items: [profileItem] }],
      "apify~instagram-post-scraper": Array.from({ length: RUN_RETRIES + 1 }, () => ({ ...failed })),
    });
    const outcomes = await drive(m.db, client);
    expect(started.filter((s) => s.actor === "apify~instagram-post-scraper")).toHaveLength(RUN_RETRIES + 1);
    expect(outcomes.at(-1)).toMatchObject({ status: "done", result: { failed: "posts_run_failed" } });
    expect(m.rows("social_reads")[0]).toMatchObject({ status: "failed", reason: "posts_run_failed", posts: null });
    expect(m.rows("social_profiles")[0]).toMatchObject({ last_read_status: "failed" });
  });

  it("takes a profile still missing after the retries as not there", async () => {
    const m = setup();
    const { client } = fakeApify({ "apify~instagram-profile-scraper": Array.from({ length: RUN_RETRIES + 1 }, () => ({ status: "SUCCEEDED", items: [{ error: "not_found" }] })) });
    const outcomes = await drive(m.db, client);
    expect(outcomes.at(-1)).toMatchObject({ status: "done", result: { confirmed: false, reason: "profile_not_found" } });
  });

  it("skips the read without an Apify token, with nothing started", async () => {
    const m = setup();
    const out = await runSocialRead(m.db, job({ profile_id: "p1" }), { now: () => NOW, apify: () => { throw new ApifyTokenMissing(); } });
    expect(out).toMatchObject({ status: "skipped", reason: "no_apify_token" });
    expect(m.rows("social_reads")).toHaveLength(0);
  });

  it("skips a profile no longer read", async () => {
    const m = setup({ active: false });
    const { client, started } = fakeApify({});
    expect((await runSocialRead(m.db, job({ profile_id: "p1" }), { now: () => NOW, apify: () => client })).status).toBe("skipped");
    expect(started).toHaveLength(0);
  });

  it("engagement is unknown when likes are hidden", () => {
    expect(engagementOf({ likes: null, comments: 4, shares: null })).toBeNull();
    expect(engagementOf({ likes: 3, comments: 4, shares: null })).toBe(7);
  });
});
