// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { ApifyClient, ApifyRun } from "../../../functions/_shared/apify/client";
import { bioFromItem, INSTAGRAM_PROFILE_ACTOR, readInstagramBio } from "../../../functions/_shared/apify/instagramProfile";

const ITEM = { username: "olo.hq", fullName: "Olo", biography: "Order ahead. Austin, TX", externalUrl: "https://olo.com/start", externalUrls: [{ url: "https://olo.com/start" }, { url: "https://olo.com/careers" }], businessCategoryName: "Software" };

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
const run = (status: ApifyRun["status"], id = "r1"): ApifyRun => ({ id, status, defaultDatasetId: `ds-${id}`, usageTotalUsd: 0.0026 });

describe("bioFromItem", () => {
  it("reads the bio and its links, for the handle asked about only", () => {
    expect(bioFromItem(ITEM, "@Olo.HQ")).toEqual({ handle: "Olo.HQ", biography: "Order ahead. Austin, TX", links: ["https://olo.com/start", "https://olo.com/careers"], full_name: "Olo", category: "Software" });
    expect(bioFromItem({ ...ITEM, username: "someone" }, "olo.hq")).toBeNull();
    expect(bioFromItem({ username: "olo.hq" }, "olo.hq")).toBeNull();
  });
});

describe("readInstagramBio", () => {
  it("starts one run of the profile actor for the username, waits up to a minute, and reads its dataset", async () => {
    const { apify, calls } = fake([run("READY"), run("SUCCEEDED")]);
    expect(await readInstagramBio(apify, "olo.hq")).toMatchObject({ state: "read", run_id: "r1", usd: 0.0026, bio: { biography: "Order ahead. Austin, TX" } });
    expect(calls).toEqual([`start ${INSTAGRAM_PROFILE_ACTOR.id} {"usernames":["olo.hq"]} 120`, "get r1 60", "items ds-r1"]);
  });
  it("keeps a run still going by its id, and reads that run on the next look without starting another", async () => {
    const first = fake([run("READY"), run("RUNNING")]);
    expect(await readInstagramBio(first.apify, "olo.hq")).toEqual({ state: "pending", run_id: "r1" });
    const next = fake([run("SUCCEEDED")]);
    expect(await readInstagramBio(next.apify, "olo.hq", { runId: "r1" })).toMatchObject({ state: "read", bio: { handle: "olo.hq" } });
    expect(next.calls.some((c) => c.startsWith("start"))).toBe(false);
  });
  it("answers a run that did not succeed as failed, without reading anything", async () => {
    const { apify, calls } = fake([run("READY"), run("FAILED")]);
    expect(await readInstagramBio(apify, "olo.hq")).toEqual({ state: "failed", run_id: "r1", status: "FAILED" });
    expect(calls.some((c) => c.startsWith("items"))).toBe(false);
  });
});
