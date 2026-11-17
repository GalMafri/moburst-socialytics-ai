import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deps, settled, siteKey, STEPS, weeksFor } from "../../../functions/_shared/lifecycle/steps";
import { fakeDb, writeClientRpc } from "../../../functions/_shared/lifecycle/fakeDb";
import { rowAfter, type StepRow } from "../../../functions/_shared/lifecycle/policy";
import { NotInStorage, PictureError } from "../../../functions/_shared/picture/client";
import { ResearchError } from "../../../functions/_shared/brand/research";
import { textHash } from "../../../functions/_shared/lifecycle/names";
import { StyleError } from "../../../functions/_shared/brand-references/errors";
import { choicesKey } from "../../../functions/_shared/brand-references/corpus";

const original = { ...deps };
afterEach(() => { Object.assign(deps, original); vi.restoreAllMocks(); });

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
  describe("the website the client's LinkedIn page states", () => {
    const withPage = (website: string | null) => rowsOf(row("social_read", { result: { checked_at: T, linkedin_page: { profile_id: "7", url: "https://www.linkedin.com/company/x", key: "7:x", read_at: T, page: { url: "https://www.linkedin.com/company/x", name: "X", website, about: "", tagline: null, specialties: [], industries: [], logo: null } } } }));
    it("is written as stated, with its subdomain, confirmed by the profile, and no search runs", async () => {
      const c = olo();
      const db = dbWith({ clients: [c], sprout_profiles: profiles() });
      deps.listBrandPosts = fail("the post read");
      deps.searchWeb = fail("the web search");
      deps.siteReader = fail("the site reader") as never;
      const rows = withPage("https://uproar.moburst.com/");
      const out = await STEPS.website.run(db, c, ctx({ rows }));
      expect(out).toMatchObject({ status: "done", result: { website: "https://uproar.moburst.com/", confirmed_by: "profile_website", written: ["website_url"] } });
      expect(c.website_url).toBe("https://uproar.moburst.com/");
      expect(c.field_sources.website_url).toMatchObject({ by: "lifecycle" });
    });
    it("keeps the path it states", async () => {
      const c = olo();
      deps.listBrandPosts = fail("the post read");
      const out = await STEPS.website.run(dbWith({ clients: [c], sprout_profiles: profiles() }), c, ctx({ rows: withPage("https://www.moburst.com/services/organic/podcast-booking/") }));
      expect(out).toMatchObject({ status: "done", result: { website: "https://www.moburst.com/services/organic/podcast-booking/", confirmed_by: "profile_website" } });
      expect(c.website_url).toBe("https://www.moburst.com/services/organic/podcast-booking/");
    });
    describe("another client's own site, stated as it is (spec B)", () => {
      // Moburst is a client, stored as it is today: a bare domain with no scheme.
      const MOBURST = { id: "m", name: "Moburst", website_url: "Moburst.com", archived_at: null, demo_job_id: null };
      it("is never written: the result records whose site it is, and the posts and the name are searched as if none were stated", async () => {
        const c = olo();
        const db = dbWith({ clients: [c, MOBURST], sprout_profiles: profiles() });
        deps.now = () => new Date(T);
        let read = 0;
        deps.listBrandPosts = (async () => { read++; return [{ text: "Order ahead at https://www.olo.com/order", created_time: T, perma_link: null, profile_id: "7" }]; }) as never;
        deps.siteReader = site({ "olo.com": `<a href="https://www.instagram.com/olo.hq/">ig</a>` }) as never;
        deps.searchWeb = fail("the web search");
        const out = await STEPS.website.run(db, c, ctx({ rows: withPage("https://www.moburst.com") }));
        expect(read).toBe(1);
        expect(out).toMatchObject({ status: "done", result: { website: "https://www.olo.com", confirmed_by: "profile_link", stated_website: "https://www.moburst.com/", stated_site_of: "Moburst" } });
        expect(c.website_url).toBe("https://www.olo.com");
      });
      it("leaves the client with no website when the search finds none, and searches by name", async () => {
        const c = olo();
        const db = dbWith({ clients: [c, MOBURST], sprout_profiles: profiles() });
        deps.now = () => new Date(T);
        deps.listBrandPosts = (async () => [{ text: "Happy Friday", created_time: T, perma_link: null, profile_id: "7" }]) as never;
        deps.siteReader = site({}) as never;
        const asked: string[] = [];
        deps.searchWeb = (async (q: string) => { asked.push(q); return []; }) as never;
        const out = await STEPS.website.run(db, c, ctx({ rows: withPage("https://moburst.com/") }));
        expect(out).toMatchObject({ status: "waiting", reason: "website", result: { stated_site_of: "Moburst" } });
        expect(asked.length).toBeGreaterThan(0);
        expect(c.website_url).toBeNull();
        expect(c.field_sources.website_url).toBeUndefined();
      });
      it("still writes a site of the client's own, a subdomain of its own, and a page under another client's site", async () => {
        for (const stated of ["https://olo.com/", "https://uproar.moburst.com/", "https://www.moburst.com/services/organic/podcast-booking/"]) {
          const c = olo();
          deps.listBrandPosts = fail("the post read");
          deps.searchWeb = fail("the web search");
          const out = await STEPS.website.run(dbWith({ clients: [c, MOBURST], sprout_profiles: profiles() }), c, ctx({ rows: withPage(stated) }));
          expect(out, stated).toMatchObject({ status: "done", result: { website: stated, confirmed_by: "profile_website" } });
          expect((out as { result: Record<string, unknown> }).result.stated_site_of, stated).toBeUndefined();
          expect(c.website_url).toBe(stated);
        }
      });
      it("is another client's site only while that client is active", async () => {
        const c = olo();
        deps.listBrandPosts = fail("the post read");
        const archived = { ...MOBURST, archived_at: "2026-10-01T00:00:00Z" };
        const out = await STEPS.website.run(dbWith({ clients: [c, archived], sprout_profiles: profiles() }), c, ctx({ rows: withPage("https://www.moburst.com/") }));
        expect(out).toMatchObject({ status: "done", result: { website: "https://www.moburst.com/", confirmed_by: "profile_website" } });
      });
    });
    it("never replaces a person's website, and ignores a social profile URL", async () => {
      const kept = olo({ website_url: "https://olo-person.example", field_sources: person("website_url") });
      deps.listBrandPosts = fail("the post read");
      expect(await STEPS.website.run(dbWith({ clients: [kept], sprout_profiles: profiles() }), kept, ctx({ rows: withPage("https://uproar.moburst.com/") }))).toEqual({ status: "done", result: { kept: true } });
      expect(kept.website_url).toBe("https://olo-person.example");
      expect(await STEPS.website.inputs(dbWith({ sprout_profiles: profiles() }), kept, withPage("https://uproar.moburst.com/"))).toBeNull();
      // A social profile is not a website: the posts are searched as before.
      const c = olo();
      deps.listBrandPosts = (async () => [{ text: "See https://partner.example", created_time: T, perma_link: null, profile_id: "7" }]) as never;
      deps.siteReader = site({}) as never;
      deps.searchWeb = async () => [];
      const out = await STEPS.website.run(dbWith({ clients: [c], sprout_profiles: profiles() }), c, ctx({ rows: withPage("https://www.instagram.com/olo.hq") }));
      expect(out).toMatchObject({ status: "waiting", reason: "website" });
      expect(c.website_url).toBeNull();
    });
    it("changes the inputs key when the page's stated website appears", async () => {
      const db = dbWith({ sprout_profiles: profiles() });
      const before = await STEPS.website.inputs(db, olo(), withPage(null));
      const after = await STEPS.website.inputs(db, olo(), withPage("https://uproar.moburst.com/"));
      expect(before).toBe("profiles:7,8|name:olo");
      expect(after).not.toBe(before);
      expect(after).toContain("uproar.moburst.com");
      expect(await STEPS.website.inputs(db, olo(), withPage("https://www.instagram.com/olo.hq"))).toBe(before);
    });
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
  it("labels a zone the agency gave by the website's source when the website finds the same zone, and leaves a real source's label", async () => {
    const set = { ...person("brand_identity", "logo_url"), timezone: { by: "lifecycle", from: "agency" } };
    const c = client({ timezone: "America/New_York", location: { source: "agency", website: null, timezone: "America/New_York" }, field_sources: set, brand_identity: BRAND, logo_url: "https://x/logo.png" });
    deps.fetchSiteHtml = async () => ({ html: FOOTER_SITE, via: "direct" as const });
    deps.researchBrand = fail("the brand read");
    const out = await STEPS.brand_read.run(dbWith({ clients: [c] }), c, ctx());
    expect((out as { result: { written: string[] } }).result.written).toContain("timezone");
    expect(c.timezone).toBe("America/New_York");
    expect(c.field_sources.timezone).toMatchObject({ by: "lifecycle", from: "page_footer" });
    expect(c.location).toMatchObject({ source: "page_footer", website: "moburst.com" });

    // A zone from a real source is not written again when the website finds the same one: only the location moves.
    const d = client({ timezone: "America/New_York", location: { source: "post_text", website: null, timezone: "America/New_York" },
      field_sources: { ...person("brand_identity", "logo_url"), timezone: { by: "lifecycle", from: "post_text" } }, brand_identity: BRAND, logo_url: "https://x/logo.png" });
    const again = await STEPS.brand_read.run(dbWith({ clients: [d] }), d, ctx());
    expect((again as { result: { written: string[] } }).result.written).toEqual(["location"]);
    expect(d.field_sources.timezone).toMatchObject({ from: "post_text" });
  });
  it("keeps the list of the website's logo files, without the main one, at most six", async () => {
    const imgs = (names: string[]) => names.map((n) => `<img class="logo" src="/${n}.png">`).join("");
    const html = `<html lang="en-US"><body><header><img src="/logo.png">${imgs(["logo-white", "a", "b"])}<svg class="logo" viewBox="0 0 2 2"><path d="M0 0h2v2z"/></svg></header><footer>1250 Broadway, New York, NY 10001 ${imgs(["logo", "c", "d", "e", "f"])}</footer></body></html>`;
    const c = client({ name: "Northwind", website_url: "https://www.northwind.test/", field_sources: person("brand_identity"), brand_identity: BRAND, logo_url: "https://www.northwind.test/old-logo.png" });
    const db = dbWith({ clients: [c] });
    deps.fetchSiteHtml = async () => ({ html, via: "direct" as const });
    deps.researchBrand = fail("the brand read");
    const fetched = vi.spyOn(globalThis, "fetch");
    const out = await STEPS.brand_read.run(db, c, ctx()) as { status: string; result: { logo_files: string[]; model_read: boolean } };
    // The header's first image is the main logo this run writes: it is left out, here and where the footer repeats it.
    expect(c.logo_url).toBe("https://www.northwind.test/logo.png");
    const svgPath = `c1/brand/logo-site-${textHash(`<svg class="logo" viewBox="0 0 2 2"><path d="M0 0h2v2z"/></svg>`)}.svg`;
    expect(out.result.logo_files).toEqual([
      "https://www.northwind.test/logo-white.png", "https://www.northwind.test/a.png", "https://www.northwind.test/b.png",
      `https://project.test/storage/v1/object/public/generated-media/${svgPath}`,
      "https://www.northwind.test/c.png", "https://www.northwind.test/d.png",
    ]);
    // An inline SVG is stored so it has an address; no page is fetched for the list and no model is called.
    expect(db.uploads.has(`generated-media/${svgPath}`)).toBe(true);
    expect(fetched).not.toHaveBeenCalled();
    expect(out.result.model_read).toBe(false);
    // The list says which listing made it, so a list from before a change of the listing is known to be older.
    expect((out.result as { logo_marks?: number }).logo_marks).toBe(1);
    // The marks that can be the client's logo itself are the header's: no logo the footer merely names, and no inline SVG the page would color.
    expect((out.result as { logo_own?: string[] }).logo_own).toEqual(["https://www.northwind.test/logo-white.png", "https://www.northwind.test/a.png", "https://www.northwind.test/b.png"]);

    // A logo a person set is the main one: the site's own header logo is then one of the other files.
    const p = client({ name: "Northwind", website_url: "https://www.northwind.test/", field_sources: person("brand_identity", "logo_url"), brand_identity: BRAND, logo_url: "https://www.northwind.test/logo-white.png" });
    const kept = await STEPS.brand_read.run(dbWith({ clients: [p] }), p, ctx()) as { result: { logo_files: string[] } };
    expect(kept.result.logo_files.slice(0, 3)).toEqual(["https://www.northwind.test/logo.png", "https://www.northwind.test/a.png", "https://www.northwind.test/b.png"]);
    expect(kept.result.logo_files).toHaveLength(6);
    expect(p.logo_url).toBe("https://www.northwind.test/logo-white.png");
  });
  it("tries again quietly when the site cannot be read", async () => {
    const { ResearchError } = await import("../../../functions/_shared/brand/research");
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
    const { PillarsError } = await import("../../../functions/_shared/brand/pillars");
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
    const { PillarsError } = await import("../../../functions/_shared/brand/pillars");
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
  // Copy sources, 17 Nov 2026 (invented names): the names Sprout writes with decorations, from its whole list, whoever they belong to.
  it("lists the decorated display names of Sprout's whole account list with their plain form, a personal LinkedIn profile included", async () => {
    const c = client({ name: "Northwind Law", website_url: null });
    deps.listCustomerProfiles = async () => [
      { id: "11", name: "Northwind Law", native_name: "northwindlaw", network_type: "linkedin_company", native_link: "", status: "active" },
      { id: "12", name: "Dana Reed ★★★★★", native_name: "dana-reed", network_type: "linkedin", native_link: "", status: "active" },
      { id: "13", name: "Harbor Wax - Smooth Skin Studio ✨", native_name: "harborwax", network_type: "facebook", native_link: "", status: "active" },
      { id: "14", name: "Harbor Wax (Lakeside)", native_name: "harborwaxlakeside", network_type: "facebook", native_link: "", status: "active" },
    ];
    const out = await STEPS.accounts.run(dbWith({ clients: [c], sprout_profiles: [], sprout_profile_removals: [] }), c, ctx({ rows: new Map() }));
    // Nothing says "Harbor Wax" is that profile's name, so its whole name stays, without the sparkle.
    expect(out).toMatchObject({ status: "done", result: { profiles: 4, display_names: [
      { name: "Harbor Wax - Smooth Skin Studio ✨", plain: "Harbor Wax - Smooth Skin Studio" }, { name: "Dana Reed ★★★★★", plain: "Dana Reed" },
    ] } });
  });

  // A name is shortened at its tagline only when the short form is known to be the name by an exact fact about that profile.
  it("shortens a listed name at its tagline only when the short form is the name of its client, its Sprout group or another of its owner's profiles", async () => {
    const c = client({ name: "Northwind Law", website_url: null });
    const p = (id: string, name: string, network: string, groups: string[] = []) => ({ id, name, native_name: `h${id}`, network_type: network, native_link: "", status: "active", groups });
    deps.listCustomerProfiles = async () => [
      // Known by this client's name: the client holds the profile.
      p("11", "Northwind Law | Trial Lawyers", "facebook"),
      // Known by another client's name, which holds the profile.
      p("21", "Harbor Wax - Smooth Skin Studio", "facebook"),
      // Known by its Sprout group's name.
      p("31", "Glow Parlor – Skin & Brows", "facebook", ["g7"]),
      // Known by the name another profile of the same group carries on another network.
      p("41", "Twin Oaks — Family Dental", "facebook", ["g8"]), p("42", "Twin Oaks", "fb_instagram_account", ["g8"]),
      // A real name with a separator in it: nothing knows "Smith" as its name, though another client is called Smith.
      p("51", "Smith - Jones Law", "facebook"), p("52", "Reed | Okafor ★", "facebook", ["g9"]),
      // The same name on the same network proves nothing about the other.
      p("61", "Lakeside - Waxing", "facebook", ["g10"]), p("62", "Lakeside", "facebook", ["g10"]),
      // A profile on another network that shares no owner and no group proves nothing either.
      p("71", "Brightside - Brow Bar", "facebook", ["g11"]), p("72", "Brightside", "fb_instagram_account", ["g12"]),
    ];
    let groupReads = 0;
    deps.listCustomerGroups = async () => { groupReads++; return [{ id: "g7", name: "Glow Parlor" }, { id: "g8", name: "to" }, { id: "g9", name: "RO" }, { id: "g10", name: "LW" }, { id: "g11", name: "BB" }, { id: "g12", name: "BS" }]; };
    const db = dbWith({
      clients: [c, { id: "hw", name: "Harbor Wax" }, { id: "sm", name: "Smith" }],
      sprout_profiles: [{ client_id: "hw", sprout_profile_id: 21, network_type: "facebook", is_active: true }, { client_id: "c1", sprout_profile_id: 11, network_type: "facebook", is_active: true }], sprout_profile_removals: [],
    });
    const out = await STEPS.accounts.run(db, c, ctx({ rows: new Map() }));
    const names = (out as { result: { display_names: Array<{ name: string; plain: string }> } }).result.display_names;
    expect(Object.fromEntries(names.map((n) => [n.name, n.plain]))).toEqual({
      "Northwind Law | Trial Lawyers": "Northwind Law",
      "Harbor Wax - Smooth Skin Studio": "Harbor Wax",
      "Glow Parlor – Skin & Brows": "Glow Parlor",
      "Twin Oaks — Family Dental": "Twin Oaks",
      // Only its star goes.
      "Reed | Okafor ★": "Reed | Okafor",
    });
    // "Smith - Jones Law", "Lakeside - Waxing" and "Brightside - Brow Bar" are names as they stand: not listed at all.
    expect(groupReads).toBe(1);
  });

  it("reads no group and no other client for names when no listed name has a tagline, and keeps the names whole when those reads fail", async () => {
    const c = client({ name: "Northwind Law", website_url: null });
    const tables: string[] = [];
    const db = dbWith({ clients: [c], sprout_profiles: [{ client_id: "hw", sprout_profile_id: 21, network_type: "facebook", is_active: true }], sprout_profile_removals: [] });
    const from = db.from.bind(db);
    db.from = (t: string) => { tables.push(t); return from(t); };
    deps.listCustomerGroups = fail("Sprout's groups");
    deps.listCustomerProfiles = async () => [{ id: "12", name: "Dana Reed ★★★★★", native_name: "dana-reed", network_type: "linkedin", native_link: "", status: "active", groups: ["g1"] }];
    expect(await STEPS.accounts.run(db, c, ctx({ rows: new Map() }))).toMatchObject({ status: "done", result: { display_names: [{ name: "Dana Reed ★★★★★", plain: "Dana Reed" }] } });
    expect(tables).not.toContain("clients");
    // A tagline, and the group read fails: the step still finishes, with that name whole.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    deps.listCustomerGroups = async () => { throw new Error("Sprout did not answer"); };
    deps.listCustomerProfiles = async () => [{ id: "21", name: "Harbor Wax - Smooth Skin Studio ★", native_name: "harborwax", network_type: "facebook", native_link: "", status: "active", groups: ["g1"] }];
    expect(await STEPS.accounts.run(db, c, ctx({ rows: new Map() }))).toMatchObject({ status: "done", result: { display_names: [{ name: "Harbor Wax - Smooth Skin Studio ★", plain: "Harbor Wax - Smooth Skin Studio" }] } });
    expect(warn).toHaveBeenCalled();
  });

  it("waits for the brand read before reading the site's links, and keys on removals", async () => {
    const db = dbWith({ sprout_profile_removals: [] });
    expect(await STEPS.accounts.inputs(db, client(), new Map())).toBeNull();
    const a = await STEPS.accounts.inputs(db, client(), read);
    db.tables.sprout_profile_removals.push({ client_id: "c1", sprout_profile_id: 9 });
    expect(await STEPS.accounts.inputs(db, client(), read)).not.toBe(a);
  });
});

// Copy sources, 17 Nov 2026 (invented brands): a client holding a national brand's accounts and a
// local franchise's on the same networks keeps one own account per network.
describe("accounts: one own account per network", () => {
  const T1 = "2026-11-17T09:00:00.000Z";
  const T2 = "2026-11-18T09:00:00.000Z";
  const sp = (id: number, name: string, native: string, network: string, active = true) => ({ client_id: "c1", sprout_profile_id: id, profile_name: name, native_name: native, network_type: network, native_link: "", is_active: active });
  const held = () => [
    sp(20, "Harbor Wax", "harborwax", "fb_instagram_account"), sp(10, "Harbor Wax (Lakeside)", "harborwax_lakeside", "fb_instagram_account"),
    sp(21, "Harbor Wax", "harborwax", "facebook"), sp(11, "Harbor Wax (Lakeside)", "harborwaxlakeside", "facebook"),
    // The only TikTok account is the franchise's: one account on a network is never parked.
    sp(12, "Harbor Wax (Lakeside)", "harborwax_lakeside", "tiktok"),
    // Another client's accounts are never read into the rule.
    { ...sp(90, "Harbor Wax", "someoneelse", "fb_instagram_account"), client_id: "other" },
  ];
  const harbor = (over: Record<string, unknown> = {}) => client({ name: "Harbor Wax", website_url: null, ...over });
  const world = (c: ReturnType<typeof client>) => dbWith({ clients: [c], sprout_profiles: held(), sprout_profile_removals: [], client_public_profiles: [] });
  const activeIds = (db: ReturnType<typeof dbWith>) => db.tables.sprout_profiles.filter((p) => p.client_id === "c1" && p.is_active).map((p) => p.sprout_profile_id).sort((a, b) => a - b);
  const result = (out: unknown) => (out as { result: Record<string, unknown> }).result;

  it("keys on the rule's version, and names the networks that hold two active accounts only while there are any", async () => {
    const c = harbor();
    const db = world(c);
    const before = await STEPS.accounts.inputs(db, c, new Map());
    expect(before).toMatch(/\|own:1\|dup:facebook,instagram$/);
    deps.listCustomerProfiles = async () => [];
    deps.now = () => new Date(T1);
    await STEPS.accounts.run(db, c, ctx());
    const after = await STEPS.accounts.inputs(db, c, new Map());
    expect(after).toMatch(/\|own:1$/);
    expect(after).not.toContain("|dup:");
    // A client with one account per network never carries the part.
    expect(await STEPS.accounts.inputs(dbWith({ sprout_profile_removals: [], sprout_profiles: [sp(20, "Harbor Wax", "harborwax", "facebook")] }), c, new Map())).toMatch(/\|own:1$/);
  });

  it("parks the second account on each network, records why and when, and writes no removal", async () => {
    const c = harbor();
    const db = world(c);
    deps.listCustomerProfiles = async () => [];
    deps.now = () => new Date(T1);
    const out = await STEPS.accounts.run(db, c, ctx());
    expect(out.status).toBe("done");
    expect(activeIds(db)).toEqual([12, 20, 21]);
    expect(result(out).own).toEqual([
      expect.objectContaining({ network: "facebook", kept: "21", dropped: ["11"], by: "name" }),
      expect.objectContaining({ network: "instagram", kept: "20", dropped: ["10"], by: "name" }),
    ]);
    expect((result(out).own as Array<{ why: string }>)[1].why).toBe('Kept "Harbor Wax" (harborwax) on Instagram: its name is the client\'s name. Parked: "Harbor Wax (Lakeside)" (harborwax_lakeside).');
    expect(result(out).own_dropped_at).toBe(T1);
    // Parked rows stay the client's rows, and a parked account is not one a person removed.
    expect(db.tables.sprout_profiles.filter((p) => p.client_id === "c1")).toHaveLength(5);
    expect(db.tables.sprout_profile_removals).toEqual([]);
    expect(db.tables.sprout_profiles.find((p) => p.client_id === "other")).toMatchObject({ is_active: true });
    // The client's platforms follow the accounts that stay.
    expect(result(out)).toMatchObject({ assigned: 3, platforms: ["Instagram", "TikTok", "Facebook"] });
    expect(c.primary_platforms).toEqual(["Instagram", "TikTok", "Facebook"]);
  });

  it("counts only the accounts that stay toward the client's platforms", async () => {
    const c = harbor({ primary_platforms: ["Facebook", "LinkedIn", "TikTok"] });
    deps.listCustomerProfiles = async () => [];
    const db = dbWith({ clients: [c], sprout_profile_removals: [], client_public_profiles: [], sprout_profiles: [
      // An earlier run parked the franchise's LinkedIn page: the record is on its row.
      sp(21, "Harbor Wax", "harborwax", "facebook"), sp(30, "Harbor Wax", "harbor-wax", "linkedin_company"), { ...sp(31, "Harbor Wax (Lakeside)", "hw-lakeside", "linkedin_company", false), parked_at: T1, parked_reason: "x" },
      // Switched off by a person, never parked by the rule: not counted, and not brought back.
      sp(40, "Harbor Wax", "harborwax", "tiktok", false),
    ] });
    const out = await STEPS.accounts.run(db, c, ctx());
    expect(result(out)).toMatchObject({ assigned: 2, platforms: ["Facebook", "LinkedIn"], written: ["primary_platforms"] });
    expect(c.primary_platforms).toEqual(["Facebook", "LinkedIn"]);
    expect(activeIds(db)).toEqual([21, 30]);
  });

  it("writes when and why on the parked row itself, and changes nothing on a second run", async () => {
    const c = harbor();
    const db = world(c);
    deps.listCustomerProfiles = async () => [];
    deps.now = () => new Date(T1);
    const first = await STEPS.accounts.run(db, c, ctx());
    expect(db.tables.sprout_profiles.filter((p) => p.client_id === "c1" && !p.is_active).map((p) => [p.sprout_profile_id, p.parked_at, p.parked_reason])).toEqual([
      [10, T1, 'The brand\'s own Instagram account is "Harbor Wax".'],
      [11, T1, 'The brand\'s own Facebook account is "Harbor Wax".'],
    ]);
    // The accounts that stay carry no record.
    expect(db.tables.sprout_profiles.filter((p) => p.client_id === "c1" && p.is_active).every((p) => !p.parked_at && !p.parked_reason)).toBe(true);
    const snapshot = JSON.stringify(db.tables.sprout_profiles);
    deps.now = () => new Date(T2);
    const second = await STEPS.accounts.run(db, c, ctx({ rows: rowsOf(row("accounts", { result: result(first) })) }));
    expect(JSON.stringify(db.tables.sprout_profiles)).toBe(snapshot);
    expect(result(second).own).toEqual(result(first).own);
    expect(result(second).own_dropped_at).toBe(T1);
    expect(db.tables.sprout_profile_removals).toEqual([]);
  });

  // The record must not depend on one run surviving: a failed run clears the step's stored result (policy.ts rowAfter).
  it("reads the same decisions and the same parked time from the rows when the step's earlier result is gone", async () => {
    const c = harbor();
    const db = world(c);
    deps.listCustomerProfiles = async () => [];
    deps.now = () => new Date(T1);
    const first = await STEPS.accounts.run(db, c, ctx());
    const snapshot = JSON.stringify(db.tables.sprout_profiles);
    deps.now = () => new Date(T2);
    // The run after a failed one: no earlier result at all, then a row whose result was cleared.
    for (const rows of [new Map<string, StepRow>(), rowsOf(row("accounts", { status: "failed", result: null, error: "Sprout did not answer", attempts: 1 }))]) {
      const again = await STEPS.accounts.run(db, c, ctx({ rows }));
      expect(result(again).own).toEqual(result(first).own);
      expect(result(again).own_dropped_at).toBe(T1);
      expect(JSON.stringify(db.tables.sprout_profiles)).toBe(snapshot);
      expect(activeIds(db)).toEqual([12, 20, 21]);
    }
  });

  it("brings the parked account back when a person removes the kept one, and clears its record", async () => {
    const c = harbor();
    const db = world(c);
    deps.listCustomerProfiles = async () => [];
    deps.now = () => new Date(T1);
    await STEPS.accounts.run(db, c, ctx());
    // A person removes the national Instagram account on the setup page: its row is deleted and the removal recorded.
    db.tables.sprout_profiles = db.tables.sprout_profiles.filter((p) => !(p.client_id === "c1" && p.sprout_profile_id === 20));
    db.tables.sprout_profile_removals.push({ client_id: "c1", sprout_profile_id: 20 });
    deps.now = () => new Date(T2);
    const second = await STEPS.accounts.run(db, c, ctx());
    expect(activeIds(db)).toEqual([10, 12, 21]);
    expect(db.tables.sprout_profiles.find((p) => p.sprout_profile_id === 10)).toMatchObject({ is_active: true, parked_at: null, parked_reason: null });
    expect(result(second).own).toEqual([
      expect.objectContaining({ network: "facebook", kept: "21", dropped: ["11"], by: "name" }),
      expect.objectContaining({ network: "instagram", kept: "10", dropped: [], by: "only" }),
    ]);
    // The Facebook franchise page is still parked, since the first run.
    expect(result(second).own_dropped_at).toBe(T1);
    // Brought back and at rest: the next run records nothing more for Instagram.
    const third = await STEPS.accounts.run(db, c, ctx());
    expect((result(third).own as Array<{ network: string }>).map((p) => p.network)).toEqual(["facebook"]);
  });

  it("keeps an account a person added back, parks the other, and goes on keeping it", async () => {
    const c = harbor();
    const db = world(c);
    deps.listCustomerProfiles = async () => [];
    deps.now = () => new Date(T1);
    await STEPS.accounts.run(db, c, ctx());
    // A person adds the parked franchise Instagram account back on the setup page: the upsert switches it on.
    db.tables.sprout_profiles.find((p) => p.sprout_profile_id === 10)!.is_active = true;
    deps.now = () => new Date(T2);
    const second = await STEPS.accounts.run(db, c, ctx());
    expect((result(second).own as Array<Record<string, unknown>>).find((p) => p.network === "instagram")).toMatchObject({ kept: "10", dropped: ["20"], by: "person" });
    expect(activeIds(db)).toEqual([10, 12, 21]);
    expect(db.tables.sprout_profiles.find((p) => p.sprout_profile_id === 20)).toMatchObject({ is_active: false, parked_at: T2 });
    expect(result(second).own_dropped_at).toBe(T2);
    // The person's choice stands on every run after, whatever the names say, with no earlier result to lean on.
    const snapshot = JSON.stringify(db.tables.sprout_profiles);
    const third = await STEPS.accounts.run(db, c, ctx());
    expect((result(third).own as Array<Record<string, unknown>>).find((p) => p.network === "instagram")).toMatchObject({ kept: "10", dropped: ["20"], by: "person" });
    expect(JSON.stringify(db.tables.sprout_profiles)).toBe(snapshot);
    expect(db.tables.sprout_profile_removals).toEqual([]);
  });

  // The step never makes the choice necessary: it adds no second account on a network.
  it("does not assign a profile on a network where the client has an account, however exactly it matches, and parks nothing for it", async () => {
    const c = harbor();
    const db = dbWith({ clients: [c], sprout_profile_removals: [], client_public_profiles: [], sprout_profiles: [sp(10, "Harbor Wax Official Page", "hw_page", "facebook")] });
    // Sprout lists a new Facebook page named exactly like the client, and a TikTok account: the client has no TikTok yet.
    deps.listCustomerProfiles = async () => [
      { id: "21", name: "Harbor Wax", native_name: "harborwax", network_type: "facebook", native_link: "", status: "active" },
      { id: "22", name: "Harbor Wax", native_name: "harborwax", network_type: "tiktok", native_link: "", status: "active" },
      // A person's own LinkedIn profile named like the client is no brand account: it is never held back, and never parks anything.
      { id: "23", name: "Harbor Wax", native_name: "harbor-wax-founder", network_type: "linkedin", native_link: "", status: "active" },
    ];
    deps.now = () => new Date(T1);
    const out = await STEPS.accounts.run(db, c, ctx());
    expect(result(out)).toMatchObject({
      matched: [{ id: "22", by: ["name"] }, { id: "23", by: ["name"] }],
      skipped: [{ id: "21", network: "facebook", handle: "harborwax", why: "the client already has an account on this network" }],
      own: [], own_open: [], own_dropped_at: null, assigned: 3,
    });
    expect(activeIds(db)).toEqual([10, 22, 23]);
    expect(db.tables.sprout_profiles.some((p) => p.sprout_profile_id === 21)).toBe(false);
  });

  it("does not assign two profiles on one network in one run: which one is the brand's is a person's to say", async () => {
    const c = harbor();
    const db = dbWith({ clients: [c], sprout_profile_removals: [], client_public_profiles: [], sprout_profiles: [] });
    deps.listCustomerProfiles = async () => [
      { id: "21", name: "Harbor Wax", native_name: "harborwax", network_type: "fb_instagram_account", native_link: "", status: "active" },
      { id: "24", name: "Harbor Wax", native_name: "harborwax.two", network_type: "instagram", native_link: "", status: "active" },
      { id: "22", name: "Harbor Wax", native_name: "harborwax", network_type: "tiktok", native_link: "", status: "active" },
    ];
    const out = await STEPS.accounts.run(db, c, ctx());
    expect(result(out)).toMatchObject({ matched: [{ id: "22" }], skipped: [{ id: "21", why: "two profiles match on this network" }, { id: "24", why: "two profiles match on this network" }], assigned: 1 });
    expect(activeIds(db)).toEqual([22]);
  });

  // "The oldest" is a guess. With no exact fact, both accounts stay in use and the step says the choice is open.
  it("parks nothing when no exact fact decides, and records the choice as open", async () => {
    const c = harbor();
    const db = dbWith({ clients: [c], sprout_profile_removals: [], client_public_profiles: [], sprout_profiles: [sp(10, "Lakeside Waxing", "lakeside", "facebook"), sp(20, "Smooth Skin Studio", "smooth", "facebook"), sp(30, "Harbor Wax", "harborwax", "fb_instagram_account")] });
    deps.listCustomerProfiles = async () => [];
    const before = JSON.stringify(db.tables.sprout_profiles);
    const out = await STEPS.accounts.run(db, c, ctx());
    expect(JSON.stringify(db.tables.sprout_profiles)).toBe(before);
    expect(result(out)).toMatchObject({
      own: [], own_dropped_at: null, assigned: 3,
      own_open: [{ network: "facebook", accounts: ["10", "20"], why: '"Lakeside Waxing" (lakeside) and "Smooth Skin Studio" (smooth) stay in use on Facebook: no exact fact says which one is the brand\'s own.' }],
    });
    // The key still names the network, so nothing runs twice for it: it is the same before and after.
    expect(await STEPS.accounts.inputs(db, c, new Map())).toMatch(/\|own:1\|dup:facebook$/);
  });

  it("leaves a company page and a personal LinkedIn profile together, and does not name LinkedIn as a network with two", async () => {
    const c = harbor();
    const db = dbWith({ clients: [c], sprout_profile_removals: [], client_public_profiles: [], sprout_profiles: [sp(50, "Harbor Wax", "harbor-wax", "linkedin_company"), sp(5, "Dana Reed", "dana-reed", "linkedin"), sp(6, "Sam Okafor", "sam-okafor", "linkedin")] });
    deps.listCustomerProfiles = async () => [];
    expect(await STEPS.accounts.inputs(db, c, new Map())).toMatch(/\|own:1$/);
    const out = await STEPS.accounts.run(db, c, ctx());
    expect(result(out)).toMatchObject({ own: [], own_open: [], own_dropped_at: null, assigned: 3, platforms: ["LinkedIn"] });
    expect(activeIds(db)).toEqual([5, 6, 50]);
  });

  it("never sorts out an account a person added after the rule began", async () => {
    const c = harbor();
    const db = dbWith({ clients: [c], sprout_profile_removals: [], client_public_profiles: [], sprout_profiles: [
      { ...sp(10, "Harbor Wax Official Page", "hw_page", "facebook"), assigned_at: "2026-09-01T10:00:00.000Z" },
      { ...sp(90, "Harbor Wax", "harborwax", "facebook"), assigned_at: "2026-12-01T10:00:00.000Z" },
    ] });
    deps.listCustomerProfiles = async () => [];
    const out = await STEPS.accounts.run(db, c, ctx());
    expect(activeIds(db)).toEqual([10, 90]);
    expect(result(out)).toMatchObject({ own: [], own_dropped_at: null, own_open: [expect.objectContaining({ network: "facebook", accounts: ["10", "90"] })] });
  });

  // The lifecycle does not run for an archived client (run.ts); the step itself holds the same line.
  it("changes nothing of an archived client, whoever calls the step: nothing is read from Sprout, matched, parked or written", async () => {
    const c = harbor({ archived_at: "2026-10-01T00:00:00.000Z" });
    const db = world(c);
    let reads = 0;
    // A profile that would be matched and assigned for a client in use.
    deps.listCustomerProfiles = async () => { reads++; return [{ id: "77", name: "Harbor Wax", native_name: "harborwax", network_type: "tiktok", native_link: "", status: "active" }]; };
    deps.now = () => new Date(T1);
    const before = JSON.stringify(db.tables);
    const tables: string[] = [];
    const from = db.from.bind(db);
    db.from = (t: string) => { tables.push(t); return from(t); };
    expect(await STEPS.accounts.run(db, c, ctx())).toEqual({ status: "waiting", reason: "archived" });
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(tables).toEqual([]);
    expect(reads).toBe(0);
    expect(activeIds(db)).toEqual([10, 11, 12, 20, 21]);
    // The same accounts, for the client in use, are sorted out.
    const live = world(harbor());
    await STEPS.accounts.run(live, harbor(), ctx());
    expect(activeIds(live)).not.toEqual([10, 11, 12, 20, 21]);
  });

  it("gives a client that never had two accounts on a network an empty list and no date", async () => {
    const c = harbor();
    const db = dbWith({ clients: [c], sprout_profile_removals: [], client_public_profiles: [], sprout_profiles: [sp(20, "Harbor Wax", "harborwax", "facebook")] });
    deps.listCustomerProfiles = async () => [];
    expect(result(await STEPS.accounts.run(db, c, ctx()))).toMatchObject({ own: [], own_open: [], skipped: [], own_dropped_at: null, assigned: 1 });
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
  it("keeps the link of a set whose landscape is there but does not hold the selection: no reset, no setup, and its handles are read as before", async () => {
    // Only a landscape recorded as gone, by the selection decision and for this very link, is ever reset.
    const kept: Array<[string, Record<string, unknown>]> = [
      ["the selection is not covered", { code: "RIVALIQ_SELECTION_NOT_COVERED", landscape_id: "L1", uncovered: { client: false, competitors: ["Contoso Rides"] } }],
      ["the client is not there as one company", { code: "RIVALIQ_SELECTION_NOT_COVERED", landscape_id: "L1", uncovered: { client: true, competitors: [] } }],
      ["a record of a missing landscape that does not say it is gone", { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "L1" }],
      ["gone, but about another landscape", { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "L0", gone: true }],
      ["gone as a word, not the mark the decision writes", { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "L1", gone: "true" }],
      ["not set up, recorded before the link", { code: "RIVALIQ_CLIENT_NOT_TRACKED", landscape_id: null }],
      ["no record", null as never],
    ];
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.resetTracking = fail("the reset") as never;
    deps.advanceSetupOnServer = fail("the setup") as never;
    for (const [what, tracking_check] of kept) {
      const db = dbWith({ competitor_sets: [set({ rivaliq_landscape_id: "L1", tracking_check })] });
      const synced: unknown[] = [];
      deps.syncTrackedHandles = (async (_d: unknown, id: string, l: string) => { synced.push([id, l]); return { client: null, competitors: 2, handles: 0 }; }) as never;
      expect(await STEPS.tracking.run(db, client(), ctx()), what).toMatchObject({ status: "done", result: { set_id: "s1", landscape_id: "L1" } });
      expect(synced, what).toEqual([["s1", "L1"]]);
      expect(db.tables.competitor_sets[0].rivaliq_landscape_id, what).toBe("L1");
    }
  });
  it("sets tracking up again when the linked landscape is gone, and waits quietly while RivalIQ adds the companies", async () => {
    const db = dbWith({ competitor_sets: [set({ rivaliq_landscape_id: "L1", tracking_check: { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "L1", gone: true } })] });
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
    const { SetupError } = await import("../../../functions/_shared/competitive/rivaliqSetupRun");
    const db = dbWith({ competitor_sets: [set()] });
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.advanceSetupOnServer = async () => { throw new SetupError("selection", "Use the company website rather than a social-profile URL."); };
    expect(await STEPS.tracking.run(db, client(), ctx())).toMatchObject({ status: "waiting", reason: "selection" });
    deps.rivaliqKey = () => null;
    expect(await STEPS.tracking.run(db, client(), ctx())).toMatchObject({ status: "failed" });
  });
});

// Kitcaster's LinkedIn page states a page on moburst.com, the website of
// Moburst, another client (spec: docs/superpowers/specs/2026-11-08-onboarding-
// profile-pages-and-no-n8n-design.md, section B): the page feeds the brief,
// pillars, keywords and competitors, never Moburst's logo, brand, place,
// profile links or RivalIQ company.
describe("a page on another client's site is used for text only", () => {
  const KITCASTER = "https://www.moburst.com/services/organic/podcast-booking/";
  const MOBURST_SITE = `<html lang="en-US"><body><header><img class="logo" src="/logo.png"></header><h1>Growth done right</h1><footer>1250 Broadway, New York, NY 10001 <a href="https://www.linkedin.com/company/moburst/">in</a> <a href="https://www.instagram.com/moburst.agency/">ig</a></footer></body></html>`;
  const moburst = () => ({ id: "m", name: "Moburst", website_url: "https://www.moburst.com", archived_at: null, demo_job_id: null });
  const kit = (over: Record<string, unknown> = {}) => client({ id: "c1", name: "Kitcaster by Moburst", website_url: KITCASTER, ...over });
  const set = (over = {}) => ({ id: "s1", client_id: "c1", status: "confirmed", confirmed_at: T, created_at: T, rivaliq_landscape_id: null, tracking_check: null, ...over });

  it("brand_read writes no logo, location, timezone, brand identity or geo, and gives no profile links", async () => {
    const c = kit({ geo: "" });
    const db = dbWith({ clients: [moburst(), c] });
    deps.fetchSiteHtml = async () => ({ html: MOBURST_SITE, via: "direct" as const });
    deps.researchBrand = fail("the brand read");
    const followers = rowsOf(row("social_read", { result: { follower_countries: [{ country: "GB", followers: 9, share: 0.9 }] } }));
    const out = await STEPS.brand_read.run(db, c, ctx({ rows: followers }));
    expect(out).toEqual({
      status: "done",
      result: {
        website: "moburst.com/services/organic/podcast-booking", fetched_via: "direct", model_read: false,
        timezone: null, timezone_source: null, country: null, language: "en", logo: "none", written: [], kept: [], logo_files: [], logo_own: [], logo_marks: 1, site_profiles: [], parent_page: true,
      },
    });
    expect(c).toMatchObject({ logo_url: null, brand_identity: null, location: null, timezone: "UTC", geo: "" });
    expect(db.uploads.size).toBe(0);
  });
  it("takes none from a text-only page", async () => {
    // A client whose website is a page of another client's site: that page's header and footer carry the other client's logos, marked as such.
    const parent = { id: "p", name: "Northwind", website_url: "https://www.northwind.test", archived_at: null, demo_job_id: null };
    const c = client({ id: "c1", name: "Northwind Radio", website_url: "https://www.northwind.test/services/radio/" });
    const db = dbWith({ clients: [parent, c] });
    const page = `<html lang="en-US"><body><header><img class="logo" src="/logo.png"></header><h1>Radio</h1><footer><img class="logo" src="/logo-white.png"><svg class="logo"><path d="M0 0"/></svg></footer></body></html>`;
    deps.fetchSiteHtml = async () => ({ html: page, via: "direct" as const });
    deps.researchBrand = fail("the brand read");
    const out = await STEPS.brand_read.run(db, c, ctx()) as { result: { logo_files: string[] } };
    expect(out.result.logo_files).toEqual([]);
    expect(db.uploads.size).toBe(0);
  });
  it("brand_read asks the model only for the page's language, and takes nothing else it reads", async () => {
    const c = kit({ language: "" });
    const db = dbWith({ clients: [moburst(), c] });
    deps.fetchSiteHtml = async () => ({ html: MOBURST_SITE.replace(' lang="en-US"', ""), via: "direct" as const });
    deps.openaiKey = async () => "sk";
    deps.researchBrand = (async () => ({ brand_identity: BRAND, headquarters: { city: "New York", region: "NY", country: "US" }, site_language: "en", logo: { url: "https://www.moburst.com/logo.svg" }, html: "", url: "", fetched_via: "direct", debug: {} })) as never;
    const out = await STEPS.brand_read.run(db, c, ctx());
    expect(out).toMatchObject({ status: "done", result: { model_read: true, written: ["language"], logo: "none", site_profiles: [], parent_page: true } });
    expect(c).toMatchObject({ language: "en", logo_url: null, brand_identity: null, location: null, timezone: "UTC", geo: "US" });
  });
  it("accounts takes no profile links from the page, and never reads the page for them", async () => {
    const c = kit();
    const db = dbWith({ clients: [moburst(), c], sprout_profiles: [], sprout_profile_removals: [] });
    deps.listCustomerProfiles = async () => [
      { id: "5719052", name: "Moburst - Growth Done Right", native_name: "moburst", network_type: "linkedin_company", native_link: "", status: "active" },
      { id: "5489335", name: "Moburst | Mobile-First Digital Agency", native_name: "moburst.agency", network_type: "fb_instagram_account", native_link: "", status: "active" },
    ];
    deps.fetchSiteHtml = fail("the page read");
    // A brand read from before the page was another client's still lists Moburst's profiles; with no brand read, the page is not fetched.
    for (const rows of [rowsOf(row("brand_read", { result: { site_profiles: ["linkedin:moburst", "instagram:moburst.agency"] } })), new Map<string, StepRow>()]) {
      expect(await STEPS.accounts.run(db, c, ctx({ rows }))).toMatchObject({ status: "done", result: { matched: [], assigned: 0, platforms: [] } });
    }
    expect(db.tables.sprout_profiles).toEqual([]);
  });
  it("tracking waits for a site of its own, asking RivalIQ nothing", async () => {
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.advanceSetupOnServer = fail("the setup");
    deps.syncTrackedHandles = fail("the handle sync");
    expect(await STEPS.tracking.run(dbWith({ clients: [moburst(), kit()], competitor_sets: [set()] }), kit(), ctx())).toEqual({ status: "waiting", reason: "own_site", result: { set_id: "s1" } });
    // A landscape linked earlier is not matched by the other client's website either.
    expect(await STEPS.tracking.run(dbWith({ clients: [moburst(), kit()], competitor_sets: [set({ rivaliq_landscape_id: "L1" })] }), kit(), ctx())).toEqual({ status: "waiting", reason: "own_site", result: { set_id: "s1" } });
  });
  it("keys brand_read and tracking on the page being another client's, so the site is read again when that changes", async () => {
    const other = moburst();
    const db = dbWith({ clients: [other, kit()], competitor_sets: [set()], competitors: [] });
    expect(await STEPS.brand_read.inputs(db, kit(), new Map())).toBe("moburst.com/services/organic/podcast-booking|text_only");
    const tracked = await STEPS.tracking.inputs(db, kit(), new Map());
    expect(tracked).toMatch(/\|moburst\.com\/services\/organic\/podcast-booking\|text_only$/);
    // Once Moburst is archived, nobody else has the site: the page is the client's own and both keys move.
    Object.assign(other, { archived_at: T });
    expect(await STEPS.brand_read.inputs(db, kit(), new Map())).toBe("moburst.com/services/organic/podcast-booking");
    expect(await STEPS.tracking.inputs(db, kit(), new Map())).toBe(tracked!.replace(/\|text_only$/, ""));
  });
  it("counts only a client that sits above the page: one stored beside it on the same site marks neither (fix round 1)", async () => {
    const db = dbWith({ clients: [{ ...moburst(), website_url: "https://www.moburst.com/en/" }, kit()], competitor_sets: [set()], competitors: [] });
    expect(await STEPS.brand_read.inputs(db, kit(), new Map())).toBe("moburst.com/services/organic/podcast-booking");
    expect(await STEPS.brand_read.inputs(db, client({ id: "m", website_url: "https://www.moburst.com/en/" }), new Map())).toBe("moburst.com/en");
    expect(await STEPS.tracking.inputs(db, kit(), new Map())).not.toMatch(/text_only/);
  });
  it("still feeds the page's text to the brief, pillars and competitors", async () => {
    const db = dbWith({ clients: [moburst(), kit()], competitor_sets: [] });
    expect(await STEPS.brief_pillars.inputs(db, kit(), rowsOf(row("brand_read", { result: { parent_page: true, site_profiles: [] } })))).toContain("|site:moburst.com/services/organic/podcast-booking|");
    expect(await STEPS.competitors.inputs(db, kit(), rowsOf(row("brief_pillars")))).toMatch(/^site:moburst\.com\/services\/organic\/podcast-booking\|notes:/);
    const c = kit();
    const scraped: string[] = [];
    deps.scrapeMarkdown = async (url: string) => { scraped.push(url); return { markdown: "# Kitcaster books founders, executives and experts on the podcasts their buyers already listen to every week.", title: "Kitcaster" }; };
    deps.anthropicKey = async () => "key";
    deps.now = () => new Date(T);
    deps.derivePillars = (async () => ({ pillars: [{ name: "Podcast booking", description: "d", rationale: "r" }], keywords: ["podcast guesting"], notes: "", sources: ["brief"], source: "brief", derived_at: T })) as never;
    const out = await STEPS.brief_pillars.run(dbWith({ clients: [moburst(), c] }), c, ctx({ rows: rowsOf(row("brand_read")) }));
    expect(scraped).toEqual([KITCASTER]);
    expect(out).toMatchObject({ status: "done", result: { brief: "drafted", pillars: "derived" } });
  });
});

// Review Focus 5: a client whose website is a plain domain behaves exactly as
// before the parent-page rule, even when another client has a page on its
// site, and the rule reads no client for it.
describe("a plain-domain client is unchanged by the parent-page rule", () => {
  const OLO_SITE = `<html lang="en-US"><body><header><img class="logo" src="/logo.png"></header><footer>1250 Broadway, New York, NY 10001 <a href="https://www.linkedin.com/company/olo/">in</a></footer></body></html>`;
  const others = () => [{ id: "k2", name: "Olo Careers", website_url: "https://www.olo.com/careers/", archived_at: null, demo_job_id: null }];
  const olo = (over: Record<string, unknown> = {}) => client({ id: "c1", name: "Olo", website_url: "https://www.olo.com/", ...over });
  const watched = (db: ReturnType<typeof dbWith>) => {
    const tables: string[] = [];
    const from = db.from.bind(db);
    db.from = (t: string) => { tables.push(t); return from(t); };
    return tables;
  };

  it("brand_read, accounts and tracking give today's results and keys, and read no client", async () => {
    const c = olo();
    const db = dbWith({ clients: [...others(), c], sprout_profiles: [], sprout_profile_removals: [], competitor_sets: [{ id: "s1", client_id: "c1", status: "confirmed", confirmed_at: T, created_at: T, rivaliq_landscape_id: null, tracking_check: null }], competitors: [] });
    const tables = watched(db);
    deps.fetchSiteHtml = async () => ({ html: OLO_SITE, via: "direct" as const });
    deps.openaiKey = async () => "sk";
    deps.researchBrand = (async () => ({ brand_identity: BRAND, headquarters: { city: "New York", region: "NY", country: "US" }, site_language: "en", logo: { url: "https://www.olo.com/logo.svg" }, html: "", url: "", fetched_via: "direct", debug: {} })) as never;

    expect(await STEPS.brand_read.inputs(db, c, new Map())).toBe("olo.com");
    const read = await STEPS.brand_read.run(db, c, ctx());
    expect(read).toEqual({
      status: "done",
      result: {
        website: "olo.com", fetched_via: "direct", model_read: true, timezone: "America/New_York", timezone_source: "page_footer", country: "US", language: "en",
        logo: "file", written: ["brand_identity", "logo_url", "location", "timezone"], kept: [], site_profiles: ["linkedin:olo"],
        // The page's header image is not the logo the read chose, so it is kept as one of the site's other logo files (16 Nov 2026).
        logo_files: [`${c.website_url}logo.png`], logo_own: [`${c.website_url}logo.png`], logo_marks: 1,
      },
    });
    expect(c).toMatchObject({ brand_identity: BRAND, logo_url: "https://www.olo.com/logo.svg", timezone: "America/New_York", location: { source: "page_footer", website: "olo.com" } });

    const rows = rowsOf(row("brand_read", { result: (read as { result: Record<string, unknown> }).result }));
    deps.listCustomerProfiles = async () => [{ id: "7", name: "Olo - Skip the Line", native_name: "olo", network_type: "linkedin_company", native_link: "", status: "active" }];
    const accounts = await STEPS.accounts.run(db, c, ctx({ rows }));
    expect(accounts).toMatchObject({ status: "done", result: { profiles: 1, matched: [{ id: "7", network: "linkedin_company", handle: "olo", by: ["site_link"] }], assigned: 1, platforms: ["LinkedIn"], written: ["primary_platforms"] } });
    expect(Object.keys((accounts as { result: Record<string, unknown> }).result).sort()).toEqual(["assigned", "display_names", "list", "matched", "own", "own_dropped_at", "own_open", "platforms", "profiles", "site_profiles", "skipped", "written"]);

    const { FollowFailure } = await import("../../../functions/_shared/competitive/rivaliqFollowFailure");
    let asked = 0;
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.advanceSetupOnServer = async () => { asked++; throw new FollowFailure("RivalIQ's plan tracks 40 distinct companies and 40 are in use, so Olo could not be added.", true); };
    expect(await STEPS.tracking.inputs(db, c, new Map())).toMatch(/^s1\|none\|\|[^|]+\|olo\.com$/);
    expect(await STEPS.tracking.run(db, c, ctx())).toEqual({ status: "waiting", reason: "rivaliq_full", recheckDays: 1, result: { set_id: "s1" } });
    expect(asked).toBe(1);
    expect(tables).not.toContain("clients");
  });
});

// Kitcaster on 8 Nov: its posts are mostly about its podcast guests, no pillar
// stood on them alone, the keywords were thrown away with the pillars and the
// step's inputs never changed, so it waited for good.
describe("brief, pillars and keywords from the LinkedIn page", () => {
  const NOW = "2026-11-08T10:00:00.000Z";
  const KITCASTER = "https://www.moburst.com/services/organic/podcast-booking/";
  const ABOUT = "Kitcaster by Moburst is the podcast booking division of Moburst. We book founders, executives and experts on the podcasts their buyers already listen to.";
  const PAGE = { url: "https://www.linkedin.com/company/kitcaster-by-moburst/", name: "Kitcaster by Moburst", website: KITCASTER, about: ABOUT, tagline: "Strategic podcast booking for B2B leaders", specialties: ["podcast booking"], industries: ["Marketing Services"], logo: null, headquarters: null };
  const POSTS = [
    { id: "P1", platform: "LinkedIn", format: "image", date: "2026-10-20", text: "This week's guest: a SaaS founder on hiring", label: null, top: false },
    { id: "P2", platform: "LinkedIn", format: "image", date: "2026-10-27", text: "Our guest on the Growth Show talks pricing", label: null, top: false },
  ];
  const social = (page: Record<string, unknown> | null, over: Record<string, unknown> = {}) => row("social_read", { result: {
    checked_at: NOW, version: 1, window_days: 90, text_posts: 8, enough: true, posts: POSTS,
    linkedin_page: page ? { profile_id: "7", url: PAGE.url, key: "7:kitcaster-by-moburst", read_at: NOW, page } : null, ...over,
  } });
  const kit = (over: Record<string, unknown> = {}) => client({ id: "c1", name: "Kitcaster by Moburst", website_url: KITCASTER, ...over });
  const complete = (over: Record<string, unknown> = {}) => kit({ content_pillars: [{ name: "Podcast booking", description: "d" }], social_keywords: ["podcast guesting"], field_sources: { content_pillars: { by: "lifecycle" }, social_keywords: { by: "lifecycle" } }, ...over });
  const derived = (o: Partial<{ pillars: unknown[]; keywords: string[]; sources: string[]; source: string; brief: string | null }> = {}) =>
    ({ pillars: [{ name: "Podcast booking", description: "d", rationale: "r" }], keywords: ["podcast guesting"], notes: "", sources: ["social_posts", "linkedin_page"], source: "social_posts", derived_at: NOW, ...o });

  it("keys on the page's text while the client has no pillars and keywords, so a page read runs the step again", async () => {
    const db = dbWith();
    const none = await STEPS.brief_pillars.inputs(db, kit(), rowsOf(row("brand_read"), social(null)));
    const withPage = await STEPS.brief_pillars.inputs(db, kit(), rowsOf(row("brand_read"), social(PAGE)));
    expect(withPage).toMatch(/\|page:[0-9a-f]{8}$/);
    expect(withPage!.startsWith(`${none}|page:`)).toBe(true);
    expect(await STEPS.brief_pillars.inputs(db, kit(), rowsOf(row("brand_read"), social({ ...PAGE, about: `${ABOUT} Since 2017.` })))).not.toBe(withPage);
    // Keywords alone are not complete: the page still counts.
    expect(await STEPS.brief_pillars.inputs(db, kit({ social_keywords: ["podcast guesting"] }), rowsOf(row("brand_read"), social(PAGE)))).toMatch(/\|page:[0-9a-f]{8}$/);
  });
  it("leaves a complete client's key as it is when a page is read, and the run that completes a client sets off no other", async () => {
    const db = dbWith();
    // A client with pillars and keywords from before the page reader: its key has no page, and a page read changes nothing.
    const before = await STEPS.brief_pillars.inputs(db, complete(), rowsOf(row("brand_read"), social(null)));
    const ranOn = row("brief_pillars", { inputs_key: before });
    expect(await STEPS.brief_pillars.inputs(db, complete(), rowsOf(row("brand_read"), ranOn, social(PAGE)))).toBe(before);
    expect(await STEPS.brief_pillars.inputs(db, complete(), rowsOf(row("brand_read"), ranOn, social({ ...PAGE, about: "Something else entirely, written later on the page." })))).toBe(before);
    // Kitcaster ran on the page and its run wrote pillars and keywords: the key it ran on stays its key, whatever the page says next.
    const incomplete = await STEPS.brief_pillars.inputs(db, kit(), rowsOf(row("brand_read"), social(PAGE)));
    const ran = row("brief_pillars", { status: "waiting", inputs_key: incomplete });
    expect(await STEPS.brief_pillars.inputs(db, complete(), rowsOf(row("brand_read"), ran, social(PAGE)))).toBe(incomplete);
    expect(await STEPS.brief_pillars.inputs(db, complete(), rowsOf(row("brand_read"), ran, social({ ...PAGE, about: "Something else entirely, written later on the page." })))).toBe(incomplete);
  });
  it("drafts the brief from the page's about text when there is no document and no site text, and reads the page for the pillars", async () => {
    const c = kit();
    const db = dbWith({ clients: [c] });
    deps.now = () => new Date(NOW);
    deps.anthropicKey = async () => "key";
    deps.scrapeMarkdown = async () => null;
    deps.fetchSiteText = async () => "";
    let given: { evidence?: { brief_text?: string }; opts?: Record<string, unknown> } = {};
    deps.derivePillars = (async (_db: unknown, evidence: { brief_text: string }, _k: string, opts: Record<string, unknown>) => { given = { evidence, opts }; return derived(); }) as never;
    const out = await STEPS.brief_pillars.run(db, c, ctx({ rows: rowsOf(row("brand_read"), social(PAGE)) }));
    expect(c.brief_text).toBe(`Drafted from the LinkedIn page on 2026-11-08:\n\n${ABOUT}`);
    expect(c.field_sources.brief_text).toMatchObject({ by: "lifecycle", from: "linkedin_page" });
    expect(out).toMatchObject({ status: "done", result: { brief: "from_page", pillars: "derived", keywords: 1 } });
    // The page is given once, as the page; no brief is asked of the posts.
    expect(given.evidence?.brief_text).toBe("");
    expect(given.opts).toMatchObject({ page: PAGE, posts: POSTS, briefFromPosts: false });
    // Run again on the same page: the brief it drafted is kept as it is.
    const again = await STEPS.brief_pillars.run(db, c, ctx({ rows: rowsOf(row("brand_read"), social(PAGE)) }));
    expect(again).toMatchObject({ status: "done", result: { brief: "from_page", written: ["content_pillars", "pillars_source", "pillars_derived_at", "social_keywords"] } });
  });
  it("replaces a brief it drafted from the posts earlier with the page's", async () => {
    const c = kit({ brief_text: "Drafted from the client's posts on 2026-11-01:\n\nKitcaster books guests.", field_sources: { brief_text: { by: "lifecycle", from: "posts" } } });
    Object.assign(deps, { now: () => new Date(NOW), anthropicKey: async () => "key", scrapeMarkdown: async () => null, fetchSiteText: async () => "", derivePillars: async () => derived() });
    await STEPS.brief_pillars.run(dbWith({ clients: [c] }), c, ctx({ rows: rowsOf(row("brand_read"), social(PAGE)) }));
    expect([c.brief_text, c.field_sources.brief_text.from]).toEqual([`Drafted from the LinkedIn page on 2026-11-08:\n\n${ABOUT}`, "linkedin_page"]);
  });
  it("reads a client with no website and too few posts once it has a page with text, and keys it as before", async () => {
    // Uproar-shaped: no website, no document, no brief, 2 posts with text.
    const few = (page: Record<string, unknown> | null) => social(page, { text_posts: 2, enough: false, window_days: 365 });
    const uproar = (over: Record<string, unknown> = {}) => kit({ name: "Uproar by Moburst", website_url: null, ...over });
    deps.derivePillars = fail("the derivation");
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [uproar()] }), uproar(), ctx({ rows: rowsOf(few(null)) }))).toMatchObject({ status: "waiting", reason: "posts" });
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [uproar()] }), uproar(), ctx({ rows: rowsOf(few({ ...PAGE, about: "", tagline: null })) }))).toMatchObject({ status: "waiting", reason: "posts" });
    const c = uproar();
    Object.assign(deps, { now: () => new Date(NOW), anthropicKey: async () => "key", scrapeMarkdown: fail("the scrape") });
    let opts: Record<string, unknown> = {};
    deps.derivePillars = (async (_db: unknown, _c: unknown, _k: string, o: Record<string, unknown>) => { opts = o; return derived(); }) as never;
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [c] }), c, ctx({ rows: rowsOf(few(PAGE)) }))).toMatchObject({ status: "done", result: { brief: "from_page", pillars: "derived", posts: 2 } });
    expect(opts).toMatchObject({ page: PAGE, posts: POSTS });
    // The key: the posts' version stays in it as for any client with only its posts, and the page joins it while pillars or keywords are missing.
    const db = dbWith();
    const before = await STEPS.brief_pillars.inputs(db, uproar(), rowsOf(few(null)));
    const withPage = await STEPS.brief_pillars.inputs(db, uproar(), rowsOf(few(PAGE)));
    expect(before).toMatch(/\|social:1$/);
    expect(withPage).toMatch(new RegExp(`^${before!.replace(/[|]/g, "\\|")}\\|page:[0-9a-f]{8}$`));
    expect(await STEPS.brief_pillars.inputs(db, c, rowsOf(row("brief_pillars", { inputs_key: withPage }), few(PAGE)))).toBe(withPage);
    // A client complete from its posts alone keeps its key, the posts' version included, when a page is read.
    const done = uproar({ content_pillars: [{ name: "Launches", description: "d" }], social_keywords: ["pr"] });
    const keyed = await STEPS.brief_pillars.inputs(db, done, rowsOf(few(null)));
    expect(await STEPS.brief_pillars.inputs(db, done, rowsOf(row("brief_pillars", { inputs_key: keyed }), few(PAGE)))).toBe(keyed);
  });
  it("keeps today's order: the website's text first, the page after it, the posts last", async () => {
    deps.now = () => new Date(NOW);
    deps.anthropicKey = async () => "key";
    // The site has text: the brief is the site's, and the page is still read for the pillars.
    const site = kit();
    deps.scrapeMarkdown = async () => ({ markdown: "# Kitcaster books founders, executives and experts on the podcasts their buyers already listen to every week.", title: "Kitcaster" });
    let opts: Record<string, unknown> = {};
    deps.derivePillars = (async (_db: unknown, _c: unknown, _k: string, o: Record<string, unknown>) => { opts = o; return derived(); }) as never;
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [site] }), site, ctx({ rows: rowsOf(row("brand_read"), social(PAGE)) }))).toMatchObject({ result: { brief: "drafted" } });
    expect(site.brief_text).toMatch(/^Drafted from the website on 2026-11-08:/);
    expect(opts.page).toEqual(PAGE);
    // A page with no about text to speak of: the brief comes from the posts.
    const posts = kit();
    deps.scrapeMarkdown = async () => null;
    deps.fetchSiteText = async () => "";
    deps.derivePillars = (async () => derived({ brief: "Kitcaster books guests on podcasts." })) as never;
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [posts] }), posts, ctx({ rows: rowsOf(row("brand_read"), social({ ...PAGE, about: "Podcast booking." })) }))).toMatchObject({ result: { brief: "from_posts" } });
    expect(posts.brief_text).toBe("Drafted from the client's posts on 2026-11-08:\n\nKitcaster books guests on podcasts.");
  });
  it("never replaces a brief, pillars or keywords a person set", async () => {
    const c = kit({ brief_text: "Our brief, written by the account team.", content_pillars: [{ name: "Ours" }], social_keywords: ["ours"], field_sources: person("brief_text", "content_pillars", "social_keywords") });
    deps.scrapeMarkdown = fail("the scrape");
    deps.derivePillars = fail("the derivation");
    expect(await STEPS.brief_pillars.run(dbWith({ clients: [c] }), c, ctx({ rows: rowsOf(row("brand_read"), social(PAGE)) }))).toEqual({ status: "done", result: { brief: "kept", pillars: "kept" } });
    expect(c).toMatchObject({ brief_text: "Our brief, written by the account team.", content_pillars: [{ name: "Ours" }], social_keywords: ["ours"] });
  });
  it("writes the keywords when no pillar stands, then waits for evidence", async () => {
    const c = kit();
    const db = dbWith({ clients: [c] });
    deps.now = () => new Date(NOW);
    deps.anthropicKey = async () => "key";
    deps.scrapeMarkdown = async () => ({ markdown: "# Kitcaster books founders, executives and experts on the podcasts their buyers already listen to every week.", title: "Kitcaster" });
    deps.derivePillars = (async () => derived({ pillars: [], keywords: ["podcast guesting", "b2b podcasts"], sources: ["social_posts", "brief"] })) as never;
    const out = await STEPS.brief_pillars.run(db, c, ctx({ rows: rowsOf(row("brand_read"), social(null)) }));
    expect(out).toMatchObject({ status: "waiting", reason: "evidence", recheckDays: 7, result: { brief: "drafted", pillars: "none", keywords: 2, written: ["brief_text", "social_keywords"] } });
    expect(c).toMatchObject({ content_pillars: [], social_keywords: ["podcast guesting", "b2b podcasts"] });
    expect(c.brief_text).toMatch(/^Drafted from the website on 2026-11-08:/);
    expect(c.field_sources.social_keywords).toMatchObject({ by: "lifecycle" });
  });
});

describe("design_settings", () => {
  const refs = rowsOf(row("design_refs", { result: { synthesized_at: T } }));
  const LOGO_URL = "https://brand.test/logo.svg";
  const LOGO = "c1/design-settings/logo-site-1.png";
  const HASH = "0123456789abcdef";
  const MADE = { other: `c1/design-settings/logo-${HASH}-other.png`, white: `c1/design-settings/logo-${HASH}-white.png` };
  const SPOT = { shown: true, at: "top-center" as const, width: 0.3 };
  const PLACEMENT = { anchor: "center", width: 0.3, top: 0.04 };
  const INPUTS = `refs:${T}|logo:${LOGO_URL}`;
  const COLORS = "|colors:#3bd4ff,#0c1d2f,#ff6671";
  const posts = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `c1/social-${i}.jpg` }));
  const c = (over: Record<string, unknown> = {}) => client({ logo_url: LOGO_URL, brand_identity: { ...BRAND, secondary_color: "#0c1d2f" }, harvested_design_references: posts(2), ...over });
  /** The settings row as the lifecycle wrote it for this client, before the logo set existed. */
  const stored = (over: Record<string, unknown> = {}) => ({
    client_id: "c1", source: "lifecycle", logo_path: LOGO, placement: { ...PLACEMENT }, background: "#0C1D2F", reference_paths: ["c1/social-0.jpg", "c1/social-1.jpg"],
    derived: { logo_from: LOGO_URL, logo_file: "from_svg", placement_from: "client_posts", logo_read: SPOT, background_from: "brand_color", at: "2026-10-20T08:00:00.000Z" },
    confirmed_at: "2026-10-20T08:00:00.000Z", updated_at: "2026-10-20T08:00:00.000Z", logo_set: null, ...over,
  });
  /** What the service answers about the stored file: a logo of one ink that shows whole on the rows' background (6.2:1 on #0C1D2F), both copies made. */
  const FACTS = {
    size: { width: 600, height: 200 }, own: "light" as const, both: false, made: { other: { turned: 1 }, white: { turned: 1 } }, site: null, person: null,
    inks: { stored: [{ color: [120, 150, 255], share: 1 }], other: [{ color: [255, 255, 255], share: 1 }], white: [{ color: [255, 255, 255], share: 1 }] },
  };
  const found = (shows: "stored" | "other" | "white", ground = [16, 40, 76]) => ({ found: true, score: 0.95, matched: shows, rect: { x: 1, y: 2, width: 100, height: 33 }, gaps: { [shows]: 20 }, shows, ground, flat: 0.99 });
  const MISSED = { found: false, score: 0.3 };

  /** A row a person set: their own logo file, placement, background and posts. */
  const theirs = (over: Record<string, unknown> = {}) => ({
    client_id: "c1", source: "person", logo_path: "c1/their-logo.png", placement: { anchor: "left", width: 0.3, top: 0.05, left: 0.05 }, background: "#0C1D2F",
    reference_paths: ["c1/new-0.jpg", "c1/new-1.jpg", "c1/new-2.jpg"], derived: null, confirmed_at: "2026-10-01T08:00:00.000Z", confirmed_by: "person-1", updated_at: "2026-10-01T08:00:00.000Z", logo_set: null, ...over,
  });

  /** The database functions the step calls, written the way the migrations have them. */
  const rpcs = {
    lifecycle_write_design_settings: (a: Record<string, unknown>, db: ReturnType<typeof dbWith>) => {
      const rows = (db.tables.design_brand_settings ??= []);
      const at = rows.find((r) => r.client_id === a.p_client);
      const values = { logo_path: a.p_logo_path, placement: a.p_placement, background: a.p_background, reference_paths: (a.p_reference_paths as string[]).slice(0, 16), derived: a.p_derived, confirmed_at: T, updated_at: T };
      if (!at) { rows.push({ client_id: a.p_client, source: "lifecycle", logo_set: null, ...values }); return true; }
      if (at.source !== "lifecycle") return false;
      Object.assign(at, values);
      return true;
    },
    settle_design_logo_set: (a: Record<string, unknown>, db: ReturnType<typeof dbWith>) => {
      const at = (db.tables.design_brand_settings ?? []).find((r) => r.client_id === a.p_client);
      const person = (at?.logo_set as { person?: unknown } | null)?.person ?? null;
      if (!at || at.logo_path !== a.p_of || JSON.stringify(person) !== JSON.stringify(a.p_person ?? null)) return false;
      const { person: _dropped, ...set } = a.p_set as Record<string, unknown>;
      at.logo_set = { ...set, ...(person ? { person } : {}) };
      return true;
    },
  };

  /** Fakes for everything the step calls outside the database; `seen` records each call. */
  function world(opts: {
    row?: Record<string, unknown> | null; shows?: Record<string, unknown>; facts?: Record<string, unknown>; logo?: Record<string, unknown>; picture?: (route: string) => void; site?: Record<string, string | null>; gone?: string[];
    given?: Record<string, (a: Record<string, unknown>, db: ReturnType<typeof dbWith>) => unknown>;
    /** The client's homepage, as a direct read gives it: a page with no mark of the brand when not given, and null for a site that cannot be read. */
    page?: string | null;
    /** What the service answers for one logo file, by its stored path: its facts, and what each post shows of it, or the failure it answers with. */
    byLogo?: Record<string, { facts?: Record<string, unknown>; shows?: Record<string, unknown>; fail?: Error }>;
    /** How far the service gets in a read of posts within its time: every post sent when not given. `shown` is what a post shows of the file searched for. */
    within?: (body: Record<string, unknown>, carried: { search?: unknown; asks: number } | null, shown: (link: string) => unknown) => unknown;
  } = {}) {
    const db = dbWith({ design_brand_settings: opts.row === null ? [] : [opts.row ?? stored()] }, { ...rpcs, ...(opts.given ?? {}) });
    const seen = { key: 0, spot: 0, pages: [] as string[], sizes: [] as string[], logoPng: [] as string[], hash: [] as string[], calls: [] as Array<{ route: string; body: Record<string, unknown>; carried?: { search?: unknown; asks: number } | null }> };
    deps.now = () => new Date(T);
    deps.projectUrl = () => "https://project.test";
    deps.fetchSiteHtml = (async (url: string, o: { firecrawlKey?: string | null } = {}) => {
      seen.pages.push(url);
      // The step reads the page directly: it never hands a scraping key over.
      if (o.firecrawlKey) throw new Error("the step must read the homepage without a scraping service");
      if (opts.page === null) throw new ResearchError("site_unreachable", "The website could not be read.");
      return { html: opts.page ?? "<html><body><main></main></body></html>", via: "direct" as const };
    }) as never;
    deps.anthropicKey = async () => { seen.key++; return "key"; };
    deps.imaging = (async () => ({
      logoPng: async (_db: unknown, _client: string, url: string) => {
        seen.logoPng.push(url);
        if (url === LOGO_URL) return { path: LOGO, width: 600, height: 200, ink: [255, 255, 255] as [number, number, number], converted: "from_svg" as const, ...(opts.logo ?? {}) };
        const path = opts.site?.[url];
        if (path === undefined) throw new Error("The logo file answered 404.");
        return path ? { path, width: 600, height: 200, ink: null, converted: "kept" as const } : null;
      },
      readLogoSpot: async () => { seen.spot++; return SPOT; },
      fileHash: async (_db: unknown, path: string) => { seen.hash.push(path); return HASH; },
      postSize: async (_db: unknown, path: string) => { seen.sizes.push(path); return [1000, 1250] as [number, number]; },
    })) as never;
    deps.picture = (() => ({
      call: async (route: string, body: Record<string, unknown>) => {
        opts.picture?.(route);
        seen.calls.push({ route, body });
        const logo = String(route === "logo-set" ? body.logo : (body.searches as Array<{ logo: string }>)[0].logo).replace("generated-media/", "");
        const own = opts.byLogo?.[logo];
        if (own?.fail) throw own.fail;
        return { result: { ...FACTS, ...(opts.facts ?? {}), ...(own?.facts ?? {}) }, ms: 40 };
      },
      // A read of posts, worked to the service's time: every post sent unless the test says how far the service gets (`within`).
      within: async (route: string, body: Record<string, unknown>, carried: { search?: unknown; asks: number } | null) => {
        opts.picture?.(route);
        seen.calls.push({ route, body, carried });
        const logo = String((body.searches as Array<{ logo: string }>)[0].logo).replace("generated-media/", "");
        const own = opts.byLogo?.[logo];
        if (own?.fail) throw own.fail;
        const shows = own ? own.shows ?? {} : opts.shows ?? {};
        const shown = (link: string) => shows[link.replace("design-references/", "")] ?? MISSED;
        return opts.within?.(body, carried, shown) ?? { result: { posts: (body.posts as string[]).map(shown) }, ms: 900 };
      },
      read: async (bucket: string, path: string) => {
        // A file that is gone from storage: what signedRead gives for it.
        if (opts.gone?.includes(path)) throw new NotInStorage(`Could not prepare ${path} for the picture service: Object not found`);
        return `${bucket}/${path}`;
      },
      write: async (bucket: string, path: string) => `put:${bucket}/${path}`,
    })) as never;
    return { db, seen, row: () => db.tables.design_brand_settings[0] };
  }

  type Out = { status: string; result?: Record<string, any>; recheckMinutes?: number; reason?: string; error?: string }; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** The step run the way the runner runs it, one look after another, until it stops waiting on its own work. */
  async function drive(db: ReturnType<typeof dbWith>, cl: Record<string, unknown>, rows: Map<string, StepRow>, most = 12): Promise<Out[]> {
    const outs: Out[] = [];
    for (let i = 0; i < most; i++) {
      const key = await STEPS.design_settings.inputs(db, cl, rows);
      const prev = rows.get("design_settings") ?? null;
      const out = await STEPS.design_settings.run(db, cl, { force: false, previous: prev && prev.inputs_key === key ? prev : null, rows }) as Out;
      outs.push(out);
      rows.set("design_settings", rowAfter(prev, { client_id: "c1", step: "design_settings", inputs_key: key! }, out as never, new Date(T)));
      if (!(out.status === "waiting" && out.reason === "in_progress")) break;
    }
    return outs;
  }
  /** The step's rows as they were before the logo set: done, on the old key. */
  const before = (over: Partial<StepRow> = {}) => rowsOf(row("design_refs", { result: { synthesized_at: T } }), row("design_settings", { inputs_key: `${INPUTS}${COLORS}`, result: { written: true, logo_path: LOGO }, ...over }));
  const picture = (seen: { calls: Array<{ route: string }> }, route: string) => seen.calls.filter((x) => x.route === route);

  it("waits for learned references and a logo, and leaves a person's settings alone", async () => {
    expect(await STEPS.design_settings.inputs(dbWith({ design_brand_settings: [] }), c(), new Map())).toBeNull();
    expect(await STEPS.design_settings.inputs(dbWith({ design_brand_settings: [] }), client(), refs)).toBeNull();
    // A row a person set has a key of its own, and the step makes its logo set and writes nothing else (16 Nov 2026; its own block is below).
    const { db, row: settings } = world({ row: theirs() });
    const untouched = structuredClone(settings());
    expect(await STEPS.design_settings.inputs(db, c(), refs)).toBe(`person|logo:c1/their-logo.png|refs:${T}|at:left,0.3,0.05,0.05|site:|other:|tone:2`);
    const outs = await drive(db, c(), rowsOf(row("design_refs", { result: { synthesized_at: T } })));
    expect(outs.at(-1)).toMatchObject({ status: "done", result: { kept: "person", tone: { of: "c1/their-logo.png", settled: T } } });
    const { logo_set, ...after } = settings();
    const { logo_set: _none, ...beforeRow } = untouched;
    expect(after).toEqual(beforeRow);
    expect(logo_set).toMatchObject({ of: "c1/their-logo.png", canvas: { file: "stored", ground: "#0C1D2F", from: "settings" } });
  });

  it("keys a lifecycle row on its posts, logo and colors, then the website's logo files, a person's second file, the tone rule and the rule for the logo its posts show", async () => {
    const { db } = world();
    expect(await STEPS.design_settings.inputs(db, c(), refs)).toBe(`${INPUTS}${COLORS}|site:|other:|tone:2|pick:1`);
    const withSite = rowsOf(row("design_refs", { result: { synthesized_at: T } }), row("brand_read", { result: { logo_files: ["https://brand.test/logo-white.svg"] } }));
    expect(await STEPS.design_settings.inputs(db, c(), withSite)).toMatch(/\|site:[0-9a-z]+\|other:\|tone:2\|pick:1$/);
    db.tables.design_brand_settings[0].logo_set = { person: { path: "c1/design-settings/logo-other-9.png", of: LOGO, at: T } };
    expect(await STEPS.design_settings.inputs(db, c(), refs)).toBe(`${INPUTS}${COLORS}|site:|other:c1/design-settings/logo-other-9.png|tone:2|pick:1`);
  });

  it("derives the logo file, the placement from the client's posts and the background from the brand colors", async () => {
    const { db, seen } = world({ row: null });
    const out = await STEPS.design_settings.run(db, c(), ctx({ rows: refs }));
    expect(out).toMatchObject({ status: "done", result: { written: true, placement: { anchor: "center", width: 0.3, top: 0.04 }, placement_from: "client_posts", background: "#0C1D2F", background_from: "brand_color", references: 2 } });
    expect(db.rpcCalls[0]).toMatchObject({ name: "lifecycle_write_design_settings", args: { p_client: "c1", p_logo_path: LOGO, p_reference_paths: ["c1/social-0.jpg", "c1/social-1.jpg"], p_derived: { placement_from: "client_posts", logo_file: "from_svg", logo_read: SPOT, logo_read_for: INPUTS, at: T } } });
    // A new client's posts are read by the model once.
    expect(seen.spot).toBe(1);
    expect(seen.key).toBe(1);
  });

  it("reuses the stored read of the logo's spot when its refs and logo parts are unchanged, and calls no model", async () => {
    const { db, seen, row: settings } = world();
    const outs = await drive(db, c(), before());
    expect(outs.at(-1)).toMatchObject({ status: "done" });
    expect(seen.spot).toBe(0);
    expect(seen.key).toBe(0);
    const write = db.rpcCalls.find((r) => r.name === "lifecycle_write_design_settings")!;
    expect(write.args.p_derived).toMatchObject({ logo_read: SPOT, logo_read_for: INPUTS, placement_from: "client_posts" });
    // The same logo, placement and background: the date the settings were derived on does not move.
    expect(write.args.p_derived.at).toBe("2026-10-20T08:00:00.000Z");
    expect(settings().derived.at).toBe("2026-10-20T08:00:00.000Z");
    expect(settings()).toMatchObject({ logo_path: LOGO, placement: PLACEMENT, background: "#0C1D2F" });
  });

  it("writes the background again by the logo's weakest whole part when the rule changes, makes the set again, and calls no model", async () => {
    // Two white letters and a dim blue one. Their average stands out on the brand's navy, where the dim blue letter has 2.9:1.
    const logo = { ink: [190, 195, 205], inks: [[255, 255, 255], [60, 100, 160]], own: "dark" };
    // The row and the step as the rule of 16 Nov left them: the navy background, a set of that rule, a finished step on its key.
    const old = { of: LOGO, rule: 1, own: "dark", both: false, other: null, white: null, made: MADE, site: null, posts: { read: 2, found: 0, shown: { stored: 0, other: 0, white: 0 } }, canvas: { file: "stored", ground: "#0C1D2F", from: "settings" }, at: "2026-11-16T09:00:00.000Z" };
    const { db, seen, row: settings } = world({
      logo, row: stored({ logo_set: old, derived: { ...stored().derived, logo_read_for: INPUTS } }),
      facts: { own: "dark", inks: { stored: [{ color: [255, 255, 255], share: 0.7 }, { color: [60, 100, 160], share: 0.3 }], other: null, white: null }, made: { other: null, white: null } },
    });
    const rows = before({ inputs_key: `${INPUTS}${COLORS}|site:|other:|tone:1`, result: { written: true, logo_path: LOGO, tone: { of: LOGO, settled: "2026-11-16T09:00:00.000Z" } } });
    // The key moved with the rule, so the step runs with nobody doing anything.
    expect(await STEPS.design_settings.inputs(db, c(), rows)).toBe(`${INPUTS}${COLORS}|site:|other:|tone:2|pick:1`);
    const outs = await drive(db, c(), rows);
    expect(outs.at(-1)).toMatchObject({ status: "done", result: { written: true, background: "#0B0E1A", background_from: "neutral" } });
    // The stored read of the logo's spot is reused: no model and no key.
    expect(seen.spot).toBe(0);
    expect(seen.key).toBe(0);
    // The settings: the same logo and placement, the neutral of the file's own ground behind it.
    expect(settings()).toMatchObject({ logo_path: LOGO, placement: PLACEMENT, background: "#0B0E1A", source: "lifecycle" });
    expect(settings().derived).toMatchObject({ background_from: "neutral", logo_read: SPOT, logo_read_for: INPUTS, at: T });
    // The set of the new rule, with the file's inks, resting on the background it shows whole on.
    expect(settings().logo_set).toMatchObject({ of: LOGO, rule: 2, inks: [[255, 255, 255], [60, 100, 160]], canvas: { file: "stored", ground: "#0B0E1A", from: "settings" }, at: T });
  });

  it("reuses a stored read that found no spot", async () => {
    const { db, seen } = world({ row: stored({ placement: { anchor: "center", width: 0.25, top: 0.04 }, derived: { placement_from: "default", logo_read: null, at: "2026-10-20T08:00:00.000Z" } }) });
    const outs = await drive(db, c(), before());
    expect(outs.at(-1)).toMatchObject({ status: "done", result: { placement_from: "default", placement: { anchor: "center", width: 0.25, top: 0.04 } } });
    expect(seen.spot).toBe(0);
    expect(seen.key).toBe(0);
  });

  it("asks the model again when the posts or the logo changed, and records what the read was made for", async () => {
    // The posts were learned again since the step last finished.
    const older = before({ inputs_key: `refs:2026-09-01T10:00:00.000Z|logo:${LOGO_URL}${COLORS}` });
    const { db, seen } = world();
    await drive(db, c(), older);
    expect(seen.spot).toBe(1);
    expect(seen.key).toBe(1);
    const write = db.rpcCalls.find((r) => r.name === "lifecycle_write_design_settings")!;
    expect(write.args.p_derived).toMatchObject({ logo_read: SPOT, logo_read_for: INPUTS, at: T });

    // From then on the record on the settings row decides: another key change with the same posts and logo asks nothing.
    const again = world({ row: stored({ derived: { ...stored().derived, logo_read_for: INPUTS } }) });
    await drive(again.db, c({ brand_identity: { ...BRAND, secondary_color: "#0c1d2f", accent_color: "#000000" } }), before({ inputs_key: "refs:older|logo:x|colors:" }));
    expect(again.seen.spot).toBe(0);
    // A read made for another logo is not reused.
    const moved = world({ row: stored({ derived: { ...stored().derived, logo_read_for: `refs:${T}|logo:https://brand.test/old.svg` } }) });
    await drive(moved.db, c(), before());
    expect(moved.seen.spot).toBe(1);
  });

  it("fails without a set when a read is needed and the AI connection is not configured", async () => {
    const { db, seen } = world({ row: null });
    deps.anthropicKey = async () => null;
    expect(await STEPS.design_settings.run(db, c(), ctx({ rows: refs }))).toEqual({ status: "failed", error: "The AI connection is not configured." });
    expect(seen.calls).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
  });

  it("reads four posts to a run and carries on where it stopped", async () => {
    const nine = posts(9).map((p) => p.path);
    const { db, seen, row: settings } = world({ row: stored({ reference_paths: nine }), shows: { "c1/social-1.jpg": found("other"), "c1/social-6.jpg": found("other", [15, 41, 76]), "c1/social-8.jpg": found("stored", [250, 250, 250]) } });
    const outs = await drive(db, c({ harvested_design_references: posts(9) }), before());
    expect(outs.map((o) => [o.status, o.reason ?? null, o.recheckMinutes ?? null])).toEqual([["waiting", "in_progress", 1], ["waiting", "in_progress", 1], ["done", null, null]]);
    const asked = picture(seen, "post-logos").map((x) => (x as { body: { posts: string[] } }).body.posts.map((l) => l.replace("design-references/", "")));
    expect(asked).toEqual([nine.slice(0, 4), nine.slice(4, 8), nine.slice(8)]);
    // No post is asked for twice, and the settings are written once.
    expect(new Set(asked.flat()).size).toBe(9);
    expect(db.rpcCalls.filter((r) => r.name === "lifecycle_write_design_settings")).toHaveLength(1);
    // The set: the copy two posts show, on the canvas, on the ground they have.
    expect(settings().logo_set).toMatchObject({
      of: LOGO, rule: 2, own: "light", other: { path: MADE.other, from: "made", size: [600, 200] }, white: null, made: MADE,
      posts: { read: 9, found: 3, shown: { stored: 1, other: 2, white: 0 } }, canvas: { file: "other", from: "client_posts" }, at: T,
    });
    expect(outs.at(-1)!.result!.tone).toMatchObject({ of: LOGO, hash: HASH, settled: T });
    // Every wait carries the settings, so a screen that reads the step sees what it saw before.
    expect(outs[0].result).toMatchObject({ written: true, logo_path: LOGO, background: "#0C1D2F" });
  });

  it("leaves out a post that is gone from storage, reads the others and settles the set", async () => {
    const six = posts(6).map((p) => p.path);
    const { db, seen, row: settings } = world({ row: stored({ reference_paths: six }), gone: ["c1/social-2.jpg", "c1/social-4.jpg", "c1/social-5.jpg"], shows: { "c1/social-1.jpg": found("other") } });
    const outs = await drive(db, c({ harvested_design_references: posts(6) }), before());
    expect(outs.map((o) => o.status)).toEqual(["waiting", "done"]);
    // The posts storage has are sent; the second batch holds none, so no call is made for it.
    const asked = picture(seen, "post-logos").map((x) => (x as { body: { posts: string[] } }).body.posts.map((l) => l.replace("design-references/", "")));
    expect(asked).toEqual([["c1/social-0.jpg", "c1/social-1.jpg", "c1/social-3.jpg"]]);
    // Only the posts that were read are counted, and the set is settled from them.
    expect(settings().logo_set).toMatchObject({ of: LOGO, other: { path: MADE.other, from: "made" }, posts: { read: 3, found: 1, shown: { stored: 0, other: 1, white: 0 } } });
    expect(outs.at(-1)!.result!.tone).toMatchObject({ settled: T });
  });

  it("makes the files once and keeps what the service answered between runs", async () => {
    const { db, seen } = world({ row: stored({ reference_paths: posts(9).map((p) => p.path) }) });
    await drive(db, c({ harvested_design_references: posts(9) }), before());
    expect(picture(seen, "logo-set")).toHaveLength(1);
    expect(seen.hash).toEqual([LOGO]);
    expect(seen.calls[0]).toEqual({ route: "logo-set", body: { job: "c1", step: "design_settings", logo: `generated-media/${LOGO}`, out: { other: `put:generated-media/${MADE.other}`, white: `put:generated-media/${MADE.white}` } } });
    // The posts are searched with the stored file on its own ground, the copy on the other, and the white copy compared.
    expect(picture(seen, "post-logos")[0]).toMatchObject({ body: {
      placement: PLACEMENT, scales: [0.45, 1.35],
      searches: [{ file: "stored", logo: `generated-media/${LOGO}`, ground: [255, 255, 255] }, { file: "other", logo: `generated-media/${MADE.other}`, ground: [11, 14, 26] }],
      compare: [{ file: "white", logo: `generated-media/${MADE.white}` }],
    } });
  });

  it("converts one website file to a run", async () => {
    const files = ["https://brand.test/logo-white.svg", "https://brand.test/gone.png", "https://brand.test/icon.ico"];
    const site = { [files[0]]: "c1/design-settings/logo-site-w.png", [files[2]]: null };
    const { db, seen, row: settings } = world({ site, facts: { site: { index: 0, overlap: 0.97, size: { width: 900, height: 300 } }, inks: { ...FACTS.inks, other: [{ color: [250, 250, 250], share: 1 }] } } });
    const rows = before();
    rows.set("brand_read", row("brand_read", { result: { logo_files: files } }));
    const outs = await drive(db, c(), rows);
    expect(outs.map((o) => o.status)).toEqual(["waiting", "waiting", "done"]);
    // The main logo once, then one website file a run, in the order the page has them.
    expect(seen.logoPng).toEqual([LOGO_URL, ...files]);
    // A file that could not be fetched or is no picture is left out; the one that passed the same-logo test is the second file.
    expect(picture(seen, "logo-set")).toHaveLength(1);
    expect((picture(seen, "logo-set")[0] as { body: { site: string[] } }).body.site).toEqual(["generated-media/c1/design-settings/logo-site-w.png"]);
    expect(settings().logo_set).toMatchObject({ other: { path: "c1/design-settings/logo-site-w.png", from: "site", size: [900, 300] }, site: "c1/design-settings/logo-site-w.png", made: MADE });
    // The posts were searched with the brand's own file on the other ground.
    expect((picture(seen, "post-logos")[0] as { body: { searches: Array<{ logo: string }> } }).body.searches[1].logo).toBe("generated-media/c1/design-settings/logo-site-w.png");
  });

  it("writes today's settings and waits when the picture service cannot be reached", async () => {
    const down = new PictureError("The picture service did not answer: 503.", "logo-set", "unavailable");
    const { db, row: settings } = world({ row: null, picture: () => { throw down; } });
    const out = await STEPS.design_settings.run(db, c(), ctx({ rows: refs })) as Out;
    expect(out).toMatchObject({ status: "waiting", reason: "picture_service", recheckMinutes: 10, result: { written: true, logo_path: LOGO, background: "#0C1D2F" } });
    // A new client can start designs with the one file, as today.
    expect(settings()).toMatchObject({ logo_path: LOGO, placement: PLACEMENT, background: "#0C1D2F", source: "lifecycle", logo_set: null });
    expect(db.rpcCalls.map((r) => r.name)).toEqual(["lifecycle_write_design_settings"]);
  });

  /**
   * A service whose time is used after a post and a half: a post takes two
   * units of work and a call has three. What it did of a post it did not
   * finish comes back as the point to carry on from, and a call that brings
   * that point for its first post starts there. `work` counts the units
   * spent on each post, so a post searched again from the beginning shows.
   */
  function slowService() {
    const work: Record<string, number> = {};
    const within = (body: Record<string, unknown>, carried: { search?: unknown; asks: number } | null, shown: (link: string) => unknown) => {
      const links = body.posts as string[];
      const point = (carried?.search ?? null) as { of: string; done: unknown[]; at: { size: number; row: number; best: unknown } } | null;
      const asks = (carried?.asks ?? 0) + 1;
      let units = 3;
      const done: unknown[] = [];
      for (const [i, link] of links.entries()) {
        const had = i === 0 && point?.of === link ? point.at.size : 0;
        const spend = Math.min(units, 2 - had);
        work[link] = (work[link] ?? 0) + spend;
        units -= spend;
        if (had + spend < 2) {
          const search = { of: link, done: [], at: { size: had + spend, row: 0, best: { x: 0, y: 0, width: 0, height: 0, score: -2 } } };
          return { unfinished: { posts: done, search }, carried: { search, asks }, ms: 20_003 };
        }
        done.push(shown(link));
        if (units === 0 && i < links.length - 1) return { unfinished: { posts: done }, carried: { asks }, ms: 20_001 };
      }
      return { result: { posts: done }, ms: 9_000 };
    };
    return { work, within };
  }
  type Asked = { body: { posts: string[] }; carried: { search?: { of: string }; asks: number } | null };

  it("keeps what the service read within its time, carries on in the post it stopped in, and ends in the set one read of them all gives", async () => {
    const nine = posts(9).map((p) => p.path);
    const shows = { "c1/social-1.jpg": found("other"), "c1/social-6.jpg": found("other", [15, 41, 76]), "c1/social-8.jpg": found("stored", [250, 250, 250]) };
    // One read of everything, as a fast service gives it.
    const fast = world({ row: stored({ reference_paths: nine }), shows });
    await drive(fast.db, c({ harvested_design_references: posts(9) }), before());

    const service = slowService();
    const w = world({ row: stored({ reference_paths: nine }), shows, within: service.within });
    const outs = await drive(w.db, c({ harvested_design_references: posts(9) }), before(), 20);
    // Every look that leaves posts unread is the step's own short wait, never a wait for the service.
    expect(outs.slice(0, -1).every((o) => o.status === "waiting" && o.reason === "in_progress" && o.recheckMinutes === 1)).toBe(true);
    expect(outs.at(-1)).toMatchObject({ status: "done" });
    // The same set, from the same posts.
    expect(w.row().logo_set).toEqual(fast.row().logo_set);
    expect(w.row().logo_set).toMatchObject({ posts: { read: 9, found: 3, shown: { stored: 1, other: 2, white: 0 } } });
    // Each post cost its two units of work and no more: nothing was searched from the beginning twice.
    expect(service.work).toEqual(Object.fromEntries(nine.map((p) => [`design-references/${p}`, 2])));
    // Nine posts at a post and a half to a call: six calls, each starting with the first post not yet read.
    const asked = picture(w.seen, "post-logos") as unknown as Asked[];
    expect(asked.map((x) => x.body.posts[0].replace("design-references/c1/social-", "").replace(".jpg", ""))).toEqual(["0", "1", "3", "4", "6", "7"]);
    expect(asked.map((x) => x.carried?.search?.of ?? null)).toEqual([null, "design-references/c1/social-1.jpg", null, "design-references/c1/social-4.jpg", null, "design-references/c1/social-7.jpg"]);
    // The step never asks for more than the request may carry, and nothing of the read is left in its result once it ended.
    expect(asked.every((x) => x.body.posts.length <= 4)).toBe(true);
    expect(outs.at(-1)!.result!.tone).not.toHaveProperty("reading");
    expect(outs.at(-1)!.result!.tone).not.toHaveProperty("batch");
  });

  it("waits quietly when the service does not answer, keeps what was read, and asks for the same read again", async () => {
    const nine = posts(9).map((p) => p.path);
    const service = slowService();
    const slow = new PictureError("The picture service did not answer: timeout.", "post-logos", "unavailable");
    let down = false;
    const w = world({ row: stored({ reference_paths: nine }), within: (body, carried, shown) => { if (down) throw slow; return service.within(body, carried, shown); } });
    const rows = before();
    const cl = c({ harvested_design_references: posts(9) });
    // One look: post 0 is read and post 1 begun.
    const key = await STEPS.design_settings.inputs(w.db, cl, rows);
    const first = await STEPS.design_settings.run(w.db, cl, { force: false, previous: null, rows }) as Out;
    rows.set("design_settings", rowAfter(rows.get("design_settings") ?? null, { client_id: "c1", step: "design_settings", inputs_key: key! }, first as never, new Date(T)));
    expect(first.result!.tone.reading).toMatchObject({ post: "c1/social-1.jpg", asks: 1, soFar: { of: "design-references/c1/social-1.jpg", at: { size: 1 } } });
    // The service stops answering: a quiet wait of ten minutes, with the read so far kept.
    down = true;
    const waited = await drive(w.db, cl, rows);
    expect(waited).toHaveLength(1);
    expect(waited[0]).toMatchObject({ status: "waiting", reason: "picture_service", recheckMinutes: 10 });
    expect(Object.keys(waited[0].result!.tone.posts)).toEqual(["c1/social-0.jpg"]);
    expect(waited[0].result!.tone.reading).toEqual(first.result!.tone.reading);
    // It answers again: the same posts are asked for, from the same point, and the read ends.
    down = false;
    const outs = await drive(w.db, cl, rows, 20);
    expect(outs.at(-1)).toMatchObject({ status: "done" });
    const asked = picture(w.seen, "post-logos") as unknown as Asked[];
    expect(asked[2].body.posts).toEqual(asked[1].body.posts);
    expect(asked[2].carried).toEqual(asked[1].carried);
    expect(asked[1].body.posts).toHaveLength(4);
    expect(w.row().logo_set).toMatchObject({ of: LOGO, posts: { read: 9 } });
    expect(service.work).toEqual(Object.fromEntries(nine.map((p) => [`design-references/${p}`, 2])));
  });

  it("searches a post from the beginning when the way the posts are searched changed while it was being read", async () => {
    const two = posts(2).map((p) => p.path);
    const service = slowService();
    const w = world({ row: stored({ reference_paths: two, placement: { ...PLACEMENT } }), within: service.within });
    const rows = before();
    const cl = c();
    const key = await STEPS.design_settings.inputs(w.db, cl, rows);
    const first = await STEPS.design_settings.run(w.db, cl, { force: false, previous: null, rows }) as Out;
    rows.set("design_settings", rowAfter(rows.get("design_settings") ?? null, { client_id: "c1", step: "design_settings", inputs_key: key! }, first as never, new Date(T)));
    expect(first.result!.tone.reading).toMatchObject({ post: "c1/social-1.jpg" });
    // The read of the logo's spot gives another placement on the next run: what the posts gave, and the point, are for another search.
    const kept = rows.get("design_settings")!;
    (kept.result as { tone: { searched: string } }).tone.searched = "another search";
    await drive(w.db, cl, rows, 20);
    const asked = picture(w.seen, "post-logos") as unknown as Asked[];
    expect(asked[1].body.posts.map((l) => l.replace("design-references/", ""))).toEqual(two);
    expect(asked[1].carried).toBeNull();
  });

  it("ends the read of a post the service never finishes: twelve reads with a budget are counted against it, and the next asks for it alone", async () => {
    const three = posts(3).map((p) => p.path);
    // Every read that carries fewer than twelve spent calls uses its time in its first post and gets no further. A read that
    // carries twelve is the one the client sends with no budget (picture/client.ts), which the service works to its end.
    const w = world({ row: stored({ reference_paths: three }), within: (body, carried, shown) => {
      if ((carried?.asks ?? 0) >= 12) return { result: { posts: (body.posts as string[]).map(shown) }, ms: 51_000 };
      const search = { of: "same", done: [], at: { size: 0, row: 1, best: { x: 0, y: 0, width: 0, height: 0, score: -2 } } };
      return { unfinished: { posts: [], search }, carried: { search, asks: (carried?.asks ?? 0) + 1 }, ms: 20_000 };
    } });
    const outs = await drive(w.db, c({ harvested_design_references: posts(3) }), before(), 40);
    expect(outs.at(-1)).toMatchObject({ status: "done" });
    const asked = picture(w.seen, "post-logos") as unknown as Asked[];
    // Twelve looks at the first post that settle nothing, each one more counted; the thirteenth asks for that post alone and settles it.
    expect(asked.slice(0, 13).map((x) => x.carried?.asks ?? 0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(asked.slice(0, 12).every((x) => x.body.posts.length === 3)).toBe(true);
    expect(asked[12].body.posts).toEqual(["design-references/c1/social-0.jpg"]);
    // The posts after it start their own count, and the set is settled from all three.
    expect(asked[13].carried).toBeNull();
    expect(w.row().logo_set).toMatchObject({ of: LOGO, posts: { read: 3 } });
  });

  it("fails with the lifecycle's own backoff when the service refuses the call", async () => {
    const refused = new PictureError("The picture service refused the call (400): The request is not well formed: site.", "logo-set", "refused");
    const { db, row: settings } = world({ picture: () => { throw refused; } });
    const outs = await drive(db, c(), before());
    expect(outs).toEqual([{ status: "failed", error: refused.message }]);
    expect(settings().logo_set).toBeNull();
  });

  it("stores no set and finishes when the service cannot use the logo", async () => {
    const unusable = new PictureError("The logo file has no ink.", "logo-set", "unusable");
    const { db, seen, row: settings } = world({ picture: (route) => { if (route === "logo-set") throw unusable; } });
    const outs = await drive(db, c(), before());
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ status: "done", result: { written: true, logo_path: LOGO, tone: { of: LOGO, unusable: "The logo file has no ink." } } });
    expect(settings().logo_set).toBeNull();
    expect(picture(seen, "post-logos")).toEqual([]);
    expect(db.rpcCalls.map((r) => r.name)).toEqual(["lifecycle_write_design_settings"]);
  });

  it("does not settle a set when the logo or the person's file changed while it was being made", async () => {
    // A person puts a second file there after the step read the row.
    const person = { path: "c1/design-settings/logo-other-9.png", of: LOGO, at: T };
    const w = world({ picture: (route) => { if (route === "post-logos") w.db.tables.design_brand_settings[0].logo_set = { person }; } });
    const rows = before();
    const key = await STEPS.design_settings.inputs(w.db, c(), rows);
    const out = await STEPS.design_settings.run(w.db, c(), ctx({ rows })) as Out;
    expect(out).toMatchObject({ status: "waiting", reason: "in_progress", recheckMinutes: 1 });
    expect(w.row().logo_set).toEqual({ person });
    // The next look has another key, and makes the set with the person's file.
    expect(await STEPS.design_settings.inputs(w.db, c(), rows)).not.toBe(key);
  });

  it("keeps what each post gave when the key changes and the searches do not", async () => {
    const { db, seen, row: settings } = world({ shows: { "c1/social-0.jpg": found("other") } });
    const rows = before();
    await drive(db, c(), rows);
    expect(picture(seen, "post-logos")).toHaveLength(1);
    const first = structuredClone(settings().logo_set);
    // The brand colors change: the key changes, the settings are written again, and nothing about the files or the searches moved.
    const recolored = c({ brand_identity: { ...BRAND, secondary_color: "#0c1d2f", accent_color: "#101010" } });
    expect(await STEPS.design_settings.inputs(db, recolored, rows)).not.toBe(rows.get("design_settings")!.inputs_key);
    const outs = await drive(db, recolored, rows);
    expect(outs).toHaveLength(1);
    expect(outs[0].status).toBe("done");
    expect(picture(seen, "logo-set")).toHaveLength(1);
    expect(picture(seen, "post-logos")).toHaveLength(1);
    expect(seen.spot).toBe(0);
    expect(settings().logo_set).toEqual(first);
    expect(db.rpcCalls.filter((r) => r.name === "settle_design_logo_set")).toHaveLength(2);
  });

  it("settles the set with the logo it was made for and the person's file it read", async () => {
    const person = { path: "c1/design-settings/logo-other-9.png", of: LOGO, at: T };
    const { db, seen, row: settings } = world({ row: stored({ logo_set: { person } }), facts: { person: { size: { width: 500, height: 200 } }, inks: { ...FACTS.inks, other: [{ color: [250, 250, 250], share: 1 }] } } });
    const outs = await drive(db, c(), before());
    expect(outs.at(-1)!.status).toBe("done");
    const settle = db.rpcCalls.find((r) => r.name === "settle_design_logo_set")!;
    expect(settle.args).toMatchObject({ p_client: "c1", p_of: LOGO, p_person: person, p_set: { of: LOGO, other: { path: person.path, from: "person", size: [500, 200] } } });
    expect("person" in (settle.args.p_set as object)).toBe(false);
    // The service was sent the person's file, and the posts were searched with it marked as theirs.
    expect((picture(seen, "logo-set")[0] as { body: { person: string } }).body.person).toBe(`generated-media/${person.path}`);
    expect((picture(seen, "post-logos")[0] as { body: { searches: unknown[] } }).body.searches[1]).toEqual({ file: "other", logo: `generated-media/${person.path}`, ground: [11, 14, 26], fixed: true });
    expect(settings().logo_set).toMatchObject({ person, other: { from: "person" } });
    // A file put beside an older main logo is not used.
    const stale = world({ row: stored({ logo_set: { person: { ...person, of: "c1/older.png" } } }) });
    await drive(stale.db, c(), before());
    expect(picture(stale.seen, "logo-set")[0].body).not.toHaveProperty("person");
    expect(stale.row().logo_set.other).toBeNull();
  });

  describe("the logo the client's posts show", () => {
    // The homepage: an icon in its schema.org record (the logo the website read kept), the wordmark as an inline SVG in the header's link
    // to the home page, a second mark of the brand in the header, and a partner's logo in the footer, which is no mark of the brand.
    const MARK = `<svg width="76" height="25" viewBox="0 0 579 194" fill="white" aria-hidden="true"><g><path d="M1 1h5v5z"/></g></svg>`;
    const page = (mark: string) => `<html><head><script type="application/ld+json">{"@type":"Organization","logo":"${LOGO_URL}"}</script></head><body><header><a href="/" aria-label="Brand">${mark}</a><img class="logo" src="/brand-badge.png"></header><footer><a href="https://partner.test/"><img class="logo" src="/partner-logo.png"></a></footer></body></html>`;
    const PAGE = page(MARK);
    const MARK_URL = `https://project.test/storage/v1/object/public/generated-media/c1/brand/logo-site-${textHash(MARK)}.svg`;
    const BADGE_URL = "https://brand.test/brand-badge.png";
    const PARTNER_URL = "https://brand.test/partner-logo.png";
    const WORDMARK = "c1/design-settings/logo-site-wordmark.png";
    const BADGE = "c1/design-settings/logo-site-badge.png";
    const six = posts(6).map((p) => p.path);
    const site = { [MARK_URL]: WORDMARK, [BADGE_URL]: BADGE, [PARTNER_URL]: "c1/design-settings/logo-site-partner.png" };
    const WIDE = { own: "dark", made: { other: { turned: 1 }, white: null } };
    /** A post that shows a logo in the middle near the bottom, 0.12 of the post's width. */
    const low = (shows: "stored" | "other") => ({ ...found(shows), rect: { x: 440, y: 1125, width: 120, height: 40 } });
    /** A post that shows a logo at a score of its own. */
    const scored = (score: number) => ({ ...low("stored"), score });
    const brand = (over: Record<string, unknown> = {}) => c({ website_url: "https://brand.test/", harvested_design_references: posts(6), ...over });
    const wordmarkOn = (n: number) => Object.fromEntries(six.slice(0, n).map((p, i) => [p, low(i % 2 ? "other" : "stored")]));
    const writes = (db: ReturnType<typeof dbWith>) => db.rpcCalls.filter((r) => r.name === "lifecycle_write_design_settings");
    const readsOf = (seen: { calls: Array<{ route: string; body: Record<string, unknown> }> }, logo: string) => seen.calls.filter((x) => x.route === "post-logos" && (x.body.searches as Array<{ logo: string }>)[0].logo === `generated-media/${logo}`).length;

    it("takes the mark the posts carry in place of the website's first logo, with its place from where it was found, and makes its set", async () => {
      const { db, seen, row: settings } = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(5) }, [BADGE]: { facts: WIDE } } });
      const outs = await drive(db, brand(), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done" });
      // The homepage was read directly, once, and no model was asked.
      expect(seen.pages).toEqual(["https://brand.test/"]);
      // Its inline SVG is stored as a file of its own: the drawing as the page has it, with the namespace a file needs.
      expect(new TextDecoder().decode(db.uploads.get(`generated-media/c1/brand/logo-site-${textHash(MARK)}.svg`) as Uint8Array)).toBe(MARK.replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg"`));
      expect(seen.spot).toBe(0);
      expect(seen.key).toBe(0);
      // The wordmark is the logo now, placed where the posts carry it, on a background from the brand colors for its ink.
      expect(settings()).toMatchObject({ source: "lifecycle", logo_path: WORDMARK, placement: { anchor: "center", width: 0.12, top: 0.9 }, reference_paths: six });
      expect(settings().derived).toMatchObject({
        logo_from: MARK_URL, placement_from: "logo_on_posts", logo_read: SPOT,
        // The choice keeps the file as the conversion gave it, so a later look writes it again without fetching anything.
        logo_pick: { rule: 1, for: LOGO_URL, from: MARK_URL, logo: { path: WORDMARK, width: 600, height: 200, ink: null, converted: "kept" }, placement: { anchor: "center", width: 0.12, top: 0.9 }, found: 5, posts: 6, over: { path: LOGO, found: 0 } },
      });
      // Its set follows by itself: made for the new logo, searched at the new place.
      expect(settings().logo_set).toMatchObject({ of: WORDMARK, rule: 2, posts: { read: 6, found: 5 } });
      expect(outs.at(-1)!.result).toMatchObject({ logo_path: WORDMARK, tone: { of: WORDMARK, settled: T }, pick: { of: WORDMARK, chosen: null } });
      const last = picture(seen, "post-logos").at(-1) as { body: { placement: unknown; searches: Array<{ logo: string }> } };
      expect(last.body.searches[0].logo).toBe(`generated-media/${WORDMARK}`);
      // Each candidate was searched where the model's stored read says the posts carry the logo, for its own shape.
      const searched = picture(seen, "post-logos").map((x) => (x as { body: { placement: unknown; searches: Array<{ logo: string }> } }).body).find((b) => b.searches[0].logo === `generated-media/${BADGE}`)!;
      expect(searched.placement).toEqual(PLACEMENT);
      // The sizes of the posts it was found on were read from their headers, once.
      expect(seen.sizes.sort()).toEqual(six.slice(0, 5));
      // The logo that was replaced is a candidate from now on, and what its set's work read of the posts is kept as its work: it is not read again.
      const read = (logo: string) => picture(seen, "post-logos").filter((x) => (x as unknown as { body: { searches: Array<{ logo: string }> } }).body.searches[0].logo === `generated-media/${logo}`).length;
      expect([read(LOGO), read(BADGE), read(WORDMARK)]).toEqual([2, 2, 4]);
      expect(outs.at(-1)!.result!.pick.counts).toEqual({ [WORDMARK]: 5, [LOGO]: 0, [BADGE]: 0 });
      // The partner's logo in the footer is no mark of the brand: it was never fetched, converted or looked for.
      expect(seen.logoPng).not.toContain(PARTNER_URL);
      expect(outs.find((o) => o.result?.pick?.listed)!.result!.pick.listed).toEqual({ site: "brand.test", files: [MARK_URL, BADGE_URL, LOGO_URL] });
      // The website's first logo is written once, then the choice; from then on only the choice.
      expect(writes(db).map((w) => w.args.p_logo_path)).toEqual([LOGO, WORDMARK, WORDMARK]);
    });

    it("keeps the logo the client has when its posts carry it, or when one post alone shows another mark", async () => {
      // The client's own logo on two posts, the wordmark on two others: a logo the posts carry is never replaced.
      const tie = world({ row: stored({ reference_paths: six }), page: PAGE, site, shows: { [six[4]]: found("stored"), [six[5]]: found("stored") }, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(2) }, [BADGE]: { facts: WIDE } } });
      const outs = await drive(tie.db, brand(), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: LOGO, pick: { of: LOGO, chosen: null, counts: { [LOGO]: 2, [WORDMARK]: 2, [BADGE]: 0 } } } });
      expect(tie.row()).toMatchObject({ logo_path: LOGO, placement: PLACEMENT });
      expect(tie.row().derived.logo_pick).toBeUndefined();
      expect(writes(tie.db)).toHaveLength(1);
      // One post alone is not what the client's posts carry.
      const one = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(1) }, [BADGE]: { facts: WIDE } } });
      await drive(one.db, brand(), before(), 30);
      expect(one.row().logo_path).toBe(LOGO);
      expect(one.seen.sizes).toEqual([]);
    });

    it("never replaces a logo the posts carry, however many more posts carry another mark of the brand", async () => {
      // The client's own logo on two posts, the wordmark on the four others.
      const { db, row: settings } = world({ row: stored({ reference_paths: six }), page: PAGE, site, shows: { [six[4]]: found("stored"), [six[5]]: found("stored") }, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(4) }, [BADGE]: { facts: WIDE } } });
      const outs = await drive(db, brand(), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: LOGO, pick: { of: LOGO, chosen: null, counts: { [LOGO]: 2, [WORDMARK]: 4, [BADGE]: 0 } } } });
      expect(settings()).toMatchObject({ logo_path: LOGO, placement: PLACEMENT });
      expect(settings().derived.logo_pick).toBeUndefined();
      expect(writes(db)).toHaveLength(1);
    });

    it("counts a post for a candidate only where it is found and scores higher than the client's logo: a sister lockup found at a lower score gets nothing for it", async () => {
      // The client's logo on two posts at 0.97. The candidate is "found" on the same two at 0.77 and 0.79 (its rectangle covers a part of
      // the mark those posts carry), and on one post of its own. Found on three posts against two, it counts for one.
      const { db, row: settings } = world({
        row: stored({ reference_paths: six }), page: PAGE, site, shows: { [six[4]]: { ...found("stored"), score: 0.973 }, [six[5]]: { ...found("stored"), score: 0.969 } },
        byLogo: { [WORDMARK]: { facts: WIDE, shows: { [six[0]]: scored(0.8), [six[4]]: scored(0.766), [six[5]]: scored(0.792) } }, [BADGE]: { facts: WIDE } },
      });
      const outs = await drive(db, brand(), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: LOGO, pick: { chosen: null, counts: { [LOGO]: 2, [WORDMARK]: 1, [BADGE]: 0 } } } });
      expect(settings().logo_path).toBe(LOGO);
      expect(writes(db)).toHaveLength(1);
    });

    it("keeps a logo found on two posts, however much better another mark matches those posts", async () => {
      // The client's logo is found on two posts at 0.78 and 0.76. The wordmark is found on the same two at 0.95 and 0.96 and on a third.
      // The logo passes the one test of a design on two posts, so the posts carry it and it stays: the rule never trades one mark a brand uses for another.
      const { db, row: settings } = world({
        row: stored({ reference_paths: six }), page: PAGE, site, shows: { [six[0]]: { ...found("stored"), score: 0.78 }, [six[1]]: { ...found("stored"), score: 0.76 } },
        byLogo: { [WORDMARK]: { facts: WIDE, shows: { [six[0]]: scored(0.95), [six[1]]: scored(0.96), [six[2]]: scored(0.9) } }, [BADGE]: { facts: WIDE } },
      });
      const outs = await drive(db, brand(), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: LOGO, pick: { of: LOGO, chosen: null, counts: { [LOGO]: 2, [WORDMARK]: 3, [BADGE]: 0 } } } });
      expect(settings()).toMatchObject({ logo_path: LOGO, placement: PLACEMENT });
      expect(settings().derived.logo_pick).toBeUndefined();
      expect(writes(db)).toHaveLength(1);
    });

    it("keeps a logo its posts carry when a second file of the same logo scores a hair higher on every one of them", async () => {
      // The site serves the same wordmark twice (one file for light pages, one for dark). Both are found on the same three posts,
      // and the second file is ahead by a hair on each. Which file scores higher there depends on how each was drawn, so a score takes no post from the logo.
      const three = { [six[0]]: { ...found("stored"), score: 0.906901 }, [six[1]]: { ...found("stored"), score: 0.943629 }, [six[2]]: { ...found("stored"), score: 0.899957 } };
      const twin = { [six[0]]: scored(0.92), [six[1]]: scored(0.966), [six[2]]: scored(0.927) };
      const { db, seen, row: settings } = world({ row: stored({ reference_paths: six }), page: PAGE, site, shows: three, byLogo: { [WORDMARK]: { facts: WIDE, shows: twin }, [BADGE]: { facts: WIDE } } });
      const outs = await drive(db, brand(), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: LOGO, pick: { of: LOGO, chosen: null, counts: { [LOGO]: 3, [WORDMARK]: 3, [BADGE]: 0 } } } });
      // Nothing of a client that works is rewritten: the logo, its place, its background and its set stay as they were made.
      expect(settings()).toMatchObject({ logo_path: LOGO, placement: PLACEMENT, logo_set: { of: LOGO } });
      expect(settings().derived.logo_pick).toBeUndefined();
      expect(writes(db)).toHaveLength(1);
      expect(seen.sizes).toEqual([]);
    });

    it("gives a candidate nothing for a post where the client's logo scores higher at a size the test does not accept", async () => {
      // The client's logo matches two posts at 0.887 and 0.88 with the match at an end of the sizes searched, so it is not found there (the size half of the test).
      // The wordmark is found on the same two at 0.80 and 0.79: its rectangle covers a part of the logo those posts carry. It counts neither, and the client keeps its logo.
      const { db, row: settings } = world({
        row: stored({ reference_paths: six }), page: PAGE, site, shows: { [six[0]]: { found: false, score: 0.887 }, [six[1]]: { found: false, score: 0.88 } },
        byLogo: { [WORDMARK]: { facts: WIDE, shows: { [six[0]]: scored(0.8), [six[1]]: scored(0.79) } }, [BADGE]: { facts: WIDE } },
      });
      const outs = await drive(db, brand(), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: LOGO, pick: { of: LOGO, chosen: null, counts: { [LOGO]: 0, [WORDMARK]: 0, [BADGE]: 0 } } } });
      expect(settings().logo_path).toBe(LOGO);
      expect(settings().derived.logo_pick).toBeUndefined();
      expect(writes(db)).toHaveLength(1);
    });

    it("places a chosen logo from the posts that count for it, and picks its background against its whole parts", async () => {
      // The wordmark as the conversion gives it since the ground rule: its parts and the ground it was made for.
      const parts = { ink: [200, 205, 215] as [number, number, number], inks: [[255, 255, 255], [60, 100, 160]] as Array<[number, number, number]>, own: "dark" as const };
      const w = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(5) }, [BADGE]: { facts: WIDE, shows: { [six[0]]: { ...scored(0.99), rect: { x: 10, y: 10, width: 300, height: 100 } } } } } });
      const imaging = await deps.imaging();
      const logoPng = imaging.logoPng;
      deps.imaging = (async () => ({ ...imaging, logoPng: async (db: unknown, id: string, url: string) => (url === MARK_URL ? { path: WORDMARK, width: 600, height: 200, ...parts, converted: "from_svg" as const } : logoPng(db as never, id, url)) })) as never;
      await drive(w.db, brand(), before(), 30);
      // The first post matches the badge better, so it is the badge's: the wordmark counts for four, and its place is measured on those four.
      expect(w.row().derived.logo_pick).toMatchObject({ found: 4, logo: { path: WORDMARK, ...parts } });
      expect(w.seen.sizes.sort()).toEqual(six.slice(1, 5));
      // The dim part has under 3:1 on every brand color, so the background is the neutral of the file's own ground, as for any lifecycle row.
      expect(w.row()).toMatchObject({ logo_path: WORDMARK, background: "#0B0E1A" });
      expect(w.row().derived.background_from).toBe("neutral");
    });

    it("leaves out a mark the page would color: an inline SVG with no paint of its own is no candidate", async () => {
      const PAINTED = MARK.replace(` fill="white"`, ` fill="currentColor"`);
      const { db, seen, row: settings } = world({ row: stored({ reference_paths: six }), page: page(PAINTED), site: { [BADGE_URL]: BADGE }, byLogo: { [BADGE]: { facts: WIDE } } });
      const outs = await drive(db, brand(), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: LOGO, pick: { candidates: 1, chosen: null } } });
      // It was never stored, converted or looked for.
      expect([...db.uploads.keys()].filter((k) => k.includes("/brand/logo-site-"))).toEqual([]);
      expect(seen.logoPng).toEqual([LOGO_URL, BADGE_URL]);
      expect(settings().logo_path).toBe(LOGO);
    });

    it("measures a standing logo's place again when the client's posts are learned again and carry it somewhere else", async () => {
      const shows: Record<string, unknown> = wordmarkOn(5);
      const { db, seen, row: settings } = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo: { [WORDMARK]: { facts: WIDE, shows }, [BADGE]: { facts: WIDE } } });
      const rows = before();
      await drive(db, brand(), rows, 30);
      expect(settings()).toMatchObject({ logo_path: WORDMARK, placement: { anchor: "center", width: 0.12, top: 0.9 } });
      // New posts: the brand now carries the wordmark at the top left, wider.
      const next = Array.from({ length: 6 }, (_, i) => ({ path: `c1/social-${10 + i}.jpg` }));
      for (const p of next.slice(0, 4)) shows[p.path] = { ...found("stored"), rect: { x: 50, y: 60, width: 200, height: 66 } };
      rows.set("design_refs", row("design_refs", { result: { synthesized_at: "2026-10-26T10:00:00.000Z" } }));
      const sized = seen.sizes.length;
      const outs = await drive(db, brand({ harvested_design_references: next }), rows, 40);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: WORDMARK, placement: { anchor: "left", width: 0.2, top: 0.048, left: 0.05 }, placement_from: "logo_on_posts", pick: { of: WORDMARK, chosen: null } } });
      // The same logo, at the place its posts carry it now, with the choice's record following.
      expect(settings()).toMatchObject({ logo_path: WORDMARK, placement: { anchor: "left", width: 0.2, top: 0.048, left: 0.05 }, reference_paths: next.map((p) => p.path) });
      expect(settings().derived.logo_pick).toMatchObject({ logo: { path: WORDMARK }, placement: { anchor: "left", width: 0.2, top: 0.048, left: 0.05 }, found: 4, posts: 6 });
      // Its set was made again at the new place, and the posts' sizes were read once for the new measure.
      expect(settings().logo_set).toMatchObject({ of: WORDMARK, posts: { read: 6, found: 4 } });
      expect((picture(seen, "post-logos").at(-1) as unknown as { body: { placement: unknown } }).body.placement).toEqual({ anchor: "left", width: 0.2, top: 0.048, left: 0.05 });
      expect(seen.sizes.slice(sized).sort()).toEqual(next.slice(0, 4).map((p) => p.path));
      // A later look on the same posts measures nothing again and writes nothing.
      const wrote = writes(db).length;
      const again = await STEPS.design_settings.run(db, brand({ harvested_design_references: next }), { force: false, previous: rows.get("design_settings")!, rows }) as Out;
      expect(again.status).toBe("done");
      expect(writes(db)).toHaveLength(wrote);
      expect(seen.sizes.slice(sized)).toHaveLength(4);
    });

    it("tries a homepage it could not read again, three times in all, before it settles for no candidate", async () => {
      const opts = { row: stored({ reference_paths: six }), page: null as string | null, site, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(5) }, [BADGE]: { facts: WIDE } } };
      const { db, seen, row: settings } = world(opts);
      const rows = before();
      const first = await drive(db, brand(), rows, 30);
      // The set is settled and designs run; only the look for another mark waits, quietly, for the site.
      expect(first.at(-1)).toMatchObject({ status: "waiting", reason: "website", recheckMinutes: 30, result: { logo_path: LOGO, tone: { settled: T }, pick: { open: true, listed: { files: [], unread: 1 } } } });
      expect((await drive(db, brand(), rows, 30)).at(-1)).toMatchObject({ status: "waiting", reason: "website", result: { pick: { listed: { unread: 2 } } } });
      // The third read answers: the candidates are looked for as if the first had.
      opts.page = PAGE;
      const outs = await drive(db, brand(), rows, 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: WORDMARK } });
      expect(seen.pages).toHaveLength(3);
      expect(settings().logo_path).toBe(WORDMARK);

      // A site that never answers: three reads, then the client keeps its logo and the step is done.
      const down = world({ row: stored({ reference_paths: six }), page: null });
      const downRows = before();
      const ends: Out[] = [];
      for (let i = 0; i < 5; i++) ends.push((await drive(down.db, brand(), downRows, 30)).at(-1)!);
      expect(ends.map((o) => o.status)).toEqual(["waiting", "waiting", "done", "done", "done"]);
      expect(ends[2]).toMatchObject({ result: { logo_path: LOGO, pick: { candidates: 0, listed: { files: [], unread: 3 } } } });
      expect(down.seen.pages).toHaveLength(3);
    });

    it("reads one candidate's posts to a run, four posts to a call, and keeps what it read between runs", async () => {
      const { db, seen } = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo: { [WORDMARK]: { facts: WIDE }, [BADGE]: { facts: WIDE } } });
      const outs = await drive(db, brand(), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done" });
      expect(outs.slice(0, -1).every((o) => o.status === "waiting" && o.reason === "in_progress" && o.recheckMinutes === 1)).toBe(true);
      // The client's own logo: one logo-set and two reads of posts. Each candidate the same. Nothing twice.
      const by = (route: string, logo: string) => seen.calls.filter((x) => x.route === route && String(route === "logo-set" ? x.body.logo : (x.body.searches as Array<{ logo: string }>)[0].logo) === `generated-media/${logo}`).length;
      expect([by("logo-set", LOGO), by("post-logos", LOGO)]).toEqual([1, 2]);
      expect([by("logo-set", WORDMARK), by("post-logos", WORDMARK)]).toEqual([1, 2]);
      expect([by("logo-set", BADGE), by("post-logos", BADGE)]).toEqual([1, 2]);
      // Every wait carries the settings and the set's work, so nothing a screen reads goes missing.
      expect(outs.at(-2)!.result).toMatchObject({ written: true, logo_path: LOGO, tone: { of: LOGO, settled: T } });
    });

    it("chooses the same logo from a service that reads a post and a half in its time: a post it did not reach is never taken for one with no logo", async () => {
      const byLogo = { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(5) }, [BADGE]: { facts: WIDE } };
      const fast = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo });
      await drive(fast.db, brand(), before(), 30);
      const chosen = fast.row();

      const service = slowService();
      const slow = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo, within: service.within });
      const outs = await drive(slow.db, brand(), before(), 80);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: WORDMARK, pick: { of: WORDMARK, chosen: null } } });
      // The wordmark on five of six posts, as one read of them all finds it, and the same row written.
      expect(slow.row()).toEqual(chosen);
      expect(slow.row().derived).toMatchObject({ logo_pick: { found: 5, posts: 6 } });
      // More reads than a fast service needs, every one of them the step's own short wait, and nothing of a read left in the result.
      expect(readsOf(slow.seen, WORDMARK)).toBeGreaterThan(readsOf(fast.seen, WORDMARK));
      expect(outs.slice(0, -1).every((o) => o.status === "waiting" && o.reason === "in_progress")).toBe(true);
      for (const unit of Object.values((outs.at(-1)!.result!.pick as { units: Record<string, object> }).units)) expect(unit).not.toHaveProperty("reading");
    });

    it("holds one read of posts to a look, and converts no candidate in the look that made the set's last calls", async () => {
      const { db, seen } = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(5) }, [BADGE]: { facts: WIDE } } });
      const rows = before();
      const looks: Array<{ sets: number; reads: number; converted: number; settled: boolean }> = [];
      for (let i = 0; i < 40; i++) {
        const key = await STEPS.design_settings.inputs(db, brand(), rows);
        const prev = rows.get("design_settings") ?? null;
        const at = { calls: seen.calls.length, png: seen.logoPng.length };
        const out = await STEPS.design_settings.run(db, brand(), { force: false, previous: prev && prev.inputs_key === key ? prev : null, rows }) as Out;
        const calls = seen.calls.slice(at.calls);
        looks.push({
          sets: calls.filter((x) => x.route === "logo-set").length, reads: calls.filter((x) => x.route === "post-logos").length,
          converted: seen.logoPng.slice(at.png).filter((u) => u !== LOGO_URL).length, settled: !!out.result?.tone?.settled && !prev?.result?.tone?.settled,
        });
        rows.set("design_settings", rowAfter(prev, { client_id: "c1", step: "design_settings", inputs_key: key! }, out as never, new Date(T)));
        if (out.status !== "waiting") break;
      }
      expect(rows.get("design_settings")!.status).toBe("done");
      expect(looks.every((l) => l.sets <= 1 && l.reads <= 1 && l.converted <= 1)).toBe(true);
      // The looks in which a set was settled (the first logo's, then the chosen one's) converted no candidate and asked nothing about one.
      const settling = looks.filter((l) => l.settled);
      expect(settling.length).toBe(2);
      expect(settling.every((l) => l.converted === 0)).toBe(true);
    });

    it("after the step's inputs change, lists the page again, tries a file it could not fetch again, and reads no post twice for a file it kept", async () => {
      const lost = { [MARK_URL]: WORDMARK } as Record<string, string | null>;
      const { db, seen, row: settings } = world({ row: stored({ reference_paths: six }), page: PAGE, site: lost, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(1) }, [BADGE]: { facts: WIDE } } });
      const rows = before();
      expect((await drive(db, brand(), rows, 30)).at(-1)).toMatchObject({ status: "done", result: { pick: { candidates: 1, chosen: null } } });
      // The badge's file could not be fetched: it was tried once and left out.
      expect(seen.logoPng.filter((u) => u === BADGE_URL)).toHaveLength(1);
      const reads = () => picture(seen, "post-logos").filter((x) => (x as unknown as { body: { searches: Array<{ logo: string }> } }).body.searches[0].logo === `generated-media/${WORDMARK}`).length;
      expect(reads()).toBe(2);
      // The posts were learned again (the same six), and the file can be fetched now.
      lost[BADGE_URL] = BADGE;
      rows.set("design_refs", row("design_refs", { result: { synthesized_at: "2026-10-26T10:00:00.000Z" } }));
      const outs = await drive(db, brand(), rows, 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { pick: { candidates: 2, chosen: null } } });
      expect(seen.pages).toEqual(["https://brand.test/", "https://brand.test/"]);
      expect(seen.logoPng.filter((u) => u === BADGE_URL)).toHaveLength(2);
      expect(seen.logoPng.filter((u) => u === MARK_URL)).toHaveLength(1);
      // The wordmark's posts were read under the old inputs: none of them is read again.
      expect(reads()).toBe(2);
      expect(settings().logo_path).toBe(LOGO);
    });

    it("never fails the step for a candidate: one the service turns away or cannot use is no candidate", async () => {
      for (const why of ["refused", "unusable"] as const) {
        const { db, row: settings } = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo: { [WORDMARK]: { fail: new PictureError("The picture service turned the call away.", "logo-set", why) }, [BADGE]: { facts: WIDE } } });
        const outs = await drive(db, brand(), before(), 30);
        expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: LOGO, tone: { of: LOGO, settled: T }, pick: { chosen: null } } });
        expect(outs.some((o) => o.status === "failed")).toBe(false);
        expect(settings().logo_path).toBe(LOGO);
      }
      // A service that is unavailable is a quiet wait, and the set stays settled.
      const down = world({ row: stored({ reference_paths: six }), page: PAGE, site, byLogo: { [WORDMARK]: { fail: new PictureError("The picture service did not answer.", "post-logos", "unavailable") } } });
      const waits = await drive(down.db, brand(), before(), 30);
      expect(waits.at(-1)).toMatchObject({ status: "waiting", reason: "picture_service", recheckMinutes: 10, result: { logo_path: LOGO, tone: { settled: T }, pick: { open: true } } });
      expect(waits.at(-1)!.result!.pick).not.toHaveProperty("batch");
    });

    it("looks for no candidate for a logo a person gave or a page on another client's site", async () => {
      const given = world({ row: stored({ reference_paths: six }), page: PAGE, site });
      const outs = await drive(given.db, brand({ field_sources: person("logo_url") }), before(), 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { pick: { kept: "person_logo" } } });
      expect(given.seen.pages).toEqual([]);
      expect(given.seen.logoPng).toEqual([LOGO_URL]);

      const parent = { id: "c9", name: "Parent", website_url: "https://brand.test/", archived_at: null, demo_job_id: null };
      const child = world({ row: stored({ reference_paths: six }), page: PAGE, site });
      child.db.tables.clients.push(parent);
      const kid = brand({ website_url: "https://brand.test/services/one/" });
      const rows = before();
      rows.set("brand_read", row("brand_read", { result: { parent_page: true, logo_files: [] } }));
      expect((await drive(child.db, kid, rows, 30)).at(-1)).toMatchObject({ status: "done", result: { pick: { kept: "not_own_site" } } });
      expect(child.seen.pages).toEqual([]);

    });

    it("uses the website read's own list when it was made by this listing, and reads no page", async () => {
      const { db, seen, row: settings } = world({ row: stored({ reference_paths: six }), site, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(3) } }, facts: { site: null } });
      const rows = before();
      rows.set("brand_read", row("brand_read", { result: { logo_marks: 1, logo_files: [MARK_URL, PARTNER_URL], logo_own: [MARK_URL] } }));
      const outs = await drive(db, brand(), rows, 30);
      expect(outs.at(-1)).toMatchObject({ status: "done" });
      expect(seen.pages).toEqual([]);
      expect(settings().logo_path).toBe(WORDMARK);
    });

    it("lets a choice stand: a later look writes the chosen logo again, and the website's first logo is then a candidate like any other", async () => {
      const NEW_URL = "https://brand.test/new-logo.svg";
      const { db, seen, row: settings } = world({ row: stored({ reference_paths: six }), page: PAGE, site: { ...site, [NEW_URL]: "c1/design-settings/logo-site-new.png" }, byLogo: { [WORDMARK]: { facts: WIDE, shows: wordmarkOn(5) }, [BADGE]: { facts: WIDE } } });
      const rows = before();
      await drive(db, brand(), rows, 30);
      expect(settings().logo_path).toBe(WORDMARK);
      const picked = structuredClone(settings());
      // The posts were learned again: a new key. The row never goes back to the website's first logo on the way.
      const wrote = writes(db).length;
      rows.set("design_refs", row("design_refs", { result: { synthesized_at: "2026-10-26T10:00:00.000Z" } }));
      const outs = await drive(db, brand(), rows, 30);
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: WORDMARK, pick: { of: WORDMARK, chosen: null } } });
      expect(writes(db).slice(wrote).map((w) => w.args.p_logo_path)).toEqual([WORDMARK]);
      expect(settings()).toMatchObject({ logo_path: WORDMARK, placement: picked.placement, background: picked.background });
      expect(settings().derived.logo_pick).toMatchObject({ logo: { path: WORDMARK }, for: LOGO_URL });
      // The website's first logo was looked for on the posts as a candidate, by the same test.
      expect(outs.at(-1)!.result!.pick.counts).toMatchObject({ [WORDMARK]: 5, [LOGO]: 0 });
      // The model's read of the posts is asked again because the posts changed, as before this rule, and never for the choice.
      expect(seen.spot).toBe(1);

      // The website now gives another first logo: the choice was made against the old one, so the new one is written and the choice is made again.
      const after = writes(db).length;
      await STEPS.design_settings.run(db, brand({ logo_url: NEW_URL }), { force: false, previous: null, rows });
      expect(writes(db)[after].args.p_logo_path).toBe("c1/design-settings/logo-site-new.png");
      expect(writes(db)[after].args.p_derived.logo_pick).toBeUndefined();
    });

    it("counts a standing logo on the posts its set finds it on too, so a logo its set shows on two posts or more is never replaced", async () => {
      // What the service answers for the wordmark depends on where it is searched: `spot` where the model's read says the posts carry the logo
      // (the search every candidate gets), `shows` at the place measured from its posts (its set's read, where a design is searched).
      const shows: Record<string, unknown> = wordmarkOn(5);
      let spot: Record<string, unknown> = shows;
      const icon: Record<string, unknown> = {};
      const { db, row: settings } = world({ row: stored({ reference_paths: six }), page: PAGE, site, shows: icon, byLogo: { [WORDMARK]: { facts: WIDE, shows }, [BADGE]: { facts: WIDE } } });
      const io = deps.picture;
      deps.picture = ((d: unknown) => {
        const real = (io as (d: unknown) => { within: (route: string, body: Record<string, unknown>, carried: unknown) => Promise<{ result: Record<string, unknown>; ms: number }> })(d);
        return { ...real, within: async (route: string, body: Record<string, unknown>, carried: unknown) => {
          const got = await real.within(route, body, carried);
          const at = body.placement as { anchor: string; width: number; top: number } | undefined;
          const atSpot = route === "post-logos" && (body.searches as Array<{ logo: string }>)[0].logo === `generated-media/${WORDMARK}` && at?.anchor === PLACEMENT.anchor && at.width === PLACEMENT.width && at.top === PLACEMENT.top;
          return atSpot ? { ...got, result: { posts: (body.posts as string[]).map((link) => spot[link.replace("design-references/", "")] ?? MISSED) } } : got;
        } };
      }) as never;
      const rows = before();
      await drive(db, brand(), rows, 30);
      expect(settings()).toMatchObject({ logo_path: WORDMARK, placement: { anchor: "center", width: 0.12, top: 0.9 } });
      // New posts. The wordmark's own search at the model's spot finds it on one of them; its set, read where the posts carry it, on four.
      // The website's first logo is found on the two others.
      const next = Array.from({ length: 6 }, (_, i) => ({ path: `c1/social-${10 + i}.jpg` }));
      for (const p of next.slice(0, 4)) shows[p.path] = low("stored");
      spot = { [next[0].path]: low("stored") };
      for (const p of next.slice(4)) icon[p.path] = low("stored");
      rows.set("design_refs", row("design_refs", { result: { synthesized_at: "2026-10-26T10:00:00.000Z" } }));
      const wrote = writes(db).length;
      const outs = await drive(db, brand({ harvested_design_references: next }), rows, 40);
      // Found on one post by its own search and on four by its set: the posts carry it, whatever the first logo is found on.
      expect(outs.at(-1)).toMatchObject({ status: "done", result: { logo_path: WORDMARK, pick: { of: WORDMARK, chosen: null, counts: { [WORDMARK]: 4, [LOGO]: 2, [BADGE]: 0 } } } });
      // The logo, its place and its set stay; the one write is the standing choice written again for the new posts.
      expect(settings()).toMatchObject({ logo_path: WORDMARK, placement: { anchor: "center", width: 0.12, top: 0.9 }, logo_set: { of: WORDMARK, posts: { read: 6, found: 4 } } });
      expect(settings().derived.logo_pick).toMatchObject({ logo: { path: WORDMARK }, for: LOGO_URL });
      expect(writes(db).slice(wrote).map((x) => x.args.p_logo_path)).toEqual([WORDMARK]);
    });
  });

  describe("design_settings for a row a person set", () => {
    it("gives a person's row its key before it looks for a website logo", async () => {
      const { db } = world({ row: theirs() });
      // No learned references yet, no website logo, no library: a lifecycle row would wait; a person's row has what it needs.
      const bare = client({ logo_url: null, harvested_design_references: [], design_references: null });
      expect(await STEPS.design_settings.inputs(db, bare, new Map())).toBe("person|logo:c1/their-logo.png|refs:|at:left,0.3,0.05,0.05|site:|other:|tone:2");
      expect(await STEPS.design_settings.inputs(db, bare, refs)).toBe(`person|logo:c1/their-logo.png|refs:${T}|at:left,0.3,0.05,0.05|site:|other:|tone:2`);
    });

    it("makes the set for a person's row and leaves the logo, placement, background and date exactly as they are", async () => {
      const { db, seen, row: settings } = world({ row: theirs(), shows: { "c1/new-0.jpg": found("other"), "c1/new-1.jpg": found("other"), "c1/new-2.jpg": found("white") } });
      const untouched = structuredClone(settings());
      const outs = await drive(db, c(), rowsOf(row("design_refs", { result: { synthesized_at: T } })));
      expect(outs).toHaveLength(1);
      expect(outs[0]).toMatchObject({ status: "done", result: { kept: "person" } });
      // No settings are written, no model is asked, and their own logo is never fetched again or converted.
      expect(db.rpcCalls.map((r) => r.name)).toEqual(["settle_design_logo_set"]);
      expect(seen.key).toBe(0);
      expect(seen.spot).toBe(0);
      expect(seen.logoPng).toEqual([]);
      // Their posts are searched with their logo, at their placement.
      expect(picture(seen, "logo-set")[0].body).toMatchObject({ logo: "generated-media/c1/their-logo.png" });
      expect(picture(seen, "post-logos")[0].body).toMatchObject({ posts: ["design-references/c1/new-0.jpg", "design-references/c1/new-1.jpg", "design-references/c1/new-2.jpg"], placement: theirs().placement });
      // The canvas stays their file on their background, whatever their posts show; the files their posts show are in the set.
      const settle = db.rpcCalls[0];
      expect(settle.args).toMatchObject({ p_client: "c1", p_of: "c1/their-logo.png", p_person: null, p_set: { canvas: { file: "stored", ground: "#0C1D2F", from: "settings" }, other: { from: "made" }, white: { path: MADE.white } } });
      const { logo_set, ...after } = settings();
      const { logo_set: _none, ...beforeRow } = untouched;
      expect(after).toEqual(beforeRow);
      expect(logo_set.posts).toEqual({ read: 3, found: 3, shown: { stored: 0, other: 2, white: 1 } });
    });

    it("waits quietly for the picture service and changes nothing of theirs", async () => {
      const down = new PictureError("The picture service did not answer: 503.", "logo-set", "unavailable");
      const { db, row: settings } = world({ row: theirs(), picture: () => { throw down; } });
      const untouched = structuredClone(settings());
      const outs = await drive(db, c(), rowsOf(row("design_refs", { result: { synthesized_at: T } })));
      expect(outs).toEqual([{ status: "waiting", reason: "picture_service", recheckMinutes: 10, result: { kept: "person", tone: expect.objectContaining({ of: "c1/their-logo.png" }) } }]);
      expect(settings()).toEqual(untouched);
      expect(db.rpcCalls).toEqual([]);
    });
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

  // Lital, 8 Nov 2026: a strategy follows the client's competitors. Moburst
  // swapped SplitMetrics for Thrive on 2 Nov; the strategy keyed on nothing
  // about the set, so it would have kept the old one for 30 days.
  it("keys on the current set's competitors, so a swap rewrites the strategy and the same companies again do not", async () => {
    deps.trendIO = trendIO;
    const db = dbWith({
      ...tables(),
      competitor_sets: [{ id: "s1", client_id: "c1", status: "complete", confirmed_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z" }],
      competitors: [
        { id: "k1", set_id: "s1", name: "TeamSnap", is_selected: true },
        { id: "k2", set_id: "s1", name: "BenchApp", is_selected: true },
        { id: "k3", set_id: "s1", name: "Spond", is_selected: false },
      ],
    });
    const rows = await current(db);
    const key = (await STEPS.content_strategy.inputs(db, c(), rows))!;
    expect(key).toMatch(/\|public:[^|]+\|set:benchapp,teamsnap$/);
    // The same companies in a new set, named a little differently: no rewrite.
    db.tables.competitor_sets.push({ id: "s2", client_id: "c1", status: "confirmed", confirmed_at: "2026-11-01T00:00:00Z", created_at: "2026-11-01T00:00:00Z" });
    db.tables.competitors.push({ id: "k4", set_id: "s2", name: "Teamsnap, Inc.", is_selected: true }, { id: "k5", set_id: "s2", name: "BenchApp", is_selected: true });
    expect(await STEPS.content_strategy.inputs(db, c(), rows)).toBe(key);
    // A competitor swapped: a new strategy.
    db.tables.competitors.find((r) => r.id === "k4")!.is_selected = false;
    db.tables.competitors.push({ id: "k6", set_id: "s2", name: "Spond", is_selected: true });
    expect(await STEPS.content_strategy.inputs(db, c(), rows)).toMatch(/\|set:benchapp,spond$/);
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
  const post = (guid: string, day: string, text = "") => {
    const [network, profile] = NETWORKS[guid.split(":")[0]];
    return { guid, perma_link: `https://social.example/${guid}`, customer_profile_id: String(profile), network, created_time: `${day}T15:00:00Z`, content_category: "PHOTO", visual_media: [{ media_type: "PHOTO", media_url: media(guid) }], text };
  };
  const pathOf = (guid: string) => `c1/social-${createHash("sha256").update(media(guid)).digest("hex")}.jpg`;
  const rulebook = (platforms: string[], look: Record<string, unknown> = { changed: false, since: null, what: "" }) => JSON.stringify({
    composition_patterns: "Centered headline over a full-bleed photo.", typography_treatment: "Bold sans, all caps.", imagery_style: "Bright studio product shots.",
    color_usage: "Navy ground, coral accent.", surface_and_texture: "Flat.", logo_and_marks_treatment: "Wordmark bottom center, small.", mood_and_voice_visual: "Confident.",
    anti_patterns: "Never use gradients.", platforms: Object.fromEntries(platforms.map((p) => [p, `${p} posts set the headline larger.`])), look_change: look,
  });
  type Asked = { imageUrl: string; platform: string; postedAt: string; caption: string };
  type Calls = { read: number; windows: number[]; image: number; review: number; asked: Asked[]; learn: number; learned: Array<{ content: Array<{ type: string; text?: string }> }> };
  const EVERYDAY = { usable: true, confidence: 0.95, reason: "Branded type over a color block", kind: "everyday", occasion: null, evidence: "" };
  const HOLIDAY = { usable: true, confidence: 0.95, reason: "Branded type over a pumpkin pattern", kind: "occasion", occasion: "holiday", evidence: "Happy Halloween" };
  /** Sprout, the images and the models. The read answers as Sprout does: the posts published inside the window asked for. */
  function fakeIO(posts: () => Record<string, unknown>[], over: Record<string, unknown> = {}): Calls {
    const calls: Calls = { read: 0, windows: [], image: 0, review: 0, asked: [], learn: 0, learned: [] };
    deps.refsIO = (() => ({
      now: () => new Date(NOW), apiKey: async () => "key",
      readPosts: async (a: { since: Date; until: Date }) => {
        calls.read++;
        calls.windows.push(Math.round((a.until.getTime() - a.since.getTime()) / 86_400_000));
        return posts().filter((p) => Date.parse(String(p.created_time)) >= a.since.getTime() && Date.parse(String(p.created_time)) <= a.until.getTime());
      },
      image: async (url: string) => { calls.image++; return { bytes: new TextEncoder().encode(url), mime: "image/jpeg" }; },
      review: async (a: Asked) => { calls.review++; calls.asked.push(a); return EVERYDAY; },
      learn: async (a: Calls["learned"][number]) => { calls.learn++; calls.learned.push(a); return rulebook(["Instagram"]); },
      ...over,
    })) as never;
    return calls;
  }
  /** The year past 90 days, as it is read: six parts of 45 days and the 5 days left (365 = 90 + 6 x 45 + 5). */
  const YEAR = [90, 45, 45, 45, 45, 45, 45, 5];
  /** The reviewer as the tests need it: a caption that says Halloween is a holiday post, any other is an everyday one. */
  const byCaption = (calls: () => Calls) => ({ review: async (a: Asked) => { calls().review++; calls().asked.push(a); return /halloween/i.test(a.caption) ? HOLIDAY : EVERYDAY; } });
  const refsClient = (over: Record<string, unknown> = {}) => client({ name: "Harbor Coffee", website_url: "https://www.harborcoffee.example/", design_style_synthesis: null, design_refs_harvested_at: null, ...over });
  /** A post in the library, as the step stores it. */
  const entry = (guid: string, day: string) => ({
    path: pathOf(guid), platform: guid.startsWith("li") ? "LinkedIn" : "Instagram", posted_at: `${day}T15:00:00Z`, source_url: `https://social.example/${guid}`, source_post_id: guid, source: "sprout",
    quality_checked: true, classification: "Branded type over a color block", confidence: 0.9, content_hash: createHash("sha256").update(media(guid)).digest("hex"),
  });
  /** A review as it was stored before the occasion question (rule 1, no answer), made the day before the check. */
  const reviewedBefore = (guid: string, day: string, over: Record<string, unknown> = {}) => ({
    client_id: "c1", source_post_id: guid, network: NETWORKS[guid.split(":")[0]][0], posted_at: `${day}T15:00:00Z`, source_url: `https://social.example/${guid}`,
    content_hash: createHash("sha256").update(media(guid)).digest("hex"), verdict: "designed", path: pathOf(guid), confidence: 0.9, reason: "Branded type over a color block", reviewed_at: "2026-11-01T10:00:00.000Z", ...over,
  });
  /** The look as it was learned before the library's rules (version 2). */
  const learnedBefore = { ...JSON.parse(rulebook([])), platforms: {}, look_change: null, reference_pipeline_version: 2, synthesized_at: "2026-10-20T09:00:00.000Z", source_count: 4, choices_key: "before" };
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
      platforms: { Instagram: { posts: 5, own_rules: true }, LinkedIn: { posts: 2, own_rules: false } },
      owner: "app", suggestions: [], occasions: [], everyday: 7, occasion: 0, unanswered: 0, sibling_disagreements: 0, window_days: 90, removed: 0 } });
    // The check's own date is when it ran: no reused date postpones the next check.
    expect("doneAt" in out).toBe(false);
    expect(calls).toMatchObject({ read: 1, windows: [90], review: 7, learn: 1 });
    // The reviewer is shown each post's platform, date and caption.
    expect(calls.asked.find((a) => a.postedAt === "2026-10-30T15:00:00Z")).toMatchObject({ platform: "LinkedIn", caption: "" });
    // Newest first, labeled; LinkedIn has no section of its own below 4 posts.
    const labels = calls.learned[0].content.filter((b) => b.type === "text").map((b) => b.text);
    expect(labels.slice(1, 4)).toEqual(["Post 1 (Instagram, Nov 1, 2026):", "Post 2 (LinkedIn, Oct 30, 2026):", "Post 3 (Instagram, Oct 29, 2026):"]);
    expect(labels.at(-1)).toContain("Platforms with rules of their own: Instagram (5 posts).");
    expect(labels.at(-1)).toContain("These follow the core, with too few posts for rules of their own: LinkedIn (2 posts).");
    expect(c.design_style_synthesis).toMatchObject({ reference_pipeline_version: 3, platforms: { Instagram: { rules: "Instagram posts set the headline larger.", posts: 5 } }, source_count: 7 });
    expect(Object.keys(c.design_style_synthesis.platforms)).toEqual(["Instagram"]);
    expect(c.design_style_synthesis.platform_adaptations).toBe("Instagram: Instagram posts set the headline larger.");
    expect(c.harvested_design_references.slice(0, 3).map((e: { path: string }) => e.path)).toEqual([pathOf("ig:0"), pathOf("li:0"), pathOf("ig:1")]);
    expect(libraryWrites).toEqual([{ p_client: "c1", p_reference_paths: c.harvested_design_references.map((e: { path: string }) => e.path) }]);
    expect(db.tables.design_reference_reviews).toHaveLength(7);
    for (const r of db.tables.design_reference_reviews) expect(r).toMatchObject({ verdict: "designed", kind: "everyday", rule: 2 });
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

  it("counts the posts reviewed before reviews were stored as designed: each is asked the occasion question from its stored image, never read again", async () => {
    const c = refsClient({ harvested_design_references: igWeek.slice(0, 3).map((d, i) => ({ path: `c1/social-old${i}.jpg`, source_post_id: `ig:${i}`, platform: "INSTAGRAM", posted_at: `${d}T15:00:00Z`, quality_checked: true, classification: "Branded" })) });
    const { db } = world(c, ["ig"]);
    for (let i = 0; i < 3; i++) db.uploads.set(`design-references/c1/social-old${i}.jpg`, "image");
    const calls = fakeIO(() => igWeek.slice(0, 4).map((d, i) => post(`ig:${i}`, d)));
    await STEPS.design_refs.run(db, c, ctx());
    // Only the fourth post's image is new; the three in the library are asked from the files they already have.
    expect(calls).toMatchObject({ image: 1, review: 4 });
    expect(calls.asked.map((a) => a.imageUrl).filter((u) => u.includes("/c1/social-old")).sort()).toEqual([0, 1, 2].map((i) => `https://project.test/storage/v1/object/public/design-references/c1/social-old${i}.jpg`));
    expect(db.tables.design_reference_reviews.map((r) => r.source_post_id).sort()).toEqual(["ig:0", "ig:1", "ig:2", "ig:3"]);
    expect(db.tables.design_reference_reviews.find((r) => r.source_post_id === "ig:0")).toMatchObject({ verdict: "designed", path: "c1/social-old0.jpg", reason: "Branded", kind: "everyday", rule: 2 });
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
    expect(two.learned[0].content.at(-1)!.text).toContain("Harbor Coffee's earlier rulebook, learned Nov 2, 2026:");
    expect(c.design_style_synthesis.synthesized_at).not.toBe(learnedAt);
  });

  it("is due at once when a person keeps or leaves out a post or uploads one, as when the accounts change", async () => {
    const c = refsClient();
    const { db } = world(c, ["ig", "li"]);
    const key = await STEPS.design_refs.inputs(db, c, new Map());
    expect(key).toMatch(/^1676448:7,8\|chosen:/);
    // The key ends in the library rule's version: a change of the rule rebuilds every client's library once.
    expect(key).toMatch(/\|rule:2$/);
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
    db.tables.design_reference_reviews.push({ client_id: "c1", source_post_id: "ig:5", network: "INSTAGRAM", posted_at: "2026-10-05T15:00:00Z", source_url: null, content_hash: "h5", verdict: "designed", path: pathOf("ig:5"), confidence: 0.9, reason: "r", reviewed_at: NOW, kind: "everyday", rule: 2 });
    db.tables.design_reference_choices.push({ client_id: "c1", path: pathOf("ig:5"), choice: "kept" });
    db.uploads.set(`design-references/${pathOf("ig:5")}`, "image");
    fakeIO(() => posts, { learn: async () => rulebook(["Instagram"], { changed: true, since: "2026-10-20", what: "A new coral and navy palette with a serif headline." }) });
    const out = await STEPS.design_refs.run(db, c, ctx());
    expect(out).toMatchObject({ status: "done", result: { look_since: "2026-10-20" } });
    expect(c.harvested_design_references.map((e: { path: string }) => e.path)).toEqual([pathOf("ig:5"), pathOf("ig:0"), pathOf("ig:1"), pathOf("ig:2")]);
    expect(c.design_style_synthesis.look_change).toMatchObject({ since: "2026-10-20", what: "A new coral and navy palette with a serif headline." });
    // brand_read keys on the new look (the client row carries it as look_since), so the logo file and colors follow a rebrand.
    expect(await STEPS.brand_read.inputs(db, { ...c, look_since: c.design_style_synthesis.look_change.since }, new Map())).toBe("harborcoffee.example|look:2026-10-20");
    expect(await STEPS.brand_read.inputs(db, c, new Map())).toBe("harborcoffee.example");
  });

  it("with fewer than 3 designed posts, waits a week and keeps the last references, minus any a person left out", async () => {
    const before = [{ path: "c1/social-a.jpg", quality_checked: true, platform: "INSTAGRAM", posted_at: "2026-06-01T00:00:00Z" }, { path: "c1/social-b.jpg", quality_checked: true, platform: "INSTAGRAM", posted_at: "2026-06-02T00:00:00Z" }];
    const c = refsClient({ harvested_design_references: before });
    const { db } = world(c, ["ig"], { design_reference_choices: [{ client_id: "c1", path: "c1/social-b.jpg", choice: "left_out" }] });
    const calls = fakeIO(() => []);
    // No look was ever learned for it, so there is nothing to keep designing from: it waits. Both windows were read first.
    expect(await STEPS.design_refs.run(db, c, ctx())).toMatchObject({ status: "waiting", reason: "designed_posts", recheckDays: 7, result: { designed: 0, posts_read: 0, window_days: 365, occasions: [] } });
    expect(calls).toMatchObject({ read: 8, windows: YEAR, review: 0, learn: 0 });
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await STEPS.design_refs.run(db, c, ctx())).toMatchObject({ status: "failed" });
    expect(c.harvested_design_references).toBe(before);
    expect(libraryWrites).toEqual([]);
    expect(db.tables.design_reference_reviews).toEqual([]);
    // Each review that did not finish is noted for developers, off the output here.
    expect(warn.mock.calls.length).toBeGreaterThan(0);
    for (const call of warn.mock.calls) expect(call).toEqual(["[brand-discovery] review did not finish", expect.any(String), "overloaded"]);
  });

  describe("the library's rules (17 Nov 2026)", () => {
    const fourDays = igWeek.slice(0, 4);
    /** A client whose library and reviews date from before the rules: four Instagram posts, a look learned from them. */
    function before(captions: string[] = [], over: Record<string, unknown> = {}, keys: string[] = ["ig"]) {
      const guids = fourDays.map((_, i) => `ig:${i}`);
      const c = refsClient({ harvested_design_references: guids.map((g, i) => entry(g, fourDays[i])), design_style_synthesis: learnedBefore, ...over });
      const w = world(c, keys, { design_reference_reviews: guids.map((g, i) => reviewedBefore(g, fourDays[i])) });
      for (const g of guids) w.db.uploads.set(`design-references/${pathOf(g)}`, "image");
      const posts = guids.map((g, i) => post(g, fourDays[i], captions[i] ?? "Fresh beans roasted every morning."));
      return { c, ...w, posts, guids };
    }

    it("the first check after the change asks every designed post once and learns the look once; the next check calls no model", async () => {
      const { c, db, posts, guids } = before();
      const calls = fakeIO(() => posts);
      const out = await STEPS.design_refs.run(db, c, ctx());
      // Each is asked from its stored image: none is read from the network again.
      expect(calls).toMatchObject({ read: 1, image: 0, review: 4, learn: 1 });
      expect(out).toMatchObject({ status: "done", result: { relearned: "first", reviewed: 4, model_calls: 5, references: 4, owner: "app", everyday: 4, window_days: 90 } });
      expect(c.design_style_synthesis).toMatchObject({ reference_pipeline_version: 3, synthesized_at: NOW });
      expect(c.harvested_design_references.map((e: { path: string }) => e.path)).toEqual(guids.map(pathOf));
      for (const r of db.tables.design_reference_reviews) expect(r).toMatchObject({ verdict: "designed", reason: "Branded type over a color block", kind: "everyday", rule: 2 });

      const again = fakeIO(() => posts, { now: () => new Date("2026-11-09T10:00:00Z") });
      expect(await STEPS.design_refs.run(db, c, ctx({ force: true }))).toMatchObject({ status: "done", result: { relearned: null, reviewed: 0, model_calls: 0 } });
      expect(again).toMatchObject({ read: 1, image: 0, review: 0, learn: 0 });
    });

    it("a library a person chose (5 uploads) is exactly those; the client's everyday posts are offered, never added", async () => {
      const uploads = [1, 2, 3, 4, 5].map((n) => `c1/uploads/reference-${n}.png`);
      const { c, db, libraryWrites, posts, guids } = before([], { design_references: uploads });
      c.harvested_design_references = [...uploads.map((path) => ({ path, upload: true, kept: true })), ...c.harvested_design_references];
      for (const u of uploads) db.uploads.set(`design-references/${u}`, "image");
      const calls = fakeIO(() => posts);
      const out = await STEPS.design_refs.run(db, c, ctx());
      expect(out).toMatchObject({ status: "done", result: { owner: "person", references: 5, occasions: [], window_days: 90 } });
      expect(libraryWrites.at(-1)).toEqual({ p_client: "c1", p_reference_paths: uploads });
      expect(c.harvested_design_references).toEqual(uploads.map((path) => ({ path, upload: true, kept: true })));
      // The posts that left are offered with their platform, date and link.
      const result = (out as { result: { suggestions: Array<Record<string, unknown>> } }).result;
      expect(result.suggestions.map((s) => s.path)).toEqual(guids.map(pathOf));
      expect(result.suggestions[0]).toEqual({ path: pathOf("ig:0"), platform: "Instagram", posted_at: `${fourDays[0]}T15:00:00Z`, source_url: "https://social.example/ig:0" });
      // The look is learned from the five the person chose, and only from them.
      expect(calls).toMatchObject({ read: 1, windows: [90], learn: 1 });
      expect(calls.learned[0].content.filter((b) => b.type === "image")).toHaveLength(5);
      expect(c.design_style_synthesis.source_posts.map((p: { path: string }) => p.path)).toEqual(uploads);
    });

    it("a library a person chose is written even when its files are too large to learn the look from; the stored look stays", async () => {
      const uploads = [1, 2, 3].map((n) => `c1/uploads/large-${n}.png`);
      const { c, db, libraryWrites, posts } = before([], { design_references: uploads });
      // Two of the three are over the size one image may have in the request.
      db.uploads.set(`design-references/${uploads[0]}`, "image");
      for (const u of uploads.slice(1)) db.uploads.set(`design-references/${u}`, new Uint8Array(4 * 1024 * 1024 + 1));
      const calls = fakeIO(() => posts);
      const out = await STEPS.design_refs.run(db, c, ctx());
      expect(out).toMatchObject({ status: "done", result: { owner: "person", references: 3, relearned: null, look_waits: true, synthesized_at: learnedBefore.synthesized_at } });
      expect(calls.learn).toBe(0);
      expect(libraryWrites.at(-1)).toEqual({ p_client: "c1", p_reference_paths: uploads });
      expect(c.harvested_design_references.map((e: { path: string }) => e.path)).toEqual(uploads);
      expect(c.design_style_synthesis).toBe(learnedBefore);
    });

    it("a post made for an occasion leaves an automatic library, and is listed with what it was made for", async () => {
      const { c, db, libraryWrites, posts } = before(["Happy Halloween from Harbor Coffee!"]);
      const calls: Calls = fakeIO(() => posts, byCaption(() => calls));
      const out = await STEPS.design_refs.run(db, c, ctx());
      expect(out).toMatchObject({ status: "done", result: { owner: "app", references: 3, everyday: 3, occasion: 1 } });
      expect(libraryWrites.at(-1)!.p_reference_paths).toEqual([pathOf("ig:1"), pathOf("ig:2"), pathOf("ig:3")]);
      expect((out as { result: { occasions: unknown[] } }).result.occasions).toEqual([{ path: pathOf("ig:0"), platform: "Instagram", posted_at: `${fourDays[0]}T15:00:00Z`, source_url: "https://social.example/ig:0", occasion: "holiday" }]);
      expect(db.tables.design_reference_reviews.find((r) => r.source_post_id === "ig:0")).toMatchObject({ verdict: "designed", kind: "occasion", occasion: "holiday", evidence: "Happy Halloween", rule: 2 });

      // A person's Keep outranks the rule: the same post is back in on the next check.
      db.tables.design_reference_choices.push({ client_id: "c1", path: pathOf("ig:0"), choice: "kept" });
      const next: Calls = fakeIO(() => posts, { ...byCaption(() => next), now: () => new Date("2026-11-03T10:00:00Z") });
      await STEPS.design_refs.run(db, c, ctx());
      expect(libraryWrites.at(-1)!.p_reference_paths).toEqual([pathOf("ig:0"), pathOf("ig:1"), pathOf("ig:2"), pathOf("ig:3")]);
      expect(next.review).toBe(0);
    });

    it("a client whose posts were all made for occasions keeps its library and its look, after reading a whole year", async () => {
      const { c, db, libraryWrites, posts, guids } = before(fourDays.map(() => "Happy Halloween from Harbor Coffee!"));
      const stored = c.harvested_design_references;
      const calls: Calls = fakeIO(() => posts, byCaption(() => calls));
      const out = await STEPS.design_refs.run(db, c, ctx());
      expect(out).toMatchObject({ status: "done", result: { no_everyday: true, occasion_only: true, references: 4, relearned: null, synthesized_at: learnedBefore.synthesized_at, owner: "app", occasion: 4, everyday: 0, window_days: 365 } });
      expect(calls).toMatchObject({ read: 8, windows: YEAR, review: 4, learn: 0 });
      expect(c.harvested_design_references).toBe(stored);
      expect(c.harvested_design_references.map((e: { path: string }) => e.path)).toEqual(guids.map(pathOf));
      expect(c.design_style_synthesis).toBe(learnedBefore);
      expect(libraryWrites).toEqual([]);
      expect((out as { result: { occasions: unknown[] } }).result.occasions).toHaveLength(4);
    });

    it("a client with 2 everyday posts builds on those 2 and keeps its look", async () => {
      const { c, db, libraryWrites, posts } = before(["Happy Halloween from Harbor Coffee!", "", "Our Halloween special is back."]);
      const calls: Calls = fakeIO(() => posts, byCaption(() => calls));
      const out = await STEPS.design_refs.run(db, c, ctx());
      expect(out).toMatchObject({ status: "done", result: { thin: true, thin_everyday: 2, chosen: 0, references: 2, relearned: null, synthesized_at: learnedBefore.synthesized_at, owner: "app", window_days: 365 } });
      expect("no_everyday" in (out as { result: object }).result).toBe(false);
      expect(calls).toMatchObject({ read: 8, review: 4, learn: 0 });
      expect(c.harvested_design_references.map((e: { path: string }) => e.path)).toEqual([pathOf("ig:1"), pathOf("ig:3")]);
      expect(libraryWrites.at(-1)).toEqual({ p_client: "c1", p_reference_paths: [pathOf("ig:1"), pathOf("ig:3")] });
      expect(c.design_style_synthesis).toBe(learnedBefore);
    });

    it("with fewer than 3 everyday posts in 90 days, reads 365 days in the same check and learns from what the year holds", async () => {
      const c = refsClient();
      const { db, libraryWrites } = world(c, ["ig"]);
      // Two posts this autumn, three from the spring.
      const posts = [post("ig:0", "2026-10-29"), post("ig:1", "2026-10-12"), post("ig:2", "2026-05-20"), post("ig:3", "2026-04-14"), post("ig:4", "2026-03-02")];
      const calls = fakeIO(() => posts);
      const out = await STEPS.design_refs.run(db, c, ctx());
      expect(out).toMatchObject({ status: "done", result: { window_days: 365, references: 5, relearned: "first", reviewed: 5, posts_read: 5, owner: "app" } });
      expect(calls).toMatchObject({ read: 8, windows: YEAR, review: 5, learn: 1 });
      expect(libraryWrites.at(-1)!.p_reference_paths).toEqual(["ig:0", "ig:1", "ig:2", "ig:3", "ig:4"].map(pathOf));
    });

    describe("a check that takes more than one run", () => {
      const base = { client_id: "c1", step: "design_refs", inputs_key: "k" };
      /** Runs the step as the lifecycle does: again a minute later while it is still at work, each time with the row the last run left. */
      async function runs(db: ReturnType<typeof dbWith>, c: Record<string, unknown>, each: (n: number) => Calls, first: StepRow | null = null) {
        const outs: Array<Awaited<ReturnType<typeof STEPS.design_refs.run>>> = [];
        const reads: number[][] = [];
        let prev: StepRow | null = first;
        for (let n = 0; n < 12; n++) {
          const calls = each(n);
          const out = await STEPS.design_refs.run(db, c, ctx({ previous: prev }));
          outs.push(out);
          reads.push(calls.windows);
          prev = rowAfter(prev, base, out, new Date(NOW));
          if (!(out.status === "waiting" && out.reason === "in_progress")) break;
        }
        return { outs, reads, last: prev! };
      }
      /** A clock that moves only when Sprout is read: each read takes 20 seconds. */
      function slowReads(posts: () => Record<string, unknown>[], over: Record<string, unknown> = {}) {
        let clock = Date.parse(NOW);
        vi.spyOn(Date, "now").mockImplementation(() => clock);
        return () => {
          const calls: Calls = fakeIO(posts, over);
          const io = deps.refsIO() as unknown as { readPosts: (a: unknown) => Promise<unknown> };
          deps.refsIO = (() => ({ ...io, readPosts: async (a: unknown) => { clock += 20_000; return io.readPosts(a); } })) as never;
          return calls;
        };
      }
      // Two posts this autumn, three from the spring: the library needs the year.
      const yearPosts = () => [post("ig:0", "2026-10-29"), post("ig:1", "2026-10-12"), post("ig:2", "2026-05-20"), post("ig:3", "2026-04-14"), post("ig:4", "2026-03-02")];

      it("reads the last 90 days once, then one part of the year per read, and never a day twice", async () => {
        const c = refsClient();
        const { db, libraryWrites } = world(c, ["ig"]);
        const { outs, reads } = await runs(db, c, slowReads(yearPosts));
        // Each run starts no further part after 30 seconds: two reads a run here. The 90 days are read by the first run alone.
        expect(reads).toEqual([[90, 45], [45, 45], [45, 45], [45, 5]]);
        expect(reads.flat()).toEqual(YEAR);
        expect(outs.slice(0, 3).map((o) => (o as { result: { progress: unknown } }).result.progress)).toEqual([
          { at: NOW, covered_from: "2026-06-20" }, { at: NOW, covered_from: "2026-03-22" }, { at: NOW, covered_from: "2025-12-22" },
        ]);
        for (const o of outs.slice(0, 3)) expect(o).toMatchObject({ status: "waiting", reason: "in_progress", recheckMinutes: 1 });
        // The library is the one a single run would have picked: the days read by earlier runs are known from their reviews.
        expect(outs.at(-1)).toMatchObject({ status: "done", result: { window_days: 365, references: 5, relearned: "first", owner: "app", everyday: 5 } });
        expect("progress" in (outs.at(-1) as { result: object }).result).toBe(false);
        expect(libraryWrites.at(-1)!.p_reference_paths).toEqual(["ig:0", "ig:1", "ig:2", "ig:3", "ig:4"].map(pathOf));
        expect(c.harvested_design_references[2]).toMatchObject({ path: pathOf("ig:2"), platform: "Instagram", posted_at: "2026-05-20T15:00:00Z", source_url: "https://social.example/ig:2", source_post_id: "ig:2", quality_checked: true });
      });

      it("goes on with the same part of the year while that part still has posts to review, and reads nothing else", async () => {
        const c = refsClient();
        const { db } = world(c, ["ig"]);
        // Thirty plain photos in one spring fortnight, two a day: more than one run reviews.
        const spring = Array.from({ length: 30 }, (_, i) => post(`ig:s${i}`, `2026-05-${30 - Math.floor(i / 2)}`));
        const plain = { usable: false, confidence: 0.95, reason: "A plain photograph" };
        const reviewer = (calls: () => Calls) => ({ review: async (a: Asked) => { calls().review++; calls().asked.push(a); return plain; } });
        let made: Calls;
        const { outs, reads } = await runs(db, c, () => (made = fakeIO(() => [post("ig:0", "2026-10-29"), ...spring], reviewer(() => made))));
        // Run 1: the 90 days, the first older part (empty), then the part with the photos: one platform's 6 reviewed, 6 more waiting.
        // Runs 2 to 4: that part again and nothing else. Run 5: its last 6, then the rest of the year.
        expect(reads).toEqual([[90, 45, 45], [45], [45], [45], [45, 45, 45, 45, 45, 5]]);
        expect(outs[0]).toMatchObject({ status: "waiting", reason: "in_progress", result: { reviewed: 7, left: 6, progress: { at: NOW, covered_from: "2026-06-20" } } });
        for (const o of outs.slice(1, 4)) expect(o).toMatchObject({ status: "waiting", reason: "in_progress", result: { reviewed: 6, left: 6, progress: { covered_from: "2026-06-20" } } });
        expect(db.tables.design_reference_reviews).toHaveLength(31);
        // One everyday post in a year and no look learned yet: it waits, and its progress is cleared.
        expect(outs[4]).toMatchObject({ status: "waiting", reason: "designed_posts", result: { window_days: 365, progress: null } });
      });

      it("starts again from the last 90 days when the stored progress is old, or is not for this year", async () => {
        const c = refsClient();
        const { db } = world(c, ["ig"]);
        const stale = (progress: unknown) => row("design_refs", { status: "waiting", result: { waiting_for: "in_progress", progress } });
        for (const progress of [{ at: "2026-11-02T03:00:00.000Z", covered_from: "2026-06-20" }, { at: NOW, covered_from: "2024-01-01" }, { at: NOW, covered_from: "tomorrow" }, "2026-06-20", null]) {
          const calls = fakeIO(yearPosts);
          await STEPS.design_refs.run(db, c, ctx({ previous: stale(progress) }));
          expect(calls.windows[0], JSON.stringify(progress)).toBe(90);
        }
        // Progress from under 6 hours ago is picked up: the 90 days are not read.
        const calls = fakeIO(yearPosts);
        await STEPS.design_refs.run(db, c, ctx({ previous: stale({ at: "2026-11-02T05:00:00.000Z", covered_from: "2026-06-20" }) }));
        expect(calls.windows[0]).toBe(45);
        expect(calls.windows).not.toContain(90);
      });

      it("after two failed runs in a row, a post the model can never review no longer holds the check back", async () => {
        const { c, db, libraryWrites, posts, guids } = before();
        const answered = { kind: "everyday", rule: 2, reviewed_at: "2026-11-01T00:00:00.000Z", profile_id: "7" };
        // Three posts are answered; the fourth was stored before the question and the model errors on it every time.
        db.tables.design_reference_reviews = [...guids.slice(0, 3).map((g, i) => reviewedBefore(g, fourDays[i], answered)), reviewedBefore(guids[3], fourDays[3])];
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const refuses = { review: async () => { throw new Error("the image could not be processed"); } };
        fakeIO(() => posts, refuses);
        // The first two runs fail and change nothing: the row is as it was.
        expect(await STEPS.design_refs.run(db, c, ctx())).toMatchObject({ status: "failed" });
        expect(await STEPS.design_refs.run(db, c, ctx({ previous: row("design_refs", { status: "failed", attempts: 1, error: "e" }) }))).toMatchObject({ status: "failed" });
        expect(db.tables.design_reference_reviews.find((r) => r.source_post_id === guids[3])!.rule ?? 1).toBe(1);
        expect(libraryWrites).toEqual([]);
        // The third records it as not answered, and the library is written from the other three.
        const out = await STEPS.design_refs.run(db, c, ctx({ previous: row("design_refs", { status: "failed", attempts: 2, error: "e" }) }));
        expect(out).toMatchObject({ status: "done", result: { references: 3, unanswered: 1 } });
        expect(db.tables.design_reference_reviews.find((r) => r.source_post_id === guids[3])).toMatchObject({ verdict: "designed", kind: null, rule: 2 });
        expect(libraryWrites.at(-1)!.p_reference_paths).toEqual(guids.slice(0, 3).map(pathOf));
      });
    });

    it("a read that comes back empty for an active account removes nothing: no review, no reference, no change to the look", async () => {
      const { c, db, libraryWrites, guids } = before();
      const answered = { kind: "everyday", rule: 2, reviewed_at: "2026-11-01T00:00:00.000Z", profile_id: "7" };
      db.tables.design_reference_reviews = guids.map((g, i) => reviewedBefore(g, fourDays[i], answered));
      // The look was learned from these four under the current rules.
      const learned = { ...learnedBefore, reference_pipeline_version: 3, choices_key: choicesKey({}, []), platforms: { Instagram: { rules: "r", posts: 4, learned_at: NOW } }, source_posts: guids.map((g) => ({ path: pathOf(g) })) };
      c.design_style_synthesis = learned;
      // Sprout answers, with no posts at all.
      const calls = fakeIO(() => []);
      const out = await STEPS.design_refs.run(db, c, ctx());
      expect(out).toMatchObject({ status: "done", result: { removed: 0, references: 4, relearned: null, posts_read: 0, window_days: 90, everyday: 4 } });
      expect(db.tables.design_reference_reviews.map((r) => r.source_post_id).sort()).toEqual([...guids].sort());
      expect(c.harvested_design_references.map((e: { path: string }) => e.path)).toEqual(guids.map(pathOf));
      expect(libraryWrites.at(-1)!.p_reference_paths).toEqual(guids.map(pathOf));
      expect(c.design_style_synthesis).toBe(learned);
      expect(calls).toMatchObject({ read: 1, review: 0, learn: 0 });
    });

    it("a read that returns one account's posts and nothing for another active account removes nothing of the silent one", async () => {
      const { c, db, posts, guids } = before([], {}, ["ig", "li"]);
      const answered = { kind: "everyday", rule: 2, reviewed_at: "2026-11-01T00:00:00.000Z" };
      db.tables.design_reference_reviews = [
        ...guids.map((g, i) => reviewedBefore(g, fourDays[i], { ...answered, profile_id: "7" })),
        reviewedBefore("li:quiet", "2026-10-28", { ...answered, profile_id: "8" }),
        reviewedBefore("ig:deleted", "2026-10-27", { ...answered, profile_id: "7" }),
      ];
      fakeIO(() => posts);
      const out = await STEPS.design_refs.run(db, c, ctx());
      // Instagram answered, so its missing post is gone. LinkedIn is active and returned nothing: its review stays.
      expect(out).toMatchObject({ status: "done", result: { removed: 1 } });
      expect(db.tables.design_reference_reviews.map((r) => r.source_post_id).sort()).toEqual([...guids, "li:quiet"].sort());
    });

    it("a reviewed post the read no longer returns loses its review and its place; a kept one stays", async () => {
      // LinkedIn was disconnected: only the Instagram account is active, and the read returns only its posts.
      const { c, db, libraryWrites, posts, guids } = before();
      const answered = { kind: "everyday", rule: 2, reviewed_at: "2026-11-01T00:00:00.000Z" };
      db.tables.design_reference_reviews = [
        ...guids.map((g, i) => reviewedBefore(g, fourDays[i], answered)),
        reviewedBefore("li:gone", "2026-10-28", answered), reviewedBefore("li:kept", "2026-10-27", answered), reviewedBefore("li:summer", "2026-06-10", answered),
        reviewedBefore("li:photo", "2026-10-25", { verdict: "not_designed", path: null }),
      ];
      c.harvested_design_references = [...c.harvested_design_references, entry("li:gone", "2026-10-28"), entry("li:kept", "2026-10-27")];
      db.tables.design_reference_choices.push({ client_id: "c1", path: pathOf("li:kept"), choice: "kept" });
      for (const g of ["li:gone", "li:kept"]) db.uploads.set(`design-references/${pathOf(g)}`, "image");
      const calls = fakeIO(() => posts);
      const out = await STEPS.design_refs.run(db, c, ctx());
      expect(out).toMatchObject({ status: "done", result: { removed: 2, references: 5, window_days: 90 } });
      // Gone: the two dated inside the window. The kept one stays, and so does one from before the window.
      expect(db.tables.design_reference_reviews.map((r) => r.source_post_id).sort()).toEqual([...guids, "li:kept", "li:summer"].sort());
      // Taken in turn across platforms, as always: Instagram's newest, then the kept LinkedIn post.
      expect(libraryWrites.at(-1)!.p_reference_paths).toEqual([pathOf("ig:0"), pathOf("li:kept"), pathOf("ig:1"), pathOf("ig:2"), pathOf("ig:3")]);
      expect(c.harvested_design_references.map((e: { path: string }) => e.path)).not.toContain(pathOf("li:gone"));
      expect(calls.review).toBe(0);
    });

    it("removes nothing when the read fails", async () => {
      const { c, db, libraryWrites, guids } = before();
      db.tables.design_reference_reviews.push(reviewedBefore("li:gone", "2026-10-28"));
      const stored = c.harvested_design_references;
      const calls = fakeIO(() => [], { readPosts: async () => { calls.read++; throw new StyleError("provider", "Published-post lookup did not answer. It will be tried again."); } });
      expect(await STEPS.design_refs.run(db, c, ctx())).toMatchObject({ status: "failed" });
      expect(calls).toMatchObject({ read: 1, review: 0, learn: 0 });
      expect(db.tables.design_reference_reviews.map((r) => r.source_post_id).sort()).toEqual([...guids, "li:gone"].sort());
      expect(c.harvested_design_references).toBe(stored);
      expect(libraryWrites).toEqual([]);
    });
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
    const { FollowFailure } = await import("../../../functions/_shared/competitive/rivaliqFollowFailure");
    const set = { id: "s1", client_id: "c1", status: "confirmed", confirmed_at: T, created_at: T, rivaliq_landscape_id: null, tracking_check: null };
    deps.rivaliqKey = () => null;
    deps.advanceSetupOnServer = fail("the setup");
    expect(await STEPS.tracking.run(dbWith({ competitor_sets: [set] }), olo(), ctx())).toEqual({ status: "waiting", reason: "client_website", result: { set_id: "s1" } });
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    deps.advanceSetupOnServer = async () => { throw new FollowFailure("RivalIQ's plan tracks 40 distinct companies and 40 are in use, so Olo could not be added.", true); };
    expect(await STEPS.tracking.run(dbWith({ competitor_sets: [set] }), olo({ website_url: "https://olo.com" }), ctx())).toEqual({ status: "waiting", reason: "rivaliq_full", recheckDays: 1, result: { set_id: "s1" } });
  });

  it("waits on the selection when a chosen competitor's website refuses the visit: no failure, a different competitor starts it at once, and it is asked again weekly", async () => {
    const { followFailure } = await import("../../../functions/_shared/competitive/rivaliqFollowFailure");
    const { decide, rowAfter } = await import("../../../functions/_shared/lifecycle/policy");
    const { SITE_REFUSED_RECHECK_DAYS } = await import("../../../functions/_shared/lifecycle/steps");
    const set = { id: "s1", client_id: "c1", status: "confirmed", confirmed_at: T, created_at: T, rivaliq_landscape_id: null, tracking_check: null };
    const brand = client({ name: "Northwind Bikes", website_url: "https://northwindbikes.example" });
    deps.rivaliqKey = () => "rk";
    deps.rivalIqApi = (() => async () => ({})) as never;
    // What RivalIQ answers for a website that refused its visit: the URL not followed, in these words.
    const REFUSED = { status: 3, error: { message: "ProblemFetchingUrlError: HTTPError: Response code 403 ()" } };
    let asked = 0;
    deps.advanceSetupOnServer = async () => { asked++; throw followFailure([{ name: "Tailspin Cycles", result: REFUSED }]); };
    const outcome = await STEPS.tracking.run(dbWith({ competitor_sets: [set] }), brand, ctx());
    expect(SITE_REFUSED_RECHECK_DAYS).toBe(7);
    expect(outcome).toEqual({ status: "waiting", reason: "site_refused", recheckDays: 7, result: { set_id: "s1", refused: ["Tailspin Cycles"] } });
    expect(asked).toBe(1);

    // Stored as a wait, not a failure: nothing for a week, then one more ask, so a refusal that passed does not hold tracking for good.
    const now = new Date(T);
    const stored = rowAfter(null, { client_id: "c1", step: "tracking", inputs_key: "s1|none||abc|northwindbikes.example" }, outcome as never, now);
    expect(stored).toMatchObject({ status: "waiting", attempts: 0, error: null, next_attempt_at: new Date(now.getTime() + 7 * 86_400_000).toISOString(), result: { waiting_for: "site_refused", refused: ["Tailspin Cycles"] } });
    for (const days of [0, 1, 6.9]) expect(decide(stored, stored.inputs_key, STEPS.tracking.policy, new Date(now.getTime() + days * 86_400_000))).toMatchObject({ due: false });
    expect(decide(stored, stored.inputs_key, STEPS.tracking.policy, new Date(now.getTime() + 7 * 86_400_000))).toMatchObject({ due: true, why: "recheck" });
    // A different competitor is part of the step's inputs: tracking starts for it at once.
    expect(decide(stored, "s1|none||other-selection|northwindbikes.example", STEPS.tracking.policy, now)).toMatchObject({ due: true, why: "inputs_changed" });

    // A full plan still waits for a place and is looked at daily.
    deps.advanceSetupOnServer = async () => { throw followFailure([{ name: "Tailspin Cycles", result: { status: 3, error: { data: { credits: { plan: 40, distinct: 40 } } } } }, { name: "Fabrikam Wheels", result: REFUSED }]); };
    expect(await STEPS.tracking.run(dbWith({ competitor_sets: [set] }), brand, ctx())).toMatchObject({ status: "waiting", reason: "rivaliq_full", recheckDays: 1 });
    // Only the refused websites count. Another website not followed for another reason is a fault with its usual retry,
    // and so is an answer that only mentions 403 without being RivalIQ's refusal.
    for (const other of [{ status: 3, error: "Unknown company" }, { status: 3, error: "Response code 403" }, { status: 3, error: "Forbidden" }, { status: 3, error: "Company 14030 could not be read" }, { status: 2, error: REFUSED.error }]) {
      deps.advanceSetupOnServer = async () => { throw followFailure([{ name: "Tailspin Cycles", result: REFUSED }, { name: "Fabrikam Wheels", result: other }]); };
      await expect(STEPS.tracking.run(dbWith({ competitor_sets: [set] }), brand, ctx())).rejects.toThrow(/Tailspin Cycles/);
    }
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

describe("accounts mends the public profiles' handle case without a paid read", () => {
  it("a stored lower-cased channel id ends as the real id with a /channel/ link, from a free page fetch", async () => {
    const ID = "UCtyXEjQ6RqDX7mNn1Zb3k9A";
    const c = client({ name: "Uproar", website_url: "https://www.uproar.example/" });
    const db = dbWith({
      clients: [c], sprout_profiles: [], sprout_profile_removals: [],
      client_public_profiles: [{ client_id: "c1", platform: "youtube", handle: ID.toLowerCase(), url: `https://www.youtube.com/@${ID.toLowerCase()}`, source: "website" }],
    });
    deps.listCustomerProfiles = async () => [];
    let fetched = 0;
    deps.fetchSiteHtml = async () => { fetched++; return { html: `<a href="https://www.youtube.com/channel/${ID}">YouTube</a>`, via: "direct" as const }; };
    const rows = rowsOf(row("brand_read", { result: { site_profiles: [`youtube:${ID.toLowerCase()}`] } }));
    const out = await STEPS.accounts.run(db, c, ctx({ rows }));
    expect(fetched).toBe(1);
    expect(db.tables.client_public_profiles.map((r) => [r.platform, r.handle, r.url, r.source])).toEqual([["youtube", ID, `https://www.youtube.com/channel/${ID}`, "website"]]);
    // The strategy's own read of the profiles sees the same links, so it does not turn the handle back.
    const { profileInputs, desiredProfiles } = await import("../../../functions/_shared/strategy/profiles");
    const pi = await profileInputs(db, { id: "c1", name: "Uproar" }, { brand_read: rows.get("brand_read")!.result, accounts: (out as { result: Record<string, unknown> }).result });
    expect(desiredProfiles(pi).map((r) => r.handle)).toEqual([ID]);
  });
});

// Copy sources, 17 Nov 2026: after the rules change, the app rebuilds each client's voice and
// checks its upcoming calendar by itself. Every company, person and caption below is invented.
describe("voice", () => {
  const BUILT = "2026-11-01T08:00:00.000Z";
  const STARS = "Dana Reed ★★★★★";
  const LISTED = { name: STARS, plain: "Dana Reed" };
  const namesKey = (...names: Array<{ name: string; plain: string }>) => textHash(names.map((n) => `${n.name}>${n.plain}`).join("\n"));
  const UNDER_RULE = "name:harbor wax|site:|links:00000000|removed:00000000|own:1";
  const accounts = (over: Partial<StepRow> = {}, facts: Record<string, unknown> = {}) =>
    rowsOf(row("accounts", { inputs_key: UNDER_RULE, result: { display_names: [LISTED], own: [], own_dropped_at: null, ...facts }, ...over }));
  const harbor = (over: Record<string, unknown> = {}) => client({ name: "Harbor Wax", voice_built_at: BUILT, ...over });
  /** A stored voice: a platform's fields and phrases, the overall voice and its example posts. */
  const voice = (over: Record<string, unknown> = {}) => ({
    built_at: BUILT, post_count: 12,
    platforms: { LinkedIn: { summary: "Warm and proud.", opening: "A thank you.", phrases: ["proud of the team"] } },
    overall: { summary: "Warm.", phrases: ["thank you"] },
    examples: { LinkedIn: [{ text: "Five years with our front desk team.", date: "2026-10-20", link: null, format: "image" }] },
    ...over,
  });
  const world = (social_voice: unknown, c = harbor()) => dbWith({ clients: [{ ...c, social_voice }], scheduled_jobs: [] });
  const jobs = (db: ReturnType<typeof dbWith>) => db.tables.scheduled_jobs.filter((j) => j.kind === "voice_profile");

  it("waits for a client to have a voice, and for an accounts result under the one-account rule", async () => {
    const db = dbWith({});
    expect(await STEPS.voice.inputs(db, harbor({ voice_built_at: null }), accounts())).toBeNull();
    expect(await STEPS.voice.inputs(db, harbor(), new Map())).toBeNull();
    // The accounts step last ran before the rule: a second account may still be parked and no names are stored, so the voice waits.
    expect(await STEPS.voice.inputs(db, harbor(), accounts({ inputs_key: "name:harbor wax|site:|links:00000000|removed:00000000" }))).toBeNull();
    // The first run under the rule is under way, or failed: there is no result to decide by yet.
    expect(await STEPS.voice.inputs(db, harbor(), rowsOf(row("accounts", { inputs_key: UNDER_RULE, status: "running", done_at: null, result: {} })))).toBeNull();
    expect(await STEPS.voice.inputs(db, harbor(), rowsOf(row("accounts", { inputs_key: UNDER_RULE, status: "failed", done_at: null, attempts: 1, result: null, error: "Sprout did not answer" })))).toBeNull();
    // A later refresh that is under way or that failed leaves the result standing, and holds nothing.
    const key = await STEPS.voice.inputs(db, harbor(), accounts());
    expect(key).toBe(`rule:1|built:${BUILT}|own:|names:${namesKey(LISTED)}`);
    expect(await STEPS.voice.inputs(db, harbor(), accounts({ status: "running" }))).toBe(key);
    expect(await STEPS.voice.inputs(db, harbor(), accounts({ status: "failed", attempts: 1, error: "Sprout did not answer" }))).toBe(key);
  });

  it("looks again when the voice, the listed names or the time an account was parked change, and at nothing else", async () => {
    const db = dbWith({ sprout_profiles: [] });
    const key = await STEPS.voice.inputs(db, harbor(), accounts());
    expect(await STEPS.voice.inputs(db, harbor({ voice_built_at: "2026-12-01T08:00:00.000Z" }), accounts())).not.toBe(key);
    expect(await STEPS.voice.inputs(db, harbor(), accounts({}, { display_names: [LISTED, { name: "Harbor Wax ✨", plain: "Harbor Wax" }] }))).not.toBe(key);
    expect(await STEPS.voice.inputs(db, harbor(), accounts({}, { own_dropped_at: "2026-11-17T09:00:00.000Z" }))).toBe(`rule:1|built:${BUILT}|own:2026-11-17T09:00:00.000Z|names:${namesKey(LISTED)}`);
    // The client's accounts as such are not in the key: an account a person adds is no reason to look at the voice.
    db.tables.sprout_profiles.push({ client_id: "c1", sprout_profile_id: 30, network_type: "tiktok", is_active: true });
    expect(await STEPS.voice.inputs(db, harbor(), accounts())).toBe(key);
  });

  it("records that a voice with nothing to fix conforms, and writes nothing else: no job, no change to the voice or its date", async () => {
    const stored = voice();
    const db = world(stored);
    const before = JSON.stringify(db.tables);
    const out = await STEPS.voice.run(db, harbor(), ctx({ rows: accounts() }));
    expect(out).toEqual({ status: "done", result: { conforms: true, rule: 1, built_at: BUILT } });
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(jobs(db)).toEqual([]);
    expect(db.rpcCalls).toEqual([]);
    // What the trend profile and the content strategy key on is as it was.
    expect(db.tables.clients[0].social_voice).toEqual(stored);
    expect((db.tables.clients[0].social_voice as { built_at: string }).built_at).toBe(BUILT);
  });

  it("conforms when the client's accounts list no decorated name, and when an account was parked before the voice was built", async () => {
    // A voice that happens to hold stars nobody listed is not this rule's to fix.
    const db = world(voice({ overall: { summary: "Five stars ★★★★★ from clients.", phrases: [] } }));
    expect(await STEPS.voice.run(db, harbor(), ctx({ rows: accounts({}, { display_names: [] }) }))).toMatchObject({ status: "done", result: { conforms: true } });
    expect(await STEPS.voice.run(world(voice()), harbor(), ctx({ rows: accounts({}, { own_dropped_at: "2026-10-30T09:00:00.000Z" }) }))).toMatchObject({ status: "done", result: { conforms: true } });
    expect(jobs(db)).toEqual([]);
  });

  /** The job key of the one rebuild for a set of facts: the rule, the listed names and the time an account was parked. */
  const jobKey = (parked = "", ...names: Array<{ name: string; plain: string }>) => `voice_profile:c1:rule1:${textHash(`${(names.length ? names : [LISTED]).map((n) => `${n.name}>${n.plain}`).join("\n")}|${parked}`)}`;

  it("builds the voice again when its stored text holds a listed decorated name, wherever it is", async () => {
    deps.now = () => new Date("2026-11-17T10:00:00.000Z");
    const key = jobKey();
    const places: Array<Record<string, unknown>> = [
      { platforms: { LinkedIn: { summary: "Warm.", phrases: [STARS] } } },
      { platforms: { LinkedIn: { summary: `Often thanks ${STARS} by name.`, phrases: [] } } },
      { overall: { summary: "Warm.", opening: `Tags ${STARS} first.`, phrases: [] } },
      { examples: { LinkedIn: [{ text: `Welcome ${STARS} to the firm.`, date: "2026-10-20", link: null, format: "image" }] } },
    ];
    for (const place of places) {
      const db = world(voice(place));
      const out = await STEPS.voice.run(db, harbor(), ctx({ rows: accounts() }));
      expect(out).toEqual({ status: "done", result: { conforms: false, rule: 1, built_at: BUILT, why: ["names"], names: 1, queued: key, at: "2026-11-17T10:00:00.000Z" } });
      expect(jobs(db)).toEqual([expect.objectContaining({ kind: "voice_profile", client_id: "c1", dedupe_key: key, priority: 39, available_at: "2026-11-17T10:00:00.000Z" })]);
      // The step itself changes nothing in the voice: the job does.
      expect((db.tables.clients[0].social_voice as { built_at: string }).built_at).toBe(BUILT);
    }
  });

  it("builds the voice again when one of the client's own accounts was parked after it was built", async () => {
    deps.now = () => new Date("2026-11-17T10:00:00.000Z");
    const parked = "2026-11-17T09:00:00.000Z";
    const db = world(voice());
    const out = await STEPS.voice.run(db, harbor(), ctx({ rows: accounts({}, { own_dropped_at: parked }) }));
    expect(out).toMatchObject({ status: "done", result: { conforms: false, why: ["accounts"], names: 0, queued: jobKey(parked) } });
    expect(jobs(db)).toHaveLength(1);
    // Both facts at once are one rebuild.
    const both = world(voice({ overall: { summary: STARS, phrases: [] } }));
    expect(await STEPS.voice.run(both, harbor(), ctx({ rows: accounts({}, { own_dropped_at: parked }) }))).toMatchObject({ result: { why: ["names", "accounts"] } });
    expect(jobs(both)).toHaveLength(1);
  });

  it("queues one rebuild for a set of facts however often it looks, under a key a profile built today does not hold back", async () => {
    deps.now = () => new Date("2026-11-17T10:00:00.000Z");
    const today = "voice_profile:c1:2026-11-17";
    const db = world(voice({ overall: { summary: STARS, phrases: [] } }));
    db.tables.scheduled_jobs.push({ kind: "voice_profile", client_id: "c1", dedupe_key: today, status: "done" });
    await STEPS.voice.run(db, harbor(), ctx({ rows: accounts() }));
    // Still queued, or running: looked at again, nothing more is asked.
    expect(await STEPS.voice.run(db, harbor(), ctx({ rows: accounts() }))).toMatchObject({ status: "done", result: { conforms: false, queued: jobKey() } });
    db.tables.scheduled_jobs.find((j) => j.dedupe_key === jobKey())!.status = "running";
    await STEPS.voice.run(db, harbor(), ctx({ rows: accounts() }));
    expect(jobs(db).map((j) => j.dedupe_key)).toEqual([today, jobKey()]);
    // Once the job built the voice again, plain, the step finds nothing to fix and asks nothing more.
    const rebuilt = "2026-11-17T10:03:00.000Z";
    db.tables.scheduled_jobs.find((j) => j.dedupe_key === jobKey())!.status = "done";
    db.tables.clients[0].social_voice = voice({ built_at: rebuilt, rule: 1 });
    expect(await STEPS.voice.run(db, harbor({ voice_built_at: rebuilt }), ctx({ rows: accounts() }))).toEqual({ status: "done", result: { conforms: true, rule: 1, built_at: rebuilt } });
    expect(jobs(db)).toHaveLength(2);
  });

  // A rebuild sets off the trend profile and the content strategy. A voice that was built again and still holds a listed name must not start another.
  it("never builds a second time for the same facts: a rebuilt voice that still holds a listed name is corrected in code, with its date kept", async () => {
    deps.now = () => new Date("2026-11-17T10:10:00.000Z");
    const rebuilt = "2026-11-17T10:03:00.000Z";
    const stillHolds = voice({ built_at: rebuilt, rule: 1, overall: { summary: `Thanks ${STARS} often.`, phrases: [STARS, "thank you"] }, examples: { LinkedIn: [{ text: `Welcome ${STARS}.`, date: "2026-10-20", link: null, format: "image" }] } });
    const db = world(stillHolds, harbor({ voice_built_at: rebuilt }));
    db.tables.scheduled_jobs.push({ kind: "voice_profile", client_id: "c1", dedupe_key: jobKey(), status: "done" });
    const out = await STEPS.voice.run(db, harbor({ voice_built_at: rebuilt }), ctx({ rows: accounts() }));
    expect(out).toEqual({ status: "done", result: { conforms: true, rule: 1, built_at: rebuilt, why: ["names"], names: 1, corrected: 1, rebuilt: jobKey() } });
    // No second job, whatever its key would be.
    expect(jobs(db)).toHaveLength(1);
    const stored = db.tables.clients[0].social_voice as Record<string, unknown>;
    expect(stored).toEqual({ ...stillHolds, overall: { summary: "Thanks Dana Reed often.", phrases: ["Dana Reed", "thank you"] }, examples: { LinkedIn: [{ text: "Welcome Dana Reed.", date: "2026-10-20", link: null, format: "image" }] } });
    // The date it was built is as it was: nothing that keys on the voice runs.
    expect(stored.built_at).toBe(rebuilt);
    expect(JSON.stringify(stored)).not.toContain("★");
    // Looked at again, it conforms.
    expect(await STEPS.voice.run(db, harbor({ voice_built_at: rebuilt }), ctx({ rows: accounts() }))).toEqual({ status: "done", result: { conforms: true, rule: 1, built_at: rebuilt } });
    // The same when the one rebuild did not finish: no second one, and the names are corrected in what is stored.
    const failed = world(voice({ overall: { summary: STARS, phrases: [] } }));
    failed.tables.scheduled_jobs.push({ kind: "voice_profile", client_id: "c1", dedupe_key: jobKey(), status: "failed" });
    expect(await STEPS.voice.run(failed, harbor(), ctx({ rows: accounts() }))).toMatchObject({ status: "done", result: { conforms: true, corrected: 1 } });
    expect(jobs(failed)).toHaveLength(1);
    expect(JSON.stringify(failed.tables.clients[0].social_voice)).not.toContain("★");
  });

  it("asks for one more rebuild only when the facts themselves change: another listed name, or another account parked", async () => {
    deps.now = () => new Date("2026-11-17T10:10:00.000Z");
    const SPARKLE = { name: "Harbor Wax ✨", plain: "Harbor Wax" };
    const db = world(voice({ overall: { summary: "Harbor Wax ✨ is how it signs off.", phrases: [] } }));
    db.tables.scheduled_jobs.push({ kind: "voice_profile", client_id: "c1", dedupe_key: jobKey(), status: "done" });
    const out = await STEPS.voice.run(db, harbor(), ctx({ rows: accounts({}, { display_names: [LISTED, SPARKLE] }) }));
    expect(out).toMatchObject({ result: { conforms: false, why: ["names"], queued: jobKey("", LISTED, SPARKLE) } });
    expect(jobs(db).map((j) => j.dedupe_key)).toEqual([jobKey(), jobKey("", LISTED, SPARKLE)]);
  });

  it("waits, and queues nothing, when the accounts result or the voice is not there to read", async () => {
    expect(await STEPS.voice.run(world(voice()), harbor(), ctx({ rows: new Map() }))).toEqual({ status: "waiting", reason: "accounts" });
    const none = world(null);
    expect(await STEPS.voice.run(none, harbor(), ctx({ rows: accounts() }))).toEqual({ status: "waiting", reason: "voice" });
    expect(jobs(none)).toEqual([]);
  });
});

describe("calendar_recheck", () => {
  const BUILT = "2026-11-17T10:05:00.000Z";
  const NOW = new Date("2026-11-17T10:10:00.000Z");
  const NOTE = "Write these posts again from the client's own material.";
  const STARS = "Dana Reed ★★★★★";
  const fromTrend = [{ type: "trend", label: "x", evidence: [{ id: "N1", kind: "trend", text: "An outside caption", company: "@booksfast", theme: "Month-end in days" }], test: false }];
  const fromOwn = [{ type: "performance", label: "x", evidence: [{ id: "P1", kind: "own", text: "Our checklist" }], test: false }];
  const plan = (id: string, week_start: string, over: Record<string, unknown> = {}) => ({ id, client_id: "c1", week_start, status: "ready", ready_at: "2026-11-10T07:20:00.000Z", evidence: { items: [] }, revisions: [], pending_revision: null, ...over });
  const post = (id: string, plan_id: string | null, post_date: string, copy: string, reasons: unknown, over: Record<string, unknown> = {}) =>
    ({ id, client_id: "c1", post_key: `k-${id}`, plan_id, post_date, platform: "Instagram", format: "image", copy, cta: null, reasons, touched_at: null, story_of: null, ...over });
  const c = (over: Record<string, unknown> = {}) => client({ name: "Harbor Wax", voice_built_at: BUILT, timezone: "UTC", ...over });
  const rows = (accounts: Record<string, unknown> = {}) => rowsOf(row("voice"), row("accounts", { inputs_key: "name:harbor wax|site:|links:00000000|removed:00000000|own:1", result: { display_names: [{ name: STARS, plain: "Dana Reed" }], own_dropped_at: null, ...accounts } }));
  /** The database half: calendar_post_worked by key, and calendar_request_revision as the migration has it. */
  const world = (tables: Record<string, Record<string, unknown>[]>, worked: string[] = []) => dbWith({ scheduled_jobs: [], post_iterations: [], ...tables }, {
    calendar_post_worked: (args: { p_key: string }) => worked.includes(args.p_key),
    calendar_request_revision: (args: Record<string, unknown>, d: { tables: Record<string, Record<string, unknown>[]> }) => {
      const p = d.tables.calendar_plans.find((x) => x.id === args.p_plan);
      if (!p) throw new Error("No such plan.");
      if (p.pending_revision) throw new Error("This week is already being revised.");
      p.pending_revision = { note: args.p_note, by: args.p_user, at: "now", scope: args.p_scope };
      d.tables.scheduled_jobs.push({ kind: "week_revise", client_id: p.client_id, occurrence: p.week_start });
      return p;
    },
  });
  const asked = (db: ReturnType<typeof dbWith>) => db.rpcCalls.filter((r) => r.name === "calendar_request_revision").map((r) => r.args);

  it("waits for the voice step, and while a voice profile is on its way", async () => {
    const db = world({});
    expect(await STEPS.calendar_recheck.inputs(db, c({ voice_built_at: null }), rows())).toBeNull();
    expect(await STEPS.calendar_recheck.inputs(db, c(), rowsOf(row("accounts")))).toBeNull();
    // The accounts step's result is what names and dates are read from: with none standing, there is nothing to check by.
    expect(await STEPS.calendar_recheck.inputs(db, c(), rowsOf(row("voice"), row("accounts", { inputs_key: "x|own:1", status: "failed", result: null, error: "Sprout did not answer", attempts: 1 })))).toBeNull();
    expect(await STEPS.calendar_recheck.inputs(db, c(), rowsOf(row("voice"), row("accounts", { inputs_key: "from before the rule", result: { display_names: [] } })))).toBeNull();
    expect(await STEPS.calendar_recheck.inputs(db, c(), rowsOf(row("voice")))).toBeNull();
    for (const status of ["queued", "running"]) {
      const waiting = world({ scheduled_jobs: [{ id: "j1", kind: "voice_profile", client_id: "c1", status }] });
      expect(await STEPS.calendar_recheck.inputs(waiting, c(), rows())).toBeNull();
    }
    // A finished voice job, another client's, or another kind of job holds nothing.
    const free = world({ scheduled_jobs: [{ id: "j1", kind: "voice_profile", client_id: "c1", status: "done" }, { id: "j2", kind: "voice_profile", client_id: "other", status: "queued" }, { id: "j3", kind: "week_plan", client_id: "c1", status: "queued" }] });
    expect(await STEPS.calendar_recheck.inputs(free, c(), rows())).toBe(`rules:1|voice:${BUILT}|own:`);
  });

  it("keys on the copy rules, the voice and the time an own account was parked", async () => {
    const db = world({});
    const key = await STEPS.calendar_recheck.inputs(db, c(), rows());
    expect(await STEPS.calendar_recheck.inputs(db, c({ voice_built_at: "2026-12-01T08:00:00.000Z" }), rows())).toBe("rules:1|voice:2026-12-01T08:00:00.000Z|own:");
    expect(await STEPS.calendar_recheck.inputs(db, c(), rows({ own_dropped_at: "2026-11-17T09:00:00.000Z" }))).toBe(`rules:1|voice:${BUILT}|own:2026-11-17T09:00:00.000Z`);
    // Nothing the step writes is in its key.
    expect(await STEPS.calendar_recheck.inputs(world({ calendar_plans: [plan("p1", "2026-11-16", { pending_revision: { note: NOTE } })] }), c(), rows())).toBe(key);
  });

  it("corrects a decorated name in place, in a post a person worked on and in its design option, without marking it touched", async () => {
    deps.now = () => NOW;
    const db = world({
      calendar_plans: [plan("p1", "2026-11-16", { evidence: { rules: 1 } })],
      calendar_posts: [
        post("a", "p1", "2026-11-18", `Five years with ${STARS} at the front desk.`, fromOwn, { cta: `Say hi to ${STARS}`, touched_at: "2026-11-12T09:00:00.000Z" }),
        post("b", "p1", "2026-11-19", "Nothing to correct here.", fromOwn),
        post("s", "p1", "2026-11-18", `Five years with ${STARS} at the front desk.`, [{ type: "story", label: "One Story with each Instagram post." }], { format: "Story", story_of: "k-a" }),
        // A post that has gone out is not an upcoming post.
        post("past", "p1", "2026-11-16", `Yesterday with ${STARS}.`, fromOwn),
        { ...post("x", "px", "2026-11-18", `Another client's ${STARS}.`, fromOwn), client_id: "other" },
      ],
      post_iterations: [
        { id: "i1", client_id: "c1", calendar_post_key: "k-a", post_copy: `Five years with ${STARS} at the front desk.`, cta: `Say hi to ${STARS}` },
        { id: "i2", client_id: "c1", calendar_post_key: "k-b", post_copy: `An option that names ${STARS}.`, cta: null },
        { id: "i3", client_id: "c1", calendar_post_key: "k-b", post_copy: "A plain option.", cta: null },
        { id: "i4", client_id: "other", calendar_post_key: "k-a", post_copy: `Not this client's ${STARS}.`, cta: null },
      ],
    }, ["k-a"]);
    const out = await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows() }));
    expect(out).toEqual({ status: "done", result: { renamed: 4, asked: [], kept: 0 } });
    const byId = (table: string, id: string) => db.tables[table].find((r) => r.id === id)!;
    expect(byId("calendar_posts", "a")).toMatchObject({ copy: "Five years with Dana Reed at the front desk.", cta: "Say hi to Dana Reed", touched_at: "2026-11-12T09:00:00.000Z" });
    expect(byId("calendar_posts", "s")).toMatchObject({ copy: "Five years with Dana Reed at the front desk.", touched_at: null });
    expect(byId("calendar_posts", "b")).toMatchObject({ copy: "Nothing to correct here.", touched_at: null });
    expect(byId("calendar_posts", "past").copy).toBe(`Yesterday with ${STARS}.`);
    expect(byId("calendar_posts", "x").copy).toBe(`Another client's ${STARS}.`);
    expect(byId("post_iterations", "i1")).toMatchObject({ post_copy: "Five years with Dana Reed at the front desk.", cta: "Say hi to Dana Reed" });
    expect(byId("post_iterations", "i2").post_copy).toBe("An option that names Dana Reed.");
    expect(byId("post_iterations", "i4").post_copy).toBe(`Not this client's ${STARS}.`);
    // A corrected name is no revision: nothing is asked of the planner, and the plan is as it was.
    expect(asked(db)).toEqual([]);
    expect(db.tables.calendar_plans[0]).toMatchObject({ pending_revision: null, revisions: [] });
    expect(db.tables.scheduled_jobs).toEqual([]);
  });

  it("makes no write for a client whose account list has no decorated name", async () => {
    deps.now = () => NOW;
    const db = world({ calendar_plans: [plan("p1", "2026-11-16", { evidence: { rules: 1 } })], calendar_posts: [post("a", "p1", "2026-11-18", `Five years with ${STARS}.`, fromOwn)], post_iterations: [{ id: "i1", client_id: "c1", calendar_post_key: "k-a", post_copy: STARS, cta: null }] });
    const before = JSON.stringify(db.tables);
    expect(await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows({ display_names: [] }) }))).toEqual({ status: "done", result: { renamed: 0, asked: [], kept: 0 } });
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("asks one revision for each week that holds a post to write again, and none for a week whose only such posts were worked on", async () => {
    deps.now = () => NOW;
    const db = world({
      calendar_plans: [
        // This week, planned before the rules: one post from a trend nobody touched, one from the client's own post.
        plan("p1", "2026-11-16"),
        // Next week: its only post from a trend has a design; another one carries time codes but a person's revision rewrote it.
        plan("p2", "2026-11-23", { revisions: [{ note: "Warmer", by: "u1", at: "x", scope: "untouched", replaced: [{ id: "e", copy: "Old" }] }] }),
        // The week after: written under the current rules, nothing to do.
        plan("p3", "2026-11-30", { evidence: { rules: 1 } }),
        // Not ready, or over: never asked.
        plan("p4", "2026-12-07", { status: "planning" }), plan("p0", "2026-11-02"),
      ],
      calendar_posts: [
        post("a", "p1", "2026-11-18", "Borrowed from a trend.", fromTrend), post("b", "p1", "2026-11-19", "From our own checklist.", fromOwn),
        post("a2", "p1", "2026-11-20", "Also borrowed.", fromTrend),
        post("d", "p2", "2026-11-24", "Borrowed, then designed.", fromTrend), post("e", "p2", "2026-11-25", "0:00 Intro", fromOwn),
        post("f", "p3", "2026-12-01", "Written under the rules.", fromTrend),
        post("g", "p4", "2026-12-08", "Still being planned.", fromTrend),
        // A Story is never a reason to ask: it follows its post.
        post("st", "p3", "2026-12-01", "0:00 in a Story", fromTrend, { format: "Story", story_of: "k-f" }),
        // A post nobody planned (no plan) is nobody's to re-plan.
        post("h", null, "2026-11-21", "0:00 added by hand", fromTrend),
      ],
    }, ["k-d"]);
    const out = await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows({ display_names: [] }) }));
    expect(out).toEqual({ status: "done", result: { renamed: 0, asked: ["2026-11-16"], kept: 2 } });
    expect(asked(db)).toEqual([{ p_plan: "p1", p_note: NOTE, p_user: null, p_scope: "replan" }]);
    expect(db.tables.scheduled_jobs).toEqual([{ kind: "week_revise", client_id: "c1", occurrence: "2026-11-16" }]);
    // Asked of calendar_post_worked only for the posts with a reason to be written again.
    expect(db.rpcCalls.filter((r) => r.name === "calendar_post_worked").map((r) => r.args.p_key).sort()).toEqual(["k-a", "k-a2", "k-d", "k-e"]);
  });

  it("asks for every week planned before one of the client's own accounts was parked", async () => {
    deps.now = () => NOW;
    const db = world({
      calendar_plans: [plan("p1", "2026-11-16", { evidence: { rules: 1 } }), plan("p2", "2026-11-23", { evidence: { rules: 1 }, ready_at: "2026-11-17T09:30:00.000Z" })],
      calendar_posts: [post("a", "p1", "2026-11-18", "From our own checklist.", fromOwn), post("b", "p2", "2026-11-24", "Planned after the account was parked.", fromOwn)],
    });
    const out = await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows({ display_names: [], own_dropped_at: "2026-11-17T09:00:00.000Z" }) }));
    expect(out).toMatchObject({ status: "done", result: { asked: ["2026-11-16"] } });
  });

  it("answers waiting while a week with such posts is being revised, and asks once that revision is done", async () => {
    deps.now = () => NOW;
    const db = world({
      calendar_plans: [plan("p1", "2026-11-16", { pending_revision: { note: "Less formal", by: "u1", at: "x", scope: "untouched" } })],
      calendar_posts: [post("a", "p1", "2026-11-18", "Borrowed from a trend.", fromTrend)],
    });
    const out = await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows({ display_names: [] }) }));
    expect(out).toEqual({ status: "waiting", reason: "in_progress", recheckMinutes: 10, result: { renamed: 0, asked: [], kept: 0 } });
    expect(asked(db)).toEqual([]);
    // The person's revision finished and left the post as it was: now the week is asked for.
    db.tables.calendar_plans[0].pending_revision = null;
    expect(await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows({ display_names: [] }) }))).toMatchObject({ status: "done", result: { asked: ["2026-11-16"] } });
  });

  it("asks nothing on a second run: the week is being revised, and once the replan is done it is under the rules", async () => {
    deps.now = () => NOW;
    const db = world({ calendar_plans: [plan("p1", "2026-11-16")], calendar_posts: [post("a", "p1", "2026-11-18", "Borrowed from a trend.", fromTrend)] });
    expect(await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows({ display_names: [] }) }))).toMatchObject({ status: "done", result: { asked: ["2026-11-16"] } });
    // Run again at once: the revision it asked for is waiting.
    expect(await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows({ display_names: [] }) }))).toMatchObject({ status: "waiting", result: { asked: [] } });
    expect(asked(db)).toHaveLength(1);
    // The replan finished (runWeek.ts stamps the plan and records the revision).
    Object.assign(db.tables.calendar_plans[0], { pending_revision: null, evidence: { items: [], rules: 1 }, revisions: [{ scope: "replan", by: null, done_at: "2026-11-17T10:20:00.000Z", rewritten: 1 }] });
    expect(await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows({ display_names: [] }) }))).toEqual({ status: "done", result: { renamed: 0, asked: [], kept: 0 } });
    expect(asked(db)).toHaveLength(1);
  });

  it("counts a week a revision reached first as still to do, and never fails for it", async () => {
    deps.now = () => NOW;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = dbWith({ scheduled_jobs: [], post_iterations: [], calendar_plans: [plan("p1", "2026-11-16")], calendar_posts: [post("a", "p1", "2026-11-18", "Borrowed from a trend.", fromTrend)] }, {
      calendar_post_worked: () => false,
      calendar_request_revision: () => { throw new Error("This week is already being revised."); },
    });
    expect(await STEPS.calendar_recheck.run(db, c(), ctx({ rows: rows({ display_names: [] }) }))).toEqual({ status: "waiting", reason: "in_progress", recheckMinutes: 10, result: { renamed: 0, asked: [], kept: 0 } });
    expect(warn).toHaveBeenCalled();
  });
});
