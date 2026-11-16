// @vitest-environment node
// runActorStep: an Apify account that refuses the token (401, 402, 403) waits
// quietly like a missing token does, so no try is spent and no run is marked
// failed; the step looks again once the account answers.
import { describe, expect, it } from "vitest";
import { apifyClient, ApifyError, ApifyTokenRefused, type ApifyClient } from "../../../functions/_shared/apify/client";
import { runActorStep, TOKEN_WAIT_SECONDS } from "../../../functions/_shared/pipelines/apifyStep";
import type { StepContext } from "../../../functions/_shared/pipelines/types";

function ctx(over: Partial<StepContext> = {}): StepContext {
  return {
    run: {}, step: "scrape", attempt: 1, state: {}, poll: null,
    now: () => new Date("2026-11-12T07:00:00Z"), signal: new AbortController().signal, deadline: new Date("2026-11-12T07:05:00Z"),
    payloads: { put: async () => undefined, get: async () => null }, output: {}, db: {}, env: (n: string) => (n === "APIFY_API_TOKEN" ? "tok" : undefined),
    ...over,
  } as unknown as StepContext;
}
const request = (apify: () => ApifyClient) => ({ actor: { id: "a", name: "A" }, input: {}, datasetKey: "k", apify });
const refusing = (status: number): ApifyClient => ({
  async startRun() { throw new ApifyTokenRefused(`Apify POST /acts/a/runs answered ${status}`, status); },
  async getRun() { throw new ApifyTokenRefused(`Apify GET /actor-runs/r answered ${status}`, status); },
  async datasetPage() { return []; },
  async datasetItems() { return []; },
});

describe("runActorStep with a refused token", () => {
  for (const status of [401, 402, 403]) {
    it(`waits and looks again when a start answers ${status}`, async () => {
      const step = await runActorStep(ctx(), request(() => refusing(status)));
      expect(step.type).toBe("wait");
      if (step.type === "wait") expect(step.result).toMatchObject({ type: "poll", waitSeconds: TOKEN_WAIT_SECONDS, waitingFor: "APIFY_API_TOKEN" });
    });
  }

  it("waits when a look at a started run is refused, and keeps that run so the next look reads it and never starts a second one", async () => {
    const step = await runActorStep(ctx({ poll: { handle: { apify_run_id: "r1" }, polls: 1, since: "x" } as never }), request(() => refusing(401)));
    expect(step.type).toBe("wait");
    if (step.type !== "wait" || step.result.type !== "poll") throw new Error("expected a poll");
    expect(step.result.handle).toMatchObject({ waiting_for: "APIFY_API_TOKEN", apify_run_id: "r1" });
    expect(step.result.waitingFor).toBe("APIFY_API_TOKEN");

    const calls: string[] = [];
    const accepting: ApifyClient = {
      async startRun() { calls.push("start"); return { id: "r2", status: "RUNNING", defaultDatasetId: "d" }; },
      async getRun(id) { calls.push(`get:${id}`); return { id, status: "RUNNING", defaultDatasetId: "d" }; },
      async datasetPage() { return []; },
      async datasetItems() { return []; },
    };
    const next = await runActorStep(ctx({ poll: { handle: step.result.handle, polls: 2, since: "x" } as never }), request(() => accepting));
    expect(calls).toEqual(["get:r1"]);
    expect(next.type).toBe("wait");
  });

  it("keeps a started run when the token itself has gone missing", async () => {
    const step = await runActorStep(
      ctx({ poll: { handle: { apify_run_id: "r1" }, polls: 1, since: "x" } as never, env: () => undefined }),
      request(() => refusing(401)),
    );
    if (step.type !== "wait" || step.result.type !== "poll") throw new Error("expected a poll");
    expect(step.result.handle).toMatchObject({ apify_run_id: "r1" });
  });

  it("still throws every other Apify error", async () => {
    const broken: ApifyClient = { ...refusing(401), async startRun() { throw new ApifyError("Apify answered 500", 500); } };
    await expect(runActorStep(ctx(), request(() => broken))).rejects.toThrow("500");
  });
});

describe("apifyClient answers", () => {
  const answer = (status: number, type?: string) =>
    apifyClient({ token: "tok", retries: 0, fetchImpl: async () => new Response(type ? JSON.stringify({ error: { type, message: "no" } }) : "no", { status }) });
  it("names a refused token apart from other errors, and never retries it", async () => {
    await expect(answer(401).startRun("a", {}, {})).rejects.toBeInstanceOf(ApifyTokenRefused);
    await expect(answer(402, "not-enough-usage-to-run-paid-actor").startRun("a", {}, {})).rejects.toBeInstanceOf(ApifyTokenRefused);
    await expect(answer(403, "user-or-token-not-found").startRun("a", {}, {})).rejects.toBeInstanceOf(ApifyTokenRefused);
    await expect(answer(404).startRun("a", {}, {})).rejects.not.toBeInstanceOf(ApifyTokenRefused);
  });
  it("keeps a 403 for one actor an ordinary error, so only that platform fails", async () => {
    for (const type of ["insufficient-permissions", "actor-is-not-rented", undefined]) {
      const e = await answer(403, type).startRun("a", {}, {}).catch((x) => x);
      expect(e).toBeInstanceOf(ApifyError);
      expect(e).not.toBeInstanceOf(ApifyTokenRefused);
      expect(e.status).toBe(403);
    }
  });
});
