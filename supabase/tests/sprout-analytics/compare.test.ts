// @vitest-environment node
// sprout-analytics: a caller that adds windows together (All time) asks for no
// comparison, and then no previous-period read is made (QA AT-16); top posts
// come back with their picture and the figure they are ranked on (AT-04, AT-05).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Sprout answers untyped JSON.
type Any = any;

const g = globalThis as Any;
const profileRows = [{ sprout_profile_id: 1, profile_name: "Brand", native_name: "Brand", network_type: "linkedin_company" }];
vi.mock("../../functions/_shared/supabase", () => ({
  createClient: () => ({
    from: (table: string) => {
      const q: Any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: { id: "c1", name: "Brand", sprout_customer_id: "42" }, error: null }),
        then: (res: Any, rej: Any) => Promise.resolve({ data: table === "sprout_profiles" ? profileRows : [], error: null }).then(res, rej),
      };
      return q;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
let sproutCalls: Array<{ path: string; body: Any }>;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  sproutCalls = [];
  const env: Record<string, string> = { SOCIALYTICS_N8N_SECRET: "s", SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", SPROUT_CLIENT_ID: "i", SPROUT_CLIENT_SECRET: "c" };
  g.Deno = { env: { get: (k: string) => env[k] }, serve: (h: Any) => { handler = h; } };
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("identity.sproutsocial.com")) return new Response(JSON.stringify({ access_token: "t" }));
    const body = JSON.parse(String(init?.body));
    const path = String(url).split("/v1/")[1].split("/").slice(1).join("/");
    sproutCalls.push({ path, body });
    if (path === "analytics/posts") {
      return new Response(JSON.stringify({ data: [{ perma_link: "https://example.com/p/1", created_time: "2026-09-02T00:00:00Z", dimensions: { customer_profile_id: 1 }, metrics: { "lifetime.impressions": 9 }, visual_media: [{ media_type: "PHOTO", thumbnail_url: "https://cdn.example.com/a.jpg" }] }] }));
    }
    const day = String(body.filters[1]).match(/in\((\d{4}-\d{2}-\d{2})\./)![1];
    return new Response(JSON.stringify({ data: [{ dimensions: { "reporting_period.by(day)": day, customer_profile_id: 1 }, metrics: { impressions: 3 } }], paging: { total_pages: 1 } }));
  }) as typeof fetch;
  vi.resetModules();
  await import("../../functions/sprout-analytics/index");
});
afterEach(() => { globalThis.fetch = realFetch; delete g.Deno; });

const ask = async (extra: Any = {}) => {
  const r = await handler(new Request("http://x", { method: "POST", headers: { "x-socialytics-secret": "s" }, body: JSON.stringify({ client_id: "c1", start: "2026-09-01", end: "2026-09-30", ...extra }) }));
  return { status: r.status, body: await r.json() };
};
const profileReads = () => sproutCalls.filter((c) => c.path === "analytics/profiles");

describe("sprout-analytics", () => {
  it("compare false makes no previous-period read and says so", async () => {
    const { status, body } = await ask({ compare: false });
    expect(status).toBe(200);
    expect(profileReads()).toHaveLength(1);
    expect(body).toMatchObject({ previous_range: null, previous_totals: null, changes: {} });
  });

  it("by default it still reads the period before and compares", async () => {
    const { body } = await ask();
    expect(profileReads()).toHaveLength(2);
    expect(body.previous_range).toMatchObject({ start: "2026-08-02", end: "2026-08-31" });
    expect(body.changes.impressions).toBeDefined();
  });

  it("returns each top post with its picture and the figure it is ranked on", async () => {
    const { body } = await ask();
    expect(sproutCalls.find((c) => c.path === "analytics/posts")!.body.fields).toContain("visual_media");
    expect(body.top_posts[0]).toMatchObject({ thumbnail_url: "https://cdn.example.com/a.jpg", media_type: "PHOTO", reach: 9, network_type: "linkedin_company" });
    expect(body.top_posts_failed_networks).toEqual([]);
  });
});
