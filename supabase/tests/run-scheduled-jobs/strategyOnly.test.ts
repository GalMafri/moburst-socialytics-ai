// @vitest-environment node
// Queued work for a strategy-only client (no active account in Sprout) ends
// quietly: a plan, a revision or a trends collection is skipped unrun, and
// every other job runs as it always did.
import { describe, expect, it, vi } from "vitest";
import { CLOSED_KINDS, runUnlessStrategyOnly } from "../../functions/run-scheduled-jobs/strategyOnly";
import type { JobOutcome, ScheduledJob } from "../../functions/_shared/scheduled-jobs/types";

const job = (kind: ScheduledJob["kind"], over: Partial<ScheduledJob> = {}): ScheduledJob => ({
  id: `job-${kind}`, kind, client_id: "client-1", schedule_id: null, occurrence: null, priority: 40, stagger_seconds: 0, status: "running", phase: null,
  report_id: null, attempts: 1, max_attempts: 3, available_at: "2026-11-23T07:15:00Z", lease_until: null, reason: null, result: null,
  created_at: "2026-11-23T07:15:00Z", started_at: "2026-11-23T07:15:00Z", finished_at: null, ...over,
});
const done: JobOutcome = { status: "done", reason: "ran" };

describe("runUnlessStrategyOnly", () => {
  it("names the kinds that make a calendar or collect weekly trends, and no other", () => {
    expect([...CLOSED_KINDS].sort()).toEqual(["trend_refresh", "week_plan", "week_revise"]);
  });

  it.each(["week_plan", "week_revise", "trend_refresh"] as const)("skips a %s job for a strategy-only client without running it", async (kind) => {
    const run = vi.fn(async () => done);
    const out = await runUnlessStrategyOnly(job(kind), async () => true, run);
    expect(out).toEqual({ status: "skipped", reason: "The client is set up for strategy only: nothing is made until its social accounts are connected in Sprout." });
    expect(run).not.toHaveBeenCalled();
  });

  it.each(["week_plan", "week_revise", "trend_refresh"] as const)("runs a %s job for a client with an account in Sprout", async (kind) => {
    const asked: string[] = [];
    const run = vi.fn(async () => done);
    expect(await runUnlessStrategyOnly(job(kind), async (id) => { asked.push(id); return false; }, run)).toBe(done);
    expect(asked).toEqual(["client-1"]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs the same job once the client has an account", async () => {
    let only = true;
    const run = vi.fn(async () => done);
    const ask = async () => only;
    expect((await runUnlessStrategyOnly(job("week_plan"), ask, run)).status).toBe("skipped");
    only = false;
    expect(await runUnlessStrategyOnly(job("week_plan"), ask, run)).toBe(done);
  });

  it.each(["lifecycle", "lifecycle_step", "feed_refresh", "voice_profile", "notes_read", "strategy_deck", "dispatch", "report_text", "report_insights", "report_pipeline"] as const)(
    "runs a %s job without asking: the strategy's own work, and what closes itself, is not held here", async (kind) => {
      const ask = vi.fn(async () => true);
      const run = vi.fn(async () => done);
      expect(await runUnlessStrategyOnly(job(kind), ask, run)).toBe(done);
      expect(ask).not.toHaveBeenCalled();
    });

  it("runs a job that belongs to no client", async () => {
    const ask = vi.fn(async () => true);
    expect(await runUnlessStrategyOnly(job("trend_refresh", { client_id: null as unknown as string }), ask, async () => done)).toBe(done);
    expect(ask).not.toHaveBeenCalled();
  });

  it("a read that fails is the job's failure, to be tried again: nothing is run on a guess", async () => {
    const run = vi.fn(async () => done);
    await expect(runUnlessStrategyOnly(job("week_plan"), async () => { throw new Error("no answer"); }, run)).rejects.toThrow("no answer");
    expect(run).not.toHaveBeenCalled();
  });
});
