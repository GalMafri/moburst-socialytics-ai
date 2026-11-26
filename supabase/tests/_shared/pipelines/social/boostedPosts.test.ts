// 26 Nov 2026 (Lital): the team may not boost posts, but a client may, from its own ad account. Sprout's API carries
// no ad-account data, and it flags a boosted post (is_boosted, Facebook and TikTok) without saying whether its figures
// hold the paid reach. The monthly report now asks for the flag and marks boosted posts. Their figures stay Sprout's
// totals, so a boosted post's engagement rate is never engagements with the boost over impressions without it.
import { describe, expect, it, vi } from "vitest";
import { MOBURST, moburstPages, moburstRequest } from "../../../../fixtures/pipelines/social";
import { aggregateSprout, workflowConfiguration } from "../../../../functions/_shared/pipelines/social/nodes";
import { BOOSTED_FIELD, readSprout, sproutRequests, type SproutReader } from "../../../../functions/_shared/pipelines/social/providers";

// deno-lint-ignore no-explicit-any
type Any = any;

describe("the Sprout read asks for the boosted flag", () => {
  const setup = { profile_ids: ["1"], current_month_start: "2026-11-01", current_month_end: "2026-11-30", previous_month_start: "2026-10-01", previous_month_end: "2026-10-31" };

  it("on the month's posts", () => {
    const r = sproutRequests(setup, { timezone: "UTC" });
    expect(r.posts.body.fields).toContain(BOOSTED_FIELD);
    expect(r.posts.body.metrics).toEqual(expect.arrayContaining(["lifetime.impressions_organic"]));
  });

  it("is asked once more without the flag when Sprout refuses it, and the posts still come", async () => {
    const asked: Array<Record<string, unknown>> = [];
    const reader: SproutReader = { pages: vi.fn(async (_path, body) => {
      asked.push(body);
      if ((body.fields as string[]).includes(BOOSTED_FIELD)) throw new Error('Sprout posts answered 400: {"error":"invalid field"}');
      return [{ data: [] }];
    }) };
    const req = sproutRequests(setup, { timezone: "UTC" }).posts;
    expect(await readSprout(reader, req)).toEqual([{ data: [] }]);
    expect(asked).toHaveLength(2);
    expect(asked[1].fields).not.toContain(BOOSTED_FIELD);
  });

  it("lets any other failure through as before", async () => {
    const reader: SproutReader = { pages: vi.fn(async () => { throw new Error("Sprout posts answered 500: down"); }) };
    await expect(readSprout(reader, sproutRequests(setup, { timezone: "UTC" }).posts)).rejects.toThrow("answered 500");
    expect(reader.pages).toHaveBeenCalledTimes(1);
  });
});

describe("the report marks boosted posts", () => {
  const pages = moburstPages();
  const base = pages.posts[0].data[0];
  const row = (id: number, over: Record<string, unknown>, metrics: Record<string, unknown> = {}) => ({
    ...base, guid: `g${id}`, perma_link: `https://example.com/p/${id}`, ...over, metrics: { ...base.metrics, "lifetime.impressions": 5000, ...metrics },
  });
  const run = (data: Any[]): Any => aggregateSprout({
    pages: { ...pages, posts: [{ ...pages.posts[0], data }] }, combined: MOBURST.combine,
    config: workflowConfiguration(moburstRequest(), new Date("2026-10-01T10:00:00.000Z")), setup: MOBURST.sprout_setup,
  });
  const byUrl = (out: Any) => new Map((Object.values(out.top_posts_by_platform_impressions).flat() as Any[]).map((p) => [p.url, p]));

  it("marks a boosted post and keeps its figures as Sprout gives them", () => {
    const out = run([
      row(1, { is_boosted: true }, { "lifetime.impressions_organic": 1200, "lifetime.impressions_paid": 3800 }),
      // A boosted TikTok post: Sprout gives no organic split, so the total stays and the post is only marked.
      row(2, { is_boosted: true }, { "lifetime.impressions_organic": undefined }),
      row(3, {}, { "lifetime.impressions_organic": 4000 }),
    ]);
    const posts = byUrl(out);
    expect(posts.get("https://example.com/p/1")).toMatchObject({ boosted: true, impressions: 5000 });
    expect(posts.get("https://example.com/p/2")).toMatchObject({ boosted: true, impressions: 5000 });
    expect(posts.get("https://example.com/p/3")).toMatchObject({ impressions: 5000 });
    expect(posts.get("https://example.com/p/3")).not.toHaveProperty("boosted");
    expect(out.boosted_posts).toBe(2);
  });

  it("reads as before when Sprout sent no flag", () => {
    const out = run([row(1, {}), row(2, {})]);
    expect(out.boosted_posts).toBe(0);
    expect([...byUrl(out).values()].some((p: Any) => p.boosted)).toBe(false);
  });
});
