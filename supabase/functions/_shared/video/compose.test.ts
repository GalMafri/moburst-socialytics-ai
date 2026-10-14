import { describe, it, expect } from "vitest";
import { REFERENCE_SECONDS, VIDEO_SIZE, cleanFootagePrompt, framesScript, parseFrames, videoLogoBox, clipScript, composeScript, footageTextPrompt, hookPlacement, parseClipped, parseComposed, parseFootageText, referenceClipPath, shellQuote } from "./compose";
import { parseVideoBriefs, parseVideoStyle, sceneLettering, videoPlannerPrompt, videoStylePrompt, VIDEO_SECONDS } from "../canva/options";
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

describe("filmed clips", () => {
  it("plans only the hook over a filmed clip, clear of the speaker's face", () => {
    const p = videoPlannerPrompt({ brand: "Bader Law", platform: "Instagram", copy: "c", voice: null, count: 2, postCount: 13, recent: "", filmed: "Seth Bader" });
    expect(p).toContain("own filmed clip of Seth Bader speaking to camera");
    expect(p).toContain("speaker's face stays clear");
    expect(p).not.toContain("- footage:");
    const briefs = parseVideoBriefs(JSON.stringify({ options: [{ posts: [1], headline: ["Insurance called already?"], text: "bold white caps with a soft shadow, lower third" }] }), ["a.jpg"], { filmed: true });
    expect(briefs).toHaveLength(1);
    expect(parseVideoBriefs(JSON.stringify({ options: [{ posts: [1], headline: ["Insurance called already?"], text: "bold white caps with a soft shadow, lower third" }] }), ["a.jpg"])).toHaveLength(0);
  });
});

describe("hook placement", () => {
  const layer = { width: 1088, height: 1936 };
  const box = { x: 100, y: 900, width: 888, height: 200 };
  it("puts a lower-third hook above the platform's bottom fifth, centered, wherever the model drew it", () => {
    const at = hookPlacement(box, layer, "bold white caps with a soft shadow, lower third", 200);
    expect(at.y + at.height).toBe(Math.round(VIDEO_SIZE.height * 0.78));
    expect(at.x).toBe(Math.round((VIDEO_SIZE.width - at.width) / 2));
  });
  it("puts a top hook below the logo, and a centered one in the middle", () => {
    expect(hookPlacement(box, layer, "set at the top of the frame", 400).y).toBe(Math.round(400 + VIDEO_SIZE.height * 0.03));
    const c = hookPlacement(box, layer, "centered over the footage", 200);
    expect(c.y).toBe(Math.round((VIDEO_SIZE.height - c.height) / 2));
  });
  it("crops the lettering out of its layer and overlays it at its place", () => {
    const script = composeScript({
      footageUrl: "https://s/f.mp4", overlayUrl: "https://s/hook.png", logoUrl: "https://s/logo.png",
      logo: { x: 1, y: 2, width: 3 }, uploadUrl: "https://s/up", hook: { crop: box, at: { x: 90, y: 1200, width: 880 } },
    });
    expect(script).toContain("crop=888:200:100:900,scale=880:-1");
    expect(script).toContain("overlay=90:1200:shortest=1");
  });
});

describe("videos in the client's own video style", () => {
  const style = parseVideoStyle(JSON.stringify({
    format: "cinematic reels of fictional footballers in club kits", subjects: "one or two players in a purple-lit tunnel",
    shots: "slow close-ups, 2 to 3 s each, hard cuts", camera: "slow push-in", look: "deep purple, low key", people: "fictional",
    on_screen_text: "none", text_style: "", logo: "none", sound: "low drone and crowd", other_formats: "",
  }))!;
  it("reads the style, and plans from stills of the client's videos with made-up players and no text", () => {
    expect(style.people).toBe("fictional");
    expect(style.on_screen_text).toBe("none");
    const p = videoPlannerPrompt({ brand: "LegaBot", platform: "Instagram", copy: "c", voice: null, count: 3, postCount: 16, recent: "", style, videos: 2, framesPer: 8 });
    expect(p).toContain("stills from LegaBot's own published videos");
    expect(p).toContain("cinematic reels of fictional footballers");
    expect(p).toContain("made-up characters like the ones in the videos");
    expect(p).toContain("carry no text over the footage, so this video carries none");
    expect(p).not.toContain("- headline:");
    const briefs = parseVideoBriefs(JSON.stringify({ options: [{ footage: "Shot 1 (3s): a striker in a violet kit stares down the tunnel. Shot 2 (3s): close-up of laces.", seconds: 7 }] }), [], { textless: true });
    expect(briefs).toEqual([expect.objectContaining({ headline: [], seconds: 7 })]);
  });
  it("asks for captions written the way the client's videos put text on screen", () => {
    const captioned = { ...style, people: "none" as const, on_screen_text: "captions" as const, text_style: "white sentence-case captions near the bottom" };
    const p = videoPlannerPrompt({ brand: "Moburst", platform: "Instagram", copy: "c", voice: null, count: 3, postCount: 24, recent: "", style: captioned });
    expect(p).toContain("- headline: the text over the footage");
    expect(p).toContain("white sentence-case captions near the bottom");
    expect(p).toContain("no box, band, panel or overlay behind the text unless their videos have one");
    expect(p).toContain("no real or identifiable person");
  });
  it("asks for the style from the stills, in order", () => {
    expect(videoStylePrompt("Moburst", 3, 8)).toContain("Video 2 is images 9 to 16");
    expect(videoStylePrompt("Moburst", 3, 8)).toContain("leave out the brands and logos of other companies");
    expect(parseVideoStyle("nothing")).toBeNull();
  });
  it("takes stills spread across each video", () => {
    const script = framesScript([{ sourceUrl: "https://s/a.mp4", uploads: ["https://s/u0", "https://s/u1"] }]);
    expect(script).toContain("d * 0.2500");
    expect(script).toContain("@f0_1.jpg 'https://s/u1'");
    expect(parseFrames("FRAMES 2", 2)).toBe(true);
    expect(parseFrames("FRAMES 1", 2)).toBe(false);
  });
  it("joins footage with no hook and no logo when the client's videos have none", () => {
    const script = composeScript({ footageUrl: "https://s/f.mp4", uploadUrl: "https://s/up" });
    expect(script).not.toContain("hook.png");
    expect(script).not.toContain("logo.png");
    expect(script).toContain("[base]format=yuv420p[v]");
    expect(script).toContain('-map "0:a?"');
  });
});

describe("the logo where and when the client's own videos show it", () => {
  it("reads where the logo sits and how big it is", () => {
    const style = parseVideoStyle(JSON.stringify({ format: "3D explainer", logo: "shown", logo_at: "end", logo_width: 0.3 }))!;
    expect(style.logo_at).toBe("end");
    expect(style.logo_width).toBe(0.3);
    expect(parseVideoStyle(JSON.stringify({ format: "talks", logo: "shown", logo_at: "somewhere", logo_width: 4 }))).not.toHaveProperty("logo_at");
    expect(parseVideoStyle(JSON.stringify({ format: "reels", logo: "none", logo_at: "top-left" }))).not.toHaveProperty("logo_at");
  });
  it("tells the planner to end the footage the way the client's videos end before their logo", () => {
    const style = parseVideoStyle(JSON.stringify({ format: "3D explainer", people: "none", on_screen_text: "captions", logo: "shown", logo_at: "end", logo_width: 0.3 }))!;
    const p = videoPlannerPrompt({ brand: "Moburst", platform: "Instagram", copy: "c", voice: null, count: 3, postCount: 24, recent: "", style });
    expect(p).toContain("close on their logo");
    expect(p).toContain("- logo: closes the video");
  });
  it("puts a corner logo inside the frame's margins and a closing logo in the middle", () => {
    const corner = videoLogoBox("top-left", 0.15, 3);
    expect(corner).toMatchObject({ x: Math.round(VIDEO_SIZE.width * 0.06), y: Math.round(VIDEO_SIZE.height * 0.06), end: false });
    const right = videoLogoBox("bottom-right", 0.15, 3);
    expect(right.x + right.width).toBeLessThan(VIDEO_SIZE.width);
    expect(right.y + right.width / 3).toBeLessThanOrEqual(VIDEO_SIZE.height * 0.84 + 1);
    const end = videoLogoBox("end", 0.3, 3);
    expect(end.end).toBe(true);
    expect(end.x * 2 + end.width).toBe(VIDEO_SIZE.width);
  });
  it("fades a closing logo in over the last moments, and takes the text off as it arrives", () => {
    const script = composeScript({ footageUrl: "https://s/f.mp4", uploadUrl: "https://s/up", overlayUrl: "https://s/h.png", logoUrl: "https://s/l.png", logo: { x: 378, y: 900, width: 324, end: true } });
    expect(script).toContain("END=$(ffprobe");
    expect(script).toContain('FILTER="${FILTER//@END@/$END}"');
    expect(script).toContain("gte(t,@END@)");
    expect(script).toContain("lt(t,@END@)");
    expect(script).toContain('-filter_complex "$FILTER"');
  });
  it("keeps a corner logo on for the whole video", () => {
    const script = composeScript({ footageUrl: "https://s/f.mp4", uploadUrl: "https://s/up", logoUrl: "https://s/l.png", logo: { x: 65, y: 115, width: 162 } });
    expect(script).not.toContain("@END@");
    expect(script).not.toContain("END=");
  });
});

describe("the names in the client's own scenes", () => {
  const style = parseVideoStyle(JSON.stringify({ format: "hype reels of made-up clubs", people: "fictional", on_screen_text: "none", logo: "none",
    scene_words: ["EAGLE VISION MEDIA", " ZENTHAR  EAGLES ", "10", "", "x".repeat(60)] }))!;
  it("reads them spelled as shown, dropping empty and runaway entries", () => {
    expect(style.scene_words).toEqual(["EAGLE VISION MEDIA", "ZENTHAR EAGLES", "10"]);
    expect(parseVideoStyle(JSON.stringify({ format: "talks" }))).not.toHaveProperty("scene_words");
  });
  it("lets the planner put those names, and only those, on the things they are on in the client's videos", () => {
    const p = videoPlannerPrompt({ brand: "LegaBot", platform: "Instagram", copy: "c", voice: null, count: 3, postCount: 16, recent: "", style });
    expect(p).toContain('"EAGLE VISION MEDIA", "ZENTHAR EAGLES", "10"');
    expect(p).toContain("no real brand appears");
    expect(p).not.toContain("It holds no lettering");
    expect(sceneLettering("Moburst", [])).toContain("It holds no lettering");
  });
  it("counts only writing that is not one of those names, and keeps them when cleaning", () => {
    expect(footageTextPrompt(["CAIRO SUN"])).toContain('"CAIRO SUN"');
    expect(footageTextPrompt(["CAIRO SUN"])).toContain("misspelled or garbled version");
    expect(footageTextPrompt()).not.toContain("belong to the brand");
    const clean = cleanFootagePrompt(["CAIRO SUN"], "three-stripe marks on both boots");
    expect(clean).toContain("Remove these from this video: three-stripe marks on both boots");
    expect(clean).toContain('Keep these names exactly where and as they are: "CAIRO SUN"');
    expect(cleanFootagePrompt()).toContain("Remove every piece of writing");
  });
});

