// @vitest-environment node
// One strategy_deck job with Google faked: the template imported once with its
// weights set, a new copy filled with one batchUpdate, shared as editor with
// the person who asked and no email, its link saved; a copy that did not fill
// goes to the trash; Google not connected ends the export at once; the chart
// images are removed after.
import { describe, expect, it } from "vitest";
import { runStrategyDeck, TEMPLATE_VERSION, type DeckJobDeps } from "./deckJob";
import { fakeDb } from "../lifecycle/fakeDb";
import { GoogleNotConnected } from "../google/oauth";
import type { GoogleApi } from "../google/api";
import type { ScheduledJob } from "../scheduled-jobs/types";

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
