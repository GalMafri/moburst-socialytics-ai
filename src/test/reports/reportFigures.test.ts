// The monthly report's headline move: chosen from the six metrics the tiles show, on a base big enough to mean something.
import { describe, expect, it } from "vitest";
import { biggestMove, SHOWN_METRIC_KEYS } from "@/components/ui/stat-card";

const ch = (previous: number, current: number) => ({ previous, current, percent: previous > 0 ? ((current - previous) / previous) * 100 : null });

describe("biggestMove", () => {
  it("does not pick comments 1 to 0 or shares 1 to 19 when impressions moved by thousands", () => {
    const move = biggestMove({ impressions: ch(10000, 14000), comments: ch(1, 0), shares: ch(1, 19), reactions: ch(500, 520) });
    expect(move?.key).toBe("impressions");
    expect(Math.round(move!.percent)).toBe(40);
  });
  it("counts only the six metrics the tiles show", () => {
    expect(SHOWN_METRIC_KEYS).toEqual(["impressions", "reactions", "link_clicks", "video_views", "comments", "shares"]);
    expect(biggestMove({ engagements: ch(100, 300), impressions: ch(1000, 1100) })?.key).toBe("impressions");
  });
  it("returns null when every metric is on a tiny base", () => {
    expect(biggestMove({ comments: ch(1, 0), shares: ch(2, 9) })).toBeNull();
  });
});
