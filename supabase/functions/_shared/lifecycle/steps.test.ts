import { createHash } from "node:crypto";
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

describe("website", () => {
  // A client the Sprout onboarding added with no confirmed website: Olo-shaped, two assigned profiles.
  const olo = (over: Record<string, unknown> = {}) => client({ id: "c1", name: "Olo", website_url: null, ...over });
  const profiles = () => [
    { client_id: "c1", sprout_profile_id: 7, profile_name: "Olo", native_name: "olo", network_type: "linkedin_company", native_link: "", is_active: true },
    { client_id: "c1", sprout_profile_id: 8, profile_name: "Olo", native_name: "olo.hq", network_type: "fb_instagram_account", native_link: "", is_active: true },
    { client_id: "c1", sprout_profile_id: 9, profile_name: "Olo old", native_name: "oloold", network_type: "facebook", native_link: "", is_active: false },
  ];
  const site = (pages: Record<string, string>) => () => ({
    resolve: async (url: string) => url,
    homepage: async (url: string) => (new URL(url).hostname in pages ? { html: pages[new URL(url).hostname], url: `https://www.${new URL(url).hostname}/` } : null),
  });

  it("is the first step", () => {
    expect(Object.keys(STEPS)[0]).toBe("website");
  });
  it("never runs when the client has a website or a person set it, and waits for the client's profiles", async () => {
    const db = dbWith({ sprout_profiles: profiles() });
    expect(await STEPS.website.inputs(db, client(), new Map())).toBeNull();
    expect(await STEPS.website.inputs(db, olo({ field_sources: person("website_url") }), new Map())).toBeNull();
    expect(await STEPS.website.inputs(dbWith({ sprout_profiles: [] }), olo(), new Map())).toBeNull();
    expect(await STEPS.website.inputs(db, olo(), new Map())).toBe("profiles:7,8|name:olo");
  });
  it("writes the website its posts confirm, as the lifecycle's, so brand_read gets its input", async () => {
    const c = olo();
    const db = dbWith({ clients: [c], sprout_profiles: profiles() });
    deps.now = () => new Date(T);
    let asked: unknown = null;
    deps.listBrandPosts = (async (ids: string[], o: { since: Date; until: Date; pages?: number }) => {
      asked = { ids, since: o.since.toISOString(), until: o.until.toISOString(), pages: o.pages };
      return [{ text: "Order ahead at https://www.olo.com/order", created_time: T, perma_link: null, profile_id: "7" }];
    }) as never;
    deps.siteReader = site({ "olo.com": `<a href="https://www.instagram.com/olo.hq/">ig</a>` }) as never;
    deps.searchWeb = fail("the web search");
    const out = await STEPS.website.run(db, c, ctx());
    // 12 months, every page Sprout returns (up to the cap).
    expect(asked).toEqual({ ids: ["7", "8"], since: "2025-10-19T10:00:00.000Z", until: T, pages: 40 });
    expect(out).toMatchObject({ status: "done", result: { website: "https://www.olo.com", confirmed_by: "profile_link", linked_network: "fb_instagram_account", posts: 1, months: 12, written: ["website_url"] } });
    expect(c.website_url).toBe("https://www.olo.com");
    expect(c.field_sources.website_url).toMatchObject({ by: "lifecycle" });
    expect(await STEPS.brand_read.inputs(db, c, new Map())).toBe("olo.com");
    expect(await STEPS.website.inputs(db, c, new Map())).toBeNull();
  });
  it("waits 7 days when no linked site is confirmed", async () => {
    const c = olo();
    deps.listBrandPosts = (async () => [{ text: "See https://partner.example", created_time: T, perma_link: null, profile_id: "7" }]) as never;
    deps.siteReader = site({ "partner.example": "<p>Partner</p>" }) as never;
    const out = await STEPS.website.run(dbWith({ clients: [c], sprout_profiles: profiles() }), c, ctx());
    expect(out).toMatchObject({ status: "waiting", reason: "website", recheckDays: 7, result: { posts: 1, most_linked: "partner.example" } });
    expect(c.website_url).toBeNull();
  });
  it("replaces nothing a person set, even when asked to run", async () => {
    const c = olo({ website_url: "https://olo-person.example", field_sources: person("website_url") });
    deps.listBrandPosts = fail("the post read");
    expect(await STEPS.website.run(dbWith({ clients: [c], sprout_profiles: profiles() }), c, ctx())).toEqual({ status: "done", result: { kept: true } });
    expect(c.website_url).toBe("https://olo-person.example");
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

describe("brief_pillars always leaves a brief (the reports send only brief_text)", () => {
  // Pay The Pyper on 19 Oct: no brief text, a Google Doc brief file the server cannot open, a strategy PDF in app storage,
  // and pillars and keywords a person set.
  const ptp = () => client({ name: "Pay The Pyper", website_url: "https://paythepyper.com/", brief_text: "", brief_file_id: "1AbCdEfGhIjKlMnOpQrStUvWxYz", strategy_doc_file_path: "Pay-The-Pyper/strategy-new-1791888334819.pdf",
    content_pillars: [{ name: "Captain Confessions" }], social_keywords: ["beer league"], field_sources: person("brand_identity", "logo_url", "timezone", "content_pillars", "social_keywords") });
  const read = rowsOf(row("brand_read"));
  it("writes the brief from the strategy document's own words, as the lifecycle's, and calls nothing else", async () => {
    const c = ptp();
    const db = dbWith({ clients: [c] });
    const docs: string[] = [];
    deps.now = () => new Date(T);
    deps.anthropicKey = async () => "key";
    deps.briefFromStrategyDoc = (async (_db: unknown, path: string) => { docs.push(path); return { text: "Pay The Pyper is built around the Captain's biggest headaches: attendance, payments, open spots and subs.", via: "pdf" as const }; }) as never;
    deps.scrapeMarkdown = fail("the scrape");
    deps.derivePillars = fail("the derivation");
    const out = await STEPS.brief_pillars.run(db, c, ctx({ rows: read }));
    expect(out).toMatchObject({ status: "done", result: { brief: "from_doc", brief_doc: "Pay-The-Pyper/strategy-new-1791888334819.pdf", pillars: "kept", written: ["brief_text"] } });
    expect(docs).toEqual(["Pay-The-Pyper/strategy-new-1791888334819.pdf"]);
    expect(c.brief_text).toBe("From the strategy document, read on 2026-10-19:\n\nPay The Pyper is built around the Captain's biggest headaches: attendance, payments, open spots and subs.");
    expect(c.field_sources.brief_text).toMatchObject({ by: "lifecycle" });
    // Run again on the same document: the brief it copied is kept, and the document is not read again.
    const again = await STEPS.brief_pillars.run(db, c, ctx({ rows: rowsOf(row("brand_read"), row("brief_pillars", { result: (out as { result: Record<string, unknown> }).result })) }));
    expect(again).toMatchObject({ status: "done", result: { brief: "from_doc" } });
    expect(docs).toHaveLength(1);
  });
  it("never replaces a brief a person wrote, whatever documents exist", async () => {
    const c = { ...ptp(), brief_text: "Our brief, written by the account team.", field_sources: person("brief_text", "content_pillars", "social_keywords") };
    deps.briefFromStrategyDoc = fail("the document read");
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [c] }), c, ctx({ rows: read }))).toEqual({ status: "done", result: { brief: "kept", pillars: "kept" } });
    expect(c.brief_text).toBe("Our brief, written by the account team.");
  });
  it("drafts from the site when the document cannot be read here, a brief file id being no brief", async () => {
    const c = { ...ptp(), strategy_doc_file_path: "Pay-The-Pyper/strategy.docx" };
    deps.now = () => new Date(T);
    deps.anthropicKey = async () => "key";
    deps.briefFromStrategyDoc = async () => null;
    deps.scrapeMarkdown = async () => ({ markdown: "Pay The Pyper keeps rec league captains from chasing payments and texts every week.", title: null });
    const out = await STEPS.brief_pillars.run(dbWith({ clients: [c] }), c, ctx({ rows: read }));
    expect(out).toMatchObject({ status: "done", result: { brief: "drafted" } });
    expect(c.brief_text).toMatch(/^Drafted from the website on 2026-10-19:\n\nPay The Pyper keeps rec league captains/);
  });
  it("tries again quietly when the document's read does not finish, and holds the first report until it has", async () => {
    const { PillarsError } = await import("../brand/pillars");
    const c = ptp();
    deps.anthropicKey = async () => "key";
    deps.briefFromStrategyDoc = async () => { throw new PillarsError("model", "The strategy document came back with almost no text."); };
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [c] }), c, ctx({ rows: read }))).toEqual({ status: "failed", error: "The strategy document came back with almost no text." });
    const db = dbWith({ calendar_plans: [], reports: [], report_schedules: [] });
    const failing = rowsOf(row("brief_pillars", { status: "failed", attempts: 1, done_at: null }), row("accounts"));
    expect(await STEPS.first_output.inputs(db, c, failing)).toBeNull();
    const wrote = rowsOf(row("brief_pillars"), row("accounts"));
    expect(await STEPS.first_output.inputs(db, c, wrote)).toMatch(/^week:/);
    expect(await STEPS.first_output.inputs(db, { ...c, brief_text: "A brief" }, failing)).toMatch(/^week:/);
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

describe("content_strategy", () => {
  const PROFILE_AT = "2026-11-01T08:00:00.000Z";
  const trendIO = () => ({ ownPosts: async () => ({ posts: [] }), feedSnapshots: async () => [], competitorSet: async () => [], siteText: async () => "" });
  const c = (over = {}) => client({ brief_text: "Pay The Pyper keeps captains from chasing payments.", content_pillars: [{ name: "Captain Life" }], posting_rhythm: null, ...over });
  const tables = () => ({
    clients: [{ id: "c1", brand_book_text: "" }],
    trend_profiles: [{ client_id: "c1", audience: "Captains.", fit_rubric: "Fits.", platforms: [{ platform: "instagram", reason: "primary" }], written_at: PROFILE_AT }],
    sprout_profiles: [{ client_id: "c1", sprout_profile_id: 1, network_type: "fb_instagram_account", native_name: "pyper", is_active: true }],
    content_strategy_edits: [{ client_id: "c1", section_key: "goals", text: "Our own goals.", editor_name: "Neria", edited_at: T }],
  });
  /** The trend profile's step row, done on the inputs it would have now. */
  const current = async (db: ReturnType<typeof dbWith>, cl = c(), patch: Partial<StepRow> = {}) => {
    const settledRows = rowsOf(row("brief_pillars"), row("competitors"));
    const key = await STEPS.trend_profile.inputs(db, cl, settledRows);
    return rowsOf(row("brief_pillars"), row("competitors"), row("trend_profile", { inputs_key: key, ...patch }));
  };

  it("waits for a trend profile that is done and current", async () => {
    deps.trendIO = trendIO;
    const db = dbWith(tables());
    expect(await STEPS.content_strategy.inputs(db, c(), new Map())).toBeNull();
    expect(await STEPS.content_strategy.inputs(db, c(), await current(db, c(), { status: "running" }))).toBeNull();
    expect(await STEPS.content_strategy.inputs(db, c(), await current(db, c(), { status: "failed", attempts: 1 }))).toBeNull();
    // The brief changed since the profile was written: the profile is rewritten first, then the strategy.
    const stale = await current(db, c());
    expect(await STEPS.content_strategy.inputs(db, c({ brief_text: "A new brief." }), stale)).toBeNull();
    expect(await STEPS.content_strategy.inputs(db, c(), stale)).toMatch(/^v2\|profile:2026-11-01T08:00:00.000Z\|networks:fb_instagram_account\|rhythm:[^|]+\|public:[^|]+/);
  });

  it("keys on the profile's date, the active Sprout networks and the posting rhythm, never on people's versions", async () => {
    deps.trendIO = trendIO;
    const db = dbWith(tables());
    const rows = await current(db);
    const key = await STEPS.content_strategy.inputs(db, c(), rows);
    db.tables.content_strategy_edits.push({ client_id: "c1", section_key: "audience", text: "Captains and co-captains.", editor_name: "Neria", edited_at: T });
    db.tables.content_strategy_edits[0].text = "Changed goals.";
    expect(await STEPS.content_strategy.inputs(db, c(), rows)).toBe(key);
    expect(await STEPS.content_strategy.inputs(db, c({ posting_rhythm: { instagram: 3 } }), rows)).not.toBe(key);
    db.tables.sprout_profiles.push({ client_id: "c1", sprout_profile_id: 2, network_type: "tiktok", native_name: "pyper", is_active: true });
    const withTikTok = await STEPS.content_strategy.inputs(db, c(), rows);
    expect(withTikTok).not.toBe(key);
    db.tables.trend_profiles[0].written_at = "2026-11-02T08:00:00.000Z";
    expect(await STEPS.content_strategy.inputs(db, c(), rows)).not.toBe(withTikTok);
  });

  it("refreshes monthly and comes after the trend steps", () => {
    expect(STEPS.content_strategy.policy).toEqual({ refreshDays: 30 });
    const order = Object.keys(STEPS);
    expect(order.indexOf("content_strategy")).toBe(order.indexOf("trend_hashtags") + 1);
  });

  describe("a write", () => {
    const io = () => ({
      gather: async () => ({ own: [], learnedRhythm: [], evidence: [], avoid: [], thin: [], examples: {}, fallbackRates: { competitors: { Instagram: 2 }, allTracked: {} } }),
      trackedRates: async () => ({}),
      voiceBlock: async () => "How Pay The Pyper writes.",
      competitiveBrief: async () => "",
      competitorSet: async () => [],
      siteText: async () => "",
      feedSnapshots: async () => [],
    });
    const goal = (title: string) => ({ title, why: "A steady pace builds the habit.", platform: "Instagram", metric: "posts_per_week", direction: "above" });
    const draft = {
      goals: [goal("Grow saves"), goal("Post every week")],
      audience: { who: "Captains.", wants: ["Less chasing", "Fair splits", "Time back"], where: ["Instagram"] },
      positioning: { statement: "The captain's app.", points: [] },
      pillars: [{ name: "Captain Life", purpose: "Checklists.", formats: ["carousel"], planned_share: 100, ideas: [{ hook: "Tu checklist", format: "carousel" }, { hook: "Martes", format: "reel" }] }],
      platforms: [{ platform: "Instagram", role: "Launch with carousels.", post: ["Checklists", "Reminders", "Tips"], worked: [], first_30: ["Set up", "Three posts", "Replies", "Review"], checks: { day_30: "Saves", day_90: "Follows" } }],
      candidates: [],
      avoid: [{ pattern: "Office photos", source: "posts" }],
    };
    const answers = (...texts: string[]) => {
      const models: string[] = [];
      deps.claudeMessages = (async ({ body }: { body: { model: string } }) => {
        models.push(body.model);
        return { text: texts.shift() ?? "", stopReason: "end_turn", raw: { usage: { input_tokens: 1, output_tokens: 1 } } };
      }) as never;
      return models;
    };
    /** Every write the step makes, by table. */
    const watched = (db: ReturnType<typeof dbWith>) => {
      const writes: string[] = [];
      const from = db.from.bind(db);
      db.from = (table: string) => {
        const q = from(table);
        for (const op of ["insert", "upsert", "update", "delete"]) {
          const original = q[op].bind(q);
          q[op] = (...args: unknown[]) => { writes.push(`${op} ${table}`); return original(...args); };
        }
        return q;
      };
      return writes;
    };

    const setUp = (db: ReturnType<typeof dbWith>) => {
      let gathered = 0;
      deps.trendIO = trendIO;
      deps.strategyIO = () => ({ ...io(), gather: async () => { gathered++; return io().gather(); } });
      deps.anthropicKey = async () => "key";
      deps.now = () => new Date("2026-11-02T10:00:00.000Z");
      return { gathered: () => gathered, writes: watched(db) };
    };
    const clean = JSON.stringify({ unsupported: [] });
    const flagged = JSON.stringify({ unsupported: [{ section: "goals", statement: "Grow saves" }] });
    const stored = { client_id: "c1", sections: { goals: "The last good goals." }, inputs_key: "old", written_at: "2026-10-01T00:00:00.000Z", pending: null };

    it("makes one model call per run: writes in one run, checks in the next, and only then stores the strategy", async () => {
      const db = dbWith(tables());
      const rows = await current(db);
      const t = setUp(db);
      const models = answers(JSON.stringify(draft), clean);
      const edits = structuredClone(db.tables.content_strategy_edits);

      const first = await STEPS.content_strategy.run(db, c(), ctx({ rows }));
      expect(first).toMatchObject({ status: "waiting", reason: "in_progress", recheckMinutes: 1, result: { phase: "check" } });
      expect(models).toEqual(["claude-opus-5-5"]);
      expect(db.tables.content_strategies[0].pending).toMatchObject({ phase: "check", inputs_key: await STEPS.content_strategy.inputs(db, c(), rows) });
      expect(db.tables.content_strategies[0].written_at).toBeUndefined();

      const second = await STEPS.content_strategy.run(db, c(), ctx({ rows }));
      expect(second).toMatchObject({ status: "done", result: { platforms: { posting: 0, new: 1, not_now: 0 }, calls: { writer: 1, checker: 1 } } });
      expect(models).toEqual(["claude-opus-5-5", "claude-sonnet-5-5"]);
      // The evidence is read once, when the write starts.
      expect(t.gathered()).toBe(1);
      expect(db.tables.content_strategies).toHaveLength(1);
      expect(db.tables.content_strategies[0]).toMatchObject({ client_id: "c1", inputs_key: await STEPS.content_strategy.inputs(db, c(), rows), written_at: "2026-11-02T10:00:00.000Z", pending: null });
      expect(db.tables.content_strategies[0].sections["platform:instagram:new"]).toMatchObject({ role: "Launch with carousels." });
      expect(db.tables.content_strategies[0].shape).toBe(2);
      // Only the strategy's own row is ever written; people's versions are never touched.
      expect(new Set(t.writes)).toEqual(new Set(["upsert content_strategies"]));
      expect(db.tables.content_strategy_edits).toEqual(edits);
    });

    it("keeps the stored strategy on screen through every run, and drops the draft when the write is still flagged", async () => {
      const db = dbWith({ ...tables(), content_strategies: [{ ...stored }] });
      const rows = await current(db);
      setUp(db);
      const models = answers(JSON.stringify(draft), flagged, JSON.stringify(draft), flagged);
      const statuses: string[] = [];
      for (let run = 0; run < 4; run++) {
        statuses.push((await STEPS.content_strategy.run(db, c(), ctx({ rows }))).status);
        expect(db.tables.content_strategies[0]).toMatchObject({ sections: { goals: "The last good goals." }, inputs_key: "old", written_at: stored.written_at });
      }
      expect(statuses).toEqual(["waiting", "waiting", "waiting", "failed"]);
      expect(models).toEqual(["claude-opus-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-5-5"]);
      expect(db.tables.content_strategies[0].pending).toBeNull();
    });

    it("drops a draft written for other inputs and starts over", async () => {
      const db = dbWith({ ...tables(), content_strategies: [{ ...stored }] });
      const rows = await current(db);
      const t = setUp(db);
      db.tables.content_strategies[0].pending = { inputs_key: "an older key", phase: "check", evidence: {}, messages: [], draft: draft, usage: { calls: { writer: 1, checker: 0 }, tokens: {} }, started_at: "2026-10-30T00:00:00.000Z" };
      const models = answers(JSON.stringify(draft));
      expect(await STEPS.content_strategy.run(db, c(), ctx({ rows }))).toMatchObject({ status: "waiting", result: { phase: "check" } });
      expect(models).toEqual(["claude-opus-5-5"]);
      expect(t.gathered()).toBe(1);
      expect(db.tables.content_strategies[0].pending).toMatchObject({ inputs_key: await STEPS.content_strategy.inputs(db, c(), rows), usage: { calls: { writer: 1, checker: 0 } } });
    });

    it("keeps the draft when a call does not get through, so the retry picks up the same phase", async () => {
      const db = dbWith({ ...tables(), content_strategies: [{ ...stored }] });
      const rows = await current(db);
      setUp(db);
      answers(JSON.stringify(draft));
      await STEPS.content_strategy.run(db, c(), ctx({ rows }));
      const kept = structuredClone(db.tables.content_strategies[0].pending);
      deps.claudeMessages = (async () => { throw new Error("Anthropic API error 529: overloaded"); }) as never;
      await expect(STEPS.content_strategy.run(db, c(), ctx({ rows }))).rejects.toThrow("529");
      expect(db.tables.content_strategies[0].pending).toEqual(kept);
      const models = answers(clean);
      expect((await STEPS.content_strategy.run(db, c(), ctx({ rows }))).status).toBe("done");
      expect(models).toEqual(["claude-sonnet-5-5"]);
    });

    it("writes a strategy for a client with no Sprout profiles, from its public posts, after the public read", async () => {
      const db = dbWith({ ...tables(), sprout_profiles: [], client_public_profiles: [{ client_id: "c1", platform: "tiktok", handle: "pyper", url: null, source: "person" }] });
      const prospect = c({ primary_platforms: [], field_sources: {} });
      const rows = await current(db, prospect);
      setUp(db);
      let reads = 0;
      deps.strategyPublicRead = async () => {
        reads++;
        if (reads === 1) return { key: "k", status: "reading", started_at: "2026-11-02T10:00:00.000Z", window: { start: "2026-08-04", end: "2026-11-02" }, runs: [{ platform: "TikTok", run_id: "r1", targets: [] }], posts: [] };
        const post = (i: number) => ({ company: "Moburst", client: true, platform: "TikTok", id: `t${i}`, publishedAt: `2026-10-${String(10 + i).padStart(2, "0")}T10:00:00.000Z`, text: "v", link: `https://www.tiktok.com/@pyper/video/${i}`, format: "short_video", engagement: 10, views: 200, followers: 900, boosted: false, source: "apify" as const });
        return { key: "k", status: "done", started_at: "2026-11-02T10:00:00.000Z", read_at: "2026-11-02T10:03:00.000Z", window: { start: "2026-08-04", end: "2026-11-02" }, runs: [], posts: Array.from({ length: 12 }, (_, i) => post(i)) };
      };
      const tiktok = { ...draft, goals: [{ ...goal("Grow views"), platform: "TikTok", metric: "engagement_rate" }, { ...goal("Post often"), platform: "TikTok" }], platforms: [{ ...draft.platforms[0], platform: "TikTok", first_30: [] }], audience: { ...draft.audience, where: ["TikTok"] }, candidates: [{ platform: "Instagram", decision: "not_now", reason: "We start where the brand already posts." }] };
      const models = answers(JSON.stringify(tiktok), clean);
      // The public read is still under way: the step looks again in a few minutes and calls no model.
      expect(await STEPS.content_strategy.run(db, prospect, ctx({ rows }))).toMatchObject({ status: "waiting", reason: "public_read", recheckMinutes: 3 });
      expect(models).toEqual([]);
      expect((await STEPS.content_strategy.run(db, prospect, ctx({ rows }))).status).toBe("waiting");
      const third = await STEPS.content_strategy.run(db, prospect, ctx({ rows }));
      expect(third, JSON.stringify(third)).toMatchObject({ status: "done" });
      const tt = db.tables.content_strategies[0].platforms.find((p: { platform: string }) => p.platform === "TikTok");
      expect(tt).toMatchObject({ state: "posting", figures: { basis: "public", posts: 12, followers: 900, rate_kind: "view" } });
      expect(db.tables.content_strategies[0].sections.goals.items[0]).toMatchObject({ platform: "TikTok", metric: "engagement_rate", baseline: 0.05 });
    });

    it("starts a rewrite when Sprout profiles arrive, and keeps people's versions", async () => {
      const db = dbWith({ ...tables(), sprout_profiles: [] });
      const rows = await current(db);
      const before = await STEPS.content_strategy.inputs(db, c(), rows);
      db.tables.sprout_profiles.push({ client_id: "c1", sprout_profile_id: 9, network_type: "fb_instagram_account", native_name: "pyper", is_active: true });
      expect(await STEPS.content_strategy.inputs(db, c(), rows)).not.toBe(before);
      // A person's public profile is an input too; people's versions of sections never are.
      const withSprout = await STEPS.content_strategy.inputs(db, c(), rows);
      db.tables.client_public_profiles = [{ client_id: "c1", platform: "tiktok", handle: "pyper", url: null, source: "person" }];
      expect(await STEPS.content_strategy.inputs(db, c(), rows)).not.toBe(withSprout);
      const edits = structuredClone(db.tables.content_strategy_edits);
      setUp(db);
      answers(JSON.stringify(draft), clean);
      await STEPS.content_strategy.run(db, c(), ctx({ rows }));
      await STEPS.content_strategy.run(db, c(), ctx({ rows }));
      expect(db.tables.content_strategy_edits).toEqual(edits);
    });

    it("tries again quietly without an AI connection, and waits for a profile", async () => {
      deps.trendIO = trendIO;
      deps.strategyIO = io;
      deps.anthropicKey = async () => null;
      const db = dbWith(tables());
      const rows = await current(db);
      expect(await STEPS.content_strategy.run(db, c(), ctx({ rows }))).toMatchObject({ status: "failed" });
      deps.anthropicKey = async () => "key";
      const none = dbWith({ ...tables(), trend_profiles: [] });
      expect(await STEPS.content_strategy.run(none, c(), ctx({ rows }))).toMatchObject({ status: "waiting" });
    });
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

describe("design_refs (references that refresh themselves)", () => {
  const NOW = "2026-11-02T10:00:00.000Z";
  const NETWORKS: Record<string, [string, number, string]> = {
    ig: ["INSTAGRAM", 7, "fb_instagram_account"], li: ["LINKEDIN_COMPANY", 8, "linkedin_company"], fb: ["FACEBOOK", 9, "facebook"], tt: ["TIKTOK", 10, "tiktok"], x: ["TWITTER", 11, "twitter"],
  };
  const profiles = (...keys: string[]) => keys.map((k) => ({ client_id: "c1", sprout_profile_id: NETWORKS[k][1], network_type: NETWORKS[k][2], is_active: true }));
  const media = (guid: string) => `https://network-media.sproutsocial.com/${guid.replace(":", "-")}.jpg`;
  /** A designed feed post, as Sprout's analytics/posts sends it. */
  const post = (guid: string, day: string) => {
    const [network, profile] = NETWORKS[guid.split(":")[0]];
    return { guid, perma_link: `https://social.example/${guid}`, customer_profile_id: String(profile), network, created_time: `${day}T15:00:00Z`, content_category: "PHOTO", visual_media: [{ media_type: "PHOTO", media_url: media(guid) }] };
  };
  const pathOf = (guid: string) => `c1/social-${createHash("sha256").update(media(guid)).digest("hex")}.jpg`;
  const rulebook = (platforms: string[], look: Record<string, unknown> = { changed: false, since: null, what: "" }) => JSON.stringify({
    composition_patterns: "Centered headline over a full-bleed photo.", typography_treatment: "Bold sans, all caps.", imagery_style: "Bright studio product shots.",
    color_usage: "Navy ground, coral accent.", surface_and_texture: "Flat.", logo_and_marks_treatment: "Wordmark bottom center, small.", mood_and_voice_visual: "Confident.",
    anti_patterns: "Never use gradients.", platforms: Object.fromEntries(platforms.map((p) => [p, `${p} posts set the headline larger.`])), look_change: look,
  });
  type Calls = { read: number; review: number; learn: number; learned: Array<{ content: Array<{ type: string; text?: string }> }> };
  function fakeIO(posts: () => Record<string, unknown>[], over: Record<string, unknown> = {}): Calls {
    const calls: Calls = { read: 0, review: 0, learn: 0, learned: [] };
    deps.refsIO = (() => ({
      now: () => new Date(NOW), apiKey: async () => "key",
      readPosts: async () => { calls.read++; return posts(); },
      image: async (url: string) => ({ bytes: new TextEncoder().encode(url), mime: "image/jpeg" }),
      review: async () => { calls.review++; return { usable: true, confidence: 0.95, reason: "Branded type over a color block" }; },
      learn: async (a: Calls["learned"][number]) => { calls.learn++; calls.learned.push(a); return rulebook(["Instagram"]); },
      ...over,
    })) as never;
    return calls;
  }
  const refsClient = (over: Record<string, unknown> = {}) => client({ name: "Pay The Pyper", design_style_synthesis: null, design_refs_harvested_at: null, ...over });
  function world(c: Record<string, unknown>, keys: string[], tables: Record<string, Record<string, unknown>[]> = {}) {
    const libraryWrites: Array<{ p_client: string; p_reference_paths: string[] }> = [];
    const db = dbWith({ clients: [c], sprout_profiles: profiles(...keys), design_reference_reviews: [], design_reference_choices: [], ...tables }, {
      lifecycle_write_design_library: (a: { p_client: string; p_reference_paths: string[] }) => { libraryWrites.push(a); return true; },
    });
    return { db, libraryWrites };
  }
  const igWeek = ["2026-11-01", "2026-10-29", "2026-10-26", "2026-10-22", "2026-10-19"];

  it("checks every week, and learns the look on its first check from each platform's newest posts, labeled with platform and date", async () => {
    expect(STEPS.design_refs.policy).toEqual({ refreshDays: 7, recheckDays: 7 });
    const c = refsClient();
    const { db, libraryWrites } = world(c, ["ig", "li"]);
    const posts = [...igWeek.map((d, i) => post(`ig:${i}`, d)), post("li:0", "2026-10-30"), post("li:1", "2026-10-20")];
    const calls = fakeIO(() => posts);
    const out = await STEPS.design_refs.run(db, c, ctx());
    expect(out).toMatchObject({ status: "done", result: { relearned: "first", reviewed: 7, model_calls: 8, references: 7, synthesized_at: NOW,
      platforms: { Instagram: { posts: 5, own_rules: true }, LinkedIn: { posts: 2, own_rules: false } } } });
    // The check's own date is when it ran: no reused date postpones the next check.
    expect("doneAt" in out).toBe(false);
    expect(calls).toMatchObject({ read: 1, review: 7, learn: 1 });
    // Newest first, labeled; LinkedIn has no section of its own below 4 posts.
    const labels = calls.learned[0].content.filter((b) => b.type === "text").map((b) => b.text);
    expect(labels.slice(1, 4)).toEqual(["Post 1 (Instagram, Nov 1, 2026):", "Post 2 (LinkedIn, Oct 30, 2026):", "Post 3 (Instagram, Oct 29, 2026):"]);
    expect(labels.at(-1)).toContain("Platforms with rules of their own: Instagram (5 posts).");
    expect(labels.at(-1)).toContain("These follow the core, with too few posts for rules of their own: LinkedIn (2 posts).");
    expect(c.design_style_synthesis).toMatchObject({ reference_pipeline_version: 2, platforms: { Instagram: { rules: "Instagram posts set the headline larger.", posts: 5 } }, source_count: 7 });
    expect(Object.keys(c.design_style_synthesis.platforms)).toEqual(["Instagram"]);
    expect(c.design_style_synthesis.platform_adaptations).toBe("Instagram: Instagram posts set the headline larger.");
    expect(c.harvested_design_references.slice(0, 3).map((e: { path: string }) => e.path)).toEqual([pathOf("ig:0"), pathOf("li:0"), pathOf("ig:1")]);
    expect(libraryWrites).toEqual([{ p_client: "c1", p_reference_paths: c.harvested_design_references.map((e: { path: string }) => e.path) }]);
    expect(db.tables.design_reference_reviews).toHaveLength(7);
  });

  it("makes no model call in a week with no new posts, and never reviews a post twice", async () => {
    const c = refsClient();
    const { db } = world(c, ["ig", "li"]);
    const posts = [...igWeek.map((d, i) => post(`ig:${i}`, d)), post("li:0", "2026-10-30")];
    fakeIO(() => posts);
    await STEPS.design_refs.run(db, c, ctx());
    const learnedAt = c.design_style_synthesis.synthesized_at;
    const calls = fakeIO(() => posts, { now: () => new Date("2026-11-09T10:00:00Z") });
    const out = await STEPS.design_refs.run(db, c, ctx({ force: true }));
    expect(calls).toMatchObject({ read: 1, review: 0, learn: 0 });
    expect(out).toMatchObject({ status: "done", result: { relearned: null, reviewed: 0, model_calls: 0, synthesized_at: learnedAt, checked_at: "2026-11-09T10:00:00.000Z" } });
  });

  it("counts the posts reviewed before reviews were stored as reviewed", async () => {
    const c = refsClient({ harvested_design_references: igWeek.slice(0, 3).map((d, i) => ({ path: `c1/social-old${i}.jpg`, source_post_id: `ig:${i}`, platform: "INSTAGRAM", posted_at: `${d}T15:00:00Z`, quality_checked: true, classification: "Branded" })) });
    const { db } = world(c, ["ig"]);
    for (let i = 0; i < 3; i++) db.uploads.set(`design-references/c1/social-old${i}.jpg`, "image");
    const calls = fakeIO(() => igWeek.slice(0, 4).map((d, i) => post(`ig:${i}`, d)));
    await STEPS.design_refs.run(db, c, ctx());
    // Only the fourth post is new to the model.
    expect(calls.review).toBe(1);
    expect(db.tables.design_reference_reviews.map((r) => r.source_post_id).sort()).toEqual(["ig:0", "ig:1", "ig:2", "ig:3"]);
  });

  it("takes one new post into the library without learning the look again; two new posts learn it again", async () => {
    const c = refsClient();
    const { db, libraryWrites } = world(c, ["ig"]);
    const posts = igWeek.map((d, i) => post(`ig:${i}`, d));
    fakeIO(() => posts);
    await STEPS.design_refs.run(db, c, ctx());
    const learnedAt = c.design_style_synthesis.synthesized_at;

    const one = fakeIO(() => [post("ig:new1", "2026-11-05"), ...posts], { now: () => new Date("2026-11-09T10:00:00Z") });
    const first = await STEPS.design_refs.run(db, c, ctx());
    expect(one).toMatchObject({ review: 1, learn: 0 });
    expect(first).toMatchObject({ status: "done", result: { relearned: null, synthesized_at: learnedAt } });
    expect(c.harvested_design_references[0].path).toBe(pathOf("ig:new1"));
    expect(libraryWrites.at(-1)!.p_reference_paths[0]).toBe(pathOf("ig:new1"));

    const two = fakeIO(() => [post("ig:new2", "2026-11-12"), post("ig:new3", "2026-11-13"), post("ig:new1", "2026-11-05"), ...posts], { now: () => new Date("2026-11-16T10:00:00Z") });
    const second = await STEPS.design_refs.run(db, c, ctx());
    expect(two).toMatchObject({ review: 2, learn: 1 });
    expect(second).toMatchObject({ status: "done", result: { relearned: "posts", synthesized_at: "2026-11-16T10:00:00.000Z" } });
    // The previous rulebook goes with the images.
    expect(two.learned[0].content.at(-1)!.text).toContain("Pay The Pyper's earlier rulebook, learned Nov 2, 2026:");
    expect(c.design_style_synthesis.synthesized_at).not.toBe(learnedAt);
  });

  it("is due at once when a person keeps or leaves out a post or uploads one, as when the accounts change", async () => {
    const c = refsClient();
    const { db } = world(c, ["ig", "li"]);
    const key = await STEPS.design_refs.inputs(db, c, new Map());
    expect(key).toMatch(/^1676448:7,8\|chosen:/);
    db.tables.design_reference_choices.push({ client_id: "c1", path: "c1/social-a.jpg", choice: "kept" });
    const kept = await STEPS.design_refs.inputs(db, c, new Map());
    expect(kept).not.toBe(key);
    expect(await STEPS.design_refs.inputs(db, { ...c, design_references: ["c1/uploads/flyer.png"] }, new Map())).not.toBe(kept);
    db.tables.sprout_profiles.pop();
    expect(await STEPS.design_refs.inputs(db, c, new Map())).toMatch(/^1676448:7\|chosen:/);
    db.tables.sprout_profiles.pop();
    expect(await STEPS.design_refs.inputs(db, c, new Map())).toBeNull();
  });

  it("drops posts from before a new look, keeps a kept one, and reads the website again", async () => {
    const days = ["2026-10-30", "2026-10-26", "2026-10-22", "2026-10-15", "2026-10-10", "2026-10-05"];
    const c = refsClient();
    const { db } = world(c, ["ig"], { design_reference_choices: [] });
    const posts = days.map((d, i) => post(`ig:${i}`, d));
    // The team kept one of the older posts.
    db.tables.design_reference_reviews.push({ client_id: "c1", source_post_id: "ig:5", network: "INSTAGRAM", posted_at: "2026-10-05T15:00:00Z", source_url: null, content_hash: "h5", verdict: "designed", path: pathOf("ig:5"), confidence: 0.9, reason: "r", reviewed_at: NOW });
    db.tables.design_reference_choices.push({ client_id: "c1", path: pathOf("ig:5"), choice: "kept" });
    db.uploads.set(`design-references/${pathOf("ig:5")}`, "image");
    fakeIO(() => posts, { learn: async () => rulebook(["Instagram"], { changed: true, since: "2026-10-20", what: "A new coral and navy palette with a serif headline." }) });
    const out = await STEPS.design_refs.run(db, c, ctx());
    expect(out).toMatchObject({ status: "done", result: { look_since: "2026-10-20" } });
    expect(c.harvested_design_references.map((e: { path: string }) => e.path)).toEqual([pathOf("ig:5"), pathOf("ig:0"), pathOf("ig:1"), pathOf("ig:2")]);
    expect(c.design_style_synthesis.look_change).toMatchObject({ since: "2026-10-20", what: "A new coral and navy palette with a serif headline." });
    // brand_read keys on the new look (the client row carries it as look_since), so the logo file and colors follow a rebrand.
    expect(await STEPS.brand_read.inputs(db, { ...c, look_since: c.design_style_synthesis.look_change.since }, new Map())).toBe("moburst.com|look:2026-10-20");
    expect(await STEPS.brand_read.inputs(db, c, new Map())).toBe("moburst.com");
  });

  it("with fewer than 3 designed posts, waits a week and keeps the last references, minus any a person left out", async () => {
    const before = [{ path: "c1/social-a.jpg", quality_checked: true, platform: "INSTAGRAM", posted_at: "2026-06-01T00:00:00Z" }, { path: "c1/social-b.jpg", quality_checked: true, platform: "INSTAGRAM", posted_at: "2026-06-02T00:00:00Z" }];
    const c = refsClient({ harvested_design_references: before });
    const { db } = world(c, ["ig"], { design_reference_choices: [{ client_id: "c1", path: "c1/social-b.jpg", choice: "left_out" }] });
    fakeIO(() => []);
    expect(await STEPS.design_refs.run(db, c, ctx())).toMatchObject({ status: "waiting", reason: "designed_posts", recheckDays: 7 });
    expect(c.harvested_design_references.map((e: { path: string }) => e.path)).toEqual(["c1/social-a.jpg"]);
  });

  it("reviews at most one run's worth and goes on a minute later", async () => {
    const c = refsClient();
    const { db } = world(c, ["ig", "li", "fb", "tt", "x"]);
    const posts = ["ig", "li", "fb", "tt", "x"].flatMap((k) => igWeek.concat(["2026-10-15"]).map((d, i) => post(`${k}:${i}`, d)));
    const calls = fakeIO(() => posts);
    expect(await STEPS.design_refs.run(db, c, ctx())).toMatchObject({ status: "waiting", reason: "in_progress", recheckMinutes: 1, result: { reviewed: 24, left: 6 } });
    expect(calls).toMatchObject({ review: 24, learn: 0 });
    const next = fakeIO(() => posts, { learn: async () => { next.learn++; return rulebook(["Instagram", "LinkedIn", "Facebook", "TikTok", "X"]); } });
    expect(await STEPS.design_refs.run(db, c, ctx())).toMatchObject({ status: "done", result: { reviewed: 6, references: 16 } });
    expect(next).toMatchObject({ review: 6, learn: 1 });
  });

  it("keeps the last references when the model does not answer, and is tried again later", async () => {
    const before = [{ path: "c1/social-a.jpg", quality_checked: true, platform: "INSTAGRAM", posted_at: "2026-10-01T00:00:00Z" }];
    const c = refsClient({ harvested_design_references: before });
    const { db, libraryWrites } = world(c, ["ig"]);
    fakeIO(() => igWeek.map((d, i) => post(`ig:${i}`, d)), { review: async () => { throw new Error("overloaded"); } });
    expect(await STEPS.design_refs.run(db, c, ctx())).toMatchObject({ status: "failed" });
    expect(c.harvested_design_references).toBe(before);
    expect(libraryWrites).toEqual([]);
    expect(db.tables.design_reference_reviews).toEqual([]);
  });
});

describe("a client with profiles and no website (onboarding from social profiles)", () => {
  const NOW = "2026-11-03T10:00:00.000Z";
  const PROFILES = () => [
    { client_id: "c1", sprout_profile_id: 7, profile_name: "Olo", native_name: "olo", network_type: "linkedin_company", native_link: "", is_active: true },
    { client_id: "c1", sprout_profile_id: 8, profile_name: "Olo", native_name: "olo.hq", network_type: "fb_instagram_account", native_link: "", is_active: true },
  ];
  const olo = (over: Record<string, unknown> = {}) => client({ name: "Olo", website_url: null, brief_text: "", geo: "", language: "", ...over });
  const POSTS = [
    { id: "P1", platform: "Instagram", format: "carousel", date: "2026-10-20", text: "Skip the line: order ahead in two taps", label: "2.4x its platform's median for carousels", top: true },
    { id: "P2", platform: "LinkedIn", format: "image", date: "2026-10-25", text: "Restaurants grow digital orders with Olo", label: null, top: false },
  ];
  const social = (over: Record<string, unknown> = {}) => row("social_read", { result: {
    checked_at: NOW, version: 1, window_days: 90, text_posts: 12, enough: true, posts: POSTS, multiples: { g1: 2.4 },
    follower_countries: [{ country: "US", followers: 70, share: 0.7 }, { country: "GB", followers: 30, share: 0.3 }],
    instagram: { handle: "olo.hq", bio: { biography: "Order ahead. Austin, TX", links: ["https://olo.com/start"] } }, ...over,
  } });

  it("reads the profiles weekly, keyed on the profiles and the look", async () => {
    const db = dbWith({ sprout_profiles: PROFILES() });
    expect(STEPS.social_read.policy).toEqual({ refreshDays: 7, recheckDays: 7 });
    expect(await STEPS.social_read.inputs(db, olo(), new Map())).toBe("profiles:7,8|look:");
    expect(await STEPS.social_read.inputs(db, olo({ look_since: "2026-10-20" }), new Map())).toBe("profiles:7,8|look:2026-10-20");
    expect(await STEPS.social_read.inputs(dbWith({ sprout_profiles: [] }), olo(), new Map())).toBeNull();
  });

  it("confirms the website by the Instagram bio link, else searches the name monthly, a site counting only when it links to a profile", async () => {
    deps.now = () => new Date(NOW);
    deps.listBrandPosts = (async () => [{ text: "No links here", created_time: NOW, perma_link: null, profile_id: "7" }]) as never;
    deps.siteReader = (() => ({
      resolve: async (u: string) => u,
      homepage: async (u: string) => (new URL(u).hostname === "olo.com" ? { html: `<a href="https://www.linkedin.com/company/olo/">in</a>`, url: "https://www.olo.com/" } : null),
    })) as never;
    deps.searchWeb = fail("the web search");
    const c = olo();
    const db = dbWith({ clients: [c], sprout_profiles: PROFILES() });
    const rows = rowsOf(social());
    expect(await STEPS.website.inputs(db, c, rows)).toMatch(/^profiles:7,8\|name:olo\|bio:[0-9a-f]{8}$/);
    expect(await STEPS.website.run(db, c, ctx({ rows }))).toMatchObject({ status: "done", result: { website: "https://www.olo.com", confirmed_by: "bio_profile_link", linked_network: "linkedin_company" } });

    // No bio link: the name is searched, once a month while no website is found.
    const d = olo();
    const db2 = dbWith({ clients: [d], sprout_profiles: PROFILES() });
    const searches: string[] = [];
    deps.searchWeb = async (q: string) => { searches.push(q); return ["https://olo-dining.example", "https://www.instagram.com/olo"]; };
    const first = await STEPS.website.run(db2, d, ctx());
    expect(first).toMatchObject({ status: "waiting", reason: "website", recheckDays: 7, result: { posts: 1, months: 12, searched_at: NOW, queries: ["Olo", "olo.hq"] } });
    expect(searches).toEqual(["Olo", "olo.hq"]);
    const previous = row("website", { status: "waiting", result: (first as { result: Record<string, unknown> }).result });
    await STEPS.website.run(db2, d, ctx({ previous }));
    expect(searches).toHaveLength(2);
    deps.now = () => new Date(Date.parse(NOW) + 31 * 86_400_000);
    await STEPS.website.run(db2, d, ctx({ previous }));
    expect(searches).toHaveLength(4);
  });

  it("writes the brief and pillars from the posts, as the lifecycle's, once the social read has them", async () => {
    const c = olo();
    const db = dbWith({ clients: [c], sprout_profiles: PROFILES() });
    expect(await STEPS.brief_pillars.inputs(db, c, new Map())).toBeNull();
    const rows = rowsOf(social());
    expect(await STEPS.brief_pillars.inputs(db, c, rows)).toMatch(/\|social:1$/);
    deps.now = () => new Date(NOW);
    deps.anthropicKey = async () => "key";
    deps.scrapeMarkdown = fail("the scrape");
    let opts: Record<string, unknown> = {};
    deps.derivePillars = (async (_db: unknown, _c: unknown, _k: string, o: Record<string, unknown>) => {
      opts = o;
      return { pillars: [{ name: "Order ahead", description: "d", rationale: "r" }], keywords: ["online ordering"], notes: "", sources: ["social_posts"], source: "social_posts", derived_at: NOW, brief: "Olo sells online ordering to restaurants." };
    }) as never;
    const out = await STEPS.brief_pillars.run(db, c, ctx({ rows }));
    expect(opts).toMatchObject({ posts: POSTS, briefFromPosts: true, bio: "Order ahead. Austin, TX", siteText: null });
    expect(out).toMatchObject({ status: "done", result: { brief: "from_posts", pillars: "derived", posts: 2 } });
    expect(c.brief_text).toBe("Drafted from the client's posts on 2026-11-03:\n\nOlo sells online ordering to restaurants.");
    expect(c.field_sources).toMatchObject({ brief_text: { by: "lifecycle", from: "posts" }, content_pillars: { by: "lifecycle" } });
    // The brief it drafted is no input: writing it never runs the step again.
    expect(await STEPS.brief_pillars.inputs(db, c, rows)).toBe(await STEPS.brief_pillars.inputs(db, olo(), rows));
  });

  it("waits a week with 3 posts with text, and says how many it has", async () => {
    const c = olo();
    deps.derivePillars = fail("the derivation");
    const out = await STEPS.brief_pillars.run(dbWith({ clients: [c], sprout_profiles: PROFILES() }), c, ctx({ rows: rowsOf(social({ text_posts: 3, enough: false, window_days: 365 })) }));
    expect(out).toEqual({ status: "waiting", reason: "posts", recheckDays: 7, result: { text_posts: 3, window_days: 365 } });
  });

  it("identifies competitors from the top posts and the followers' countries once the pillars are written, and confirms them as the system", async () => {
    const pillars = [{ name: "Order ahead", description: "d" }];
    const db = dbWith({ competitor_sets: [], competitors: [], sprout_profiles: PROFILES() });
    const rows = rowsOf(row("brief_pillars"), social());
    expect(await STEPS.competitors.inputs(db, olo(), rows)).toBeNull();
    expect(await STEPS.competitors.inputs(db, olo({ content_pillars: pillars }), rows)).toMatch(/^site:\|notes:/);
    deps.anthropicKey = async () => "key";
    let asked: { geo?: unknown; postsText?: unknown } = {};
    deps.identifyCompetitors = (async (d: typeof db, cl: { geo: string }, _k: string, o: { postsText?: string }) => {
      asked = { geo: cl.geo, postsText: o.postsText };
      d.tables.competitor_sets.push({ id: "draft1", client_id: "c1", status: "draft", created_at: T });
      for (const [i, n] of ["Toast", "ChowNow", "Square"].entries()) d.tables.competitors.push({ id: `k${i}`, set_id: "draft1", client_id: "c1", name: n, website_url: `https://${n.toLowerCase()}.com`, similarity_score: 0.9 - i * 0.1, is_selected: false, selected_rank: null });
      return { set_id: "draft1", competitors: d.tables.competitors, rejected: [] };
    }) as never;
    const first = await STEPS.competitors.run(db, olo({ content_pillars: pillars }), ctx({ rows }));
    expect(first).toMatchObject({ status: "waiting", reason: "in_progress" });
    expect(asked.geo).toBe("US,GB");
    expect(asked.postsText).toContain("[Instagram, 2.4x its platform's median for carousels] Skip the line");
    deps.detectCompetitorHandles = (async () => ({ results: [], writeErrors: [] })) as never;
    let notes = "";
    deps.confirmDraftSet = (async (_d: unknown, id: string, o: { notes: string }) => { notes = o.notes; db.tables.competitor_sets.find((x) => x.id === id)!.status = "confirmed"; return { confirmed: true, selected: [] }; }) as never;
    const previous = row("competitors", { status: "waiting", result: (first as { result: Record<string, unknown> }).result });
    const second = await STEPS.competitors.run(db, olo({ content_pillars: pillars }), ctx({ previous, rows }));
    expect(second).toMatchObject({ status: "done", result: { set_id: "draft1", chosen_from: "posts", selected: ["Toast", "ChowNow", "Square"] } });
    expect(notes).toBe("Chosen automatically from the client's posts: the three closest competitors with a website.");
  });

  it("identifies a set chosen from posts once more when a website is found, if it is untouched and was never tracked; tracking waits for it", async () => {
    const set = { id: "s1", client_id: "c1", status: "confirmed", confirmed_at: T, created_at: T, confirmed_by: null, rivaliq_landscape_id: null, tracking_check: null };
    const comps = ["Toast", "ChowNow", "Square"].map((name, i) => ({ id: `k${i}`, set_id: "s1", client_id: "c1", name, website_url: `https://${name}.com`, is_selected: true, selected_rank: i + 1 }));
    const chosen = row("competitors", { result: { set_id: "s1", chosen_from: "posts", selected: ["Toast", "ChowNow", "Square"] } });
    const withSite = olo({ website_url: "https://www.olo.com", content_pillars: [{ name: "Order ahead" }] });
    const db = dbWith({ competitor_sets: [{ ...set }], competitors: comps.map((c) => ({ ...c })), rivaliq_setup_jobs: [] });
    expect(await STEPS.competitors.inputs(db, withSite, rowsOf(chosen))).toBe("again:s1|site:olo.com");
    expect(await STEPS.tracking.inputs(db, withSite, rowsOf(chosen))).toBeNull();
    // Without the website, or once a person changed or confirmed it, or once it was tracked: the set stays.
    expect(await STEPS.competitors.inputs(db, olo({ content_pillars: [{ name: "x" }] }), rowsOf(chosen))).toBe("existing:s1");
    expect(await STEPS.competitors.inputs(dbWith({ competitor_sets: [{ ...set, confirmed_by: "person-1" }], competitors: comps }), withSite, rowsOf(chosen))).toBe("existing:s1");
    expect(await STEPS.competitors.inputs(dbWith({ competitor_sets: [{ ...set }], competitors: comps, rivaliq_setup_jobs: [{ set_id: "s1" }] }), withSite, rowsOf(chosen))).toBe("existing:s1");
    const swapped = comps.map((c) => (c.name === "Square" ? { ...c, name: "Lunchbox" } : c));
    expect(await STEPS.competitors.inputs(dbWith({ competitor_sets: [{ ...set }], competitors: swapped }), withSite, rowsOf(chosen))).toBe("existing:s1");
    // The identification keeps saying it replaces the set chosen from posts, so the pick a minute later still runs.
    deps.anthropicKey = async () => "key";
    deps.identifyCompetitors = (async () => ({ set_id: "draft2", competitors: [1, 2, 3], rejected: [] })) as never;
    const first = await STEPS.competitors.run(db, withSite, ctx({ rows: rowsOf(chosen) }));
    expect(first).toMatchObject({ status: "waiting", result: { draft_set_id: "draft2", chosen_from: "posts", set_id: "s1" } });
    const carried = row("competitors", { status: "waiting", result: (first as { result: Record<string, unknown> }).result });
    expect(await STEPS.competitors.inputs(db, withSite, rowsOf(carried))).toBe("again:s1|site:olo.com");
  });

  it("holds the trend profile until competitors are settled, and keys the strategy on each version", async () => {
    const pillars = [{ name: "Order ahead", description: "d" }];
    deps.trendIO = () => ({ ownPosts: async () => ({ posts: [] }), feedSnapshots: async () => [], competitorSet: async () => [], siteText: async () => "" }) as never;
    const db = dbWith({ clients: [{ id: "c1", brand_book_text: "" }] });
    expect(await STEPS.trend_profile.inputs(db, olo({ content_pillars: pillars }), rowsOf(row("brief_pillars")))).toBeNull();
    expect(await STEPS.trend_profile.inputs(db, olo({ content_pillars: pillars }), rowsOf(row("brief_pillars"), row("competitors")))).toMatch(/^profile:/);
    const tables = { clients: [{ id: "c1", brand_book_text: "" }], trend_profiles: [{ client_id: "c1", written_at: "2026-11-01T08:00:00.000Z" }], sprout_profiles: PROFILES() };
    const c = olo({ content_pillars: pillars, brief_text: "Drafted from the client's posts on 2026-11-03:\n\nOlo", field_sources: { brief_text: { by: "lifecycle", from: "posts" } } });
    const base = rowsOf(row("brief_pillars"), row("competitors"));
    const key = await STEPS.trend_profile.inputs(dbWith(tables), c, base);
    const rows = rowsOf(row("brief_pillars"), row("competitors"), row("trend_profile", { inputs_key: key }), social({ version: 1 }));
    expect(await STEPS.content_strategy.inputs(dbWith(tables), c, rows)).toMatch(/\|social:1$/);
    const moved = rowsOf(row("brief_pillars"), row("competitors"), row("trend_profile", { inputs_key: key }), social({ version: 2 }));
    expect(await STEPS.content_strategy.inputs(dbWith(tables), c, moved)).toMatch(/\|social:2$/);
    // A client with a website keys on the posts only from their first move.
    const site = { ...c, website_url: "https://olo.com" };
    const siteKeyed = await STEPS.trend_profile.inputs(dbWith(tables), site, base);
    const siteRows = rowsOf(row("brief_pillars"), row("competitors"), row("trend_profile", { inputs_key: siteKeyed }), social({ version: 1 }));
    expect(await STEPS.content_strategy.inputs(dbWith(tables), site, siteRows)).not.toMatch(/social:/);
  });

  it("reaches the first output with the brief drafted from the posts", async () => {
    const db = dbWith({ calendar_plans: [], reports: [], report_schedules: [{ client_id: "c1", id: "s" }] });
    deps.now = () => new Date(NOW);
    const c = olo({ brief_text: "Drafted from the client's posts on 2026-11-03:\n\nOlo", timezone: "America/Chicago" });
    expect(await STEPS.first_output.inputs(db, c, rowsOf(row("brief_pillars"), row("accounts")))).toMatch(/^week:2026-11-02\|/);
  });

  it("waits to track without a website, asking RivalIQ nothing, and waits for a free place when the plan is full, never failing", async () => {
    const { FollowFailure } = await import("../competitive/rivaliqFollowFailure");
    const set = { id: "s1", client_id: "c1", status: "confirmed", confirmed_at: T, created_at: T, rivaliq_landscape_id: null, tracking_check: null };
    deps.rivaliqKey = () => null;
    deps.advanceSetupOnServer = fail("the setup");
    expect(await STEPS.tracking.run(dbWith({ competitor_sets: [set] }), olo(), ctx())).toEqual({ status: "waiting", reason: "client_website", result: { set_id: "s1" } });
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.advanceSetupOnServer = async () => { throw new FollowFailure("RivalIQ's plan tracks 40 distinct companies and 40 are in use, so Olo could not be added.", true); };
    expect(await STEPS.tracking.run(dbWith({ competitor_sets: [set] }), olo({ website_url: "https://olo.com" }), ctx())).toEqual({ status: "waiting", reason: "rivaliq_full", recheckDays: 1, result: { set_id: "s1" } });
  });

  it("takes the website's values once it is found only where the site ranks higher, and keeps a person's", async () => {
    const PICTURE = "https://project.test/storage/v1/object/public/generated-media/c1/brand/logo-profile-linkedin-0123456789abcdef.png";
    const c = client({
      name: "Olo", website_url: "https://www.olo.com/", logo_url: PICTURE, timezone: "America/Chicago", language: "en,es", geo: "US,GB",
      location: { source: "post_text", website: null, timezone: "America/Chicago" },
      field_sources: { logo_url: { by: "lifecycle", from: "profile_picture:linkedin" }, timezone: { by: "lifecycle", from: "post_text" }, language: { by: "lifecycle", from: "posts" }, geo: { by: "lifecycle", from: "followers" }, brand_identity: { by: "person" } },
      brand_identity: BRAND,
    });
    const db = dbWith({ clients: [c] });
    deps.fetchSiteHtml = async () => ({ html: FOOTER_SITE.replace("<body>", '<body><header><img class="logo" src="/logo.png"></header>'), via: "direct" as const });
    deps.openaiKey = async () => "sk";
    deps.researchBrand = fail("the brand read");
    await STEPS.brand_read.run(db, c, ctx({ rows: rowsOf(social()) }));
    // The site's footer address (rank 2) beats an address in posts (rank 3); its logo replaces the profile picture.
    expect(c).toMatchObject({ timezone: "America/New_York", location: { source: "page_footer", website: "olo.com" }, logo_url: "https://www.olo.com/logo.png" });
    expect(c.field_sources).toMatchObject({ logo_url: { by: "lifecycle", from: "website" }, timezone: { from: "page_footer" } });
    // The posts' languages outrank the site's language tag, and the regions keep the followers' countries.
    expect(c).toMatchObject({ language: "en,es", geo: "US,GB" });
    expect(c.brand_identity).toBe(BRAND);

    // A Google Business Profile address (rank 1) stays when the site has only text addresses.
    const d = client({ website_url: "https://www.olo.com/", location: { source: "profile_address", website: null, timezone: "America/Denver" }, timezone: "America/Denver",
      field_sources: { timezone: { by: "lifecycle", from: "profile_address" }, brand_identity: { by: "person" }, logo_url: { by: "person" } }, brand_identity: BRAND, logo_url: "https://x/mine.png" });
    const db2 = dbWith({ clients: [d] });
    deps.fetchSiteHtml = async () => ({ html: '<html lang="en"><body><main>Visit 1250 Broadway, New York, NY 10001</main></body></html>', via: "direct" as const });
    await STEPS.brand_read.run(db2, d, ctx());
    expect(d).toMatchObject({ timezone: "America/Denver", location: { source: "profile_address" }, logo_url: "https://x/mine.png" });
  });
});
