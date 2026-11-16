import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// post-preview is a Deno.serve entry point, so the handler is captured from a
// stubbed Deno.serve and called with real Requests against a fake database.
const db = vi.hoisted(() => ({
  staff: true,
  upserts: [] as Array<Record<string, unknown>>,
  uploads: [] as string[],
  cached: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async () => ({ data: db.staff, error: null }),
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        in: async () => ({ data: db.cached }),
        eq: () => q,
        contains: () => q,
        order: () => q,
        limit: async () => ({ data: [] }),
        upsert: async (rows: Array<Record<string, unknown>>) => { db.upserts.push(...rows); return { error: null }; },
      };
      return q;
    },
    storage: {
      from: () => ({
        upload: async (path: string) => { db.uploads.push(path); return { error: null }; },
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://store.example/${path}` } }),
      }),
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
const fetched: string[] = [];

beforeEach(async () => {
  db.staff = true; db.upserts = []; db.uploads = []; db.cached = []; fetched.length = 0;
  vi.stubGlobal("Deno", {
    env: { get: (k: string) => (k === "SUPABASE_URL" ? "https://p.supabase.co" : "k") },
    serve: (h: typeof handler) => { handler = h; },
  });
  vi.stubGlobal("fetch", vi.fn(async (u: string) => {
    fetched.push(String(u));
    const url = String(u);
    if (url.startsWith("https://network-media.sproutsocial.com/")) return new Response(null, { status: 302, headers: { location: "https://media.licdn.com/dms/a.jpg" } });
    if (url.startsWith("https://media.licdn.com/") || url.startsWith("https://scontent.cdninstagram.com/")) return new Response(new Uint8Array(2000), { headers: { "content-type": "image/jpeg" } });
    return new Response("<html></html>", { headers: { "content-type": "text/html" } });
  }));
  // jsdom has no AbortSignal.timeout, and the function uses it on every fetch.
  if (!AbortSignal.timeout) (AbortSignal as unknown as { timeout: () => AbortSignal }).timeout = () => new AbortController().signal;
  vi.resetModules();
  await import("../../functions/post-preview/index.ts");
});
afterEach(() => vi.unstubAllGlobals());

const call = async (body: unknown) => {
  const r = await handler(new Request("https://f/post-preview", { method: "POST", headers: { Authorization: "Bearer abc.def.ghi" }, body: JSON.stringify(body) }));
  return (await r.json()) as { previews: Record<string, { status: string; image_url: string | null }> };
};

describe("post-preview durable copies", () => {
  const post = "https://www.linkedin.com/feed/update/urn:li:activity:123/";

  it("copies a Sprout network-media image into storage and returns the storage URL", async () => {
    const { previews } = await call({ posts: [{ url: post, image: "https://network-media.sproutsocial.com/abc" }] });
    expect(previews[post].image_url).toMatch(/^https:\/\/store\.example\/post-thumbnails\//);
    expect(previews[post].status).toBe("ok");
    expect(db.uploads).toHaveLength(1);
  });

  it("re-resolves a stored row that still points at Sprout's media host", async () => {
    db.cached = [{ url: post, status: "ok", image_url: "https://network-media.sproutsocial.com/abc", fetched_at: new Date().toISOString() }];
    const { previews } = await call({ url: post });
    expect(previews[post].image_url).toMatch(/^https:\/\/store\.example\//);
  });
});

describe("post-preview re-resolves a stored link that has expired", () => {
  const post = "https://www.facebook.com/brand/posts/123";
  const stale = "https://scontent.fbcdn.net/old.jpg";
  const fresh = "https://scontent.fbcdn.net/new.jpg";

  it("falls back to the page's own image when the stored link answers 403", async () => {
    db.cached = [{ url: post, status: "expiring", media_type: "image", image_url: stale, fetched_at: new Date(Date.now() - 2 * 3600000).toISOString() }];
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (u: string) => {
      fetched.push(String(u));
      if (u === stale) return new Response("no", { status: 403 });
      if (u === fresh) return new Response(new Uint8Array(2000), { headers: { "content-type": "image/jpeg" } });
      return new Response(`<html><meta property="og:image" content="${fresh}"></html>`, { headers: { "content-type": "text/html" } });
    });
    const { previews } = await call({ url: post });
    expect(previews[post].status).toBe("ok");
    expect(previews[post].image_url).toMatch(/^https:\/\/store\.example\/post-thumbnails\//);
    expect(fetched).toContain(stale);
    expect(fetched).toContain(fresh);
  });
});

describe("post-preview from the project's own work", () => {
  const post = "https://www.instagram.com/p/abc123/";
  it("stores a hint sent with the operational secret and no user", async () => {
    db.staff = false;
    const r = await handler(new Request("https://f/post-preview", {
      method: "POST",
      headers: { "x-socialytics-secret": "k" },
      body: JSON.stringify({ posts: [{ url: post, image: "https://scontent.cdninstagram.com/a.jpg", media_type: "image" }] }),
    }));
    expect(r.status).toBe(200);
    expect(db.uploads).toHaveLength(1);
  });

  it("refuses a wrong secret", async () => {
    const r = await handler(new Request("https://f/post-preview", { method: "POST", headers: { "x-socialytics-secret": "nope" }, body: JSON.stringify({ url: post }) }));
    expect(r.status).toBeGreaterThanOrEqual(401);
    expect(db.uploads).toEqual([]);
  });
});

describe("post-preview refuses what is not a social post", () => {
  it("answers unavailable for another site without any request or write", async () => {
    const { previews } = await call({ url: "https://netflix.com/a" });
    expect(previews["https://netflix.com/a"].status).toBe("unavailable");
    expect(fetched).toEqual([]);
    expect(db.upserts).toEqual([]);
  });

  it("does not copy an image hint from a host that is not a known CDN", async () => {
    const post = "https://www.instagram.com/p/abc123/";
    await call({ posts: [{ url: post, image: "https://example.org/scontent-1.jpg" }] });
    expect(fetched).not.toContain("https://example.org/scontent-1.jpg");
    expect(db.uploads).toEqual([]);
  });
});

describe("post-preview hints from a caller who is not staff", () => {
  const post = "https://www.instagram.com/p/abc123/";
  const hint = { url: post, image: "https://scontent.cdninstagram.com/a.jpg", media_type: "image" };

  it("answers with the hint but copies and stores nothing", async () => {
    db.staff = false;
    const { previews } = await call({ posts: [hint] });
    expect(previews[post].image_url).toBe(hint.image);
    expect(db.uploads).toEqual([]);
    expect(db.upserts.some((r) => r.image_url === hint.image)).toBe(false);
  });

  it("stores the same hint from staff", async () => {
    db.staff = true;
    await call({ posts: [hint] });
    expect(db.uploads).toHaveLength(1);
  });
});
