import { describe, expect, it } from "vitest";
import { localDateString, scheduledInstant } from "@/lib/calendarDate";
import { applyCopyRevisions, calendarWithRevisions, iterationMatchesPost } from "@/lib/calendarRevision";
import { activeNavigationSection } from "@/lib/navigationSection";

describe("Calendar date and named-zone scheduling", () => {
  it.each([
    ["UTC", "2030-09-21", "15:00", "2030-09-21T15:00:00.000Z"],
    ["Asia/Jerusalem", "2030-09-21", "15:00", "2030-09-21T12:00:00.000Z"],
    ["America/New_York", "2026-01-15", "15:00", "2026-01-15T20:00:00.000Z"],
    ["America/New_York", "2026-07-15", "15:00", "2026-07-15T19:00:00.000Z"],
    ["Asia/Kathmandu", "2026-07-15", "15:00", "2026-07-15T09:15:00.000Z"],
  ])("resolves %s independently of the operator zone", (zone, date, time, expected) => {
    expect(scheduledInstant(date, time, zone)).toBe(expected);
  });
  it("refuses a nonexistent spring-forward wall time", () => expect(() => scheduledInstant("2026-03-08", "02:30", "America/New_York")).toThrow("does not exist"));
  it("refuses an ambiguous fall-back wall time", () => expect(() => scheduledInstant("2026-11-01", "01:30", "America/New_York")).toThrow("occurs twice"));
  it("handles a half-hour DST transition", () => expect(() => scheduledInstant("2026-10-04", "02:15", "Australia/Lord_Howe")).toThrow("does not exist"));
  it.each([["2026-02-30", "15:00", "UTC"], ["2026-01-01", "25:00", "UTC"], ["2026-01-01", "12:00", "Invalid/Zone"]])("rejects invalid input", (date, time, zone) => expect(() => scheduledInstant(date, time, zone)).toThrow());
  it("keeps a local calendar day unchanged", () => expect(localDateString(new Date(2026, 8, 1))).toBe("2026-09-01"));
});

describe("Persistent calendar copy", () => {
  const original = { platform: "LinkedIn", copy: "Original", hashtags: ["old"] };
  const calendar = [{ day: "Monday", posts: [original, original] }];
  const posts = calendarWithRevisions(calendar, "report-a", [])[0].posts;
  const revision = { calendar_post_key: posts[0]._calendarPostKey, post_copy: "Reviewed", hashtags: ["new"], cta: "Read more", version: 1, created_at: "2026-09-17T10:00:00Z" };
  it("restores the saved copy and metadata after rebuilding the calendar", () => {
    const loaded = calendarWithRevisions(calendar, "report-a", [revision])[0].posts;
    expect(loaded[0]).toMatchObject({ copy: "Reviewed", hashtags: ["new"], CTA: "Read more" });
    expect(loaded[1].copy).toBe("Original");
  });
  it("does not transfer edits to another report or regenerated original", () => {
    expect(calendarWithRevisions(calendar, "report-b", [revision])[0].posts[0].copy).toBe("Original");
    expect(calendarWithRevisions([{ day: "Monday", posts: [{ ...original, copy: "New source" }] }], "report-a", [revision])[0].posts[0].copy).toBe("New source");
  });
  it("retains legacy creative and newly generated creative across copy revisions", () => {
    const post = applyCopyRevisions(posts[0], [revision]);
    expect(iterationMatchesPost({ platform: "LinkedIn", post_copy: "Original" }, post)).toBe(true);
    expect(iterationMatchesPost({ platform: "LinkedIn", post_copy: "Reviewed" }, post)).toBe(true);
    expect(iterationMatchesPost({ platform: "Instagram", post_copy: "Reviewed" }, post)).toBe(false);
  });
  it("ignores a stale refetch after a successful new revision", () => {
    const post = { ...posts[0], copy: "Newest", _copyVersion: 2 };
    expect(applyCopyRevisions(post, [revision]).copy).toBe("Newest");
  });
});

it.each([
  ["/clients/a/competitive/reports/b", "/competitive"], ["/clients/a/competitive/feed", "/competitive"],
  ["/clients/a/analytics", "/analytics"], ["/clients/a/reports/b", "/reports"],
  ["/clients/a/analyze", "/reports"], ["/clients/a/setup", "/"], ["/usage", "/usage"],
])("keeps navigation context for %s", (route, section) => expect(activeNavigationSection(route)).toBe(section));
