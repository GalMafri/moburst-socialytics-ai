import { describe, it, expect } from "vitest";
import { REFERENCE_SECONDS, cleanFootagePrompt, clipScript, composeScript, footageTextPrompt, parseClipped, parseComposed, parseFootageText, referenceClipPath, shellQuote } from "./compose";
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

describe("reference cuts", () => {
  it("cuts a short stretch from the middle of each of the client's videos, keeping its sound", () => {
    const script = clipScript([
      { sourceUrl: "https://s/a.mp4", uploadUrl: "https://s/up-a" },
      { sourceUrl: "https://s/b.mp4", uploadUrl: "https://s/up-b" },
    ]);
    expect(script).toContain("-o src0.mp4 'https://s/a.mp4'");
    expect(script).toContain("-o src1.mp4 'https://s/b.mp4'");
    expect(script).toContain(`-t ${REFERENCE_SECONDS}`);
    expect(script).toContain("s = d / 2 -");
    expect(script).toContain('-map "0:a?"');
    expect(script).toContain("@clip1.mp4 'https://s/up-b'");
    expect(script.split("\n").pop()).toBe('echo "CLIPPED 2"');
  });
  it("keeps each cut beside its video, and accepts only a reply that counts every cut", () => {
    expect(referenceClipPath("c/video-ab.mp4")).toBe(`c/video-ab-ref${REFERENCE_SECONDS}s.mp4`);
    expect(parseClipped("CLIPPED 3", 3)).toBe(true);
    expect(parseClipped("CLIPPED 2", 3)).toBe(false);
    expect(parseClipped("FAILED: curl (22)", 1)).toBe(false);
  });
});

describe("footage stills", () => {
  it("keeps stills of the footage alone, spread across it, before anything is laid over it", () => {
    const script = composeScript({
      footageUrl: "https://s/f.mp4", overlayUrl: "https://s/hook.png", logoUrl: "https://s/logo.png",
      logo: { x: 1, y: 2, width: 3 }, uploadUrl: "https://s/up", frameUploads: ["https://s/s0", "https://s/s1"],
    });
    expect(script).toContain("$1 * 0.250");
    expect(script).toContain("$1 * 0.750");
    expect(script).toContain("@still1.jpg 'https://s/s1'");
    expect(script.indexOf("still0.jpg")).toBeLessThan(script.indexOf("-filter_complex"));
  });
  it("asks about any writing, garbled or not, and reads the answer", () => {
    expect(footageTextPrompt()).toMatch(/labels on screens, dashboards or charts.*garbled/);
    expect(parseFootageText('{"writing": true, "where": "labels on the "dashboard" panels"}')).toEqual({ writing: true, where: 'labels on the "dashboard" panels' });
    expect(parseFootageText('{"writing": false, "where": ""}')).toEqual({ writing: false, where: "" });
    expect(parseFootageText("no idea")).toBeNull();
  });
});

describe("cleaned footage", () => {
  it("keeps the first footage's sound when the picture was cleaned", () => {
    const script = composeScript({
      footageUrl: "https://s/clean.mp4", overlayUrl: "https://s/hook.png", logoUrl: "https://s/logo.png",
      logo: { x: 1, y: 2, width: 3 }, uploadUrl: "https://s/up", audioUrl: "https://s/first.mp4",
    });
    expect(script).toContain("-o sound.mp4 'https://s/first.mp4'");
    expect(script).toContain("-i sound.mp4");
    expect(script).toContain('-map "3:a?"');
  });
  it("asks for every piece of writing and brand mark to go, keeping the rest", () => {
    expect(cleanFootagePrompt()).toMatch(/stripes or emblems of real brands/);
    expect(cleanFootagePrompt()).toMatch(/Keep everything else exactly as it is/);
  });
});

