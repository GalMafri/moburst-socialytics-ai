// @vitest-environment node
// A page on another client's site is used for text only (spec:
// docs/superpowers/specs/2026-11-08-onboarding-profile-pages-and-no-n8n-
// design.md, section B): Kitcaster's LinkedIn page states a page on
// moburst.com, the website of Moburst, another client.
import { describe, expect, it } from "vitest";
import { isParentPage, otherClientSites, parentPageFor } from "./parentPage";
import { fakeDb } from "./fakeDb";

const KITCASTER = "https://www.moburst.com/services/organic/podcast-booking/";

describe("isParentPage", () => {
  it("is a page with a path on another client's site", () => {
    expect(isParentPage(KITCASTER, ["https://www.moburst.com"])).toBe(true);
    expect(isParentPage(KITCASTER, ["https://moburst.com/"])).toBe(true);
    expect(isParentPage("moburst.com/services/organic/podcast-booking", ["https://www.moburst.com"])).toBe(true);
  });
  it("is never a site's homepage, a subdomain of its own included (Review Focus 5)", () => {
    expect(isParentPage("https://uproar.moburst.com/", ["https://www.moburst.com"])).toBe(false);
    expect(isParentPage("https://olo.com", ["https://www.moburst.com"])).toBe(false);
    expect(isParentPage("https://www.moburst.com/", ["https://www.moburst.com"])).toBe(false);
  });
  it("is a page on the site another client stands for: a subdomain client owns its host only", () => {
    // No client owns moburst.com here: Uproar's site is uproar.moburst.com alone.
    expect(isParentPage(KITCASTER, ["https://uproar.moburst.com/"])).toBe(false);
    expect(isParentPage("https://uproar.moburst.com/press", ["https://uproar.moburst.com/"])).toBe(true);
    // A plain-domain client owns its subdomains as well.
    expect(isParentPage("https://careers.moburst.com/jobs", ["https://www.moburst.com"])).toBe(true);
  });
  it("is a page only under a client that sits above it, by a strict path prefix (fix round 1)", () => {
    // Kitcaster's page sits under Moburst's homepage.
    expect(isParentPage(KITCASTER, ["https://www.moburst.com/"])).toBe(true);
    // A client stored as www.moburst.com/en/ is under nobody below or beside it, and Kitcaster is not under /en/.
    expect(isParentPage("https://www.moburst.com/en/", [KITCASTER])).toBe(false);
    expect(isParentPage(KITCASTER, ["https://www.moburst.com/en/"])).toBe(false);
    // Under /en/ when a page sits below it; /en/ itself under a homepage above it.
    expect(isParentPage("https://www.moburst.com/en/podcasts/", ["https://www.moburst.com/en/"])).toBe(true);
    expect(isParentPage("https://www.moburst.com/en/", ["https://www.moburst.com/"])).toBe(true);
    // Two pages side by side on a domain no client owns mark neither.
    expect(isParentPage("https://example.com/x", ["https://example.com/y"])).toBe(false);
    expect(isParentPage("https://example.com/y", ["https://example.com/x"])).toBe(false);
    // The same page is not under itself, and a segment counts whole ("/x" is not above "/xy/z").
    expect(isParentPage("https://example.com/x", ["https://example.com/x/"])).toBe(false);
    expect(isParentPage("https://example.com/xy/z", ["https://example.com/x"])).toBe(false);
  });
  it("is false for a page on a site no other client has, and for nothing", () => {
    expect(isParentPage("https://lega.bot/en/", ["https://www.moburst.com", null, ""])).toBe(false);
    expect(isParentPage(KITCASTER, [])).toBe(false);
    expect(isParentPage(null, ["https://www.moburst.com"])).toBe(false);
    expect(isParentPage("not a site", ["https://www.moburst.com"])).toBe(false);
  });
});

describe("otherClientSites", () => {
  it("reads the websites of the other active clients, never an archived client or a demo copy", async () => {
    const db = fakeDb({
      clients: [
        { id: "k", website_url: KITCASTER, archived_at: null, demo_job_id: null },
        { id: "m", website_url: "https://www.moburst.com", archived_at: null, demo_job_id: null },
        { id: "u", website_url: "https://uproar.moburst.com/", archived_at: null, demo_job_id: null },
        { id: "a", website_url: "https://archived.example", archived_at: "2026-10-01T00:00:00Z", demo_job_id: null },
        { id: "d", website_url: "https://demo.example", archived_at: null, demo_job_id: "j1" },
        { id: "n", website_url: null, archived_at: null, demo_job_id: null },
      ],
    });
    expect((await otherClientSites(db, "k")).sort()).toEqual(["https://uproar.moburst.com/", "https://www.moburst.com"]);
  });
  it("says so when the clients cannot be read", async () => {
    const db = { from: () => ({ select: () => ({ is: () => ({ is: () => ({ neq: () => ({ not: async () => ({ data: null, error: { message: "down" } }) }) }) }) }) }) };
    await expect(otherClientSites(db, "k")).rejects.toThrow("Could not read the other clients' websites: down");
  });
});

describe("parentPageFor", () => {
  const clients = [
    { id: "k", website_url: KITCASTER, archived_at: null, demo_job_id: null },
    { id: "m", website_url: "https://www.moburst.com", archived_at: null, demo_job_id: null },
  ];
  it("is true for a client whose website is a page on another client's site", async () => {
    expect(await parentPageFor(fakeDb({ clients }), { id: "k", website_url: KITCASTER })).toBe(true);
    // Moburst's own homepage is its site, whatever pages other clients have on it.
    expect(await parentPageFor(fakeDb({ clients }), { id: "m", website_url: "https://www.moburst.com" })).toBe(false);
  });
  it("marks neither a client stored on a page of its own site nor a client beside it", async () => {
    const two = [
      { id: "k", website_url: KITCASTER, archived_at: null, demo_job_id: null },
      { id: "m", website_url: "https://www.moburst.com/en/", archived_at: null, demo_job_id: null },
    ];
    expect(await parentPageFor(fakeDb({ clients: two }), { id: "m", website_url: "https://www.moburst.com/en/" })).toBe(false);
    expect(await parentPageFor(fakeDb({ clients: two }), { id: "k", website_url: KITCASTER })).toBe(false);
  });
  it("reads no client for a website with no path, so a site of its own costs nothing (Review Focus 5)", async () => {
    const db = { from: () => { throw new Error("no read expected"); } };
    expect(await parentPageFor(db, { id: "o", website_url: "https://olo.com" })).toBe(false);
    expect(await parentPageFor(db, { id: "u", website_url: "https://uproar.moburst.com/" })).toBe(false);
    expect(await parentPageFor(db, { id: "x", website_url: null })).toBe(false);
  });
});
