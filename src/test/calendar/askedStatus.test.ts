import { describe, expect, it } from "vitest";
import { scheduledFor, sendStateLine, sendStateOf } from "@/components/reports/SchedulePostModal";
import { SEND_RUN_LIMIT_MS } from "../../../supabase/functions/_shared/sprout/sendWindow";

const key = "post:5f0c2a1e-7d3b-4c8e-9a61-2b4d8e9f0c17";
const NOW = Date.parse("2026-11-12T12:00:00Z");
const fresh = new Date(NOW - 30_000).toISOString();
const past = new Date(NOW - SEND_RUN_LIMIT_MS - 1_000).toISOString();

describe("a post whose send Sprout was asked to make", () => {
  it("reads as sent when the answer was never written down, and not when Sprout was not asked", () => {
    const post = { _calendarPostKey: key, platform: "LinkedIn", copy: "A post." };
    expect(scheduledFor([{ id: "1", status: "asked", calendar_post_key: key, scheduled_time: "2026-11-09T23:45:00Z" }], post)).toMatchObject({ id: "1" });
    expect(scheduledFor([{ id: "2", status: "sending", calendar_post_key: key }], post)).toBeNull();
    expect(scheduledFor([{ id: "3", status: "failed", calendar_post_key: key }], post)).toBeNull();
  });

  it("is being sent while its send can still be running, and unconfirmed only after that", () => {
    expect(sendStateOf({ id: "1", status: "asked", created_at: fresh }, NOW)).toBe("being_sent");
    expect(sendStateOf({ id: "1", status: "asked", created_at: past }, NOW)).toBe("unconfirmed");
    expect(sendStateOf({ id: "1", status: "asked", created_at: past, sprout_post_id: "4567890" }, NOW)).toBe("sent");
    expect(sendStateOf({ id: "1", status: "scheduled", created_at: past }, NOW)).toBe("sent");
    expect(sendStateOf(null, NOW)).toBe("none");
  });

  it("is said the same way wherever it is shown", () => {
    expect(sendStateLine({ id: "1", status: "asked", created_at: past, scheduled_time: "2026-11-20T15:00:00Z" }, "UTC", NOW)).toBe("Sprout did not confirm this post. Send it again to be sure it is there.");
    expect(sendStateLine({ id: "1", status: "asked", created_at: fresh, scheduled_time: "2026-11-20T15:00:00Z" }, "UTC", NOW)).toBe("This post is being sent to Sprout.");
    expect(sendStateLine(null, "UTC", NOW)).toBe("Not sent to Sprout yet.");
    expect(sendStateLine({ id: "1", status: "scheduled", scheduled_time: "2026-11-20T15:00:00Z" }, "UTC", NOW)).toMatch(/^Sent to Sprout as a draft for /);
  });

  it("is unconfirmed at once when its send ended without Sprout's answer", () => {
    expect(sendStateOf({ id: "1", status: "unconfirmed", created_at: fresh }, NOW)).toBe("unconfirmed");
    expect(sendStateOf({ id: "1", status: "unconfirmed", created_at: fresh, sprout_post_id: "4567890" }, NOW)).toBe("sent");
    const post = { _calendarPostKey: key, platform: "LinkedIn", copy: "A post." };
    expect(scheduledFor([{ id: "u", status: "unconfirmed", calendar_post_key: key, created_at: fresh }], post)).toMatchObject({ id: "u" });
  });
});

describe("a post with an earlier confirmed send and a later one that holds it", () => {
  const post = { _calendarPostKey: key, platform: "LinkedIn", copy: "A post." };
  const confirmed = { id: "old", status: "scheduled", sprout_post_id: "77", calendar_post_key: key, created_at: new Date(NOW - 86_400_000).toISOString(), scheduled_time: "2026-11-20T15:00:00Z" };

  it.each([["confirmed row first", true], ["holding row first", false]])("reads the holding row, %s", (_name, confirmedFirst) => {
    const stale = { id: "held", status: "asked", calendar_post_key: key, created_at: past, scheduled_time: "2026-11-21T15:00:00Z" };
    const live = { ...stale, created_at: fresh };
    const order = (r: typeof stale) => (confirmedFirst ? [confirmed, r] : [r, confirmed]);
    expect(scheduledFor(order(stale), post)).toMatchObject({ id: "held" });
    expect(sendStateOf(scheduledFor(order(stale), post), NOW)).toBe("unconfirmed");
    expect(sendStateOf(scheduledFor(order(live), post), NOW)).toBe("being_sent");
  });

  it("reads the newest sent row when none holds the post", () => {
    const newer = { ...confirmed, id: "new", sprout_post_id: "78", created_at: new Date(NOW - 3_600_000).toISOString() };
    expect(scheduledFor([newer, confirmed], post)).toMatchObject({ id: "new" });
    expect(scheduledFor([confirmed, newer], post)).toMatchObject({ id: "new" });
  });
});
