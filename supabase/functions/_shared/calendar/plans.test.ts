import { describe, it, expect } from "vitest";
import { claimWeek, mondayOf, slotOf, weeksToPlan, type WeekPost } from "./plans";

const OLD = "old-report", NEW = "new-report", NEWER = "newer-report";
const reportCreated = new Map([
  [OLD, "2026-10-07T07:28:01Z"],
  [NEW, "2026-10-16T20:59:22Z"],
  [NEWER, "2026-11-07T07:20:00Z"],
]);
const post = (id: string, report_id: string | null, post_date: string, platform: string, source = "report"): WeekPost => ({ id, post_key: `k-${id}`, post_date, platform, source, report_id });

describe("claimWeek", () => {
  it("takes an older plan's untouched posts off the week and keeps the worked-on ones, with their slots", () => {
    const posts = [
      post("o1", OLD, "2026-10-19", "LinkedIn"), // designed
      post("o2", OLD, "2026-10-20", "Instagram"),
      post("o3", OLD, "2026-10-23", "Facebook", "trend_slot"),
      post("n1", NEW, "2026-10-19", "LinkedIn"),
      post("n2", NEW, "2026-10-20", "Facebook"),
    ];
    const claim = claimWeek({ reportId: NEW, reportCreatedAt: reportCreated.get(NEW)!, today: "2026-10-19", posts, reportCreated, worked: new Set(["o1"]) });
    expect(claim.yielded).toBe(false);
    // o2 and o3 leave; n1 sits on the slot the designed o1 keeps, so it leaves too.
    expect(claim.remove.sort()).toEqual(["n1", "o2", "o3"]);
    expect([...claim.held]).toEqual([slotOf("2026-10-19", "LinkedIn")]);
  });

  it("keeps the plan's own worked-on post even on a held slot", () => {
    const posts = [post("o1", OLD, "2026-10-19", "LinkedIn"), post("n1", NEW, "2026-10-19", "linkedin ")];
    const claim = claimWeek({ reportId: NEW, reportCreatedAt: reportCreated.get(NEW)!, today: "2026-10-19", posts, reportCreated, worked: new Set(["o1", "n1"]) });
    expect(claim.remove).toEqual([]);
  });

  it("never touches days already past", () => {
    const posts = [post("o1", OLD, "2026-10-19", "LinkedIn"), post("o2", OLD, "2026-10-22", "LinkedIn")];
    const claim = claimWeek({ reportId: NEW, reportCreatedAt: reportCreated.get(NEW)!, today: "2026-10-21", posts, reportCreated, worked: new Set() });
    expect(claim.remove).toEqual(["o2"]);
  });

  it("leaves posts a person added, whatever their source", () => {
    const posts = [post("a1", null, "2026-10-20", "LinkedIn", "ad_hoc"), post("i1", OLD, "2026-10-21", "Instagram", "insight")];
    const claim = claimWeek({ reportId: NEW, reportCreatedAt: reportCreated.get(NEW)!, today: "2026-10-19", posts, reportCreated, worked: new Set() });
    expect(claim).toEqual({ yielded: false, remove: [], held: new Set() });
  });

  it("does not take a week back from a newer plan when an older report is imported again", () => {
    const posts = [post("n1", NEW, "2026-10-19", "LinkedIn"), post("x1", NEWER, "2026-10-21", "LinkedIn")];
    const claim = claimWeek({ reportId: NEW, reportCreatedAt: reportCreated.get(NEW)!, today: "2026-10-19", posts, reportCreated, worked: new Set() });
    expect(claim).toEqual({ yielded: true, remove: [], held: new Set() });
  });

  it("is a no-op when the plan places a week again", () => {
    const posts = [post("n1", NEW, "2026-10-19", "LinkedIn"), post("n2", NEW, "2026-10-20", "Facebook")];
    const claim = claimWeek({ reportId: NEW, reportCreatedAt: reportCreated.get(NEW)!, today: "2026-10-19", posts, reportCreated, worked: new Set() });
    expect(claim).toEqual({ yielded: false, remove: [], held: new Set() });
  });
});

describe("weeksToPlan", () => {
  it("plans through the week after the next scheduled report", () => {
    // 16 Oct report, own week 19 Oct, next report Sat 7 Nov: 26 Oct, 2 Nov, 9 Nov.
    expect(weeksToPlan("2026-10-26", "2026-11-07T07:15:00+00:00")).toBe(3);
    // 7 Nov report, own week 9 Nov, next report Mon 7 Dec: 16 Nov to 14 Dec.
    expect(weeksToPlan("2026-11-16", "2026-12-07T07:15:00+00:00")).toBe(5);
  });
  it("plans three weeks when nothing is scheduled, and never more than six", () => {
    expect(weeksToPlan("2026-10-26", null)).toBe(3);
    expect(weeksToPlan("2026-10-26", "2027-03-01T00:00:00Z")).toBe(6);
    expect(weeksToPlan("2026-10-26", "2026-10-01T00:00:00Z")).toBe(1);
  });
});

describe("mondayOf", () => {
  it("finds the week's Monday from a date or a timestamp", () => {
    expect(mondayOf("2026-10-25")).toBe("2026-10-19");
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(mondayOf("2026-11-07T07:15:00+00:00")).toBe("2026-11-02");
  });
});
