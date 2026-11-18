// A strategy-only client (no active account in Sprout) in the client
// lifecycle: every step up to its strategy is as for any client. The two
// that mend its calendar and steer its weekly trends wait until an account
// is connected, and first_output plans nothing and starts no report: it only
// asks for the voice profile the strategy is written in, as the client's
// first plan would have. The rule is the database's (client_strategy_only);
// the fake answers it as each test says.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { functionsDir } from "../../paths.ts";
import { deps, STEPS } from "../../../functions/_shared/lifecycle/steps";
import { fakeDb, writeClientRpc } from "../../../functions/_shared/lifecycle/fakeDb";
import { decide, type StepRow } from "../../../functions/_shared/lifecycle/policy";

const original = { ...deps };
afterEach(() => { Object.assign(deps, original); vi.restoreAllMocks(); });

const T = "2026-11-17T10:00:00.000Z";
const BUILT = "2026-11-17T10:05:00.000Z";
const NOW = new Date("2026-11-18T12:00:00Z");
const row = (step: string, patch: Partial<StepRow> = {}): StepRow => ({
  client_id: "c1", step, inputs_key: "k", status: "done", attempts: 0, attempted_at: T, done_at: T, next_attempt_at: null, result: {}, error: null, ...patch,
});
const rowsOf = (...r: StepRow[]) => new Map(r.map((x) => [x.step, x]));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = (over: Record<string, any> = {}) => ({
  id: "c1", name: "Harbor Lane", website_url: "https://harborlane.example/", field_sources: {}, timezone: "UTC", geo: "US", language: "en",
  brief_text: "A brief", content_pillars: [], social_keywords: [], primary_platforms: ["Instagram"], voice_built_at: BUILT, exclude_from_reporting: false, ...over,
});
const rows = () => rowsOf(
  row("brief_pillars"), row("voice"), row("trend_profile"),
  row("accounts", { inputs_key: "name:harbor lane|site:harborlane.example|links:00000000|removed:00000000|own:1", result: { display_names: [], own_dropped_at: null } }),
);
/** A world where the client is, or is not, strategy-only; `only.value` can change, as when an account is connected. */
function world(only: { value: boolean }) {
  return fakeDb({
    clients: [], calendar_plans: [], reports: [], report_schedules: [{ id: "s1", client_id: "c1" }, { id: "s2", client_id: "c1" }], scheduled_jobs: [],
    trend_profiles: [{ client_id: "c1", written_at: "2026-11-10T08:00:00.000Z" }],
  }, { lifecycle_write_client: writeClientRpc, client_strategy_only: (args: { p_client: string }) => args.p_client === "c1" && only.value });
}
const CLOSED = ["trend_hashtags", "calendar_recheck"] as const;
const FIRST_KEY = "week:2026-11-16|plans:00|voice:1|report:0|schedules:2";

describe("a strategy-only client in the lifecycle", () => {
  it.each(CLOSED)("%s waits: it has no input, so it is never due and never run", async (step) => {
    deps.now = () => NOW;
    const db = world({ value: true });
    const key = await STEPS[step].inputs(db, client(), rows());
    expect(key).toBeNull();
    expect(decide(null, key, STEPS[step].policy, NOW)).toMatchObject({ due: false, why: "no_input" });
    // Whatever the step stored before stays as it is, and is not run again either.
    expect(decide(row(step, { inputs_key: "from before" }), key, STEPS[step].policy, NOW).due).toBe(false);
    expect(db.rpcCalls.map((r) => r.name)).toEqual(["client_strategy_only"]);
  });

  it("the same three steps are keyed exactly as before for a client with an account in Sprout", async () => {
    deps.now = () => NOW;
    const db = world({ value: false });
    expect(await STEPS.trend_hashtags.inputs(db, client(), rows())).toBe("2026-11:2026-11-10T08:00:00.000Z");
    expect(await STEPS.first_output.inputs(db, client(), rows())).toBe(FIRST_KEY);
    expect(await STEPS.calendar_recheck.inputs(db, client(), rows())).toBe(`rules:1|voice:${BUILT}|own:`);
  });

  it("the moment it has an account, each of the three is due on the look that account sets off", async () => {
    deps.now = () => NOW;
    const only = { value: true };
    const db = world(only);
    for (const step of CLOSED) expect(await STEPS[step].inputs(db, client(), rows())).toBeNull();
    const before = await STEPS.first_output.inputs(db, client(), rows());
    only.value = false;
    // first_output ran for the strategy-only client under a key of its own, so its full run is due at once.
    const after = await STEPS.first_output.inputs(db, client(), rows());
    expect(after).toBe(FIRST_KEY);
    expect(decide(row("first_output", { inputs_key: before }), after, STEPS.first_output.policy, NOW)).toMatchObject({ due: true, why: "inputs_changed" });
    for (const step of CLOSED) {
      const key = await STEPS[step].inputs(db, client(), rows());
      expect(key).not.toBeNull();
      // Never run for this client, or last run on other inputs: due either way.
      expect(decide(null, key, STEPS[step].policy, NOW)).toMatchObject({ due: true, why: "new" });
      expect(decide(row(step, { inputs_key: "from before" }), key, STEPS[step].policy, NOW)).toMatchObject({ due: true, why: "inputs_changed" });
    }
  });

  describe("first_output", () => {
    const given = (only: { value: boolean }, calls: string[]) => fakeDb({ clients: [], calendar_plans: [], reports: [], report_schedules: [], scheduled_jobs: [] }, {
      client_strategy_only: () => only.value,
      voice_profile_request: (args: { p_client: string }) => { calls.push(`voice ${args.p_client}`); return true; },
      lifecycle_first_output: (args: { p_client: string }) => { calls.push(`first output ${args.p_client}`); return { week: "2026-11-16", weeks_requested: ["2026-11-16", "2026-11-23"], first_report: "started" }; },
    });
    const ctx = { force: false, previous: null, rows: new Map<string, StepRow>() };

    it("is keyed for a strategy-only client by the week and its voice, never by plans, reports or schedules", async () => {
      deps.now = () => NOW;
      const db = world({ value: true });
      expect(await STEPS.first_output.inputs(db, client(), rows())).toBe("strategy_only|week:2026-11-16|voice:1");
      expect(await STEPS.first_output.inputs(db, client({ voice_built_at: null }), rows())).toBe("strategy_only|week:2026-11-16|voice:0");
      // The following Monday it is due again, as the Monday plan would have asked for the voice profile again.
      deps.now = () => new Date("2026-11-23T08:00:00Z");
      expect(await STEPS.first_output.inputs(db, client(), rows())).toBe("strategy_only|week:2026-11-23|voice:1");
      // It still waits for what it always waited for.
      expect(await STEPS.first_output.inputs(db, client({ exclude_from_reporting: true }), rows())).toBeNull();
      expect(await STEPS.first_output.inputs(db, client(), rowsOf(row("brief_pillars")))).toBeNull();
    });

    it("plans nothing and starts no report for a strategy-only client: it asks only for the voice profile the strategy is written in", async () => {
      const calls: string[] = [];
      const out = await STEPS.first_output.run(given({ value: true }, calls), client(), ctx);
      expect(out).toEqual({ status: "done", result: { strategy_only: true, voice_requested: true } });
      expect(calls).toEqual(["voice c1"]);
    });

    it("runs in full, as before, for a client in Sprout and for the same client once it has an account", async () => {
      const calls: string[] = [];
      const only = { value: true };
      const db = given(only, calls);
      await STEPS.first_output.run(db, client(), ctx);
      only.value = false;
      const out = await STEPS.first_output.run(db, client(), ctx);
      expect(out).toEqual({ status: "done", result: { week: "2026-11-16", weeks_requested: ["2026-11-16", "2026-11-23"], first_report: "started" } });
      expect(calls).toEqual(["voice c1", "first output c1"]);
    });

    it("a client whose last account went between the look and the run gets no plan either", async () => {
      const calls: string[] = [];
      const out = await STEPS.first_output.run(given({ value: true }, calls), client(), { ...ctx, previous: row("first_output", { inputs_key: FIRST_KEY }) });
      expect(out.status).toBe("done");
      expect(calls).not.toContain("first output c1");
    });
  });

  it("the question is asked last, so a step that waits for something else never asks it", async () => {
    deps.now = () => NOW;
    const db = world({ value: true });
    expect(await STEPS.first_output.inputs(db, client({ exclude_from_reporting: true }), rows())).toBeNull();
    expect(await STEPS.first_output.inputs(db, client(), rowsOf(row("brief_pillars")))).toBeNull();
    expect(await STEPS.calendar_recheck.inputs(db, client({ voice_built_at: null }), rows())).toBeNull();
    expect(await STEPS.trend_hashtags.inputs(db, client(), rowsOf(row("brief_pillars")))).toBeNull();
    expect(db.rpcCalls).toEqual([]);
  });

  it("no other step asks whether the client is strategy-only: the strategy is written for every client", () => {
    const source = readFileSync(join(functionsDir, "_shared", "lifecycle", "steps.ts"), "utf8");
    const asks = [...source.matchAll(/^ {2}([a-z_]+): \{$|isStrategyOnly\(db, client\.id\)/gm)];
    const asking: string[] = [];
    let step = "";
    for (const m of asks) {
      if (m[1]) step = m[1];
      else asking.push(step);
    }
    // first_output asks twice: when it is keyed, and again when it runs.
    expect(asking).toEqual(["trend_hashtags", "first_output", "first_output", "calendar_recheck"]);
    for (const kept of ["website", "brand_read", "brief_pillars", "accounts", "competitors", "trend_profile", "content_strategy", "tracking"]) {
      expect(Object.keys(STEPS)).toContain(kept);
      expect(asking).not.toContain(kept);
    }
  });
});
