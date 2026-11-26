// @vitest-environment node
// The profiles a client's work reads, kept in line with its handles, and a
// round of reads: a dry run writes nothing and prices the round; a real one
// queues one job per profile, once a week.
import { describe, expect, it } from "vitest";
import { isoWeek, planReadRound, readEstimate } from "../../functions/social-read/plan";
import { profileChanges, wantedProfiles, type ProfileSources, type StoredProfile } from "../../functions/social-read/profiles";
import { memDb } from "./memDb";

const NOW = new Date("2026-11-26T10:00:00.000Z");

const sources = (o: Partial<ProfileSources> = {}): ProfileSources => ({
  client: { id: "c1", name: "Client", website_url: "https://client.com" },
  own: [
    { platform: "instagram", handle: "client", url: null, source: "website" },
    { platform: "linkedin", handle: "client", url: null, source: "person" },
    { platform: "facebook", handle: "client", url: null, source: "removed" },
    { platform: "x", handle: "client", url: null, source: "website" },
  ],
  sprout: new Set(["linkedin"]),
  competitors: [{ id: "k1", name: "Brand", website_url: "https://brand.com" }],
  handles: [
    { competitor_id: "k1", platform: "instagram", handle: "brand_auto", profile_url: null, is_active: true, source: "auto", detection_confidence: 0.95 },
    { competitor_id: "k1", platform: "instagram", handle: "brand_real", profile_url: null, is_active: true, source: "manual", detection_confidence: null },
    { competitor_id: "k1", platform: "tiktok", handle: "brandtok", profile_url: null, is_active: true, source: "auto", detection_confidence: 0.6 },
    { competitor_id: "k1", platform: "facebook", handle: "brandfb", profile_url: null, is_active: true, source: "rejected", detection_confidence: 0.95 },
    { competitor_id: "k1", platform: "youtube", handle: "brandyt", profile_url: null, is_active: true, source: "auto", detection_confidence: 0.95 },
    { competitor_id: "k1", platform: "x", handle: "brandx", profile_url: null, is_active: true, source: "rivaliq", detection_confidence: null },
  ],
  ...o,
});

describe("wantedProfiles", () => {
  it("reads four platforms; never X or YouTube, a removed or rejected handle, or the client's own where Sprout measures it", () => {
    const w = wantedProfiles(sources());
    expect(w.map((p) => `${p.competitor_id ?? "client"}:${p.platform}:${p.handle}:${p.found_on_site}`)).toEqual([
      "client:instagram:client:true",
      "k1:instagram:brand_real:false",
      "k1:tiktok:brandtok:false",
    ]);
  });
});

describe("profileChanges", () => {
  const stored = (o: Partial<StoredProfile>): StoredProfile => ({
    id: "s1", client_id: "c1", competitor_id: "k1", platform: "instagram", handle: "old", url: "https://www.instagram.com/old/", handle_source: "auto",
    active: true, confirmed: true, confirmed_reason: "links_brand_site", last_read_at: null, last_read_status: null, ...o,
  });
  it("adds new profiles, confirming a person's at once, and leaves the replaced one inactive", () => {
    const c = profileChanges(wantedProfiles(sources()), [stored({})], NOW);
    expect(c.insert.map((r) => [r.handle, r.confirmed ?? null, r.confirmed_reason ?? null])).toEqual([["client", null, null], ["brand_real", true, "entered_by_person"], ["brandtok", null, null]]);
    expect(c.update).toEqual([{ id: "s1", patch: { active: false, updated_at: NOW.toISOString() } }]);
  });
  it("checks a profile again when the person who chose it no longer stands behind it", () => {
    const w = wantedProfiles(sources({ own: [], handles: [{ competitor_id: "k1", platform: "instagram", handle: "old", profile_url: null, is_active: true, source: "auto", detection_confidence: 0.9 }] }));
    const c = profileChanges(w, [stored({ handle_source: "manual", confirmed_reason: "entered_by_person" })], NOW);
    expect(c.update[0].patch).toMatchObject({ handle_source: "auto", confirmed: null, confirmed_reason: null });
  });
});

function db() {
  return memDb({
    clients: [
      { id: "c1", name: "Client", website_url: "https://client.com", archived_at: null, demo_job_id: null, exclude_from_reporting: false },
      { id: "demo", name: "Demo", archived_at: null, demo_job_id: "d1", exclude_from_reporting: false },
    ],
    competitor_sets: [{ id: "set1", client_id: "c1", status: "confirmed" }, { id: "set2", client_id: "demo", status: "confirmed" }],
    competitors: [{ id: "k1", set_id: "set1", name: "Brand", website_url: "https://brand.com", is_selected: true }],
    competitor_handles: sources().handles,
    client_public_profiles: sources().own.map((o) => ({ ...o, client_id: "c1" })),
    sprout_profiles: [{ client_id: "c1", network_type: "linkedin_company", is_active: true }],
  });
}

describe("planReadRound", () => {
  it("a dry run lists and prices the round and writes nothing", async () => {
    const m = db();
    const round = await planReadRound(m.db, NOW, { dryRun: true });
    expect(round.clients).toBe(1);
    expect(round.reads.map((r) => `${r.platform}:${r.handle}:${r.first}`)).toEqual(["instagram:client:true", "instagram:brand_real:true", "tiktok:brandtok:true"]);
    expect(round.estimate.first_reads).toBe(3);
    expect(round.estimate.usd).toBeCloseTo(readEstimate("instagram", true).usd * 2 + readEstimate("tiktok", true).usd, 2);
    expect(round.queued).toBe(0);
    expect(m.writes).toEqual([]);
  });

  it("queues one job per profile a week, and none twice", async () => {
    const m = db();
    const first = await planReadRound(m.db, NOW, { dryRun: false });
    expect(first.queued).toBe(3);
    const jobs = m.rows("scheduled_jobs");
    expect(jobs.every((j) => j.kind === "social_read" && j.client_id === "c1" && String(j.dedupe_key).endsWith(isoWeek(NOW)))).toBe(true);
    expect((await planReadRound(m.db, NOW, { dryRun: false })).queued).toBe(0);
    expect(m.rows("scheduled_jobs")).toHaveLength(3);
  });

  it("leaves a known unconfirmed profile out", async () => {
    const m = db();
    await planReadRound(m.db, NOW, { dryRun: false });
    const tok = m.rows("social_profiles").find((p) => p.handle === "brandtok")!;
    Object.assign(tok, { confirmed: false, confirmed_reason: "no_link_to_brand" });
    const round = await planReadRound(m.db, new Date(NOW.getTime() + 7 * 86_400_000), { dryRun: true });
    expect(round.unconfirmed).toBe(1);
    expect(round.reads.map((r) => r.handle)).not.toContain("brandtok");
  });

  it("isoWeek names the ISO week", () => {
    expect(isoWeek(new Date("2026-11-26T10:00:00Z"))).toBe("2026-W48");
    expect(isoWeek(new Date("2027-01-01T10:00:00Z"))).toBe("2026-W53");
  });
});
