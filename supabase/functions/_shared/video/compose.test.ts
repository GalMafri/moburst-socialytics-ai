import { describe, it, expect } from "vitest";
import { composeScript, parseComposed, shellQuote } from "./compose";
import { parseVideoBriefs, videoPlannerPrompt, VIDEO_SECONDS } from "../canva/options";
import { hookPrompt } from "./hook";

describe("video assembly", () => {
  const script = composeScript({
    footageUrl: "https://s/f.mp4", overlayUrl: "https://s/hook.png", logoUrl: "https://s/logo.png",
    logo: { x: 365, y: 92, width: 349 }, uploadUrl: "https://s/upload?token=a'b",
  });
  it("lays the hook and the logo file over the footage at 1080x1920 and keeps the footage's sound", () => {
    expect(script).toContain("-o clip.mp4 'https://s/f.mp4'");
    expect(script).toContain("-o hook.png 'https://s/hook.png'");
    expect(script).toContain("-o logo.png 'https://s/logo.png'");
    expect(script).toContain("scale=1080:1920");
    expect(script).toContain("overlay=365:92");
    expect(script).toContain('-map "0:a?"');
    expect(script).toContain("--data-binary @out.mp4 'https://s/upload?token=a'\"'\"'b'");
    expect(script.split("\n").pop()).toMatch(/^echo "COMPOSED /);
  });
  it("quotes values for bash", () => {
    expect(shellQuote("a'b")).toBe(`'a'"'"'b'`);
  });
  it("accepts only a real finished file, and reports its sound", () => {
    expect(parseComposed("COMPOSED 7006274 8.000000 1")).toEqual({ bytes: 7006274, seconds: 8, audio: 1 });
    expect(parseComposed("FAILED: curl: (22)")).toBeNull();
    expect(parseComposed("COMPOSED 12 0.1 0")).toBeNull();
  });
});

describe("video briefs", () => {
  const library = ["a.jpg", "b.jpg"];
  it("keeps options with a hook, how it looks and a written shot, and keeps the length in range", () => {
    const text = JSON.stringify({ options: [
      { posts: [2], layout: "statement", headline: ["AI answers changed search"], text: "bold white sans-serif with a soft cyan glow, centered", footage: "A glass prism turns slowly on a navy stage while light splits into blue beams; the camera pushes in.", seconds: 30 },
      { headline: ["x"], text: "y", footage: "short" },
    ] });
    const briefs = parseVideoBriefs(text, library);
    expect(briefs).toHaveLength(1);
    expect(briefs[0].headline).toEqual(["AI answers changed search"]);
    expect(briefs[0].text_style).toContain("cyan glow");
    expect(briefs[0].refs).toEqual(["b.jpg"]);
    expect(briefs[0].seconds).toBe(VIDEO_SECONDS.max);
  });
  it("asks for footage in the client's own video style, free of text, logos and people, with the hook over it", () => {
    const p = videoPlannerPrompt({ brand: "Moburst", platform: "Instagram", copy: "c", voice: null, visual: "a robot scans cards", count: 3, postCount: 13, recent: "" });
    expect(p).toContain("vertical video post (9:16)");
    expect(p).toContain("given Moburst's own published videos as its reference");
    expect(p).toContain("The post's planned visual: a robot scans cards");
    expect(p).toMatch(/footage: .*no lettering.*logos.*no real or identifiable person/);
  });
  it("draws only the hook, exactly, on a transparent layer", () => {
    const p = hookPrompt("Moburst", ["Search and AI visibility", "aren't the same game."], "bold white sans-serif with a soft cyan glow, lower third");
    expect(p).toContain('"Search and AI visibility"');
    expect(p).toContain("transparent");
    expect(p).toContain("lower third");
    expect(p).toMatch(/no logo/i);
  });
});
