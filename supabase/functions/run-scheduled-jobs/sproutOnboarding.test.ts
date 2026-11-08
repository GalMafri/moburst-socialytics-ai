// @vitest-environment node
// The weekly Sprout onboarding job (spec: docs/superpowers/specs/2026-11-02-
// sprout-auto-onboarding-design.md, sections 1 to 6 and 9), on a fake
// database and fake Sprout and website answers: no network.
import { describe, expect, it } from "vitest";
import { fakeDb, type FakeDb } from "../_shared/lifecycle/fakeDb";
import type { SproutProfile } from "../_shared/lifecycle/accounts";
import type { SproutPost } from "../_shared/sprout/posts";
import { runSproutOnboardingJob, sproutOnboarding, type OnboardingDeps } from "./sproutOnboarding";
import type { ScheduledJob } from "../_shared/scheduled-jobs/types";

const NOW = new Date("2026-11-09T06:00:00.000Z");
const p = (id: string, name: string, native: string, network: string): SproutProfile => ({ id, name, native_name: native, network_type: network, native_link: `https://example.test/${native}`, status: "active" });

// Sprout's list: brands that are clients already, an archived client's, a secondary account, a person, a quiet brand, and two new ones.
const LISTED = [
  p("5719052", "Moburst - Growth Done Right", "moburst", "linkedin_company"), p("5489335", "Moburst | Mobile-First Digital Agency", "moburst.agency", "fb_instagram_account"),
  p("5555", "Moburst Careers", "moburstcareers", "facebook"),
  p("7480884", "Bader Law", "BaderLawLLC", "facebook"), p("7481075", "Bader Law", "Bader Law", "youtube"),
  p("7727415", "Pay The Pyper ", "paythepyperapp", "facebook"),
  p("600", "Gone Co", "goneco", "fb_instagram_account"), p("601", "Gone Co", "goneco_tt", "tiktok"),
  p("7001", "Olo", "olo", "linkedin_company"), p("7002", "Olo", "olo.hq", "fb_instagram_account"), p("7003", "Olo Dining", "olodining", "facebook"),
  p("8001", "Noah Glass", "noahglass", "linkedin"),
  p("9001", "Quiet Brand", "quietbrand", "facebook"),
  p("9100", "Yangra", "yangra", "facebook"), p("9101", "Yangra", "yangra.tt", "tiktok"),
];
const POSTS: Record<string, string[]> = {
  "5555": ["Join us https://www.moburst.com/careers"],
  "7001": ["Order ahead https://bit.ly/olo-order", "https://www.olo.com/demo"],
  "7003": ["Dine with us https://olo.com/dining"],
  "9100": ["Happy Monday!"],
};
const PAGES: Record<string, string> = {
  "olo.com": `<meta property="og:site_name" content="Olo"><a href="https://www.instagram.com/olo.hq/">ig</a><a href="https://www.facebook.com/olodining">fb</a>`,
};

function world() {
  const db = fakeDb({
    clients: [
      { id: "m", name: "Moburst", website_url: "https://www.moburst.com/", archived_at: null, demo_job_id: null },
      { id: "b", name: "Bader Law", website_url: "https://baderlaw.com", archived_at: null, demo_job_id: null },
      { id: "ptp", name: "Pay The Pyper", website_url: "https://paythepyper.com", archived_at: null, demo_job_id: null },
      { id: "g", name: "Gone Co", website_url: null, archived_at: "2026-09-30T00:00:00Z", demo_job_id: null },
      // A prospect's demo copy with Olo's name and website: never a match.
      { id: "demo", name: "Olo", website_url: "https://olo.com", archived_at: null, demo_job_id: "job-1" },
    ],
    sprout_profiles: [
      { id: "sp1", client_id: "m", sprout_profile_id: 5719052, is_active: true }, { id: "sp2", client_id: "m", sprout_profile_id: 5489335, is_active: true },
      { id: "sp3", client_id: "b", sprout_profile_id: 7480884, is_active: true }, { id: "sp4", client_id: "g", sprout_profile_id: 600, is_active: true },
    ],
    sprout_profile_removals: [],
    sprout_brand_declines: [],
    client_lifecycle_steps: [{ client_id: "m", step: "brand_read", result: { site_profiles: ["linkedin:moburst", "instagram:moburst.agency"] } }],
    scheduled_jobs: [],
  }, {
    // sprout_onboard_client as the database does it: refused for a profile already assigned or removed,
    // else the client, its profiles and origin; its insert trigger queues the lifecycle's first look.
    sprout_onboard_client: (args, d) => {
      const ids = (args.p_profiles as Array<{ id: string }>).map((x) => Number(x.id));
      const held = d.tables.sprout_profiles.find((r) => ids.includes(Number(r.sprout_profile_id)));
      if (held) return { created: false, reason: "assigned", client_id: held.client_id };
      const id = `new-${d.tables.clients.length + 1}`;
      d.tables.clients.push({
        id, name: args.p_name, website_url: args.p_website ?? null, archived_at: null, demo_job_id: null, created_by: null,
        field_sources: args.p_website ? { website_url: { by: "lifecycle", at: "now" } } : {},
        origin: { source: "sprout", brand: args.p_brand, profile_ids: [...ids].sort((a, c) => a - c), at: "now" },
      });
      for (const x of args.p_profiles as Array<Record<string, string>>) {
        d.tables.sprout_profiles.push({ id: `sp-${x.id}`, client_id: id, sprout_profile_id: Number(x.id), profile_name: x.name, native_name: x.native_name, network_type: x.network_type, native_link: x.native_link, is_active: true });
      }
      d.tables.scheduled_jobs.push({ id: `look-${id}`, kind: "lifecycle", client_id: id, dedupe_key: `lifecycle:${id}` });
      return { created: true, client_id: id };
    },
  });
  return db;
}

function deps(over: Partial<OnboardingDeps> = {}): OnboardingDeps & { postReads: string[][] } {
  const postReads: string[][] = [];
  return {
    postReads,
    now: () => NOW,
    profiles: async () => LISTED,
    groups: async () => [],
    posts: async (ids: string[]): Promise<SproutPost[]> => {
      postReads.push(ids);
      return ids.flatMap((id) => (POSTS[id] ?? []).map((text) => ({ text, created_time: NOW.toISOString(), perma_link: null, profile_id: id })));
    },
    reader: {
      resolve: async (url: string) => (url === "https://bit.ly/olo-order" ? "https://www.olo.com/order" : url),
      homepage: async (url: string) => { const host = new URL(url).hostname.replace(/^www\./, ""); return host in PAGES ? { html: PAGES[host], url: `https://www.${host}/` } : null; },
    },
    budgetMs: 90_000,
    clock: () => 0,
    ...over,
  };
}

const job = (payload: Record<string, unknown> | null = null) => ({ id: "j1", kind: "sprout_onboarding", client_id: null, payload, attempts: 1 } as unknown as ScheduledJob);
const decisions = (results: Array<{ brand: string; decision: string }>) => Object.fromEntries(results.map((r) => [r.brand, r.decision]));
const snapshot = (db: FakeDb) => JSON.stringify(db.tables);

describe("the Sprout onboarding job", () => {
  it("creates an Olo-shaped brand with its name, website, origin and profiles, and its lifecycle look is queued", async () => {
    const db = world();
    const archivedBefore = JSON.stringify([db.tables.clients.find((c) => c.id === "g"), db.tables.sprout_profiles.filter((r) => r.client_id === "g")]);
    const d = deps();
    const out = await runSproutOnboardingJob(db, job(), d);
    expect(out.status).toBe("done");
    const report = out.result as { results: Array<Record<string, unknown> & { brand: string; decision: string }>; created: string[]; left: string[] };
    // Named as people know them: both Moburst profiles are "Moburst" before their taglines, and "Gone Co" is "Gone".
    expect(report.results.map((r) => [r.key, r.brand, r.decision])).toEqual([
      ["600", "Gone", "archived"], ["5555", "Moburst Careers", "client_website"], ["7001", "Olo", "created"], ["8001", "Noah Glass", "person"],
      ["9001", "Quiet Brand", "no_posts"], ["9100", "Yangra", "created"], ["5489335", "Moburst", "matched"], ["5719052", "Moburst", "matched"],
      ["7480884", "Bader Law", "matched"], ["7727415", "Pay The Pyper", "matched"],
    ]);
    const olo = db.tables.clients.find((c) => c.name === "Olo" && !c.demo_job_id)!;
    expect(olo).toMatchObject({ website_url: "https://www.olo.com", created_by: null, field_sources: { website_url: { by: "lifecycle" } }, origin: { source: "sprout", brand: "Olo", profile_ids: [7001, 7002, 7003] } });
    // Olo Dining joined Olo by the website: one client with all three profiles.
    expect(db.tables.sprout_profiles.filter((r) => r.client_id === olo.id).map((r) => r.sprout_profile_id)).toEqual([7001, 7002, 7003]);
    expect(db.tables.scheduled_jobs).toContainEqual(expect.objectContaining({ kind: "lifecycle", client_id: olo.id }));
    const oloResult = report.results.find((r) => r.brand === "Olo")!;
    expect(oloResult).toMatchObject({ client_id: olo.id, joined: ["7001", "7003"], website: { website: "https://www.olo.com", confirmed_by: "profile_link", most_linked: "olo.com" } });
    // A brand with no confirmed website is created all the same; the lifecycle's website step looks again.
    const yangra = db.tables.clients.find((c) => c.name === "Yangra")!;
    expect(yangra).toMatchObject({ website_url: null, field_sources: {} });
    expect(report.results.find((r) => r.brand === "Yangra")!.reason).toMatch(/website step/);
    expect(report.created).toEqual([olo.id, yangra.id]);
    expect(report.left).toEqual([]);
    // The archived client and its profiles are as they were, and the demo copy was never matched.
    expect(JSON.stringify([db.tables.clients.find((c) => c.id === "g"), db.tables.sprout_profiles.filter((r) => r.client_id === "g")])).toBe(archivedBefore);
    // Only unmatched brand accounts cost a Sprout call.
    expect(d.postReads).toEqual([["5555"], ["7001", "7002"], ["7003"], ["9001"], ["9100", "9101"]]);
  });

  it("creates nothing more on a second run, nor when two runs overlap", async () => {
    const db = world();
    await runSproutOnboardingJob(db, job(), deps());
    const clients = db.tables.clients.length;
    const again = await runSproutOnboardingJob(db, job(), deps());
    expect(db.tables.clients).toHaveLength(clients);
    expect(decisions((again.result as { results: Array<{ brand: string; decision: string }> }).results)).toMatchObject({ Olo: "matched", Yangra: "matched" });

    const fresh = world();
    const [a, b] = await Promise.all([sproutOnboarding(fresh, deps(), { dryRun: false }), sproutOnboarding(fresh, deps(), { dryRun: false })]);
    expect(fresh.tables.clients.filter((c) => c.name === "Olo" && !c.demo_job_id)).toHaveLength(1);
    expect(fresh.tables.clients.filter((c) => c.name === "Yangra")).toHaveLength(1);
    expect([decisions(a.results).Olo, decisions(b.results).Olo].sort()).toEqual(["created", "taken"]);
  });

  it("works within its time and queues itself a minute later with the brands left", async () => {
    const db = world();
    let t = 0;
    const d = deps({ clock: () => t, posts: async (ids) => { t += 60_000; return deps().posts(ids, NOW, NOW); } });
    const out = await runSproutOnboardingJob(db, job(), d);
    const report = out.result as { results: Array<{ brand: string; decision: string; key: string }>; left: string[] };
    // Moburst Careers and Olo used the 90 seconds; Quiet Brand and Yangra are left.
    expect(report.left).toEqual(["9001", "9100"]);
    expect(decisions(report.results)).toMatchObject({ "Quiet Brand": "later", Yangra: "later", Olo: "created" });
    const next = db.tables.scheduled_jobs.find((j) => j.kind === "sprout_onboarding")!;
    expect(next).toMatchObject({ client_id: null, payload: { left: ["9001", "9100"] }, available_at: "2026-11-09T06:01:00.000Z", dedupe_key: "sprout_onboarding:rest:j1" });

    const rest = await runSproutOnboardingJob(db, job({ left: ["9001", "9100"] }), deps());
    const restReport = rest.result as { results: Array<{ brand: string; decision: string }>; left: string[] };
    expect(decisions(restReport.results)).toEqual({ "Quiet Brand": "no_posts", Yangra: "created" });
    expect(restReport.left).toEqual([]);
    expect(db.tables.scheduled_jobs.filter((j) => j.kind === "sprout_onboarding")).toHaveLength(1);
  });

  it("writes nothing in a dry run, and says for every brand what it would do, why, and what the website search found", async () => {
    const db = world();
    const before = snapshot(db);
    const report = await sproutOnboarding(db, deps(), { dryRun: true });
    expect(snapshot(db)).toBe(before);
    expect(db.rpcCalls).toEqual([]);
    expect(report).toMatchObject({ dry_run: true, created: [], left: [] });
    expect(decisions(report.results)).toMatchObject({ Olo: "would_create", Yangra: "would_create", Gone: "archived", "Moburst Careers": "client_website" });
    const olo = report.results.find((r) => r.brand === "Olo")!;
    expect(olo.reason).toMatch(/^Would be created/);
    expect(olo.website).toMatchObject({ website: "https://www.olo.com", confirmed_by: "profile_link", tried: [{ domain: "olo.com", read: true, fact: "profile_link" }] });
    expect(report.results.every((r) => typeof r.reason === "string" && r.reason.length > 0)).toBe(true);
  });

  it("never creates a brand whose confirmed website is an existing client's, and reads no posts for a person", async () => {
    const db = world();
    db.tables.clients.push({ id: "olo-real", name: "Olo Inc.", website_url: null, archived_at: null, demo_job_id: null });
    const d = deps();
    const report = await sproutOnboarding(db, d, { dryRun: true });
    // Olo now matches by name; Olo Dining's own site is the same olo.com, so it is joined to the client's brand and left to it.
    expect(decisions(report.results)).toMatchObject({ Olo: "matched", "Olo Dining": "matched", "Noah Glass": "person" });
    expect(d.postReads.flat()).not.toContain("8001");
  });

  it("totals an existing client's links across its subdomains, so a third-party site cannot take the top spot", async () => {
    const db = world();
    const hiring = p("9200", "Hiring Co", "hiringco", "facebook");
    const texts = ["https://careers.moburst.com/a https://careers.moburst.com/b", "https://jobs.moburst.com/c https://jobs.moburst.com/d", "https://partner.example/x https://partner.example/y https://partner.example/z"];
    const d = deps({
      profiles: async () => [...LISTED, hiring],
      posts: async (ids: string[]): Promise<SproutPost[]> => ids.includes("9200") ? texts.map((text) => ({ text, created_time: NOW.toISOString(), perma_link: null, profile_id: "9200" })) : [],
    });
    const report = await sproutOnboarding(db, d, { dryRun: true, only: ["9200"] });
    expect(report.results.map((r) => [r.brand, r.decision])).toEqual([["Hiring", "client_website"]]);
  });

  it("in a run's rest, still leaves a brand its website ties to a client's brand outside the rest", async () => {
    const db = world();
    db.tables.sprout_profiles.push({ id: "sp9", client_id: "olo-real", sprout_profile_id: 7001, is_active: true });
    db.tables.clients.push({ id: "olo-real", name: "Olo Restaurant Software", website_url: null, archived_at: null, demo_job_id: null });
    const report = await sproutOnboarding(db, deps(), { dryRun: true, only: ["7003"] });
    expect(report.results.map((r) => [r.brand, r.decision])).toEqual([["Olo Dining", "matched"]]);
  });
});

// The 2 Nov dry run: Sprout names a brand's profiles differently per network; its groups keep each brand whole.
describe("the job with Sprout's groups", () => {
  const G = (groups: string[], profile: SproutProfile): SproutProfile => ({ ...profile, groups });
  const GROUPS = [{ id: "11", name: "Olo" }, { id: "12", name: "Yangra" }, { id: "13", name: "Agency Team" }, { id: "14", name: "Bader Law" }, { id: "15", name: "ewc" }];
  const GROUPED = [
    G(["11"], p("7001", "Olo - Skip the Line", "olo", "facebook")), G(["11"], p("7002", "Olo App | Food Ordering", "oloapp", "fb_instagram_account")),
    G(["11"], p("7003", "Olo App | Food Ordering", "oloapp", "tiktok")),
    p("7100", "Olo", "olo_x", "twitter"),
    G(["12"], p("9100", "Yangra", "yangra", "facebook")), G(["12", "13"], p("9101", "Yangra | Hinduism for Modern Life", "yangra.life", "fb_instagram_account")),
    G(["14"], p("7480884", "Bader Law", "BaderLawLLC", "facebook")), G(["14"], p("7481075", "Bader Law Firm", "Bader Law", "youtube")),
    G(["15"], p("8800", "European Wax Center (Erie)", "ewc_erie", "facebook")), G(["15"], p("8801", "European Wax Center", "waxcenter", "fb_instagram_account")),
  ];
  const groupedDeps = () => deps({
    profiles: async () => GROUPED,
    groups: async () => GROUPS,
    posts: async (ids: string[]) => ids.includes("7001") ? Array.from({ length: 7 }, (_, i) => ({ text: `Order at https://app.olo.com/r/${i}`, created_time: NOW.toISOString(), perma_link: null, profile_id: "7002" }))
      : ids.includes("8800") ? [{ text: "Book your first wax", created_time: NOW.toISOString(), perma_link: null, profile_id: "8800" }] : [],
    reader: { resolve: async (url: string) => url, homepage: async (url: string) => (new URL(url).hostname === "olo.com" ? { html: "<p>Order online</p>", url: "https://www.olo.com/" } : null) },
  });

  it("makes one client of a group, named by the group, with every profile and the site its posts link to most", async () => {
    const db = world();
    const report = await sproutOnboarding(db, groupedDeps(), { dryRun: false });
    const olo = report.results.find((r) => r.key === "group:11")!;
    expect(olo).toMatchObject({ brand: "Olo", decision: "created", group: { id: "11", name: "Olo" }, website: { website: "https://www.olo.com", confirmed_by: "domain_name", most_linked: "app.olo.com" } });
    const made = db.tables.clients.find((c) => c.id === olo.client_id)!;
    expect(made).toMatchObject({ name: "Olo", website_url: "https://www.olo.com", origin: { brand: "Olo", profile_ids: [7001, 7002, 7003] } });
    // The loose "Olo" profile matches the client this run made, so it is not made twice.
    expect(report.results.find((r) => r.key === "7100")).toMatchObject({ decision: "matched", client_ids: [olo.client_id] });
    expect(db.tables.clients.filter((c) => c.name === "Olo" && !c.demo_job_id)).toHaveLength(1);
  });

  it("leaves a group alone when one of its profiles is in two groups, and matches a group to its client as before", async () => {
    const report = await sproutOnboarding(world(), groupedDeps(), { dryRun: true });
    const byKey = Object.fromEntries(report.results.map((r) => [r.key, r]));
    expect(byKey["group:12"]).toMatchObject({ decision: "group_conflict", reason: "Left alone: its fb_instagram_account profile yangra.life is in two Sprout groups (Yangra and Agency Team), so which brand it belongs to is unclear." });
    expect(byKey["group:13"]).toMatchObject({ decision: "group_conflict" });
    expect(byKey["group:14"]).toMatchObject({ brand: "Bader Law", decision: "matched", client_ids: ["b"] });
  });

  it("shows in the dry run each brand's Sprout group and each profile's group ids", async () => {
    const report = await sproutOnboarding(world(), groupedDeps(), { dryRun: true });
    const olo = report.results.find((r) => r.key === "group:11")!;
    expect(olo).toMatchObject({ decision: "would_create", group: { id: "11", name: "Olo" } });
    expect(olo.profiles).toEqual([
      { id: "7001", name: "Olo - Skip the Line", network: "facebook", groups: ["11"] },
      { id: "7002", name: "Olo App | Food Ordering", network: "fb_instagram_account", groups: ["11"] },
      { id: "7003", name: "Olo App | Food Ordering", network: "tiktok", groups: ["11"] },
    ]);
    expect(report.results.find((r) => r.key === "7100")).toMatchObject({ group: null, profiles: [{ id: "7100", groups: [] }], decision: "matched" });
    expect(report.results.find((r) => r.key === "group:13")!.profiles).toEqual([{ id: "9101", name: "Yangra | Hinduism for Modern Life", network: "fb_instagram_account", groups: ["12", "13"] }]);
  });

  it("names a new client as people know the brand, and keeps the group's label in its origin", async () => {
    const db = world();
    const report = await sproutOnboarding(db, groupedDeps(), { dryRun: false });
    const ewc = report.results.find((r) => r.key === "group:15")!;
    expect(ewc).toMatchObject({ brand: "European Wax Center", decision: "created", group: { id: "15", name: "ewc" } });
    expect(db.tables.clients.find((c) => c.id === ewc.client_id)).toMatchObject({ name: "European Wax Center", origin: { brand: "ewc", profile_ids: [8800, 8801] } });
  });

  it("shows in the dry run the name chosen and why", async () => {
    const report = await sproutOnboarding(world(), groupedDeps(), { dryRun: true });
    expect(report.results.find((r) => r.key === "group:15")).toMatchObject({
      brand: "European Wax Center", decision: "would_create",
      name_reason: `Named "European Wax Center": the name 2 of its 2 profile names share; the Sprout group is "ewc".`,
    });
    expect(report.results.find((r) => r.key === "group:11")!.name_reason).toMatch(/^Named "Olo": the name 3 of its 3 profile names share/);
  });

  // The team's 2 Nov decision, recorded as data (sprout_brand_declines), never as a list in code.
  const declined = (db: FakeDb, rows: Array<Record<string, unknown>>) => {
    db.tables.sprout_brand_declines = rows.map((r) => ({ note: null, declined_at: "2026-11-02T12:30:00Z", ...r }));
    let reads = 0;
    const from = db.from.bind(db);
    db.from = (t: string) => { if (t === "sprout_brand_declines") reads++; return from(t); };
    return () => reads;
  };

  it("leaves a declined brand alone for good, by its Sprout group or by one of its profiles, reading the declines once", async () => {
    const db = world();
    const reads = declined(db, [
      { id: "d1", sprout_group_id: "15", profile_ids: [8800, 8801], brand: "European Wax Center" },
      { id: "d2", sprout_group_id: null, profile_ids: [7003], brand: "Olo" },
    ]);
    const before = db.tables.clients.length;
    const report = await sproutOnboarding(db, groupedDeps(), { dryRun: false });
    const byKey = Object.fromEntries(report.results.map((r) => [r.key, r]));
    expect(byKey["group:15"]).toMatchObject({ decision: "declined", reason: "Left alone for good: a person chose not to add it as a client on Nov 2, 2026.", decline: { id: "d1" } });
    expect(byKey["group:11"]).toMatchObject({ decision: "declined", decline: { id: "d2" } });
    expect(db.tables.clients.filter((c) => ["European Wax Center", "Olo"].includes(c.name) && !c.demo_job_id)).toEqual([]);
    expect(db.tables.clients.length).toBe(before);
    expect(reads()).toBe(1);
    // The dry run says the same, and writes nothing.
    const dry = await sproutOnboarding(db, groupedDeps(), { dryRun: true });
    expect(dry.results.find((r) => r.key === "group:15")).toMatchObject({ decision: "declined" });
  });

  it("matches an assigned or removed profile first, and a decline before a name or a homepage link", async () => {
    const db = world();
    db.tables.clients.push({ id: "olo-real", name: "Olo", website_url: null, archived_at: null, demo_job_id: null });
    declined(db, [
      { id: "d3", sprout_group_id: "14", profile_ids: [], brand: "Bader Law" },
      { id: "d4", sprout_group_id: "11", profile_ids: [], brand: "Olo" },
    ]);
    const report = await sproutOnboarding(db, groupedDeps(), { dryRun: true });
    const byKey = Object.fromEntries(report.results.map((r) => [r.key, r]));
    // Bader Law's profile is assigned to its client: matched, whatever was declined.
    expect(byKey["group:14"]).toMatchObject({ decision: "matched", client_ids: ["b"] });
    // Olo's group matches the client "Olo" only by name: the decline comes first.
    expect(byKey["group:11"]).toMatchObject({ decision: "declined", decline: { id: "d4" } });
  });
});
