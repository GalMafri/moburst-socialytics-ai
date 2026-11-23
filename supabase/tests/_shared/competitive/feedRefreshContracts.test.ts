// @vitest-environment node
// QA 22 Nov 2026 (P30): the competitor feed refresh (refreshFeed.ts). RivalIQ, Sprout and the
// landscape read are stand-ins; nothing leaves the test.
import { describe, expect, it, vi } from "vitest";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";

const COMPANIES = [{ id: "1", name: "Bader Law", url: "https://baderlaw.com" }, { id: "2", name: "Peer Law", url: "https://peerlaw.com" }];
const state = vi.hoisted(() => ({ rivalPosts: [] as unknown[], owned: null as unknown, body: null as unknown }));
vi.mock("../../../functions/_shared/competitive/landscapeCheck", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/competitive/landscapeCheck")>()),
  checkFeedLandscape: vi.fn(async () => ({
    feed: { ok: true, linked: true, summary: { id: "ls-1", client_company_id: "1", companies: COMPANIES } },
    selection: { ok: false, code: "RIVALIQ_SELECTION_NOT_COVERED", selection: true, landscapeId: "ls-1", message: "waits" },
  })),
  recordTrackingCheck: vi.fn(async () => {}),
}));
vi.mock("../../../functions/_shared/competitive/rivaliqFetch", () => ({
  rivalIqFetch: vi.fn(async () => new Response(JSON.stringify(state.body ?? { socialPosts: state.rivalPosts }))),
}));
vi.mock("../../../functions/_shared/competitive/ownedSource", async (original) => ({
  ...(await original<typeof import("../../../functions/_shared/competitive/ownedSource")>()),
  collectOwnedCompetitive: vi.fn(async () => state.owned ?? { provider: "sprout", coverage: "not_connected", profiles: [], posts: [], metrics: null }),
}));
const { refreshCompetitorFeed } = await import("../../../functions/_shared/competitive/refreshFeed");

const CLIENT = "client-1";
const ENV = { rivaliqKey: "rq", by: { actor: "system" as const }, secret: "s" };
function db(opts: { set?: boolean; competitors?: Array<Record<string, unknown>> } = {}) {
  const d = fakeDb({
    clients: [{ id: CLIENT, name: "Bader Law", website_url: "https://baderlaw.com", harvested_design_references: [] }],
    competitor_sets: opts.set === false ? [] : [{ id: "set-1", client_id: CLIENT, status: "confirmed", rivaliq_landscape_id: "ls-1", confirmed_at: "2026-11-01T00:00:00Z" }],
    competitors: opts.competitors ?? [],
    app_settings: [], rivaliq_snapshots: [], competitive_alerts: [],
    report_engines: [{ kind: "linkedin_source", client_id: null, engine: "n8n" }],
  });
  const eqs: Array<[string, string, unknown]> = [];
  const from = d.from.bind(d);
  d.from = (t: string) => { const q = from(t); const eq = q.eq.bind(q); q.eq = (c: string, v: unknown) => { eqs.push([t, c, v]); return eq(c, v); }; return q; };
  return Object.assign(d, { eqs });
}
const post = (i: number, companyId = "2") => ({ companyId, companyName: "Peer Law", channel: "instagram", message: `p${i}`, postId: `r${i}`, postLink: `https://instagram.com/p/${i}`, publishedAt: "2026-11-10" });

describe("P30 refreshCompetitorFeed", () => {
  it("saves the feed for the tracked companies while a newly confirmed competitor is not in the landscape yet", async () => {
    state.rivalPosts = [post(1)]; state.owned = null;
    const d = db({ competitors: [
      { id: "k1", set_id: "set-1", client_id: CLIENT, name: "Peer Law", website_url: "https://peerlaw.com", is_selected: true, selected_rank: 1 },
      { id: "k2", set_id: "set-1", client_id: CLIENT, name: "New Co", website_url: "https://newco.com", is_selected: true, selected_rank: 2 },
    ] });
    await expect(refreshCompetitorFeed(d, CLIENT, ENV)).resolves.toMatchObject({ posts: 1 });
  });

  it("does not ask the competitors table for set_id undefined when the client has no confirmed set", async () => {
    state.rivalPosts = [post(1)]; state.owned = null;
    const d = db({ set: false });
    await refreshCompetitorFeed(d, CLIENT, ENV).catch(() => undefined);
    expect(d.eqs.filter(([t, c]) => t === "competitors" && c === "set_id").map(([, , v]) => v)).not.toContain(undefined);
  });

  it("does not say 'capped' when RivalIQ returned fewer posts than its limit", async () => {
    state.rivalPosts = Array.from({ length: 499 }, (_, i) => post(i));
    state.owned = { provider: "sprout", coverage: "complete", profiles: [{ id: "9", name: "Bader", network: "facebook" }], metrics: null,
      posts: [{ postId: "sprout:a", channel: "facebook", publishedAt: "2026-11-10", message: "own", postLink: "https://facebook.com/x/1" }] };
    const d = db({ competitors: [{ id: "k1", set_id: "set-1", client_id: CLIENT, name: "Peer Law", website_url: "https://peerlaw.com", is_selected: true, selected_rank: 1 }] });
    const out = await refreshCompetitorFeed(d, CLIENT, ENV);
    expect(out.truncated).toBe(false);
  });

  it("does not save an empty week as a finished refresh when RivalIQ's answer holds no post list", async () => {
    state.body = { message: "Landscape data is being collected" }; state.owned = null;
    const d = db({ competitors: [{ id: "k1", set_id: "set-1", client_id: CLIENT, name: "Peer Law", website_url: "https://peerlaw.com", is_selected: true, selected_rank: 1 }] });
    const out = await refreshCompetitorFeed(d, CLIENT, ENV).catch((e: Error) => e);
    state.body = null;
    expect(out instanceof Error || d.tables.rivaliq_snapshots.length === 0).toBe(true);
  });
});
