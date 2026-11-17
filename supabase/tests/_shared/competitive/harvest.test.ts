// @vitest-environment node
// The older harvest of a client's own post thumbnails (refreshFeed.ts
// harvestOwnCreative), which runs on every competitor feed refresh, against
// the reference library's rules (docs/superpowers/plans/2026-11-17-
// reference-library.md). Two limits: a library the reference rules wrote is
// never its to merge into, reorder or trim, and it removes only files it made
// itself. Before these limits a library a person chose from uploads alone had
// no reviewed entry, so the harvest merged its thumbnails in, kept the newest
// eight and deleted the person's uploaded files. RivalIQ's images, the
// database and the storage are stand-ins: nothing leaves the test.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { harvestFile, harvestOwnCreative } from "../../../functions/_shared/competitive/refreshFeed";
import { rulesLibrary } from "../../../functions/_shared/brand-references/corpus";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

const CLIENT = "0c1e0000-0000-4000-8000-000000000001";
const COMPANY = "77";
const NAME = "Harbor Coffee";
const upload = (n: number) => ({ path: `Harbor-Coffee/${CLIENT}-reference-${n}.png`, upload: true, kept: true });
const harvested = (n: number, day: string) => ({ path: `Harbor-Coffee/harvested-${CLIENT}-old${n}.jpg`, source_post_id: `old${n}`, platform: "instagram", posted_at: `${day}T12:00:00Z` });
/** The client's own posts as RivalIQ sends them, newest first, each with an image. */
const ownPosts = (n: number) => Array.from({ length: n }, (_, i) => ({
  companyId: COMPANY, postId: `new${i}`, channel: "instagram", publishedAt: `2026-11-${String(16 - i).padStart(2, "0")}T12:00:00Z`, engagementTotal: 100 - i, imageLarge: `https://images.example/new${i}.jpg`,
}));

let fetched: string[];
beforeEach(() => {
  fetched = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetched.push(String(url));
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/jpeg" } });
  }));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function world(library: unknown[], refsResult: Record<string, unknown> | null = null) {
  const db = fakeDb({
    clients: [{ id: CLIENT, name: NAME, harvested_design_references: library, design_refs_harvested_at: "2026-11-01T00:00:00.000Z" }],
    client_lifecycle_steps: refsResult ? [{ client_id: CLIENT, step: "design_refs", status: "done", result: refsResult }] : [],
  });
  for (const e of library as Array<{ path: string }>) db.uploads.set(`design-references/${e.path}`, "image");
  const removed: string[][] = [];
  const from = db.storage.from;
  db.storage.from = (bucket: string) => {
    const s = from(bucket);
    return { ...s, remove: async (paths: string[]) => { removed.push([...paths]); return s.remove(paths); } };
  };
  const files = () => [...db.uploads.keys()].sort();
  return { db, removed, files, row: () => db.tables.clients[0] };
}

describe("a library the reference rules wrote is never the harvest's to touch", () => {
  it.each([
    ["a library a person chose from 5 uploads", [1, 2, 3, 4, 5].map(upload), { owner: "person", references: 5 }],
    ["the same library before the step recorded whose it is", [1, 2, 3, 4, 5].map(upload), null],
    ["a thin library of 1 upload", [upload(1)], { owner: "app", thin: true }],
    ["a thin library of 2 uploads", [upload(1), upload(2)], null],
    ["an automatic library of reviewed posts", [{ path: `${CLIENT}/social-a.jpg`, platform: "Instagram", posted_at: "2026-10-01T12:00:00Z", quality_checked: true }], null],
    ["a library with one post a person kept", [{ path: `${CLIENT}/social-b.jpg`, platform: "Instagram", posted_at: "2026-06-01T12:00:00Z", kept: true }], null],
    ["a library the client keeps as it is, whose entries carry no mark", [1, 2, 3].map((n) => harvested(n, `2026-09-0${n}`)), { owner: "app", no_everyday: true }],
  ] as Array<[string, unknown[], Record<string, unknown> | null]>)("%s survives a feed refresh with every entry and every file", async (_name, library, refsResult) => {
    const w = world(library, refsResult);
    const stored = JSON.stringify(library);
    const filesBefore = w.files();
    const out = await harvestOwnCreative(w.db, CLIENT, COMPANY, ownPosts(10), NAME);
    expect(out).toEqual({ added: 0, kept: library.length, skipped: [] });
    // Same entries, in the same order; its date untouched; no file added or removed; no image even fetched.
    expect(JSON.stringify(w.row().harvested_design_references)).toBe(stored);
    expect(w.row().design_refs_harvested_at).toBe("2026-11-01T00:00:00.000Z");
    expect(w.files()).toEqual(filesBefore);
    expect(w.removed).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("is not touched either when the library or the step that answers for it cannot be read", async () => {
    const w = world([1, 2, 3].map((n) => harvested(n, `2026-09-0${n}`)));
    const real = w.db.from.bind(w.db);
    w.db.from = (table: string) => (table === "client_lifecycle_steps"
      ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "timeout" } }) }) }) }) }
      : real(table));
    expect(await harvestOwnCreative(w.db, CLIENT, COMPANY, ownPosts(10), NAME)).toEqual({ added: 0, kept: 3, skipped: [] });
    expect(w.removed).toEqual([]);
    expect(fetched).toEqual([]);
    expect(w.row().harvested_design_references).toHaveLength(3);
  });

  it("says which libraries are the reference rules' own", () => {
    expect(rulesLibrary([upload(1)])).toBe(true);
    expect(rulesLibrary([{ path: "a", kept: true }])).toBe(true);
    expect(rulesLibrary([{ path: "a", quality_checked: true }])).toBe(true);
    expect(rulesLibrary([harvested(1, "2026-09-01")], { owner: "app" })).toBe(true);
    expect(rulesLibrary([], { owner: "person" })).toBe(true);
    // The older harvest's own list, and an empty one, are not.
    expect(rulesLibrary([harvested(1, "2026-09-01"), "Harbor-Coffee/old.png"])).toBe(false);
    expect(rulesLibrary([harvested(1, "2026-09-01")], { waiting_for: "designed_posts", designed: 0 })).toBe(false);
    expect(rulesLibrary([])).toBe(false);
    expect(rulesLibrary(null)).toBe(false);
  });
});

describe("the harvest removes only files it made itself", () => {
  it("knows its own files by their name, for this client only", () => {
    expect(harvestFile(`Harbor-Coffee/harvested-${CLIENT}-abc.jpg`, CLIENT)).toBe(true);
    expect(harvestFile(`harvested-${CLIENT}-abc.png`, CLIENT)).toBe(true);
    expect(harvestFile(`Harbor-Coffee/harvested-other-client-abc.jpg`, CLIENT)).toBe(false);
    expect(harvestFile(`Harbor-Coffee/${CLIENT}-reference-1.png`, CLIENT)).toBe(false);
    expect(harvestFile(`${CLIENT}/social-0123.jpg`, CLIENT)).toBe(false);
    expect(harvestFile(`harvested-${CLIENT}-x/${CLIENT}-reference-1.png`, CLIENT)).toBe(false);
    expect(harvestFile(null, CLIENT)).toBe(false);
  });

  it("in its own list, trims its own oldest files and never an entry or a file it did not make", async () => {
    // An older list with no mark on any entry: eight of the harvest's files, and three files it did not make (two with no date at all).
    const foreign = [{ path: `Harbor-Coffee/${CLIENT}-old-campaign.png` }, { path: "Harbor-Coffee/brand-sheet.png" }, { path: `${CLIENT}/social-unmarked.jpg`, posted_at: "2026-01-05T12:00:00Z" }];
    const own = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => harvested(n, `2026-09-0${n}`));
    const w = world([...own, ...foreign]);
    const out = await harvestOwnCreative(w.db, CLIENT, COMPANY, ownPosts(10), NAME);
    expect(out).toMatchObject({ added: 8 });
    // Eight new thumbnails came in, so the eight old ones of its own went: those, and nothing else, were removed.
    expect(w.removed).toHaveLength(1);
    expect(w.removed[0].sort()).toEqual(own.map((e) => e.path).sort());
    for (const path of w.removed.flat()) expect(harvestFile(path, CLIENT)).toBe(true);
    const paths = (w.row().harvested_design_references as Array<{ path: string }>).map((e) => e.path);
    for (const f of foreign) {
      expect(paths).toContain(f.path);
      expect(w.files()).toContain(`design-references/${f.path}`);
    }
    expect(paths.filter((p) => harvestFile(p, CLIENT))).toHaveLength(8);
    expect(paths).toHaveLength(11);
  });

  it("removes nothing at all when what it would trim is not its own", async () => {
    // Twelve files it did not make and none of its own: eight thumbnails come in and nothing leaves.
    const foreign = Array.from({ length: 12 }, (_, i) => ({ path: `Harbor-Coffee/${CLIENT}-older-${i}.png` }));
    const w = world(foreign);
    await harvestOwnCreative(w.db, CLIENT, COMPANY, ownPosts(10), NAME);
    expect(w.removed).toEqual([]);
    expect((w.row().harvested_design_references as unknown[])).toHaveLength(20);
    for (const f of foreign) expect(w.files()).toContain(`design-references/${f.path}`);
  });
});
