import { describe, expect, it } from "vitest";
import { minutesRunning } from "@/lib/reportRun";
import { runView } from "@/hooks/useReportRun";

const NOW = new Date("2026-09-10T12:00:00Z").getTime();
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60000).toISOString();

describe("minutesRunning", () => {
  it("counts from the run's start, and copes with a row that has no timestamp", () => {
    expect(minutesRunning({ status: "running", created_at: at(30) }, NOW)).toBeCloseTo(30);
    expect(minutesRunning({ status: "running" }, NOW)).toBe(0);
  });
});

describe("the app and the server agree on how long a run may take", () => {
  it("uses the same threshold on both sides", async () => {
    const { STUCK_AFTER_MINUTES } = await import("@/lib/reportRun");
    const server = await import("../../../supabase/functions/_shared/reports/payloads");
    expect(server.STUCK_AFTER_MINUTES).toBe(STUCK_AFTER_MINUTES);
  });
});

describe("a manual run, from the request until its report exists", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    job_id: "j", status: "queued", requested_at: at(1), range_start: "2026-09-01", range_end: "2026-09-30", report_id: null, open: true, runs: 0, next_at: at(1), ...over,
  });
  it("is starting while only the request exists, and running once the report does", () => {
    expect(runView(request(), null, true).state).toBe("starting");
    expect(runView(request({ report_id: "r" }), null, true)).toMatchObject({ state: "running", reportId: "r" });
    expect(runView(null, { id: "r2", created_at: at(5), date_range_start: null, date_range_end: null }, false)).toMatchObject({ state: "running", reportId: "r2" });
  });
  it("says when a run that did not finish runs again, and never shows a failure", () => {
    const later = new Date(Date.now() + 30 * 60000).toISOString();
    expect(runView(request({ runs: 1, next_at: later }), null, true)).toMatchObject({ state: "again", nextAt: later });
  });
  it("is ready only for the run this page watched", () => {
    expect(runView(request({ status: "done", open: false, report_id: "r" }), null, true)).toMatchObject({ state: "ready", reportId: "r" });
    expect(runView(request({ status: "done", open: false, report_id: "r" }), null, false).state).toBe("idle");
    expect(runView(request({ status: "skipped", open: false }), null, true).state).toBe("idle");
  });
});
