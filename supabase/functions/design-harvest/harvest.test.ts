// @vitest-environment node
// Node, like the Deno runtime, has crypto.subtle and AbortSignal.timeout; jsdom does not.
import { describe, it, expect } from "vitest";
import { harvestClient, type HarvestDeps } from "./harvest";

// The harvest reads a client's own published posts from Sprout and files every
// still (and every video's thumbnail) under brand_assets. These fakes stand in
// for the four things it touches: the database, Sprout, the media CDN and the
// vision check. Nothing here reaches the network.

const CLIENT = "c-1";
const NOW = new Date("2026-10-08T09:00:00Z");
const LONG_TEXT = "x".repeat(700);

const post = (over: Record<string, unknown>) => ({
  guid: "ig:1", customer_profile_id: 7, network: "INSTAGRAM", created_time: "2026-09-20T10:00:00Z",
  perma_link: "https://instagram.com/p/one", content_category: "PHOTO", text: "A designed post",
  metrics: { "lifetime.impressions": 1200 },
  visual_media: [{ media_type: "PHOTO", media_url: "https://s.cdninstagram.com/one.jpg" }],
  ...over,
});

const SPROUT_POSTS = [
  post({}),
  post({ guid: "ig:2", perma_link: "https://instagram.com/p/two", text: LONG_TEXT, metrics: { "lifetime.impressions": 300 },
    visual_media: [{ media_type: "PHOTO", media_url: "https://s.cdninstagram.com/two.png" }] }),
  post({ guid: "ig:3", perma_link: "https://instagram.com/p/album", content_category: "ALBUM", visual_media: [
    { media_type: "PHOTO", media_url: "https://s.cdninstagram.com/album-a.jpg" },
    { media_type: "PHOTO", media_url: "https://s.cdninstagram.com/album-plain.jpg" },
    { media_type: "PHOTO", media_url: "https://s.cdninstagram.com/album-c.jpg" },
  ] }),
  post({ guid: "ig:4", perma_link: "https://instagram.com/p/reel", content_category: "VIDEO", visual_media: [
    { media_type: "VIDEO", media_url: "https://s.cdninstagram.com/reel.mp4", thumbnail_url: "https://s.cdninstagram.com/reel-thumb.jpg" },
  ] }),
  // Never another client's profile, even when Sprout returns it.
  post({ guid: "ig:9", customer_profile_id: 8, perma_link: "https://instagram.com/p/foreign",
    visual_media: [{ media_type: "PHOTO", media_url: "https://s.cdninstagram.com/foreign.jpg" }] }),
  // An unassigned (inactive) profile of this client is not read either.
  post({ guid: "ig:10", customer_profile_id: 9, perma_link: "https://instagram.com/p/inactive",
    visual_media: [{ media_type: "PHOTO", media_url: "https://s.cdninstagram.com/inactive.jpg" }] }),
  // Link previews are not designs.
  post({ guid: "ig:11", perma_link: "https://instagram.com/p/link", content_category: "LINK" }),
];

interface Row { [k: string]: unknown }

function world(opts: { profiles?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    clients: [{ id: CLIENT, name: "Fixture", sprout_customer_id: "1" }, { id: "c-2", name: "Other", sprout_customer_id: "1" }],
    sprout_profiles: opts.profiles ?? [
      { client_id: CLIENT, sprout_profile_id: 7, is_active: true },
      { client_id: CLIENT, sprout_profile_id: 9, is_active: false },
      { client_id: "c-2", sprout_profile_id: 8, is_active: true },
    ],
    brand_assets: [],
  };
  const uploads: Array<{ path: string; bytes: Uint8Array; contentType: string }> = [];
  const classified: string[] = [];
  const sproutBodies: Row[] = [];

  // The slice of the supabase-js query builder the harvest uses, and nothing more.
  const query = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const rows = () => tables[table].filter((r) => filters.every((f) => f(r)));
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return b; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      insert: async (row: Row) => {
        if (table === "brand_assets" && row.sha256 && tables.brand_assets.some((r) => r.client_id === row.client_id && r.sha256 === row.sha256)) {
          return { error: { code: "23505", message: "duplicate key value violates unique constraint" } };
        }
        tables[table].push({ id: `${table}-${tables[table].length + 1}`, created_at: NOW.toISOString(), ...row });
        return { error: null };
      },
    };
    return b;
  };
  const db = {
    from: query,
    storage: { from: (bucket: string) => ({
      upload: async (path: string, bytes: Uint8Array, o: { contentType: string }) => {
        expect(bucket).toBe("design-references");
        uploads.push({ path, bytes, contentType: o.contentType });
        return { error: null };
      },
    }) },
  };

  const deps: HarvestDeps = {
    db,
    now: () => NOW,
    sproutToken: async () => "token-1",
    send: async (input, init) => {
      const url = String(input);
      expect(url).toBe("https://api.sproutsocial.com/v1/1/analytics/posts");
      expect(init?.headers).toMatchObject({ Authorization: "Bearer token-1" });
      const body = JSON.parse(String(init?.body));
      sproutBodies.push(body);
      const data = body.page === 1 ? SPROUT_POSTS : [];
      return new Response(JSON.stringify({ data, paging: { total_pages: 1 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    fetchImage: async (url) => ({ bytes: new TextEncoder().encode(`image-bytes:${url}`), mime: url.endsWith(".png") ? "image/png" : "image/jpeg" }),
    classify: async (_bytes, _mime, clientName) => {
      expect(clientName).toBe("Fixture");
      const url = new TextDecoder().decode(_bytes).replace("image-bytes:", "");
      classified.push(url);
      return url.includes("plain")
        ? { usable: false, confidence: 0.95, reason: "A plain photograph with no lettering or layout" }
        : { usable: true, confidence: 0.9, reason: "Branded typography on a colour block" };
    },
  };
  return { deps, tables, uploads, classified, sproutBodies };
}

describe("harvestClient", () => {
  it("stores every usable still and the video thumbnail, skips the plain photo, and stores nothing new on a second run", async () => {
    const w = world();
    const first = await harvestClient(w.deps, CLIENT);
    expect(first).toEqual({ posts: 4, slides: 4, videos: 1, skipped: 1, stored: 5 });

    const rows = w.tables.brand_assets;
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.kind).sort()).toEqual(["post", "post", "post", "post", "video"]);
    expect(rows.every((r) => r.client_id === CLIENT)).toBe(true);
    for (const r of rows) {
      expect(r.path).toMatch(new RegExp(`^${CLIENT}/post-${r.sha256}\\.(jpg|png)$`));
      expect(String(r.sha256)).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(w.uploads.map((u) => u.path).sort()).toEqual(rows.map((r) => r.path).sort());

    // Provenance carries the Sprout facts the learner reads back.
    const one = rows.find((r) => (r.provenance as Row).source_post_id === "ig:1")!;
    expect(one.provenance).toEqual({
      source: "sprout", source_post_id: "ig:1", source_url: "https://instagram.com/p/one", profile_id: "7", platform: "INSTAGRAM",
      posted_at: "2026-09-20T10:00:00Z", slide_index: 0, impressions: 1200, text: "A designed post",
      classification: "Branded typography on a colour block", confidence: 0.9,
    });
    const two = rows.find((r) => (r.provenance as Row).source_post_id === "ig:2")!;
    expect(two.path).toMatch(/\.png$/);
    expect((two.provenance as Row).text).toHaveLength(500);

    // Album slides keep their position; the plain one is absent.
    const album = rows.filter((r) => (r.provenance as Row).source_post_id === "ig:3").map((r) => (r.provenance as Row).slide_index).sort();
    expect(album).toEqual([0, 2]);

    // The video row holds the thumbnail and was never sent to the classifier.
    const video = rows.find((r) => r.kind === "video")!;
    expect(video.provenance).toMatchObject({ source_post_id: "ig:4", slide_index: 0, classification: null, confidence: null });
    expect(w.classified).not.toContain("https://s.cdninstagram.com/reel-thumb.jpg");
    expect(w.classified).toHaveLength(5);

    // Foreign, inactive and link posts never reached a download.
    expect(w.uploads.some((u) => new TextDecoder().decode(u.bytes).match(/foreign|inactive/))).toBe(false);

    // Second run: every file is already on record, so nothing is uploaded or inserted.
    const second = await harvestClient(w.deps, CLIENT);
    expect(second).toEqual({ posts: 4, slides: 0, videos: 0, skipped: 6, stored: 0 });
    expect(w.tables.brand_assets).toHaveLength(5);
    expect(w.uploads).toHaveLength(5);
  });

  it("asks Sprout only for the saved active profiles, over 180 days, 50 a page, with the fields the provenance needs", async () => {
    const w = world();
    await harvestClient(w.deps, CLIENT);
    expect(w.sproutBodies).toHaveLength(1);
    const body = w.sproutBodies[0];
    expect(body.filters).toEqual(["customer_profile_id.eq(7)", "created_time.in(2026-04-11T00:00:00...2026-10-08T23:59:59)"]);
    expect(body.fields).toEqual(["guid", "customer_profile_id", "network", "created_time", "perma_link", "content_category", "visual_media", "text"]);
    expect(body.metrics).toEqual(["lifetime.impressions"]);
    expect(body).toMatchObject({ limit: 50, page: 1 });
  });

  it("refuses a client with no active Sprout profile rather than reading anything", async () => {
    const w = world({ profiles: [{ client_id: CLIENT, sprout_profile_id: 7, is_active: false }] });
    await expect(harvestClient(w.deps, CLIENT)).rejects.toThrow(/social accounts/);
    expect(w.sproutBodies).toHaveLength(0);
  });

  it("refuses an unknown client", async () => {
    const w = world();
    await expect(harvestClient(w.deps, "c-missing")).rejects.toThrow(/Client not found/);
  });

  it("counts a failed download as skipped and keeps going", async () => {
    const w = world();
    const inner = w.deps.fetchImage;
    w.deps.fetchImage = async (url) => { if (url.includes("two")) throw new Error("Image unavailable"); return inner(url); };
    const r = await harvestClient(w.deps, CLIENT);
    expect(r).toEqual({ posts: 4, slides: 3, videos: 1, skipped: 2, stored: 4 });
  });
});
