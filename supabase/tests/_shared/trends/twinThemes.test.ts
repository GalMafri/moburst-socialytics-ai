// QA 22 Nov 2026 (P52-02): parseThemes accepts two themes with the same title (and one post listed twice in a theme).
import { describe, it, expect } from "vitest";
import { parseThemes } from "../../../functions/_shared/trends/themes";

const kept = [1, 2, 3, 4].map((i) => ({
  platform: "tiktok", url: `https://www.tiktok.com/@a/video/${i}`, author: "a", text: "t", posted_at: null,
  views: 0, likes: 0, comments: 0, shares: 0, saves: 0, engagement: 0, search: "s", fit: 80, why: "w", lesson: "l", format: "short_video",
})) as never[];
const theme = (title: string, post_ids: string[]) => ({ title, happening: "h", why_it_matters: "w", angle: "a", post_ids });

describe("P52-02 one trend, one theme", () => {
  it("refuses (or merges) two themes whose titles match as a dismissal compares them", () => {
    const got = parseThemes(JSON.stringify({ themes: [theme("AI intake tools", ["K1"]), theme("ai intake tools", ["K2"]), theme("Other", ["K3"])] }), kept);
    const titles = "value" in got ? got.value.map((t) => t.title.toLowerCase()) : [];
    expect(new Set(titles).size).toBe(titles.length);
  });
  it("lists a post once per theme", () => {
    const got = parseThemes(JSON.stringify({ themes: [theme("A", ["K1", "K1"]), theme("B", ["K2"]), theme("C", ["K3"])] }), kept);
    const urls = "value" in got ? got.value[0].post_urls : [];
    expect(urls).toEqual([...new Set(urls)]);
  });
});
