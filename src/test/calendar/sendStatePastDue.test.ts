// QA 22 Nov 2026 (P07-07): a post sent to Sprout read "Sent to Sprout as a
// draft for Nov 10, 11:45 PM." forever, before and after its time, and a row
// marked "published" (allowed by the table) was not counted as sent at all.
// Nothing reads Sprout back yet, so after its time the line says where to see
// whether it went out; a published row says it was posted.
import { describe, expect, it } from "vitest";
import { scheduledFor, sendStateLine } from "@/components/reports/SchedulePostModal";

const AT = "2026-11-10T23:45:00Z";
const before = Date.parse("2026-11-10T12:00:00Z");
const after = Date.parse("2026-11-22T12:00:00Z");

describe("a post's Sprout line over time", () => {
  it("says the draft's time before it comes", () => {
    expect(sendStateLine({ id: "r1", status: "scheduled", scheduled_time: AT, sprout_post_id: "9" }, "UTC", before)).toBe("Sent to Sprout as a draft for Nov 10, 11:45 PM.");
  });

  it("says where to see whether it went out once its time has passed", () => {
    expect(sendStateLine({ id: "r1", status: "scheduled", scheduled_time: AT, sprout_post_id: "9" }, "UTC", after))
      .toBe("Sent to Sprout as a draft for Nov 10, 11:45 PM. Its time has passed: whether it was approved and posted shows in Sprout.");
  });

  it("says a published post was posted", () => {
    expect(sendStateLine({ id: "r1", status: "published", scheduled_time: AT, sprout_post_id: "9" }, "UTC", after)).toBe("Posted from Sprout for Nov 10, 11:45 PM.");
  });

  it("counts a published row as the post's send", () => {
    const row = { id: "r1", status: "published", scheduled_time: AT, sprout_post_id: "9", calendar_post_key: "k1" };
    expect(scheduledFor([row], { _calendarPostKey: "k1", platform: "LinkedIn" })).toEqual(row);
  });
});
