/* eslint-disable @typescript-eslint/no-explicit-any -- Board rows are loosely typed, as the board takes them. */
import { describe, it, expect } from "vitest";
import { CLIENT_STATUS_LABEL, STATUS_LABEL, resolvePostStatus, statusLabel } from "../../components/reports/calendar/postStatus";
import { visibleBoard } from "../../components/reports/calendar/CalendarKanban";

describe("resolvePostStatus", () => {
  it("defaults to draft when nothing is set", () => {
    expect(
      resolvePostStatus({
        mediaUrls: [],
        isSelectedAny: false,
        isApproved: false,
        hasScheduledPost: false,
      }),
    ).toBe("draft");
  });

  it("scheduled wins over approved + designed", () => {
    expect(
      resolvePostStatus({
        mediaUrls: ["u"],
        isSelectedAny: true,
        isApproved: true,
        hasScheduledPost: true,
      }),
    ).toBe("scheduled");
  });

  it("never puts a Story at Scheduled: it is posted by hand", () => {
    // A Story carries its post's copy, so a scheduled feed post with the same words must not mark it.
    expect(resolvePostStatus({ mediaUrls: ["u"], isSelectedAny: true, isApproved: false, hasScheduledPost: true, story: true })).toBe("designed");
    expect(resolvePostStatus({ mediaUrls: [], isSelectedAny: false, isApproved: true, hasScheduledPost: true, story: true })).toBe("approved");
  });

  it("approved comes before designed when both conditions are met", () => {
    expect(
      resolvePostStatus({
        mediaUrls: ["u"],
        isSelectedAny: true,
        isApproved: true,
        hasScheduledPost: false,
      }),
    ).toBe("approved");
  });

  it("designed requires both media and is_selected", () => {
    // media but nothing selected → not yet designed
    expect(
      resolvePostStatus({
        mediaUrls: ["u"],
        isSelectedAny: false,
        isApproved: false,
        hasScheduledPost: false,
      }),
    ).toBe("draft");
    // both → designed
    expect(
      resolvePostStatus({
        mediaUrls: ["u"],
        isSelectedAny: true,
        isApproved: false,
        hasScheduledPost: false,
      }),
    ).toBe("designed");
  });
});

describe("the board's status for a post sent to Sprout", () => {
  const copy = "Three things we changed in our paid social bidding this quarter. ".repeat(2).slice(0, 120);
  const week = [{ day: "Monday", posts: [{ _calendarPostKey: "post:a", platform: "LinkedIn", copy }] }];
  const none = { day: "all", platform: "all", status: "all", language: "all" };
  const statusOf = (rows: any[]) => visibleBoard(week, [], rows, none).days.find((d) => d.day === "Monday")!.posts[0].status;

  it("matches by the post's key even when the stored text is the copy plus hashtags", () => {
    const rows = [{ id: "s1", platform: "LinkedIn", post_content: `${copy}\n\n${"#PaidMedia ".repeat(30)}`, status: "scheduled", calendar_post_key: "post:a" }];
    expect(statusOf(rows)).toBe("scheduled");
  });

  it("does not match a row with another key and the same words", () => {
    const rows = [{ id: "s1", platform: "LinkedIn", post_content: copy, status: "scheduled", calendar_post_key: "post:b" }];
    expect(statusOf(rows)).toBe("draft");
  });

  it("reads a row with no key by platform and the start of the copy", () => {
    expect(statusOf([{ id: "s1", platform: "linkedin", post_content: copy, status: "sent_now", calendar_post_key: null }])).toBe("scheduled");
  });

  it("ignores failed, canceled and in-flight rows", () => {
    for (const status of ["failed", "cancelled", "sending"]) {
      expect(statusOf([{ id: "s1", platform: "LinkedIn", post_content: copy, status, calendar_post_key: "post:a" }])).toBe("draft");
    }
  });

  it("reads the send state the panel and the dialog read, and words it for staff only", () => {
    const cardOf = (rows: any[]) => visibleBoard(week, [], rows, none).days.find((d) => d.day === "Monday")!.posts[0];
    const unconfirmed = cardOf([{ id: "s1", status: "unconfirmed", created_at: new Date().toISOString(), calendar_post_key: "post:a" }]);
    expect(unconfirmed).toMatchObject({ status: "scheduled", sendState: "unconfirmed" });
    expect(cardOf([{ id: "s1", status: "asked", created_at: new Date().toISOString(), calendar_post_key: "post:a" }])).toMatchObject({ status: "scheduled", sendState: "being_sent" });
    expect(cardOf([{ id: "s1", status: "asked", created_at: "2026-01-01T00:00:00Z", calendar_post_key: "post:a" }])).toMatchObject({ sendState: "unconfirmed" });
    expect(cardOf([{ id: "s1", status: "scheduled", sprout_post_id: "77", calendar_post_key: "post:a" }])).toMatchObject({ sendState: "sent" });
    expect(statusLabel("scheduled", true, "unconfirmed")).toBe("Not confirmed by Sprout");
    expect(statusLabel("scheduled", true, "being_sent")).toBe("Sending to Sprout");
    expect(statusLabel("scheduled", true, "sent")).toBe("Draft in Sprout");
    // A client reads the same words for every sent state.
    for (const state of ["unconfirmed", "being_sent", "sent"] as const) expect(statusLabel("scheduled", false, state)).toBe("Sent for scheduling");
  });

  it("calls a sent post Draft in Sprout, and has no Published status", () => {
    expect(STATUS_LABEL.scheduled).toBe("Draft in Sprout");
    expect(Object.keys(STATUS_LABEL)).not.toContain("published");
    // A client never reads the scheduling tool's name.
    expect(CLIENT_STATUS_LABEL.scheduled).not.toMatch(/sprout/i);
  });
});
