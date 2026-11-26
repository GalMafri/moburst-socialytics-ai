import { describe, expect, it } from "vitest";
import { fakeDb } from "../support/lifecycleFakeDb";
import { postTimeOf } from "../../functions/design-request/postTime";

// A person's video request reads its post's time before anything is parked
// (12 Nov 2026), in the client's own time zone.

describe("postTimeOf", () => {
  it("reads the post's time in the client's time zone", async () => {
    const db = fakeDb({
      calendar_posts: [{ client_id: "c1", post_key: "k1", post_date: "2026-11-14", posting_time: "09:30" }],
      clients: [{ id: "c1", timezone: "Asia/Jerusalem" }],
    });
    expect((await postTimeOf(db, "c1", "k1"))?.toISOString()).toBe("2026-11-14T07:30:00.000Z");
  });

  it("answers null for a post that is not in the calendar", async () => {
    const db = fakeDb({
      calendar_posts: [{ client_id: "c1", post_key: "other", post_date: "2026-11-14", posting_time: "09:30" }],
      clients: [{ id: "c1", timezone: "Asia/Jerusalem" }],
    });
    expect(await postTimeOf(db, "c1", "k1")).toBeNull();
  });
});
