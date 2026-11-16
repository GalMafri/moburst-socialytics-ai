// @vitest-environment node
// A kit claim belongs to the job that made it: when that job has ended (failed
// on refused picture calls, was canceled, finished without storing the kit)
// the next job takes the kit over at once, with the dead job's pick, outcomes
// and paid edits, instead of waiting out the claim and paying again.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// steps.ts reads Deno.env when it loads and imports Deno's base64 by URL, which the test runner cannot load; the kit step uses neither.
vi.hoisted(() => { (globalThis as { Deno?: unknown }).Deno = { env: { get: () => undefined } }; });
vi.mock("https://deno.land/std@0.168.0/encoding/base64.ts", () => ({ decode: () => new Uint8Array(), encode: () => "" }));
import { KIT_MAKE_MS, kitHolderOf, kitTakenOver } from "../../../functions/_shared/video/kit";
import { runKitStep, type VideoJob } from "../../../functions/_shared/video/steps";

const NOW = Date.parse("2026-11-12T10:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("kitHolderOf", () => {
  it("names another job's fresh claim, and nothing for a lapsed, own or missing one", () => {
    expect(kitHolderOf({ kit_started_at: ago(60_000), kit_job: "dead" }, NOW, "me")).toBe("dead");
    expect(kitHolderOf({ kit_started_at: ago(KIT_MAKE_MS + 1), kit_job: "dead" }, NOW, "me")).toBeNull();
    expect(kitHolderOf({ kit_started_at: ago(60_000), kit_job: "me" }, NOW, "me")).toBeNull();
    expect(kitHolderOf({ kit_started_at: null, kit_job: null }, NOW, "me")).toBeNull();
    expect(kitHolderOf(undefined, NOW, "me")).toBeNull();
  });
});

describe("kitTakenOver", () => {
  const held = { kit_of: "m1", kit_pick: ["a", "b", "c"], kit_done: { "0": { path: "c1/style/kit-0.jpg" }, "1": { dropped: true }, x: 1 }, kit_edits: { "2-1": "c1/style/kit-2-edit-1.png", "2-2": 5 }, kit_tries: 3, kit_errors: ["boom"] };

  it("takes the pick, the outcomes and the paid edits of the same style, and none of its tries or errors", () => {
    const out = kitTakenOver({ kit_of: "m1", kit_tries: 0 }, held, "m1");
    expect(out).toEqual({ kit_of: "m1", kit_tries: 0, kit_pick: ["a", "b", "c"], kit_done: { "0": { path: "c1/style/kit-0.jpg" }, "1": { dropped: true } }, kit_edits: { "2-1": "c1/style/kit-2-edit-1.png" } });
  });

  it("leaves the job's own pick, a pick of another style, and a holder with none, as they are", () => {
    const own = { kit_of: "m1", kit_pick: ["z"] };
    expect(kitTakenOver(own, held, "m1")).toBe(own);
    const fresh = { kit_of: "m2" };
    expect(kitTakenOver(fresh, held, "m2")).toBe(fresh);
    expect(kitTakenOver(fresh, { kit_of: "m2" }, "m2")).toBe(fresh);
    expect(kitTakenOver(fresh, null, "m2")).toBe(fresh);
  });
});

/** An admin client with the client's video style, the claim holder's row, and a record of the claim. */
function world(holder: { status: string; state: unknown } | null, started = ago(60_000)) {
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const style = { made_at: "m1", frames: ["f0", "f1", "f2"], kit_started_at: started, kit_job: "dead-job" };
  // deno-lint-ignore no-explicit-any
  const query = (table: string): any => {
    // deno-lint-ignore no-explicit-any
    const q: any = {};
    for (const op of ["select", "eq", "in", "update"]) q[op] = () => q;
    q.maybeSingle = async () => ({ data: table === "clients" ? { name: "Bader", video_style: style } : holder, error: null });
    q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
    return q;
  };
  const admin = {
    from: query,
    rpc: async (name: string, args: Record<string, unknown>) => { rpcs.push({ name, args }); return { data: name === "video_style_claim_kit" || name === "video_style_take_kit" ? true : null, error: null }; },
  };
  const job = { id: "me", client_id: "c1", step: "kit", state: {}, input: { brand_name: "Bader" } } as unknown as VideoJob;
  return { admin, job, rpcs };
}

describe("the kit step with a claim held by another job", () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); });

  const dead = { status: "failed", state: { kit_of: "m1", kit_pick: ["f0", "f1", "f2"], kit_done: { "0": { path: "c1/style/kit-0.jpg" }, "1": { path: "c1/style/kit-1.jpg" }, "2": { dropped: true } }, kit_edits: {} } };

  it("claims at once when the holder failed, and goes on from the holder's kept work", async () => {
    const w = world(dead);
    expect(await runKitStep(w.admin, w.job, "video")).toBe("next");
    const claim = w.rpcs.find((r) => r.name === "video_style_take_kit");
    expect(claim?.args).toMatchObject({ p_client: "c1", p_job: "me", p_ended: expect.any(String) });
    expect(w.rpcs.some((r) => r.name === "video_style_claim_kit")).toBe(false);
    expect(w.job.state).toMatchObject({ kit_pick: ["f0", "f1", "f2"], kit_done: { "0": { path: "c1/style/kit-0.jpg" } } });
    // Every still was already done: the kit is stored from them, with nothing paid again.
    expect(w.rpcs.find((r) => r.name === "video_style_merge")?.args).toMatchObject({ p_patch: { kit: ["c1/style/kit-0.jpg", "c1/style/kit-1.jpg"] } });
  });

  it("claims at once when the holder's row is gone", async () => {
    const w = world(null);
    await runKitStep(w.admin, w.job, "video");
    expect(w.rpcs.find((r) => r.name === "video_style_take_kit")?.args).toMatchObject({ p_job: "me" });
  });

  it("waits for a holder that is still at work, and claims nothing", async () => {
    for (const status of ["queued", "running"]) {
      const w = world({ status, state: {} });
      expect(await runKitStep(w.admin, w.job, "video")).toBe("wait");
      expect(w.rpcs).toEqual([]);
    }
  });

  it("claims as before when the claim lapsed", async () => {
    const w = world({ status: "running", state: {} }, ago(KIT_MAKE_MS + 1));
    await runKitStep(w.admin, w.job, "video");
    expect(w.rpcs.find((r) => r.name === "video_style_claim_kit")?.args).toMatchObject({ p_stale: `${KIT_MAKE_MS / 1000} seconds` });
  });

  it("a job already waiting for the kit moves back to claiming when the holder ended", async () => {
    const w = world(dead);
    w.job.step = "kit_wait";
    expect(await runKitStep(w.admin, w.job, "video")).toBe("next");
    expect(w.job.step).toBe("kit");
  });
});
