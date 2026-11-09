// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ApifyClient, ApifyRun } from "../../../functions/_shared/apify/client";
import { LINKEDIN_PAGE_ACTOR, pageFromItem, pageUrlOf, readLinkedInPage } from "../../../functions/_shared/apify/linkedinPage";

const URL = "https://www.linkedin.com/company/kitcaster-by-moburst/";
const ITEM = {
  universalName: "kitcaster-by-moburst",
  name: "Kitcaster by Moburst",
  website: "https://www.moburst.com/services/organic/podcast-booking/",
  description: "Kitcaster by Moburst is the podcast booking division. " + "x".repeat(4000),
  tagline: "Strategic podcast booking...",
  specialities: ["podcast", "marketing"],
  industries: [{ name: "Marketing Services" }],
  logo: "https://media.licdn.com/small.png",
  logos: [{ url: "https://media.licdn.com/a.png", width: 400, height: 400 }],
  locations: [
    { headquarter: false, city: "Tel Aviv", country: "IL" },
    { headquarter: true, city: "New York", geographicArea: "NY", country: "US", postalCode: "10001", line1: "1 Main St" },
  ],
};

function fake(runs: ApifyRun[], items: unknown[] = [ITEM]) {
  const calls: string[] = [];
  const apify: ApifyClient = {
    async startRun(actor, input, opts) { calls.push(`start ${actor} ${JSON.stringify(input)} ${opts.timeoutSecs}`); return runs.shift()!; },
    async getRun(id, opts = {}) { calls.push(`get ${id} ${opts.waitSecs ?? 0}`); return runs.shift()!; },
    async datasetPage() { return items; },
    async datasetItems(id) { calls.push(`items ${id}`); return items; },
  };
  return { apify, calls };
}
const run = (status: ApifyRun["status"], id = "r1"): ApifyRun => ({ id, status, defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.004 });

describe("pageUrlOf", () => {
  it("builds the company page address from its native name", () => {
    expect(pageUrlOf("uproar-by-moburst")).toBe("https://www.linkedin.com/company/uproar-by-moburst/");
  });
});

describe("pageFromItem", () => {
  it("reads the website unchanged, clips the about text, and takes the largest logo and the headquarters", () => {
    const page = pageFromItem(ITEM, URL)!;
    expect(page.url).toBe(URL);
    expect(page.name).toBe("Kitcaster by Moburst");
    expect(page.website).toBe("https://www.moburst.com/services/organic/podcast-booking/");
    expect(page.about).toHaveLength(3000);
    expect(page.tagline).toBe("Strategic podcast booking...");
    expect(page.specialties).toEqual(["podcast", "marketing"]);
    expect(page.industries).toEqual(["Marketing Services"]);
    expect(page.logo).toEqual({ url: "https://media.licdn.com/a.png", width: 400, height: 400 });
    expect(page.headquarters).toEqual({ line1: "1 Main St", city: "New York", region: "NY", postalCode: "10001", country: "US" });
  });
  it("prefers the largest of several logos, and falls back to the single logo with no size", () => {
    const logos = [{ url: "s.png", width: 100, height: 100 }, { url: "l.png", width: 800, height: 800 }];
    expect(pageFromItem({ ...ITEM, logos }, URL)!.logo).toEqual({ url: "l.png", width: 800, height: 800 });
    expect(pageFromItem({ ...ITEM, logos: undefined }, URL)!.logo).toEqual({ url: "https://media.licdn.com/small.png", width: null, height: null });
  });
  it("takes the first location when none is marked as the headquarters, and none when there are no locations", () => {
    const locations = [{ city: "Tel Aviv", country: "IL" }];
    expect(pageFromItem({ ...ITEM, locations }, URL)!.headquarters).toMatchObject({ city: "Tel Aviv", country: "IL", line1: null });
    expect(pageFromItem({ ...ITEM, locations: [] }, URL)!.headquarters).toBeNull();
  });
  it("returns null for another company's page", () => {
    expect(pageFromItem({ ...ITEM, universalName: "someone-else" }, URL)).toBeNull();
  });
  it("returns null when it has no website, no description and no logo", () => {
    expect(pageFromItem({ universalName: "kitcaster-by-moburst", name: "Kitcaster" }, URL)).toBeNull();
    expect(pageFromItem(null, URL)).toBeNull();
  });
});

describe("readLinkedInPage", () => {
  it("starts one run for the page address, waits up to a minute, and reads its dataset", async () => {
    const { apify, calls } = fake([run("READY"), run("SUCCEEDED")]);
    expect(await readLinkedInPage(apify, URL)).toMatchObject({ state: "read", run_id: "r1", usd: 0.004, page: { name: "Kitcaster by Moburst" } });
    expect(calls).toEqual([`start ${LINKEDIN_PAGE_ACTOR.id} {"companies":["${URL}"]} 120`, "get r1 60", "items ds-r1"]);
  });
  it("answers a run still going as pending, and reads that run later without starting another", async () => {
    const first = fake([run("READY"), run("RUNNING")]);
    expect(await readLinkedInPage(first.apify, URL)).toEqual({ state: "pending", run_id: "r1" });
    const next = fake([run("SUCCEEDED")]);
    expect(await readLinkedInPage(next.apify, URL, { runId: "r1" })).toMatchObject({ state: "read", page: { url: URL } });
    expect(next.calls.some((c) => c.startsWith("start"))).toBe(false);
  });
  it("answers a run that did not succeed as failed, without reading anything", async () => {
    const { apify, calls } = fake([run("READY"), run("FAILED")]);
    expect(await readLinkedInPage(apify, URL)).toEqual({ state: "failed", run_id: "r1", status: "FAILED" });
    expect(calls.some((c) => c.startsWith("items"))).toBe(false);
  });
});
