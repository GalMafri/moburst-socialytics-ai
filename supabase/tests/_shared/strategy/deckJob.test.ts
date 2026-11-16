// @vitest-environment node
// One strategy_deck job with Google faked: the template imported once with its
// weights set, a new copy filled with one batchUpdate, shared as editor with
// the person who asked and no email, its link saved; a copy that did not fill
// goes to the trash; Google not connected ends the export at once; the chart
// images are removed after; a client's logo of any usual kind reaches the cover
// (an SVG as a PNG, no logo leaves its place empty), is read within a size cap;
// a deck whose job ended or whose worker died on its last try is closed, by what the job says and never by the clock.
import { describe, expect, it } from "vitest";
import { closeAbandonedAll, closeStalledDecks, fetchLogo, LOGO_MAX_BYTES, runStrategyDeck, TEMPLATE_VERSION, type DeckJobDeps } from "../../../functions/_shared/strategy/deckJob";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { GoogleNotConnected } from "../../../functions/_shared/google/oauth";
import type { GoogleApi } from "../../../functions/_shared/google/api";
import type { ScheduledJob } from "../../../functions/_shared/scheduled-jobs/types";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const ARCHETYPES = ["cover-1", "cover-2", "divider", "cards-1", "cards-2", "cards-3", "cards-4", "cards-5", "chart-cards-1", "chart-cards-2", "chart-cards-3", "chart-cards-4", "chart-cards-5", "start", "flow", "close"];
const job = (over: Partial<ScheduledJob> = {}) => ({ id: "j1", kind: "strategy_deck", client_id: "c1", payload: { export_id: "e1" }, attempts: 1, max_attempts: 3, ...over }) as ScheduledJob;

function google(opts: { fill?: number } = {}) {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const slides = ARCHETYPES.map((a, i) => ({ objectId: `s${i}`, pageElements: [{ objectId: `m${i}`, shape: { text: { textElements: [{ startIndex: 0, endIndex: 9, textRun: { content: `{{a:${a}}}`, style: { fontFamily: "Geist Light" } } }] } } }] }));
  const api: GoogleApi = {
    async json(method, url, body) {
      calls.push({ method, url, body });
      if (url.endsWith(":batchUpdate")) {
        const requests = (body as { requests: Array<Record<string, unknown>> }).requests;
        return { replies: requests.map((r) => (r.replaceAllText ? { replaceAllText: { occurrencesChanged: opts.fill ?? 1 } } : r.replaceAllShapesWithImage ? { replaceAllShapesWithImage: { occurrencesChanged: 1 } } : {})) } as never;
      }
      if (url.includes("slides.googleapis.com")) return { slides } as never;
      if (url.endsWith("/copy?fields=id")) return { id: "copy1" } as never;
      if (url.includes("/files?fields=id")) return { id: "folder1" } as never;
      if (/files\/\w+\?fields=id,trashed/.test(url)) return { id: "x", trashed: false } as never;
      return { id: "ok" } as never;
    },
    async raw(method, url) {
      calls.push({ method, url });
      return url.includes("uploadType=resumable") ? new Response("", { headers: { Location: "https://upload/session" } }) : new Response(JSON.stringify({ id: "template1" }));
    },
  };
  return { api, calls };
}

function deps(g: ReturnType<typeof google>, over: Partial<DeckJobDeps> = {}) {
  const stored: string[] = [];
  const removed: string[] = [];
  const d: DeckJobDeps = {
    now: () => NOW,
    accessToken: async () => "ya29.token",
    api: () => g.api,
    measure: async () => (text, size) => text.length * 0.5 * size,
    png: async () => new Uint8Array([1]),
    logo: async () => ({ bytes: new Uint8Array([0x89, 0x50]), type: "image/png" }),
    template: async () => new Uint8Array([1, 2, 3]),
    store: async (_db, path) => { stored.push(path); return `https://signed/${path}`; },
    unstore: async (_db, paths) => { removed.push(...paths); },
    email: async () => "neria@moburst.com",
    ...over,
  };
  return { d, stored, removed };
}

const tables = () => ({
  content_strategy_exports: [{ id: "e1", client_id: "c1", status: "queued", requested_by: "u1", strategy_written_at: "2026-11-03T09:00:00.000Z" }],
  google_connection: [{ id: true, connected_at: "2026-11-01T00:00:00Z", folder_id: null, template_id: null, template_version: null }],
  clients: [{ id: "c1", name: "Acme", logo_url: "https://acme.test/logo.png" }],
  content_strategies: [{
    client_id: "c1", written_at: "2026-11-03T09:00:00.000Z", pillars: [{ name: "Captain Life", share: null }, { name: "Truths", share: null }],
    platforms: [{ platform: "Instagram", state: "posting", cadence: { per_week: 2, source: "published_8w" }, figures: { platform: "Instagram", basis: "measured", posts: 20, posts_per_week: 1.6, median_engagement: 40, rate: 0.03, rate_kind: "impression", followers: null }, competitors: [{ company: "BenchApp", platform: "Instagram", posts: 30, posts_per_week: 2.3, median_engagement: 18, followers: 900 }] }],
    sections: {
      goals: { items: [{ title: "Grow engagement", why: "Carousels work.", platform: "Instagram", metric: "median_engagement", direction: "above", baseline: 40, by: "2027-02-01" }, { title: "Post weekly", why: "Habit.", platform: "Instagram", metric: "posts_per_week", direction: "above", baseline: 1.6, by: "2027-02-01" }] },
      audience: { who: "Captains.", wants: ["a", "b", "c"], where: ["Instagram"] }, positioning: { statement: "Built for captains.", points: [] },
      "pillar:Captain Life": { purpose: "Save time.", formats: ["carousel"], planned_share: 50, ideas: [] }, "pillar:Truths": { purpose: "Laugh.", formats: ["reel"], planned_share: 50, ideas: [] },
      "platform:instagram:posting": { role: "Home base.", post: ["a", "b", "c"], worked: [], checks: { day_30: "x", day_90: "y" } },
      avoid: { items: [{ pattern: "Office photos", source: "posts" }] },
    },
  }],
  content_strategy_edits: [],
});

describe("a strategy deck job", () => {
  it("imports the template once with its weights, fills a new copy in one batchUpdate, shares it with no email and saves the link", async () => {
    const db = fakeDb(tables());
    const g = google();
    const { d, stored, removed } = deps(g);
    const out = await runStrategyDeck(db, job(), d);
    expect(out).toMatchObject({ status: "done", result: { file_id: "copy1", shared: true } });
    const urls = g.calls.map((c) => `${c.method} ${c.url.replace(/^https:\/\/[^/]+/, "")}`);
    expect(urls).toEqual([
      "POST /drive/v3/files?fields=id",
      "POST /upload/drive/v3/files?uploadType=resumable&fields=id",
      "PUT /session",
      "GET /v1/presentations/template1",
      "POST /v1/presentations/template1:batchUpdate",
      "POST /drive/v3/files/template1/copy?fields=id",
      "GET /v1/presentations/copy1",
      "POST /v1/presentations/copy1:batchUpdate",
      "POST /drive/v3/files/copy1/permissions?sendNotificationEmail=false&fields=id",
    ]);
    expect(g.calls.find((c) => c.url.endsWith("/copy?fields=id"))!.body).toEqual({ name: "Acme | Social Strategy | Nov 2026", parents: ["folder1"] });
    expect(g.calls.find((c) => c.url.includes("permissions"))!.body).toEqual({ type: "user", role: "writer", emailAddress: "neria@moburst.com" });
    expect(db.tables.content_strategy_exports[0]).toMatchObject({ status: "done", file_id: "copy1", url: "https://docs.google.com/presentation/d/copy1/edit", made_at: NOW.toISOString() });
    expect(db.tables.google_connection[0]).toMatchObject({ folder_id: "folder1", template_id: "template1", template_version: TEMPLATE_VERSION });
    expect(stored.sort()).toEqual(["charts/e1/logo.png", "charts/e1/mix.png", "charts/e1/start.png"]);
    expect(removed.sort()).toEqual(stored.sort());

    // The next deck copies the same template: no second import.
    db.tables.content_strategy_exports.push({ id: "e2", client_id: "c1", status: "queued", requested_by: "u1" });
    const again = google();
    await runStrategyDeck(db, job({ payload: { export_id: "e2" } }), deps(again).d);
    expect(again.calls.some((c) => c.url.includes("uploadType=resumable"))).toBe(false);
  });

  it("moves a copy that did not fill to the trash and ends with a log line", async () => {
    const db = fakeDb(tables());
    const g = google({ fill: 0 });
    const out = await runStrategyDeck(db, job(), deps(g).d);
    expect(out.status).toBe("failed");
    expect(out.reason).toMatch(/did not fill/);
    expect(g.calls.at(-1)).toMatchObject({ method: "PATCH", url: "https://www.googleapis.com/drive/v3/files/copy1?fields=id", body: { trashed: true } });
    expect(g.calls.some((c) => c.url.includes("permissions"))).toBe(false);
    expect(db.tables.content_strategy_exports[0].status).toBe("failed");
  });

  it("ends the export at once when Google is not connected, calling nothing", async () => {
    const db = fakeDb(tables());
    const g = google();
    const out = await runStrategyDeck(db, job(), deps(g, { accessToken: async () => { throw new GoogleNotConnected(); } }).d);
    expect(out).toEqual({ status: "skipped", reason: "Google is not connected." });
    expect(g.calls).toEqual([]);
    expect(db.tables.content_strategy_exports[0].status).toBe("failed");
  });

  it("lets the worker try again quietly, and marks the export failed only when the tries run out", async () => {
    const db = fakeDb(tables());
    const g = google();
    const broken = deps(g, { template: async () => null }).d;
    await expect(runStrategyDeck(db, job({ attempts: 1 }), broken)).rejects.toThrow(/template is not in storage/);
    expect(db.tables.content_strategy_exports[0].status).toBe("making");
    await expect(runStrategyDeck(db, job({ attempts: 3 }), broken)).rejects.toThrow();
    expect(db.tables.content_strategy_exports[0].status).toBe("failed");
  });
});

const SVG = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="40" height="10"><rect width="40" height="10"/></svg>';
type Req = { replaceAllShapesWithImage?: { imageUrl: string; containsText: { text: string } }; replaceAllText?: { replaceText: string; containsText: { text: string } } };
const batch = (g: ReturnType<typeof google>) => (g.calls.find((c) => c.url.endsWith("copy1:batchUpdate"))!.body as { requests: Req[] }).requests;

describe("the client's logo on the cover", () => {
  it("turns an SVG logo into a stored PNG and puts it on the cover", async () => {
    const db = fakeDb(tables());
    const g = google();
    const seen: string[] = [];
    const { d, stored } = deps(g, {
      logo: async () => ({ bytes: new TextEncoder().encode(SVG), type: "image/svg+xml" }),
      png: async (_db, svg) => { seen.push(svg); return new Uint8Array([0x89, 0x50, 0x4e, 0x47]); },
    });
    const out = await runStrategyDeck(db, job(), d);
    expect(out.status).toBe("done");
    expect(seen).toContain(SVG);
    expect(stored).toContain("charts/e1/logo.png");
    const put = batch(g).find((r) => r.replaceAllShapesWithImage?.containsText?.text === "{{logo}}");
    expect(put?.replaceAllShapesWithImage.imageUrl).toBe("https://signed/charts/e1/logo.png");
  });

  it("leaves the logo's place empty when there is no usable logo, since the cover title already names the client", async () => {
    for (const logo of [async () => null, async () => ({ bytes: new TextEncoder().encode("<svg"), type: "image/svg+xml" }), async () => { throw new Error("down"); }]) {
      const db = fakeDb(tables());
      const g = google();
      const { d, stored } = deps(g, { logo, png: async (_db, svg) => { if (svg === "<svg") throw new Error("not a drawing"); return new Uint8Array([1]); } });
      const out = await runStrategyDeck(db, job(), d);
      expect(out.status).toBe("done");
      expect(stored.some((p) => p.includes("logo"))).toBe(false);
      const name = batch(g).find((r) => r.replaceAllText?.containsText?.text === "{{logo}}");
      expect(name?.replaceAllText.replaceText).toBe("");
      expect(batch(g).filter((r) => r.replaceAllText?.replaceText === "Acme")).toHaveLength(0);
    }
  });
});

describe("a deck closed while its worker still runs", () => {
  it("stays failed: the worker's last write only changes a deck that is still open", async () => {
    const db = fakeDb(tables());
    const { d } = deps(google(), { email: async () => { db.tables.content_strategy_exports[0].status = "failed"; return null; } });
    await runStrategyDeck(db, job(), d);
    expect(db.tables.content_strategy_exports[0].status).toBe("failed");
    expect(db.tables.content_strategy_exports[0].url ?? null).toBeNull();
  });
});

describe("reading a logo", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  it("recognizes PNG, JPEG, GIF and SVG, and nothing else", async () => {
    const answer = (bytes: Uint8Array) => (async () => new Response(bytes)) as unknown as typeof fetch;
    expect((await fetchLogo("https://x.test/a", answer(PNG)))?.type).toBe("image/png");
    expect((await fetchLogo("https://x.test/a", answer(new Uint8Array([0xff, 0xd8, 1])))) ?.type).toBe("image/jpeg");
    expect((await fetchLogo("https://x.test/a", answer(new Uint8Array([0x47, 0x49, 0x46, 1]))))?.type).toBe("image/gif");
    expect((await fetchLogo("https://x.test/a", answer(new TextEncoder().encode(SVG))))?.type).toBe("image/svg+xml");
    expect(await fetchLogo("https://x.test/a", answer(new TextEncoder().encode("<html>nope</html>")))).toBeNull();
    expect(await fetchLogo("http://x.test/a", answer(PNG))).toBeNull();
    expect(await fetchLogo(null, answer(PNG))).toBeNull();
  });

  it("refuses a body that says it is far over the cap without reading it", async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { pulled++; c.enqueue(new Uint8Array(1_000_000)); } });
    const res = new Response(body, { headers: { "content-length": String(50_000_000) } });
    expect(await fetchLogo("https://x.test/a", (async () => res) as unknown as typeof fetch)).toBeNull();
    expect(pulled).toBeLessThanOrEqual(1);
  });

  it("stops reading a 50 MB body that does not say its size, once the cap is passed", async () => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(c) { if (pulled >= 50) return c.close(); pulled++; c.enqueue(new Uint8Array(1_000_000)); },
      cancel() { cancelled = true; },
    });
    expect(await fetchLogo("https://x.test/a", (async () => new Response(body)) as unknown as typeof fetch)).toBeNull();
    expect(pulled * 1_000_000).toBeLessThan(LOGO_MAX_BYTES + 3_000_000);
    expect(cancelled).toBe(true);
  });
});

describe("a deck whose worker died", () => {
  const MIN = 60_000;
  const rows = () => ({
    content_strategy_exports: [
      { id: "job-failed", client_id: "c1", status: "making" },
      { id: "job-skipped", client_id: "c2", status: "queued" },
      { id: "job-gone", client_id: "c3", status: "queued" },
      { id: "job-live", client_id: "c4", status: "making" },
      { id: "job-waiting", client_id: "c5", status: "queued" },
      { id: "export-done", client_id: "c6", status: "done" },
    ],
    scheduled_jobs: [
      { id: "j1", kind: "strategy_deck", client_id: "c1", status: "failed", payload: { export_id: "job-failed" } },
      { id: "j2", kind: "strategy_deck", client_id: "c2", status: "skipped", payload: { export_id: "job-skipped" } },
      { id: "j4", kind: "strategy_deck", client_id: "c4", status: "running", payload: { export_id: "job-live" }, lease_until: new Date(NOW.getTime() + 2 * MIN).toISOString() },
      { id: "j5", kind: "strategy_deck", client_id: "c5", status: "queued", payload: { export_id: "job-waiting" } },
      { id: "j6", kind: "strategy_deck", client_id: "c6", status: "done", payload: { export_id: "export-done" } },
    ],
  });
  const by = (db: ReturnType<typeof fakeDb>, id: string) => db.tables.content_strategy_exports.find((e) => e.id === id)!;

  it("is closed as failed when its job has ended or is gone, and a deck with a live job is left alone however long it takes", async () => {
    const db = fakeDb(rows());
    const closed = await closeStalledDecks(db, NOW);
    expect(closed.map((c) => c.id).sort()).toEqual(["job-failed", "job-gone", "job-skipped"]);
    expect(by(db, "job-failed")).toMatchObject({ status: "failed", updated_at: NOW.toISOString() });
    expect(by(db, "job-skipped").status).toBe("failed");
    expect(by(db, "job-gone").status).toBe("failed");
    expect(by(db, "job-live").status).toBe("making");
    expect(by(db, "job-waiting").status).toBe("queued");
    expect(by(db, "export-done").status).toBe("done");
  });

  it("closes the export and returns failed when the lease hands back a job past its last try", async () => {
    const db = fakeDb(tables());
    const g = google();
    const out = await runStrategyDeck(db, job({ attempts: 4, max_attempts: 3 }), deps(g).d);
    expect(out.status).toBe("failed");
    expect(db.tables.content_strategy_exports[0].status).toBe("failed");
    expect(g.calls).toEqual([]);
  });

  it("still works its last try when attempts equals max_attempts", async () => {
    const db = fakeDb(tables());
    const out = await runStrategyDeck(db, job({ attempts: 3, max_attempts: 3 }), deps(google()).d);
    expect(out.status).toBe("done");
  });

  it("trashes the copy when the export was closed while it was being made", async () => {
    const db = fakeDb(tables());
    const g = google();
    const out = await runStrategyDeck(db, job(), deps(g, {
      email: async () => { db.tables.content_strategy_exports[0].status = "failed"; return "neria@moburst.com"; },
    }).d);
    expect(out.status).toBe("failed");
    expect(g.calls.some((c) => c.method === "PATCH" && /copy1/.test(c.url) && JSON.stringify(c.body).includes("trashed"))).toBe(true);
    expect(db.tables.content_strategy_exports[0].status).toBe("failed");
  });

  it("is checked by the worker's every-minute sweep, and a throwing deck sweep leaves the report sweep's rows", async () => {
    const rows = await closeAbandonedAll({
      reports: async () => [{ table: "report_runs", id: "r1" }],
      decks: async () => { throw new Error("boom"); },
    });
    expect(rows).toEqual([{ table: "report_runs", id: "r1" }]);
    const both = await closeAbandonedAll({
      reports: async () => [{ table: "report_runs", id: "r1" }],
      decks: async () => [{ table: "content_strategy_exports", id: "e1" }],
    });
    expect(both.map((r) => r.id)).toEqual(["r1", "e1"]);
  });
});
