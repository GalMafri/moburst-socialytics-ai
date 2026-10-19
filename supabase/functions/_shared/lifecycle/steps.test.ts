import { afterEach, describe, expect, it } from "vitest";
import { deps, settled, siteKey, STEPS, weeksFor } from "./steps";
import { fakeDb, writeClientRpc } from "./fakeDb";
import type { StepRow } from "./policy";

const original = { ...deps };
afterEach(() => Object.assign(deps, original));

const T = "2026-10-19T10:00:00.000Z";
const row = (step: string, patch: Partial<StepRow> = {}): StepRow => ({
  client_id: "c1", step, inputs_key: "k", status: "done", attempts: 0, attempted_at: T, done_at: T, next_attempt_at: null, result: {}, error: null, ...patch,
});
const rowsOf = (...r: StepRow[]) => new Map(r.map((x) => [x.step, x]));
const ctx = (over: Partial<{ force: boolean; previous: StepRow | null; rows: Map<string, StepRow> }> = {}) => ({ force: false, previous: null, rows: new Map<string, StepRow>(), ...over });
const person = (...fields: string[]) => Object.fromEntries(fields.map((f) => [f, { by: "person", at: T }]));
const fail = (what: string) => async () => { throw new Error(`${what} must not be called`); };
// deno-lint-ignore no-explicit-any
const client = (over: Record<string, any> = {}) => ({
  id: "c1", name: "Moburst", website_url: "https://www.moburst.com/", field_sources: {}, timezone: "UTC", geo: "US", language: "en",
  brand_identity: null, logo_url: null, brief_text: "", brief_file_id: "", strategy_doc_file_path: null, content_pillars: [], social_keywords: [],
  primary_platforms: ["Instagram", "TikTok", "Facebook", "LinkedIn"], company_slug: null, hub_company_name: null, competitor_seed_notes: "",
  harvested_design_references: [], design_references: null, sprout_customer_id: null, location: null, voice_built_at: null, ...over,
});
const dbWith = (tables: Record<string, Record<string, unknown>[]> = {}, rpcs = {}) =>
  fakeDb({ clients: [], ...tables }, { lifecycle_write_client: writeClientRpc, ...rpcs });

const FOOTER_SITE = `<html lang="en-US"><body><h1>Growth done right</h1><footer>1250 Broadway, New York, NY 10001 <a href="https://www.linkedin.com/company/moburst/">in</a></footer></body></html>`;
const BRAND = { primary_color: "#3bd4ff", secondary_color: "#bee545", accent_color: "#ff6671", font_family: "Open Sans", visual_style: "v", logo_description: "l", tone_of_voice: "t", design_elements: "d", background_style: "b" };

describe("helpers", () => {
  it("keys a website by host and path", () => {
    expect(siteKey("https://www.Moburst.com/")).toBe("moburst.com");
    expect(siteKey("Moburst.com")).toBe("moburst.com");
    expect(siteKey("https://lega.bot/en/")).toBe("lega.bot/en");
    expect(siteKey("")).toBeNull();
  });
  it("counts a step as settled once it produced something or tried", () => {
    expect(settled(new Map(), "brand_read")).toBe(false);
    expect(settled(rowsOf(row("brand_read", { status: "running", done_at: null, attempts: 0 })), "brand_read")).toBe(false);
    expect(settled(rowsOf(row("brand_read", { status: "failed", done_at: null, attempts: 1 })), "brand_read")).toBe(true);
    expect(settled(rowsOf(row("brand_read", { status: "waiting" })), "brand_read")).toBe(true);
  });
  it("finds this week and the next in the client's timezone", () => {
    // 03:00 UTC on Monday 19 Oct is still Sunday evening in New York.
    expect(weeksFor("America/New_York", new Date("2026-10-19T03:00:00Z"))).toEqual({ today: "2026-10-18", monday: "2026-10-12", next: "2026-10-19", daysLeft: false });
    expect(weeksFor("Asia/Jerusalem", new Date("2026-10-19T03:00:00Z"))).toEqual({ today: "2026-10-19", monday: "2026-10-19", next: "2026-10-26", daysLeft: true });
    expect(weeksFor("Not/AZone", new Date("2026-10-21T12:00:00Z")).monday).toBe("2026-10-19");
  });
});

describe("brand_read", () => {
  it("waits for a website, and keys on it", async () => {
    expect(await STEPS.brand_read.inputs(dbWith(), client({ website_url: null }), new Map())).toBeNull();
    expect(await STEPS.brand_read.inputs(dbWith(), client(), new Map())).toBe("moburst.com");
  });
  it("reads the timezone from the footer without a model call when the brand and logo were set by a person", async () => {
    const c = client({ field_sources: person("brand_identity", "logo_url"), brand_identity: BRAND, logo_url: "https://x/logo.png" });
    const db = dbWith({ clients: [c] });
    deps.fetchSiteHtml = async () => ({ html: FOOTER_SITE, via: "direct" as const });
    deps.researchBrand = fail("the brand read");
    const out = await STEPS.brand_read.run(db, c, ctx());
    expect(out).toMatchObject({ status: "done", result: { model_read: false, timezone: "America/New_York", timezone_source: "page_footer", country: "US", site_profiles: ["linkedin:moburst"] } });
    expect(c.timezone).toBe("America/New_York");
    expect(c.location).toMatchObject({ source: "page_footer", website: "moburst.com" });
    expect(c.brand_identity).toBe(BRAND);
    expect(c.field_sources.timezone).toMatchObject({ by: "lifecycle" });
  });
  it("reads the brand when the lifecycle may write it, and never writes over a person's timezone", async () => {
    const c = client({ field_sources: person("timezone"), timezone: "America/Chicago" });
    const db = dbWith({ clients: [c] });
    deps.fetchSiteHtml = async () => ({ html: "<html><body>Hi</body></html>", via: "direct" as const });
    deps.openaiKey = async () => "sk";
    let page: unknown = null;
    deps.researchBrand = (async (a: { page?: unknown }) => {
      page = a.page;
      return { brand_identity: BRAND, headquarters: { city: "Denver", region: "CO", country: "US" }, site_language: "en", logo: { url: "https://moburst.com/logo.svg" }, html: "", url: "", fetched_via: "direct", debug: {} };
    }) as never;
    const out = await STEPS.brand_read.run(db, c, ctx());
    expect(page).toMatchObject({ via: "direct" });
    expect(out).toMatchObject({ status: "done", result: { model_read: true, timezone: "America/Denver", timezone_source: "site_read" } });
    expect((out as { result: { written: string[] } }).result.written).not.toContain("timezone");
    expect(c).toMatchObject({ brand_identity: BRAND, logo_url: "https://moburst.com/logo.svg", timezone: "America/Chicago" });
  });
  it("tries again quietly when the site cannot be read", async () => {
    const { ResearchError } = await import("../brand/research");
    deps.fetchSiteHtml = async () => { throw new ResearchError("site_unreachable", "The website could not be read."); };
    expect(await STEPS.brand_read.run(dbWith({ clients: [client()] }), client(), ctx())).toEqual({ status: "failed", error: "The website could not be read." });
  });
});

describe("brief_pillars", () => {
  const read = rowsOf(row("brand_read"));
  it("waits for the brand read, and keys on what a person provides, never on the brief it drafts", async () => {
    expect(await STEPS.brief_pillars.inputs(dbWith(), client(), new Map())).toBeNull();
    const before = await STEPS.brief_pillars.inputs(dbWith(), client(), read);
    const after = await STEPS.brief_pillars.inputs(dbWith(), client({ brief_text: "Drafted from the website on 2026-10-19:\n\nText", field_sources: { brief_text: { by: "lifecycle" }, content_pillars: { by: "lifecycle" } } }), read);
    expect(after).toBe(before);
    expect(await STEPS.brief_pillars.inputs(dbWith(), client({ brief_text: "A brief a person wrote.", field_sources: person("brief_text") }), read)).not.toBe(before);
    expect(await STEPS.brief_pillars.inputs(dbWith(), client({ strategy_doc_file_path: "x/strategy.pdf" }), read)).not.toBe(before);
  });
  it("drafts a brief from the site when there is none, then derives pillars and keywords", async () => {
    const c = client();
    const db = dbWith({ clients: [c] });
    deps.scrapeMarkdown = async () => ({ markdown: "# Moburst helps the world's biggest apps grow with paid, organic and creative work.", title: "Moburst" });
    deps.anthropicKey = async () => "key";
    deps.now = () => new Date(T);
    deps.derivePillars = (async (_db: unknown, evidence: { brief_text: string }) => {
      expect(evidence.brief_text).toMatch(/^Drafted from the website on 2026-10-19:/);
      return { pillars: [{ name: "App growth", description: "d", rationale: "r" }], keywords: ["app marketing"], notes: "", sources: ["brief"], source: "brief", derived_at: T };
    }) as never;
    const out = await STEPS.brief_pillars.run(db, c, ctx({ rows: read }));
    expect(out).toMatchObject({ status: "done", result: { brief: "drafted", pillars: "derived", pillar_names: ["App growth"], keywords: 1 } });
    expect(c.brief_text).toBe("Drafted from the website on 2026-10-19:\n\nMoburst helps the world's biggest apps grow with paid, organic and creative work.");
    expect(c).toMatchObject({ content_pillars: [{ name: "App growth" }], pillars_source: "brief", social_keywords: ["app marketing"] });
  });
  it("calls nothing when a person set the brief, the pillars and the keywords", async () => {
    deps.scrapeMarkdown = fail("the scrape");
    deps.derivePillars = fail("the derivation");
    const c = client({ brief_text: "Brief", content_pillars: [{ name: "Ours" }], social_keywords: ["k"], field_sources: person("brief_text", "content_pillars", "social_keywords") });
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [c] }), c, ctx())).toEqual({ status: "done", result: { brief: "kept", pillars: "kept" } });
  });
  it("replaces the five generic pillars and keeps a person's brief as the evidence", async () => {
    const c = client({ brief_text: "A real brief about growth marketing for apps and games.", field_sources: person("brief_text"),
      content_pillars: ["Thought Leadership", "Product Education", "Client Wins", "Industry Trends", "Team Culture"].map((name) => ({ name, description: "" })) });
    deps.scrapeMarkdown = fail("the scrape");
    deps.anthropicKey = async () => "key";
    deps.derivePillars = (async (_db: unknown, evidence: { brief_text: string }, _k: string, opts: { siteText: string | null }) => {
      expect(evidence.brief_text).toBe(c.brief_text);
      expect(opts.siteText).toBeNull();
      return { pillars: [{ name: "Growth", description: "d", rationale: "r" }], keywords: [], notes: "", sources: ["brief"], source: "brief", derived_at: T };
    }) as never;
    const out = await STEPS.brief_pillars.run(dbWith({ clients: [c] }), c, ctx());
    expect(out).toMatchObject({ status: "done", result: { brief: "kept", pillars: "derived" } });
    expect(c.content_pillars).toEqual([{ name: "Growth", description: "d", rationale: "r" }]);
  });
  it("waits quietly when there is nothing to read yet", async () => {
    const { PillarsError } = await import("../brand/pillars");
    deps.scrapeMarkdown = async () => null;
    deps.fetchSiteText = async () => "";
    deps.anthropicKey = async () => "key";
    deps.derivePillars = async () => { throw new PillarsError("no_evidence", "There is nothing to read yet."); };
    const c = client();
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [c] }), c, ctx())).toMatchObject({ status: "waiting", reason: "evidence", recheckDays: 7 });
  });
});

describe("accounts", () => {
  const sprout = [
    { id: "5719052", name: "Moburst - Growth Done Right", native_name: "moburst", network_type: "linkedin_company", native_link: "", status: "active" },
    { id: "5489335", name: "Moburst | Mobile-First Digital Agency", native_name: "moburst.agency", network_type: "fb_instagram_account", native_link: "", status: "active" },
    { id: "9", name: "Moburst", native_name: "moburstfb", network_type: "facebook", native_link: "", status: "active" },
    { id: "7480884", name: "Bader Law", native_name: "BaderLawLLC", network_type: "facebook", native_link: "", status: "active" },
  ];
  const read = rowsOf(row("brand_read", { result: { site_profiles: ["linkedin:moburst", "instagram:moburst.agency"] } }));
  it("assigns the profiles both rules find, never a removed one, and names the platforms", async () => {
    const c = client();
    const db = dbWith({ clients: [c], sprout_profiles: [{ client_id: "other", sprout_profile_id: 7480884, network_type: "facebook", is_active: true }], sprout_profile_removals: [{ client_id: "c1", sprout_profile_id: 9 }] });
    deps.listCustomerProfiles = async () => sprout;
    const out = await STEPS.accounts.run(db, c, ctx({ rows: read }));
    expect(out).toMatchObject({ status: "done", result: { profiles: 4, matched: [{ id: "5719052", by: ["site_link"] }, { id: "5489335", by: ["site_link"] }], platforms: ["Instagram", "LinkedIn"] } });
    expect(db.tables.sprout_profiles.filter((r) => r.client_id === "c1").map((r) => r.sprout_profile_id)).toEqual([5719052, 5489335]);
    expect(c.primary_platforms).toEqual(["Instagram", "LinkedIn"]);
  });
  it("keeps the platforms a person chose", async () => {
    const c = client({ primary_platforms: ["LinkedIn"], field_sources: person("primary_platforms") });
    deps.listCustomerProfiles = async () => sprout;
    await STEPS.accounts.run(dbWith({ clients: [c], sprout_profiles: [], sprout_profile_removals: [] }), c, ctx({ rows: read }));
    expect(c.primary_platforms).toEqual(["LinkedIn"]);
  });
  it("waits for the brand read before reading the site's links, and keys on removals", async () => {
    const db = dbWith({ sprout_profile_removals: [] });
    expect(await STEPS.accounts.inputs(db, client(), new Map())).toBeNull();
    const a = await STEPS.accounts.inputs(db, client(), read);
    db.tables.sprout_profile_removals.push({ client_id: "c1", sprout_profile_id: 9 });
    expect(await STEPS.accounts.inputs(db, client(), read)).not.toBe(a);
  });
});

describe("access", () => {
  it("sets the slug by the portal's rule, waits when another client holds it, and keeps one that exists", async () => {
    const c = client({ name: "Pay The Pyper" });
    const db = dbWith({ clients: [c] });
    expect(await STEPS.access.run(db, c, ctx())).toMatchObject({ status: "done", result: { slug: "pay-the-pyper", set_by: "lifecycle" } });
    expect(c.company_slug).toBe("pay-the-pyper");
    const d = client({ id: "c2", name: "Pay the Pyper!" });
    db.tables.clients.push(d);
    expect(await STEPS.access.run(db, d, ctx())).toMatchObject({ status: "waiting", reason: "slug_taken", recheckDays: 1 });
    expect(await STEPS.access.run(db, c, ctx())).toMatchObject({ status: "done", result: { slug: "pay-the-pyper" } });
  });
});

describe("competitors", () => {
  const settledRows = rowsOf(row("brief_pillars"));
  it("never touches a client with a current set, and waits for the brief and pillars", async () => {
    const db = dbWith({ competitor_sets: [{ id: "s1", client_id: "c1", status: "complete", confirmed_at: T, created_at: T }] });
    expect(await STEPS.competitors.inputs(db, client(), new Map())).toBe("existing:s1");
    expect(await STEPS.competitors.run(db, client(), ctx())).toEqual({ status: "done", result: { set_id: "s1", status: "complete", source: "existing" } });
    expect(await STEPS.competitors.inputs(dbWith({ competitor_sets: [{ id: "d", client_id: "c1", status: "draft", created_at: T }] }), client(), new Map())).toBeNull();
    expect(await STEPS.competitors.inputs(dbWith({ competitor_sets: [] }), client(), settledRows)).toMatch(/^site:moburst\.com\|notes:/);
  });
  it("identifies first, then picks the three closest with a website and confirms as the system", async () => {
    const db = dbWith({ competitor_sets: [], competitors: [] });
    deps.anthropicKey = async () => "key";
    deps.identifyCompetitors = (async (d: typeof db) => {
      d.tables.competitor_sets.push({ id: "draft1", client_id: "c1", status: "draft", created_at: T });
      for (const [i, n] of ["Phiture", "Gummicube", "NoSite", "SplitMetrics", "Yodel"].entries()) {
        d.tables.competitors.push({ id: `k${i}`, set_id: "draft1", client_id: "c1", name: n, website_url: n === "NoSite" ? null : `https://${n.toLowerCase()}.com`, similarity_score: 0.9 - i * 0.1, is_selected: false, selected_rank: null });
      }
      return { set_id: "draft1", competitors: d.tables.competitors, rejected: [] };
    }) as never;
    const first = await STEPS.competitors.run(db, client(), ctx({ rows: settledRows }));
    expect(first).toEqual({ status: "waiting", reason: "in_progress", recheckMinutes: 1, result: { draft_set_id: "draft1", proposed: 5 } });

    const detected: string[] = [];
    deps.detectCompetitorHandles = (async (_d: unknown, list: Array<{ name: string }>) => { detected.push(...list.map((c) => c.name)); return { results: [], writeErrors: [] }; }) as never;
    let confirmedBy: unknown = "unset";
    deps.confirmDraftSet = (async (_d: unknown, id: string, o: { confirmedBy: string | null }) => {
      confirmedBy = o.confirmedBy;
      db.tables.competitor_sets.find((s) => s.id === id)!.status = "confirmed";
      return { confirmed: true, selected: [] };
    }) as never;
    const previous = row("competitors", { status: "waiting", result: { draft_set_id: "draft1", waiting_for: "in_progress" } });
    const second = await STEPS.competitors.run(db, client(), ctx({ previous, rows: settledRows }));
    expect(second).toMatchObject({ status: "done", result: { set_id: "draft1", selected: ["Phiture", "Gummicube", "SplitMetrics"], created: true } });
    expect(db.tables.competitors.filter((c) => c.is_selected).map((c) => [c.name, c.selected_rank])).toEqual([["Phiture", 1], ["Gummicube", 2], ["SplitMetrics", 3]]);
    expect(detected.sort()).toEqual(["Gummicube", "Phiture", "SplitMetrics"]);
    expect(confirmedBy).toBeNull();
  });
});

describe("tracking", () => {
  const set = (over = {}) => ({ id: "s1", client_id: "c1", status: "confirmed", confirmed_at: T, created_at: T, rivaliq_landscape_id: null, tracking_check: null, ...over });
  it("waits for a confirmed set", async () => {
    expect(await STEPS.tracking.inputs(dbWith({ competitor_sets: [] }), client(), new Map())).toBeNull();
  });
  it("takes each tracked company's handles from RivalIQ once a landscape is linked, and only once", async () => {
    const db = dbWith({ competitor_sets: [set({ rivaliq_landscape_id: "L1", tracking_check: { code: "ok" } })] });
    let syncs = 0;
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.advanceSetupOnServer = fail("the setup");
    deps.syncTrackedHandles = (async () => { syncs++; return { client: { company_id: "RC0", name: "Moburst", url: null, handles: [] }, competitors: 3, handles: 9 }; }) as never;
    const out = await STEPS.tracking.run(db, client(), ctx());
    expect(out).toMatchObject({ status: "done", result: { landscape_id: "L1", synced_landscape: "L1", competitors_matched: 3, client_company: { company_id: "RC0" } } });
    const again = await STEPS.tracking.run(db, client(), ctx({ rows: rowsOf(row("tracking", { result: (out as { result: Record<string, unknown> }).result })) }));
    expect(again.status).toBe("done");
    expect(syncs).toBe(1);
  });
  it("sets tracking up again when the linked landscape is gone, and waits quietly while RivalIQ adds the companies", async () => {
    const db = dbWith({ competitor_sets: [set({ rivaliq_landscape_id: "L1", tracking_check: { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "L1" } })] });
    const resets: unknown[] = [];
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.now = () => new Date(T);
    deps.resetTracking = (async (_d: unknown, id: string, l: string) => { resets.push([id, l]); }) as never;
    deps.advanceSetupOnServer = (async () => ({ state: "pending", phase: "following", landscape_id: "L2", since: T })) as never;
    expect(await STEPS.tracking.run(db, client(), ctx())).toMatchObject({ status: "waiting", reason: "in_progress", recheckMinutes: 5, result: { phase: "following" } });
    expect(resets).toEqual([["s1", "L1"]]);
  });
  it("waits for a usable selection, and tries again quietly without a key", async () => {
    const { SetupError } = await import("../competitive/rivaliqSetupRun");
    const db = dbWith({ competitor_sets: [set()] });
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.advanceSetupOnServer = async () => { throw new SetupError("selection", "Use the company website rather than a social-profile URL."); };
    expect(await STEPS.tracking.run(db, client(), ctx())).toMatchObject({ status: "waiting", reason: "selection" });
    deps.rivaliqKey = () => null;
    expect(await STEPS.tracking.run(db, client(), ctx())).toMatchObject({ status: "failed" });
  });
});

describe("design_settings", () => {
  const refs = rowsOf(row("design_refs", { result: { synthesized_at: T } }));
  const c = () => client({ logo_url: "https://moburst.com/logo.svg", brand_identity: { ...BRAND, secondary_color: "#0c1d2f" }, harvested_design_references: [{ path: "c1/social-a.jpg" }, { path: "c1/social-b.jpg" }] });
  it("waits for learned references and a logo, and leaves a person's settings alone", async () => {
    expect(await STEPS.design_settings.inputs(dbWith({ design_brand_settings: [] }), c(), new Map())).toBeNull();
    expect(await STEPS.design_settings.inputs(dbWith({ design_brand_settings: [] }), client(), refs)).toBeNull();
    const personRow = dbWith({ design_brand_settings: [{ client_id: "c1", source: "person" }] });
    expect(await STEPS.design_settings.inputs(personRow, c(), refs)).toBe("person");
    expect(await STEPS.design_settings.run(personRow, c(), ctx({ rows: refs }))).toEqual({ status: "done", result: { kept: "person" } });
  });
  it("derives the logo file, the placement from the client's posts and the background from the brand colors", async () => {
    const db = dbWith({ design_brand_settings: [] }, { lifecycle_write_design_settings: () => true });
    deps.anthropicKey = async () => "key";
    deps.now = () => new Date(T);
    deps.imaging = (async () => ({
      logoPng: async () => ({ path: "c1/design-settings/logo-site-1.png", width: 600, height: 200, ink: [255, 255, 255] as [number, number, number], converted: "from_svg" as const }),
      readLogoSpot: async () => ({ shown: true, at: "top-center" as const, width: 0.3 }),
    })) as never;
    const out = await STEPS.design_settings.run(db, c(), ctx({ rows: refs }));
    expect(out).toMatchObject({ status: "done", result: { written: true, placement: { anchor: "center", width: 0.3, top: 0.04 }, placement_from: "client_posts", background: "#0C1D2F", background_from: "brand_color", references: 2 } });
    expect(db.rpcCalls[0]).toMatchObject({ name: "lifecycle_write_design_settings", args: { p_client: "c1", p_logo_path: "c1/design-settings/logo-site-1.png", p_reference_paths: ["c1/social-a.jpg", "c1/social-b.jpg"], p_derived: { placement_from: "client_posts", logo_file: "from_svg" } } });
  });
});

describe("first_output", () => {
  it("waits for the brief and the accounts, then keys on plans, voice and the first report", async () => {
    const db = dbWith({ calendar_plans: [{ client_id: "c1", week_start: "2026-10-26" }], reports: [], report_schedules: [{ client_id: "c1", id: "s" }] });
    deps.now = () => new Date("2026-10-20T12:00:00Z");
    expect(await STEPS.first_output.inputs(db, client({ timezone: "America/New_York" }), rowsOf(row("brief_pillars")))).toBeNull();
    const rows = rowsOf(row("brief_pillars"), row("accounts"));
    expect(await STEPS.first_output.inputs(db, client({ timezone: "America/New_York" }), rows)).toBe("week:2026-10-19|plans:01|voice:0|report:0|schedules:1");
    expect(await STEPS.first_output.inputs(db, client({ exclude_from_reporting: true }), rows)).toBeNull();
  });
  it("asks the database for the plans and the first report in one call", async () => {
    const db = dbWith({}, { lifecycle_first_output: () => ({ week: "2026-10-19", weeks_requested: ["2026-10-19", "2026-10-26"], first_report: "started" }) });
    expect(await STEPS.first_output.run(db, client(), ctx())).toEqual({ status: "done", result: { week: "2026-10-19", weeks_requested: ["2026-10-19", "2026-10-26"], first_report: "started" } });
  });
});
