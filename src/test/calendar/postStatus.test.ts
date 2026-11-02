import { describe, it, expect } from "vitest";
import { resolvePostStatus } from "../../components/reports/calendar/postStatus";

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
