// @vitest-environment node
// The plan for a client whose website is a page on another client's site
// (lifecycle/parentPage.ts): RivalIQ would take that client's company as this
// one's, so the plan is refused with a plain statement (spec: docs/superpowers/
// specs/2026-11-08-onboarding-profile-pages-and-no-n8n-design.md, section B).
import { describe, expect, it } from "vitest";
import { SetupError, setupPlan } from "./rivaliqSetupRun";
import { publicCompanyUrl } from "./rivaliqSetup";
import { fakeDb } from "../lifecycle/fakeDb";

const KITCASTER = "https://www.moburst.com/services/organic/podcast-booking/";
const tables = (client: { name: string; website_url: string }) => ({
  competitor_sets: [{ id: "set", client_id: "c", status: "confirmed" }],
  clients: [
    { id: "c", ...client, archived_at: null, demo_job_id: null },
    { id: "m", name: "Moburst", website_url: "https://www.moburst.com", archived_at: null, demo_job_id: null },
  ],
  competitors: ["one", "two", "three"].map((n, i) => ({ id: n, set_id: "set", name: n, website_url: `https://${n}.com`, is_selected: true, selected_rank: i + 1 })),
});
const reads = (db: ReturnType<typeof fakeDb>) => {
  const tablesRead: string[] = [];
  const from = db.from.bind(db);
  db.from = (t: string) => { tablesRead.push(t); return from(t); };
  return tablesRead;
};

describe("setupPlan for a page on another client's site", () => {
  it("refuses the plan, saying plainly whose site the page is on", async () => {
    const err = await setupPlan(fakeDb(tables({ name: "Kitcaster by Moburst", website_url: KITCASTER })), "set").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SetupError);
    expect(err).toMatchObject({ code: "selection", status: 422, message: "Kitcaster by Moburst's website is a page on Moburst's site, so RivalIQ cannot track it as its own company." });
    expect((err as Error).message).not.toMatch(/—|–|\b(add|paste|set)\b/i);
  });
  it("plans a plain-domain client exactly as before, reading no other client", async () => {
    const db = fakeDb(tables({ name: "Olo", website_url: "https://olo.com" }));
    const tablesRead = reads(db);
    expect(await setupPlan(db, "set")).toEqual({
      set_id: "set", client_id: "c", name: "Socialytics - Olo - set",
      companies: [{ id: "c", name: "Olo", url: publicCompanyUrl("https://olo.com") }, ...["one", "two", "three"].map((n) => ({ id: n, name: n, url: publicCompanyUrl(`https://${n}.com`) }))],
    });
    expect(tablesRead.filter((t) => t === "clients")).toEqual(["clients"]);
  });
});
