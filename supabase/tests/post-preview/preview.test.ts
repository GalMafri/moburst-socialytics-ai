/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles of the database and of Deno. */
// @vitest-environment node
// post-preview: what a report tile gets for a post link. The function is
// loaded with Deno.serve captured, the database replaced by a fake and the
// network by a recorder, so no page is fetched and nothing is stored.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// deno-lint-ignore no-explicit-any
type Any = any;
const g = globalThis as Any;
const NOW = new Date("2026-11-12T08:00:00.000Z");

interface World { cached: Any[]; upserts: Any[]; user: Any; staff: boolean; fetched: string[] }
let w: World;

function fakeDb() {
  return {
    auth: { getUser: async () => ({ data: { user: w.user } }) },
    // The staff check the function asks with the caller's own token.
    rpc: async (name: string) => ({ data: name === "is_moburst_staff" ? w.staff : null, error: null }),
    from(table: string) {
      return {
        select: () => ({ in: async () => ({ data: table === "post_previews" ? w.cached : [] }) }),
        upsert: async (rows: Any[]) => { w.upserts.push(...rows); return { error: null }; },
      };
    },
    storage: { from: () => ({ upload: async () => ({ error: { message: "no storage in the test" } }), getPublicUrl: () => ({ data: { publicUrl: null } }) }) },
  };
}

async function load() {
  vi.resetModules();
  vi.doMock("../../functions/_shared/supabase.ts", () => ({ createClient: () => fakeDb() }));
  let handler: (req: Request) => Promise<Response> = async () => new Response("no handler", { status: 500 });
  g.Deno = { env: { get: () => "x" }, serve: (h: typeof handler) => { handler = h; } };
  await import("../../functions/post-preview/index.ts");
  return handler;
}

const call = (h: (r: Request) => Promise<Response>, body: unknown, auth: string | null = "Bearer user-token") =>
  h(new Request("http://x/post-preview", { method: "POST", headers: auth ? { Authorization: auth } : {}, body: JSON.stringify(body) }));

const oauthToken = () => `h.${Buffer.from(JSON.stringify({ client_id: "claude-connector" })).toString("base64url")}.s`;

beforeEach(() => {
  w = { cached: [], upserts: [], user: { id: "u1" }, staff: true, fetched: [] };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", async (url: string) => { w.fetched.push(String(url)); return new Response("", { status: 404 }); });
});
afterEach(() => { delete g.Deno; vi.useRealTimers(); vi.unstubAllGlobals(); vi.doUnmock("../../functions/_shared/supabase.ts"); });

describe("post-preview", () => {
  it("needs a signed-in user, refuses the read-only connector's token and a session that is not valid", async () => {
    const h = await load();
    expect((await call(h, { urls: ["https://youtu.be/dQw4w9WgXcQ"] }, null)).status).toBe(401);
    expect((await call(h, { urls: ["https://youtu.be/dQw4w9WgXcQ"] }, `Bearer ${oauthToken()}`)).status).toBe(403);
    w.user = null;
    expect((await call(h, { urls: ["https://youtu.be/dQw4w9WgXcQ"] })).status).toBe(401);
  });

  it("makes a YouTube thumbnail from the video id with no fetch, and caches it", async () => {
    const h = await load();
    const res = await call(h, { posts: [{ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }] });
    const { previews } = await res.json();
    expect(previews["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]).toMatchObject({ platform: "youtube", media_type: "video", image_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", status: "ok" });
    expect(w.fetched).toEqual([]);
    expect(w.upserts).toHaveLength(1);
  });

  it("serves a cached preview younger than 30 days without resolving it again", async () => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    w.cached = [{ url, platform: "youtube", media_type: "video", image_url: "https://i.ytimg.com/vi/cached/hqdefault.jpg", title: null, status: "ok", fetched_at: new Date(NOW.getTime() - 5 * 86400000).toISOString() }];
    const h = await load();
    const { previews } = await (await call(h, { urls: [url] })).json();
    expect(previews[url].image_url).toBe("https://i.ytimg.com/vi/cached/hqdefault.jpg");
    expect(w.upserts).toEqual([]);
  });

  it("looks again at a miss older than an hour, and at once when the report now knows the picture", async () => {
    const url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    const miss = (ageMs: number) => [{ url, platform: "youtube", media_type: "unknown", image_url: null, title: null, status: "unavailable", fetched_at: new Date(NOW.getTime() - ageMs).toISOString() }];
    const h = await load();
    w.cached = miss(10 * 60000);
    expect((await (await call(h, { urls: [url] })).json()).previews[url].status).toBe("unavailable");
    expect(w.upserts).toEqual([]);
    w.cached = miss(2 * 3600000);
    expect((await (await call(h, { urls: [url] })).json()).previews[url].status).toBe("ok");
    w.upserts = [];
    w.cached = miss(10 * 60000);
    expect((await (await call(h, { posts: [{ url, image: "https://example.com/a.jpg" }] })).json()).previews[url].status).toBe("ok");
  });

  it("stores a staff member's creative for a post, and answers anyone else's for that one request only", async () => {
    const url = "https://www.instagram.com/p/abc123/";
    const image = "https://example.com/creative.jpg";
    const h = await load();
    w.staff = true;
    const staff = (await (await call(h, { posts: [{ url, image }] })).json()).previews[url];
    expect(staff).toMatchObject({ image_url: image, status: "ok" });
    expect(w.upserts).toHaveLength(1);
    expect(w.upserts[0]).toMatchObject({ url, image_url: image, status: "ok" });

    w.upserts = [];
    w.staff = false;
    const other = (await (await call(h, { posts: [{ url, image }] })).json()).previews[url];
    expect(other).toMatchObject({ image_url: image, status: "ok" });
    expect(w.upserts).toHaveLength(1);
    expect(w.upserts[0]).toMatchObject({ url, image_url: null, status: "unavailable" });
  });

  it("drops a link that points inside the network, and answers no previews when none is left", async () => {
    const h = await load();
    const res = await call(h, { urls: ["http://169.254.169.254/latest/meta-data", "http://localhost:54321/x", "file:///etc/passwd"] });
    expect(await res.json()).toEqual({ previews: {} });
    expect(w.fetched).toEqual([]);
  });

  it("takes at most 40 links in one call", async () => {
    const h = await load();
    const urls = Array.from({ length: 60 }, (_, i) => `https://www.youtube.com/watch?v=video${String(i).padStart(6, "0")}`);
    const { previews } = await (await call(h, { urls })).json();
    expect(Object.keys(previews)).toHaveLength(40);
  });
});
