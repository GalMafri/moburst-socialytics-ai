/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// What the screens say from the tracking state. A competitive analysis runs
// only when the confirmed competitors are tracked; until then no screen
// promises a run date or a run time, and a client reads no vendor's name.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientOverview } from "@/components/dashboard/ClientOverview";
import { ReportRunStatus } from "@/components/reports/ReportRunStatus";
import { fetchNextRun } from "@/lib/nextRun";
import { firstRunSentence } from "@/lib/display";

const f = vi.hoisted(() => ({
  /** report_schedules rows by report_kind, as a client's own session reads them. */
  schedules: {} as Record<string, { next_run_at: string | null; last_result: string | null } | null>,
  asked: [] as string[],
}));

vi.mock("@/lib/openTopics", () => ({ fetchOpenTopics: async () => [] }));
vi.mock("../../../supabase/functions/_shared/reports/shownFields", () => ({ readShownInsights: async () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ buildCompetitiveContext: () => ({ competitors: [], benchmark_dimensions: [] }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const q: any = { kind: "" };
      for (const m of ["is", "not", "gte", "order", "limit", "range"]) q[m] = () => q;
      q.select = (columns: string) => { if (table === "report_schedules") f.asked.push(columns); return q; };
      q.eq = (column: string, value: string) => { if (column === "report_kind") q.kind = value; return q; };
      q.maybeSingle = async () => ({
        data: table === "clients" ? { id: "c", name: "Northwind Bikes", timezone: "UTC" } : table === "report_schedules" ? f.schedules[q.kind] ?? null : null,
        error: null,
      });
      q.then = (ok: any, no: any) => Promise.resolve({ data: [], error: null }).then(ok, no);
      return q;
    },
  },
}));

const DEC7 = "2026-12-07T07:15:00Z";
const WAITS = "needs tracking: Tracking for the confirmed competitors has not started.";
const WAITING_SENTENCE = "The first competitive analysis runs once tracking of the competitors has started.";

beforeEach(() => { f.schedules = {}; f.asked = []; });
afterEach(() => cleanup());

describe("the next run a screen reads from the schedule", () => {
  it("tracked: the date, and no wait", async () => {
    f.schedules = { competitive: { next_run_at: DEC7, last_result: null } };
    expect(await fetchNextRun("c", "competitive")).toEqual({ at: DEC7, awaitsTracking: false });
    f.schedules = { competitive: { next_run_at: DEC7, last_result: "The report ran." } };
    expect(await fetchNextRun("c", "competitive")).toEqual({ at: DEC7, awaitsTracking: false });
    expect(f.asked.every((columns) => columns === "next_run_at, last_result")).toBe(true);
  });
  it("untracked or waiting: the schedule's note says so, whoever wrote it", async () => {
    for (const note of [WAITS, "needs tracking: No RivalIQ landscape tracks Northwind Bikes and every confirmed competitor yet."]) {
      f.schedules = { competitive: { next_run_at: DEC7, last_result: note } };
      const next = await fetchNextRun("c", "competitive");
      expect(next).toEqual({ at: DEC7, awaitsTracking: true });
      expect(firstRunSentence("competitive", next, "UTC")).toBe(WAITING_SENTENCE);
    }
  });
  it("a monthly report waits for no tracking, and no schedule says nothing", async () => {
    f.schedules = { social: { next_run_at: DEC7, last_result: WAITS } };
    expect(await fetchNextRun("c", "monthly")).toEqual({ at: DEC7, awaitsTracking: false });
    expect(await fetchNextRun("c", "competitive")).toBeNull();
  });
});

describe("a client's overview, as the client reads it", () => {
  const mount = () => render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ClientOverview clientId="c" isStaff={false} /></MemoryRouter></QueryClientProvider>);

  it("tracked: says when the first competitive analysis runs", async () => {
    f.schedules = { competitive: { next_run_at: DEC7, last_result: null } };
    mount();
    await waitFor(() => expect(screen.getByText("The first competitive analysis runs on Dec 7, 2026.")).toBeInTheDocument());
  });

  it("untracked or waiting: promises no date, and names no vendor", async () => {
    f.schedules = { competitive: { next_run_at: DEC7, last_result: WAITS }, social: { next_run_at: DEC7, last_result: null } };
    const { container } = mount();
    await waitFor(() => expect(screen.getByText(WAITING_SENTENCE)).toBeInTheDocument());
    expect(screen.queryByText(/competitive analysis runs on \w+ \d/)).not.toBeInTheDocument();
    // The monthly report still has its date: only the competitive analysis waits for tracking.
    expect(screen.getByText("The first monthly report runs on Dec 7, 2026.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/RivalIQ|needs tracking|landscape/i);
  });

  it("nothing scheduled: says only that there is no analysis yet", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("No competitive analysis yet.")).toBeInTheDocument());
  });
});

describe("the run page's status, from the request until its report", () => {
  const range = { start: "2026-10-12", end: "2026-11-10" };
  const text = (view: Parameters<typeof ReportRunStatus>[0]["view"], tracked?: boolean) => {
    const { container } = render(<ReportRunStatus view={view} kind="competitive" tracked={tracked} />);
    const out = container.textContent ?? "";
    cleanup();
    return out;
  };

  it("waiting for tracking: says so, promises no time, and shows no failure", () => {
    const waiting = text({ state: "waiting", requestedAt: "2026-11-11T09:00:00Z", range }, false);
    expect(waiting).toContain("Waiting for tracking");
    expect(waiting).toContain("The analysis starts on its own once tracking of these competitors has started, and appears in report history when it is ready.");
    expect(waiting).toContain("Oct 12, 2026");
    expect(waiting).not.toMatch(/runs again|It runs again at|about 10 minutes|in progress|Starting the/);
    expect(waiting).not.toMatch(/RivalIQ|fail|could not|error/i);
    // The same when the page could not read the tracking state.
    expect(text({ state: "waiting", requestedAt: "2026-11-11T09:00:00Z", range })).toContain("Waiting for tracking");
  });

  it("untracked, with a request the dispatch has not looked at again yet: already says it waits for tracking, never when it runs again", () => {
    // The job that was making the report again each day, before its next look: eleven runs behind it and a time on the row.
    const between = text({ state: "again", nextAt: "2026-11-18T07:00:00Z", range }, false);
    expect(between).toContain("Waiting for tracking");
    expect(between).not.toMatch(/runs again|It runs again at|Nov 18|about 10 minutes/);
    const asked = text({ state: "starting", requestedAt: "2026-11-17T09:00:00Z", range }, false);
    expect(asked).toContain("Waiting for tracking");
    expect(asked).not.toMatch(/Starting the|about 10 minutes/);
    // A report that is being made is shown as it is, and a monthly report waits for no tracking.
    expect(text({ state: "running", reportId: "r", startedAt: new Date().toISOString(), range }, false)).toContain("Competitive analysis in progress");
    const { container } = render(<ReportRunStatus view={{ state: "again", nextAt: "2026-11-18T07:00:00Z", range }} kind="monthly" tracked={false} />);
    expect(container.textContent).toContain("Analysis runs again on its own");
    cleanup();
  });

  it("tracking that does not cover the selection: the request waits for the two to match, and nothing says tracking has not started", () => {
    const view = { state: "waiting" as const, requestedAt: "2026-11-17T09:00:00Z", range };
    const { container } = render(<ReportRunStatus view={view} kind="competitive" tracked={false} notCovered />);
    const waiting = container.textContent ?? "";
    cleanup();
    expect(waiting).toContain("Waiting for tracking to cover this selection");
    expect(waiting).toContain("The analysis starts on its own once the tracked companies match the confirmed competitors, and appears in report history when it is ready.");
    expect(waiting).not.toMatch(/has started|about 10 minutes|runs again|RivalIQ/);
  });

  it("tracked, and the request still parked: says it has not started yet, with no word about tracking", () => {
    const parked = text({ state: "waiting", requestedAt: "2026-11-11T09:00:00Z", range }, true);
    expect(parked).toContain("Competitive analysis not started yet");
    expect(parked).toContain("It starts on its own and appears in report history when it is ready.");
    expect(parked).not.toMatch(/tracking|about 10 minutes/i);
  });

  it("tracked and going: starting, in progress and running again read as before", () => {
    expect(text({ state: "starting", requestedAt: "2026-11-11T09:00:00Z", range }, true)).toContain("Starting the competitive analysis");
    expect(text({ state: "running", reportId: "r", startedAt: new Date().toISOString(), range }, true)).toContain("Competitive analysis in progress");
    const again = text({ state: "again", nextAt: "2026-11-18T07:00:00Z", range }, true);
    expect(again).toContain("Competitive analysis runs again on its own");
    expect(again).toContain("It runs again at");
    expect(text({ state: "idle" }, false)).toBe("");
  });
});
