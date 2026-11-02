// @vitest-environment node
import { describe, expect, it } from "vitest";
import { listBrandPosts, SproutPostsError } from "./posts";

const SINCE = new Date("2026-08-04T06:00:00Z");
const UNTIL = new Date("2026-11-02T06:00:00Z");

function sprout(pages: Array<Record<string, unknown>>, status = 200) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    if (status !== 200) return new Response(`{"error":"Bearer abc.def is not allowed"}`, { status });
    return new Response(JSON.stringify(pages[Number(body.page) - 1] ?? { data: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("listBrandPosts", () => {
  it("asks Sprout's analytics/posts for the brand's profiles over the window, with the post text, page by page", async () => {
    const { calls, fetchImpl } = sprout([
      { data: [{ text: "Order online https://olo.com", created_time: "2026-10-01T10:00:00Z", perma_link: "https://instagram.com/p/1", customer_profile_id: 7 }], paging: { current_page: 1, total_pages: 2 } },
      { data: [{ text: "Second", created_time: "2026-09-01T10:00:00Z", dimensions: { customer_profile_id: 8 } }], paging: { current_page: 2, total_pages: 2 } },
    ]);
    const slept: number[] = [];
    const posts = await listBrandPosts(["7", "8"], { since: SINCE, until: UNTIL, customerId: "1676448", fetchImpl, token: async () => "tok", sleep: async (ms) => { slept.push(ms); } });
    expect(posts).toEqual([
      { text: "Order online https://olo.com", created_time: "2026-10-01T10:00:00Z", perma_link: "https://instagram.com/p/1", profile_id: "7" },
      { text: "Second", created_time: "2026-09-01T10:00:00Z", perma_link: null, profile_id: "8" },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("https://api.sproutsocial.com/v1/1676448/analytics/posts");
    expect(calls[0].headers).toMatchObject({ Authorization: "Bearer tok" });
    expect(calls[0].body).toMatchObject({
      filters: ["customer_profile_id.eq(7, 8)", "created_time.in(2026-08-04T00:00:00...2026-11-02T23:59:59)"],
      fields: expect.arrayContaining(["text", "created_time", "perma_link", "customer_profile_id"]), timezone: "UTC", page: 1, limit: 50,
    });
    expect(slept).toEqual([200]);
  });
  it("stops after three pages, and asks nothing for a brand with no profiles", async () => {
    const page = { data: [{ text: "x" }], paging: { current_page: 1, total_pages: 9 } };
    const { calls, fetchImpl } = sprout([page, page, page, page]);
    expect(await listBrandPosts(["7"], { since: SINCE, until: UNTIL, fetchImpl, token: async () => "t", sleep: async () => {} })).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(await listBrandPosts([], { since: SINCE, until: UNTIL, fetchImpl, token: async () => "t" })).toEqual([]);
    expect(calls).toHaveLength(3);
  });
  it("throws Sprout's refusal with its status, the token never in the detail", async () => {
    const { fetchImpl } = sprout([], 429);
    const err = await listBrandPosts(["7"], { since: SINCE, until: UNTIL, fetchImpl, token: async () => "t" }).catch((e) => e);
    expect(err).toBeInstanceOf(SproutPostsError);
    expect(err).toMatchObject({ status: 429 });
    expect(err.detail).not.toMatch(/abc\.def/);
  });
});
