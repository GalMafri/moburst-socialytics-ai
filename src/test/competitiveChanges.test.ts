import { describe, expect, it } from "vitest";
import { aggregatePosts, comparablePeriods, diffCompanies, pickComparableReport, type CompanyStats } from "@/lib/competitiveChanges";

describe("comparablePeriods", () => {
  it("accepts consecutive months and a small overlap", () => {
    expect(comparablePeriods({ start: "2026-07-01", end: "2026-07-31" }, { start: "2026-08-01", end: "2026-08-31" })).toBe(true);
    // Two shared days out of thirty: still comparable.
    expect(comparablePeriods({ start: "2026-08-04", end: "2026-09-02" }, { start: "2026-09-01", end: "2026-09-30" })).toBe(true);
  });
  it("rejects nested, identical and reversed periods", () => {
    expect(comparablePeriods({ start: "2026-08-04", end: "2026-09-02" }, { start: "2026-08-01", end: "2026-08-31" })).toBe(false);
    expect(comparablePeriods({ start: "2026-08-27", end: "2026-09-02" }, { start: "2026-08-27", end: "2026-09-02" })).toBe(false);
    expect(comparablePeriods({ start: "2026-09-01", end: "2026-09-30" }, { start: "2026-08-01", end: "2026-08-31" })).toBe(false);
    expect(comparablePeriods(null, { start: "2026-08-01", end: "2026-08-31" })).toBe(false);
  });
});

const base = (over: Partial<CompanyStats> & { name: string }): CompanyStats => ({
  is_client: false,
  post_count: 10,
  cadence_per_week: 2.5,
  engagement_avg: 50,
  engagement_rate_avg: 0.01,
  channel_mix: [{ key: "instagram", count: 10 }],
  media_type_mix: [{ key: "video", count: 5 }, { key: "photo", count: 5 }],
  ...over,
});

describe("diffCompanies", () => {
  it("reports cadence, engagement rate, channel moves, format shifts, quiet and new companies", () => {
    const prev = [base({ name: "Client", is_client: true }), base({ name: "Rival" }), base({ name: "Quiet" })];
    const curr = [
      base({ name: "Client", is_client: true, engagement_rate_avg: 0.02 }),
      base({ name: "Rival", post_count: 25, cadence_per_week: 6.3, channel_mix: [{ key: "instagram", count: 15 }, { key: "tiktok", count: 10 }], media_type_mix: [{ key: "video", count: 22 }, { key: "photo", count: 3 }] }),
      base({ name: "Quiet", post_count: 0, cadence_per_week: 0, channel_mix: [], media_type_mix: [] }),
      base({ name: "Newcomer", post_count: 4 }),
    ];
    const changes = diffCompanies(prev, curr, 20);
    const kinds = changes.map((c) => `${c.company}:${c.kind}`);
    expect(kinds).toContain("Client:engagement_rate");
    expect(kinds).toContain("Rival:cadence");
    expect(kinds).toContain("Rival:channel_new");
    expect(kinds).toContain("Rival:format");
    expect(kinds).toContain("Quiet:quiet");
    expect(kinds).toContain("Newcomer:new_company");
    expect(changes[0].company).toBe("Client");
    expect(changes.find((c) => c.kind === "engagement_rate")?.tone).toBe("good");
    expect(changes.find((c) => c.kind === "cadence")?.headline).toBe("Rival posts 2.5× as often");
    expect(changes.find((c) => c.kind === "channel_new")?.headline.startsWith("Rival moved onto ")).toBe(true);
    expect(changes.find((c) => c.kind === "format")?.headline).toBe("Rival shifted toward video");
    expect(changes.find((c) => c.kind === "quiet")?.tone).toBe("neutral");
  });
  it("marks the client's own engagement loss as bad and stays silent when nothing moved", () => {
    const prev = [base({ name: "Client", is_client: true, engagement_rate_avg: 0.02 })];
    const curr = [base({ name: "Client", is_client: true, engagement_rate_avg: 0.01 })];
    expect(diffCompanies(prev, curr)[0]).toMatchObject({ kind: "engagement_rate", tone: "bad", direction: "down" });
    const same = [base({ name: "Same" })];
    expect(diffCompanies(same, same)).toEqual([]);
  });
  it("caps the list and ignores tiny moves", () => {
    const prev = [base({ name: "A", cadence_per_week: 2.5, post_count: 10 })];
    const curr = [base({ name: "A", cadence_per_week: 3.0, post_count: 12 })];
    expect(diffCompanies(prev, curr)).toEqual([]);
  });
});

describe("aggregatePosts", () => {
  it("builds per-company stats with a weekly cadence and marks the client", () => {
    const posts = [
      { companyName: "A", channel: "instagram", type: "reel", engagementTotal: 10, engagementRate: 0.01 },
      { companyName: "A", channel: "tiktok", type: "video", engagementTotal: 30, engagementRate: 0.03 },
      { companyName: "B", channel: "facebook", type: "photo", engagementTotal: "5", engagementRate: "0.005" },
    ];
    const out = aggregatePosts(posts, 7, "A");
    const a = out.find((c) => c.name === "A")!;
    expect(a.is_client).toBe(true);
    expect(a.post_count).toBe(2);
    expect(a.cadence_per_week).toBe(2);
    expect(a.engagement_avg).toBe(20);
    expect(a.channel_mix.map((m) => m.key).sort()).toEqual(["instagram", "tiktok"]);
    expect(out.find((c) => c.name === "B")?.engagement_avg).toBe(5);
  });
});

describe("pickComparableReport", () => {
  it("picks the newest earlier report on the same landscape whose period sits before this one", () => {
    const cur = { report_data: { landscape: { id: "587615" }, period: { start: "2026-09-01", end: "2026-09-30" } } };
    const candidates = [
      { report_data: { landscape: { id: "587615" }, period: { start: "2026-09-01", end: "2026-09-15" } } },
      { report_data: { landscape: { id: "587596" }, period: { start: "2026-08-01", end: "2026-08-31" } } },
      { report_data: { landscape: { id: "587615" }, period: { start: "2026-08-01", end: "2026-08-31" } } },
      { report_data: { landscape: { id: "587615" }, period: { start: "2026-07-01", end: "2026-07-31" } } },
    ];
    expect(pickComparableReport(cur, candidates)).toBe(candidates[2]);
    expect(pickComparableReport(cur, [candidates[0], candidates[1]])).toBeNull();
    // Order of arrival does not matter: the latest earlier period wins even when it was created last.
    expect(pickComparableReport(cur, [candidates[3], candidates[2]])).toBe(candidates[2]);
  });
});
