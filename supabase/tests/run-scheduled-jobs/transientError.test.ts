// @vitest-environment node
// P60: any error thrown before a report row exists (a transient database read
// in competitorSet / readSelection / webhooks / pairedCompetitivePending) is
// caught by runDispatch's own catch and returned as "blocked" on the FIRST
// attempt. The worker's retry rule (queued again in RETRY_MINUTES while
// attempts < max_attempts) never sees it; a blocked dispatch is only released
// by the next daily enqueue, so a person's "Run report" waits up to a day.
import { describe, it, expect } from "vitest";
import { runDispatch, type DispatchDeps, type DispatchStore } from "../../../supabase/functions/run-scheduled-jobs/dispatch";
import type { ScheduledJob } from "../../../supabase/functions/_shared/scheduled-jobs/types";

const NOW = new Date("2026-11-20T09:00:00.000Z");

describe("P60 transient error before the report exists", () => {
  it("a one-off read error on the first attempt is retried shortly, not blocked until the daily release", async () => {
    let reads = 0;
    const store = {
      schedule: async () => null, client: async () => ({ id: "c1", name: "Client", archived_at: null }),
      // The first read hits a dropped connection; any later read would answer.
      competitorSet: async () => { if (reads++ === 0) throw new Error("Connection terminated unexpectedly"); return { id: "set-1" }; },
      competitiveReport: async () => null, reportRun: async () => null, pairedCompetitivePending: async () => false, releaseHeldSocial: async () => {},
      webhooks: async () => ({ social: null, competitive: null }), insertCompetitiveReport: async () => "r1", recordRedo: async () => {},
      insertSocialReport: async () => "x", holdSocial: async () => {}, setAnalyzing: async () => {}, dropReport: async () => {},
      releaseSet: async () => {}, advance: async () => {}, close: async () => {}, note: async () => {},
    } satisfies DispatchStore;
    const job: ScheduledJob = {
      id: "j1", kind: "dispatch", client_id: "c1", schedule_id: null, occurrence: null, priority: 20, stagger_seconds: 0, status: "running",
      phase: null, report_id: null, attempts: 1, max_attempts: 3, available_at: NOW.toISOString(), lease_until: null, reason: null, result: null,
      created_at: NOW.toISOString(), started_at: NOW.toISOString(), finished_at: null,
      payload: { run: "manual", kind: "competitive", range: { start: "2026-10-01", end: "2026-10-31" }, requested_by: "u1", requested_at: NOW.toISOString() },
    };
    const deps: DispatchDeps = {
      store, now: () => NOW, post: async () => ({ ok: true, status: 200 }),
      buildSocialPayload: async () => ({}), buildCompetitivePayload: async () => ({}),
      checkLandscape: async () => ({ ok: true }) as never, saveJob: async () => {},
      engine: async () => ({ engine: "app" as const, refused: "n/a" }),
    };
    const out = await runDispatch(job, deps);
    expect(out.status).toBe("queued");
    expect(out.available_at).toBe("2026-11-20T09:10:00.000Z");
    // On its last try the same error blocks it, and a social report held for it is let go.
    let released = 0;
    reads = 0;
    const last = await runDispatch({ ...job, attempts: 3 }, { ...deps, store: { ...store, releaseHeldSocial: async () => { released++; } } });
    expect(last.status).toBe("blocked");
    expect(released).toBe(1);
  });

  it("a dispatch with no webhook to send to is blocked at once", async () => {
    const store = {
      schedule: async () => null, client: async () => ({ id: "c1", name: "Client", archived_at: null }),
      competitorSet: async () => ({ id: "set-1" }), competitiveReport: async () => null, reportRun: async () => null, pairedCompetitivePending: async () => false, releaseHeldSocial: async () => {},
      webhooks: async () => ({ social: null, competitive: null }), insertCompetitiveReport: async () => "r1", recordRedo: async () => {},
      insertSocialReport: async () => "x", holdSocial: async () => {}, setAnalyzing: async () => {}, dropReport: async () => {},
      releaseSet: async () => {}, advance: async () => {}, close: async () => {}, note: async () => {},
    } satisfies DispatchStore;
    const job: ScheduledJob = {
      id: "j1", kind: "dispatch", client_id: "c1", schedule_id: null, occurrence: null, priority: 20, stagger_seconds: 0, status: "running",
      phase: null, report_id: null, attempts: 1, max_attempts: 3, available_at: NOW.toISOString(), lease_until: null, reason: null, result: null,
      created_at: NOW.toISOString(), started_at: NOW.toISOString(), finished_at: null,
      payload: { run: "manual", kind: "social", range: { start: "2026-10-01", end: "2026-10-31" }, requested_by: "u1", requested_at: NOW.toISOString() },
    };
    const out = await runDispatch(job, {
      store, now: () => NOW, post: async () => ({ ok: true, status: 200 }),
      buildSocialPayload: async () => ({}), buildCompetitivePayload: async () => ({}),
      checkLandscape: async () => ({ ok: true }) as never, saveJob: async () => {},
      engine: async () => ({ engine: "n8n" as const }) as never,
    });
    expect(out).toMatchObject({ status: "blocked", reason: "n8n webhook URL not configured" });
  });
});
