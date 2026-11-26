// @vitest-environment node
// Whether each client's confirmed competitors are tracked, kept on its
// competitive schedule (report_schedules.last_result), the one tracking fact
// a client's own screens can read. While the note stands, no screen promises
// "The first competitive analysis runs on <date>". The scheduled-jobs worker
// brings every schedule in line on each tick, so it is right for every client
// within a minute of a release, with nobody asking.
import { describe, expect, it } from "vitest";
import { noteSchedulesTracking, READ_LIMIT, TRACKING_NOT_STARTED } from "../../../functions/_shared/lifecycle/trackingNote";
import { fakeDb } from "../../support/lifecycleFakeDb";
import { NEEDS_TRACKING, trackedOnRecord } from "../../../functions/_shared/competitive/selectionTracking";

const T = "2026-11-17T07:00:00.000Z";
const set = (client: string, over: Record<string, unknown> = {}) => ({ id: `set-${client}`, client_id: client, status: "confirmed", confirmed_at: T, created_at: T, rivaliq_landscape_id: null, tracking_check: null, ...over });
const schedule = (client: string, over: Record<string, unknown> = {}) => ({ id: `sched-${client}`, client_id: client, report_kind: "competitive", is_active: true, next_run_at: "2026-12-07T07:15:00.000Z", last_result: null, ...over });
const noteOf = (db: ReturnType<typeof fakeDb>, client: string) => db.tables.report_schedules.find((s) => s.id === `sched-${client}`)!.last_result;

describe("noteSchedulesTracking: every client's schedule, in one pass", () => {
  it("writes the wait for each client whose confirmed set is not tracked, and leaves the tracked ones alone", async () => {
    const db = fakeDb({
      competitor_sets: [
        set("untracked"),
        set("tracked", { rivaliq_landscape_id: "777" }),
        set("found", { tracking_check: { code: "ok", landscape_id: null, checked_at: T, found_landscape_id: "640" } }),
        set("draft-only", { status: "draft" }),
        set("gone", { rivaliq_landscape_id: "777", tracking_check: { code: "RIVALIQ_LANDSCAPE_MISSING", landscape_id: "777", checked_at: T, gone: true } }),
        set("not-covered", { rivaliq_landscape_id: "501", tracking_check: { code: "RIVALIQ_SELECTION_NOT_COVERED", landscape_id: "501", checked_at: T, uncovered: { client: false, competitors: ["Contoso Rides"] } } }),
      ],
      report_schedules: [
        schedule("untracked"), schedule("tracked"), schedule("found"), schedule("draft-only"), schedule("gone"), schedule("not-covered"), schedule("no-set"),
        { ...schedule("untracked"), id: "sched-untracked-social", report_kind: "social" },
        schedule("paused", { is_active: false }),
      ],
    });
    expect(await noteSchedulesTracking(db)).toEqual({ waiting: 5, tracked: 2, written: 5 });
    for (const client of ["untracked", "draft-only", "gone", "not-covered", "no-set"]) {
      expect(noteOf(db, client), client).toBe(TRACKING_NOT_STARTED);
      expect(String(noteOf(db, client)).startsWith(NEEDS_TRACKING)).toBe(true);
    }
    for (const client of ["tracked", "found", "paused"]) expect(noteOf(db, client), client).toBeNull();
    // Only competitive schedules, and only the note: no date is ever moved.
    expect(db.tables.report_schedules.find((s) => s.id === "sched-untracked-social")!.last_result).toBeNull();
    expect(db.tables.report_schedules.every((s) => s.next_run_at === "2026-12-07T07:15:00.000Z")).toBe(true);
    // In line already: the next pass writes nothing.
    expect(await noteSchedulesTracking(db)).toEqual({ waiting: 5, tracked: 2, written: 0 });
  });

  it("reads the client's current set: the newest confirmed one, as the dispatch does", async () => {
    const db = fakeDb({
      competitor_sets: [
        set("a", { id: "older", rivaliq_landscape_id: "777", confirmed_at: "2026-10-01T00:00:00.000Z" }),
        set("a", { id: "newer", confirmed_at: "2026-11-11T00:00:00.000Z" }),
        set("a", { id: "draft", status: "draft", rivaliq_landscape_id: "888", confirmed_at: null, created_at: "2026-11-16T00:00:00.000Z" }),
      ],
      report_schedules: [schedule("a")],
    });
    // The selection was changed on 11 Nov: the new set has no link, whatever the older one tracked.
    await noteSchedulesTracking(db);
    expect(noteOf(db, "a")).toBe(TRACKING_NOT_STARTED);
  });

  it("clears the note once the set is tracked, so the date is promised again", async () => {
    for (const note of [TRACKING_NOT_STARTED, `${NEEDS_TRACKING}: No RivalIQ landscape tracks Northwind Bikes and every confirmed competitor yet.`]) {
      const db = fakeDb({ competitor_sets: [set("a", { rivaliq_landscape_id: "777" })], report_schedules: [schedule("a", { last_result: note })] });
      expect(await noteSchedulesTracking(db)).toEqual({ waiting: 0, tracked: 1, written: 1 });
      expect(noteOf(db, "a")).toBeNull();
    }
  });

  it("leaves a run's own note as the dispatch wrote it", async () => {
    for (const note of ["The report ran.", null]) {
      const tracked = fakeDb({ competitor_sets: [set("a", { rivaliq_landscape_id: "777" })], report_schedules: [schedule("a", { last_result: note })] });
      expect(await noteSchedulesTracking(tracked)).toMatchObject({ written: 0 });
      expect(noteOf(tracked, "a")).toBe(note);
    }
    for (const note of ["error: competitive webhook URL not configured", "The report is running.", `${NEEDS_TRACKING}: as the dispatch worded it`]) {
      const waiting = fakeDb({ competitor_sets: [set("a")], report_schedules: [schedule("a", { last_result: note })] });
      expect(await noteSchedulesTracking(waiting)).toMatchObject({ waiting: 1, written: 0 });
      expect(noteOf(waiting, "a")).toBe(note);
    }
    // A finished run's note gives way: the next analysis waits for tracking too.
    const next = fakeDb({ competitor_sets: [set("a")], report_schedules: [schedule("a", { last_result: "The report ran." })] });
    await noteSchedulesTracking(next);
    expect(noteOf(next, "a")).toBe(TRACKING_NOT_STARTED);
  });

  it("agrees with what every screen reads for the same set", async () => {
    const sets = [set("a"), set("b", { rivaliq_landscape_id: "777" }), set("c", { rivaliq_landscape_id: "501", tracking_check: { code: "RIVALIQ_SELECTION_NOT_COVERED", landscape_id: "501", checked_at: T } })];
    const db = fakeDb({ competitor_sets: sets, report_schedules: sets.map((s) => schedule(s.client_id)) });
    await noteSchedulesTracking(db);
    for (const s of sets) expect(noteOf(db, s.client_id) === null, s.client_id).toBe(trackedOnRecord(s));
  });

  it("covers many clients in a few reads, and never throws", async () => {
    const clients = Array.from({ length: 60 }, (_, i) => `c${i}`);
    const db = fakeDb({ competitor_sets: clients.map((c, i) => set(c, i % 2 ? { rivaliq_landscape_id: "777" } : {})), report_schedules: clients.map((c) => schedule(c)) });
    expect(await noteSchedulesTracking(db)).toEqual({ waiting: 30, tracked: 30, written: 30 });
    expect(await noteSchedulesTracking(fakeDb({ competitor_sets: [], report_schedules: [] }))).toEqual({ waiting: 0, tracked: 0, written: 0 });
    // A client with more sets than one read returns: the read is asked again for fewer clients, and each client's newest set still decides.
    const many = Array.from({ length: READ_LIMIT + 5 }, (_, i) => set("busy", { id: `old-${i}`, rivaliq_landscape_id: "777", confirmed_at: "2026-01-01T00:00:00.000Z" }));
    const crowded = fakeDb({
      competitor_sets: [...many, set("busy", { id: "newest", confirmed_at: "2026-11-11T00:00:00.000Z" }), set("quiet", { rivaliq_landscape_id: "777", confirmed_at: "2025-01-01T00:00:00.000Z" })],
      report_schedules: [schedule("busy"), schedule("quiet")],
    });
    expect(await noteSchedulesTracking(crowded)).toEqual({ waiting: 1, tracked: 1, written: 1 });
    expect(noteOf(crowded, "busy")).toBe(TRACKING_NOT_STARTED);
    expect(noteOf(crowded, "quiet")).toBeNull();
    const broken = { from() { throw new Error("database away"); } };
    expect(await noteSchedulesTracking(broken)).toBeNull();
  });
});
