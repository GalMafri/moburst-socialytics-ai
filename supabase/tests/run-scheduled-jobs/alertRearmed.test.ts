// @vitest-environment node
// P60: an occurrence that already alerted, then waited for tracking, re-arms
// alert_due_at on its first run after the wait (startRun ignores alerted_at),
// and alertIfLate returns early on alerted_at without removing it. A lease
// between runs then hands the job back with available_at = now until retry_at:
// the worker leases it again and again (deferred, so attempts never grow).
import { describe, it, expect } from "vitest";
import { runDispatch, type DispatchDeps, type DispatchStore, type ScheduleRow } from "../../../supabase/functions/run-scheduled-jobs/dispatch";
import type { ScheduledJob } from "../../../supabase/functions/_shared/scheduled-jobs/types";
import type { LandscapeCheck } from "../../../supabase/functions/_shared/competitive/landscapeCheck";

const DUE = "2026-11-07T07:15:00.000Z";
const TRACKED = { ok: true, linked: true, summary: { id: "ls", name: "x", focus_company: "C", is_match: true, client_company_id: "1", match_reason: "focus company", companies: [] }, landscape: { id: "ls", name: "x", focusCompanyId: 1, companies: [] } } as unknown as LandscapeCheck;

function setup() {
  const schedule: ScheduleRow = { id: "s1", client_id: "c1", report_kind: "competitive", is_active: true, next_run_at: DUE, run_day_of_month: 7, frequency: "monthly", range_mode: "previous_month", created_by: null, pending_competitive_report_id: null };
  let n = 0;
  const store = {
    schedule: async () => ({ ...schedule }), client: async () => ({ id: "c1", name: "Client", archived_at: null }),
    competitorSet: async () => ({ id: "set-1" }), competitiveReport: async () => null, reportRun: async () => null,
    pairedCompetitivePending: async () => false, releaseHeldSocial: async () => {}, webhooks: async () => ({ social: null, competitive: null }),
    insertCompetitiveReport: async () => `r${n++}`, recordRedo: async () => {}, insertSocialReport: async () => "x", holdSocial: async () => {},
    setAnalyzing: async () => {}, dropReport: async () => {}, releaseSet: async () => {}, advance: async () => {}, close: async () => {}, note: async () => {},
  } satisfies DispatchStore;
  return store;
}

describe("P60 alert re-armed after a tracking wait", () => {
  it("never hands the job back for an immediate re-lease while it waits for its next run", async () => {
    const store = setup();
    let clock = new Date("2026-11-20T08:00:00.000Z");
    // The occurrence alerted on 13 Nov, then waited for tracking from 17 Nov (whileWaiting keeps alerted_at).
    const job: ScheduledJob = {
      id: "j1", kind: "dispatch", client_id: "c1", schedule_id: "s1", occurrence: DUE, priority: 20, stagger_seconds: 0, status: "running",
      phase: null, report_id: null, attempts: 1, max_attempts: 3, available_at: DUE, lease_until: null, reason: null, created_at: DUE, started_at: DUE, finished_at: null,
      result: { runs: [{ report_id: "old", started_at: "2026-11-12T07:15:00.000Z", ended_at: "2026-11-17T07:00:00.000Z", outcome: "stopped", end: "needs_tracking", note: "LANDSCAPE_NOT_FOUND" }],
        alerted_at: "2026-11-13T07:20:00.000Z", tracking_wait_at: "2026-11-17T07:00:00.000Z" },
    };
    const deps: DispatchDeps = {
      store, now: () => clock, post: async () => ({ ok: true, status: 200 }),
      buildSocialPayload: async () => ({}), buildCompetitivePayload: async () => ({}),
      checkLandscape: async () => TRACKED,
      saveJob: async (p) => { Object.assign(job, p); },
      // Tracking has come; every run now stops at once (no in-app pipeline can start).
      engine: async () => ({ engine: "app" as const, refused: "no pipeline" }),
      alert: async () => true,
    };
    const spins: string[] = [];
    for (let lease = 0; lease < 12; lease++) {
      const out = await runDispatch(job, deps);
      if (out.result !== undefined) job.result = out.result ?? null;
      if (out.status !== "queued" || !out.available_at) break;
      const at = Date.parse(out.available_at);
      if (at <= clock.getTime()) spins.push(`${clock.toISOString()} -> ${out.available_at} (${out.reason})`);
      clock = new Date(Math.max(at, clock.getTime() + 60_000));
    }
    expect(spins).toEqual([]);
  });
});
