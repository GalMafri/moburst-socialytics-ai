import { describe, it, expect } from "vitest";
import { TIMING, composeScript, parseComposed, shellQuote } from "./compose";
import { parseVideoBriefs, videoPlannerPrompt } from "../canva/options";
import { designPrompt } from "../canva/brief";

describe("video assembly", () => {
  const script = composeScript({ coverUrl: "https://s/c.png", endUrl: "https://s/e.png", footageUrl: "https://s/f.mp4", uploadUrl: "https://s/upload?token=a'b" });
  it("downloads the three parts, joins them at 1080x1920 and uploads the result", () => {
    expect(script).toContain("curl -fsSL --retry 3 -o cover.png 'https://s/c.png'");
    expect(script).toContain("-o clip.mp4 'https://s/f.mp4'");
    expect(script).toContain("scale=1080:1920");
    expect(script).toContain(`xfade=transition=fade:duration=${TIMING.fade}:offset=${TIMING.cover - TIMING.fade}`);
    expect(script).toContain("--data-binary @out.mp4 'https://s/upload?token=a'\"'\"'b'");
    expect(script.split("\n").pop()).toMatch(/^echo "COMPOSED /);
  });
  it("quotes values for bash", () => {
    expect(shellQuote("a'b")).toBe(`'a'"'"'b'`);
  });
  it("accepts only a real finished file", () => {
    expect(parseComposed("COMPOSED 7006274 11.800000")).toEqual({ bytes: 7006274, seconds: 11.8 });
    expect(parseComposed("FAILED: curl: (22)")).toBeNull();
    expect(parseComposed("COMPOSED 12 0.1")).toBeNull();
  });
});

describe("video briefs", () => {
  const library = ["a.jpg", "b.jpg"];
  it("keeps options with a cover, an end card and a written shot", () => {
    const text = JSON.stringify({ options: [
      { posts: [2], layout: "statement card", cover: { headline: ["AI answers changed search"], picture: "a glass prism on navy" }, end: { headline: ["Get found in AI answers"], picture: "the same prism, closer" }, footage: "A glass prism turns slowly on a navy stage while light splits into blue beams; the camera pushes in." },
      { cover: { headline: ["x"], picture: "y" }, end: { headline: ["z"], picture: "w" }, footage: "short" },
    ] });
    const briefs = parseVideoBriefs(text, library);
    expect(briefs).toHaveLength(1);
    expect(briefs[0].slides?.map((s) => s.headline[0])).toEqual(["AI answers changed search", "Get found in AI answers"]);
    expect(briefs[0].refs).toEqual(["b.jpg"]);
    expect(briefs[0].footage).toContain("glass prism");
  });
  it("asks for a 9:16 video with footage free of text, logos and people", () => {
    const p = videoPlannerPrompt({ brand: "Moburst", platform: "Instagram", copy: "c", voice: null, count: 3, postCount: 13, recent: "" });
    expect(p).toContain("vertical video post (9:16)");
    expect(p).toMatch(/footage: .*no lettering.*logos.*no real or identifiable person/);
  });
  it("describes the cards as a vertical video's opening and closing cards", () => {
    const cover = designPrompt({ brand_name: "Moburst", platform: "Instagram", concept: "a prism", video_card: "cover" }, ["Hook"], 2);
    const end = designPrompt({ brand_name: "Moburst", platform: "Instagram", concept: "a prism", video_card: "end" }, ["Close"], 2, { index: 1, count: 3, withCover: true });
    expect(cover).toContain("the opening card of a new Moburst Instagram vertical video (9:16)");
    expect(end).toContain("the closing card");
    expect(end).toContain("this video's opening card");
  });
});
