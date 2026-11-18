// @vitest-environment node
// A video in its platform's upload size (18 Nov 2026): which row a video
// post reads, what a stored size becomes, and that a vertical video is made
// exactly as before. The vertical outputs are compared with what the code
// gave before this change (supabase/fixtures/video-sizes/vertical-before.json,
// written from the code at c7ed32fc with the same inputs).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { functionsDir } from "../../paths.ts";
import { fakeDb } from "../../../functions/_shared/lifecycle/fakeDb";
import { VERTICAL, checkVideoSize, isVertical, jobVideoFrame, videoFrameOf, videoShapeWords, videoSizeKey } from "../../../functions/_shared/video/videoSize";
import { readVideoSize } from "../../../functions/_shared/video/videoSizeDb";
import { CARD_SIZE, VIDEO_SIZE, captionsAss, composeScript, hookPlacement, videoLogoBox } from "../../../functions/_shared/video/compose";
import { CLIP, QUOTE_PROMPT, clipRequest, footageRules, framePrompt, quoteClip } from "../../../functions/_shared/video/clip";
import { hookPrompt } from "../../../functions/_shared/video/hook";
import { shotBriefPrompt, videoPlannerPrompt } from "../../../functions/_shared/canva/options";

// Heavy files: give the event loop a turn between tests.
afterEach(() => new Promise<void>((r) => setImmediate(r)));

const before = JSON.parse(readFileSync(join(functionsDir, "..", "fixtures", "video-sizes", "vertical-before.json"), "utf8"));
const LANDSCAPE = checkVideoSize({ width: 1920, height: 1080 });
const wide = LANDSCAPE.ok ? LANDSCAPE.frame : VERTICAL;

describe("the row a video post reads", () => {
  it("is the platform's short_video row for a Reel, a Short or a vertical video", () => {
    expect(videoSizeKey({ platform: "YouTube", format: "Shorts" })).toEqual({ platform: "youtube", format: "short_video" });
    expect(videoSizeKey({ platform: "Instagram", format: "Reel" })).toEqual({ platform: "instagram", format: "short_video" });
    expect(videoSizeKey({ platform: "Facebook", format: "Reels" })).toEqual({ platform: "facebook", format: "short_video" });
  });

  it("is the platform's video row for any other post made as a video", () => {
    expect(videoSizeKey({ platform: "YouTube", format: "long_video" })).toEqual({ platform: "youtube", format: "video" });
    expect(videoSizeKey({ platform: "YouTube", format: "Video" })).toEqual({ platform: "youtube", format: "video" });
    expect(videoSizeKey({ platform: "TikTok", format: "" })).toEqual({ platform: "tiktok", format: "video" });
    expect(videoSizeKey({ platform: "Twitter/X", format: "video" })).toEqual({ platform: "x", format: "video" });
  });

  it("keeps a YouTube post vertical unless its format names a long or standard video", () => {
    expect(videoSizeKey({ platform: "YouTube", format: "" })).toEqual({ platform: "youtube", format: "short_video" });
    expect(videoSizeKey({ platform: "YouTube", format: null })).toEqual({ platform: "youtube", format: "short_video" });
    expect(videoSizeKey({ platform: "YouTube", format: "Video (9:16)" })).toEqual({ platform: "youtube", format: "short_video" });
    expect(videoSizeKey({ platform: "YouTube", format: "vertical video" })).toEqual({ platform: "youtube", format: "short_video" });
    expect(videoSizeKey({ platform: "YouTube", format: "Portrait clip" })).toEqual({ platform: "youtube", format: "short_video" });
    expect(videoSizeKey({ platform: "YouTube", format: "YouTube Video" })).toEqual({ platform: "youtube", format: "video" });
    expect(videoSizeKey({ platform: "YouTube", format: "Long-form video" })).toEqual({ platform: "youtube", format: "video" });
    expect(videoSizeKey({ platform: "YouTube", format: "Standard video" })).toEqual({ platform: "youtube", format: "video" });
    expect(videoSizeKey({ platform: "TikTok", format: "Video 9:16" })).toEqual({ platform: "tiktok", format: "short_video" });
  });

  it("is none for a post with no platform", () => {
    expect(videoSizeKey({ platform: null, format: "video" })).toBeNull();
  });
});

describe("what a stored size becomes", () => {
  it("is the vertical frame itself for 1080x1920, and for a smaller 9:16 size", () => {
    expect(checkVideoSize({ width: 1080, height: 1920 })).toEqual({ ok: true, frame: VERTICAL });
    expect(checkVideoSize({ width: 720, height: 1280 })).toEqual({ ok: true, frame: VERTICAL });
    expect(checkVideoSize({ width: 1440, height: 2560 })).toEqual({ ok: true, frame: VERTICAL });
    expect(VERTICAL.size).toEqual(VIDEO_SIZE);
    expect(VERTICAL.card).toEqual(CARD_SIZE);
    expect(VERTICAL.aspect).toBe(CLIP.aspect);
  });

  it("makes a YouTube video landscape: a 16:9 clip, a 1920x1080 MP4, pictures drawn at 1936x1088", () => {
    expect(wide).toEqual({ size: { width: 1920, height: 1080 }, card: { width: 1936, height: 1088 }, aspect: "16:9", label: "16:9", word: "landscape" });
    expect(checkVideoSize({ width: 1280, height: 720 })).toMatchObject({ ok: true, frame: { size: { width: 1920, height: 1080 }, aspect: "16:9" } });
  });

  it("asks the video model for its nearest aspect, and fills the stored shape", () => {
    const square = checkVideoSize({ width: 1080, height: 1080 });
    expect(square).toMatchObject({ ok: true, frame: { aspect: "1:1", size: { width: 1080, height: 1080 }, word: "square" } });
    const portrait = checkVideoSize({ width: 1080, height: 1350 });
    expect(portrait).toMatchObject({ ok: true, frame: { aspect: "3:4", label: "4:5", size: { width: 1080, height: 1350 }, word: "vertical" } });
    if (portrait.ok) {
      expect(portrait.frame.card.width % 16).toBe(0);
      expect(portrait.frame.card.height % 16).toBe(0);
    }
  });

  it("refuses a size it cannot make, on exact facts", () => {
    expect(checkVideoSize({ width: 1080.5, height: 1920 })).toEqual({ ok: false, reason: "not_whole" });
    expect(checkVideoSize({ width: 256, height: 144 })).toEqual({ ok: false, reason: "edge" });
    expect(checkVideoSize({ width: 7680, height: 4320 })).toEqual({ ok: false, reason: "edge" });
    expect(checkVideoSize({ width: 2400, height: 1000 })).toEqual({ ok: false, reason: "shape" });
  });

  it("is vertical for a request or a job with nothing, or nothing the check accepts", () => {
    expect(videoFrameOf(null)).toBe(VERTICAL);
    expect(videoFrameOf({ platform: "x", format: "image", width: 1600, height: 900 })).toBe(VERTICAL);
    expect(videoFrameOf({ platform: "youtube", format: "video", width: 100, height: 100 })).toBe(VERTICAL);
    expect(videoFrameOf({ platform: "youtube", format: "video", width: 1920, height: 1080 })).toMatchObject({ aspect: "16:9", platform: "youtube", format: "video" });
    expect(jobVideoFrame({})).toBe(VERTICAL);
    expect(jobVideoFrame({ video_frame: { size: { width: 1, height: 1 } } })).toBe(VERTICAL);
    expect(jobVideoFrame({ video_frame: wide })).toEqual(wide);
    expect(isVertical(VERTICAL)).toBe(true);
    expect(isVertical(wide)).toBe(false);
  });

  it("names the shape in the same words a vertical video always had", () => {
    expect(videoShapeWords(VERTICAL)).toBe("vertical video (9:16)");
    expect(videoShapeWords(wide)).toBe("landscape video (16:9)");
  });
});

describe("reading the size", () => {
  const table = [
    { platform: "youtube", format: "video", width: 1920, height: 1080, usable: true },
    { platform: "youtube", format: "short_video", width: 1080, height: 1920, usable: true },
    { platform: "tiktok", format: "video", width: 1080, height: 1920, usable: true },
    { platform: "youtube", format: "image", width: 1280, height: 720, usable: true },
  ];
  it("is the row of the post's platform and video format", async () => {
    expect(await readVideoSize(fakeDb({ platform_sizes: table }), { platform: "YouTube", format: "long_video" })).toEqual({ platform: "youtube", format: "video", width: 1920, height: 1080 });
    expect(await readVideoSize(fakeDb({ platform_sizes: table }), { platform: "YouTube", format: "Shorts" })).toEqual({ platform: "youtube", format: "short_video", width: 1080, height: 1920 });
  });
  it("is nothing with no row, a row it cannot make, or a table it cannot read: the video is made vertical", async () => {
    expect(await readVideoSize(fakeDb({ platform_sizes: table }), { platform: "Instagram", format: "Reel" })).toBeNull();
    expect(await readVideoSize(fakeDb({ platform_sizes: [{ platform: "youtube", format: "video", width: 256, height: 144 }] }), { platform: "YouTube", format: "video" })).toBeNull();
    expect(await readVideoSize({ from: () => { throw new Error("no connection"); } }, { platform: "YouTube", format: "video" })).toBeNull();
  });
});

describe("a vertical video is made exactly as before", () => {
  const words = [{ word: "Hello", start: 0.1, end: 0.5 }, { word: "there.", start: 0.6, end: 1.0 }, { word: "Next", start: 1.9, end: 2.2 }, { word: "line", start: 2.3, end: 2.6 }];
  const filmedA = { captions: "words" as const, caption_style: "bold uppercase with shadow", caption_font: "Montserrat", caption_color: "#ffffff", highlight_color: "#ffcc00", caption_position: "bottom" };
  const filmedB = { captions: "lines" as const, caption_style: "regular", caption_font: "Inter", caption_color: "#000000", highlight_color: "", caption_position: "middle", caption_y: 0.7 };
  const full = { footageUrl: "https://s/f.mp4", overlayUrl: "https://s/hook.png", hook: { crop: { x: 40, y: 1200, width: 1000, height: 300 }, at: { x: 90, y: 1100, width: 900 } }, logoUrl: "https://s/logo.png", logo: { x: 365, y: 92, width: 349, end: true }, uploadUrl: "https://s/up?t=a'b", frameUploads: ["https://s/s0", "https://s/s1"], captions: { assB64: "QUJD", fontUrl: "https://s/font.ttf" }, endCard: { url: "https://s/end.mp4", seconds: 2.5 } };
  const bare = { footageUrl: "https://s/f.mp4", overlayUrl: "https://s/hook.png", logoUrl: "https://s/logo.png", logo: { x: 365, y: 92, width: 349 }, uploadUrl: "https://s/up" };

  it("writes the same assembly script, with or without the frame named", () => {
    expect(composeScript(full)).toBe(before.composeFull);
    expect(composeScript({ ...full, size: VERTICAL.size })).toBe(before.composeFull);
    expect(composeScript(bare)).toBe(before.composeBare);
  });

  it("places the logo, the title and the captions where it always did", () => {
    const boxes = ["end", "top-left", "top-right", "bottom-center", "top-center", "bottom-left"].flatMap((at) => [0.05, 0.2, 0.9].map((s) => videoLogoBox(at, s, 2.5, VERTICAL.size)));
    expect(boxes).toEqual(before.logoBoxes);
    const hooks = ["bold lower third", "top of frame", "centered", "upper part"].flatMap((st) => [0, 300].map((lb) => hookPlacement({ x: 40, y: 900, width: 1000, height: 260 }, VERTICAL.card, st, lb, VERTICAL.size)));
    expect(hooks).toEqual(before.hookPlacements);
    expect(captionsAss(words, filmedA, [1.9], VERTICAL.size)).toBe(before.captionsA);
    expect(captionsAss(words, filmedB)).toBe(before.captionsB);
    expect(captionsAss(words, { ...filmedB, caption_y: undefined, caption_position: "top" })).toBe(before.captionsC);
    expect(captionsAss(words, { ...filmedB, caption_y: undefined, caption_position: "" })).toBe(before.captionsD);
  });

  it("orders, prices and prompts the clip in the same words and settings", () => {
    expect(clipRequest("p", "frame-1", ["k1"])).toEqual(before.clipRequest);
    expect(clipRequest("p", "frame-1", ["k1"], VERTICAL.aspect)).toEqual(before.clipRequest);
    expect(clipRequest(QUOTE_PROMPT, null, [])).toEqual(before.clipRequestQuote);
    expect(framePrompt("A brief.", footageRules("fictional", VERTICAL), VERTICAL)).toBe(before.framePrompt);
    expect(footageRules(undefined)).toBe(before.footageRulesNone);
    expect(hookPrompt("Brand", ["One", "Two"], "bold white", VERTICAL)).toBe(before.hookPrompt);
  });

  it("plans the post in the same words", () => {
    const shape = { word: VERTICAL.word, label: VERTICAL.label };
    expect(videoPlannerPrompt({ brand: "Brand", platform: "Instagram", copy: "c", voice: "v", visual: "x", count: 3, postCount: 5, recent: "r", frame: shape })).toBe(before.plannerPosts);
    expect(videoPlannerPrompt({ brand: "Brand", platform: "TikTok", copy: "c", voice: null, count: 2, postCount: 5, recent: "", filmed: "the founder speaks" })).toBe(before.plannerFilmed);
    // deno-lint-ignore no-explicit-any
    expect(videoPlannerPrompt({ brand: "Brand", platform: "YouTube", copy: "c", voice: null, count: 2, postCount: 5, recent: "", style: { people: "fictional", logo: "shown", logo_at: "end", on_screen_text: "words", text_style: "bold" } as any, videos: 3, framesPer: 8, frame: shape })).toBe(before.plannerStyle);
    expect(shotBriefPrompt({ brand: "Brand", platform: "TikTok", copy: "c", reason: "the founder speaks", format: "talking head", voice: "warm" })).toBe(before.shotBrief);
  });
});

describe("a landscape video", () => {
  it("is assembled at its own size, with an end card only when it is wide too", () => {
    const script = composeScript({ footageUrl: "https://s/f.mp4", overlayUrl: "https://s/h.png", uploadUrl: "https://s/u", endCard: { url: "https://s/e.mp4", seconds: 2 }, size: wide.size });
    expect(script).toContain("scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080");
    expect(script).toContain("scale=1920:1080,format=rgba");
    expect(script).toContain(`if [ "$EC_W" -gt "$EC_H" ]; then`);
    expect(script).not.toContain("1080:1920");
  });

  it("keeps the logo the size it is on a vertical frame, inside the frame", () => {
    const tall = videoLogoBox("top-right", 0.2, 2.5);
    const box = videoLogoBox("top-right", 0.2, 2.5, wide.size);
    expect(box.width).toBe(tall.width);
    expect(box.x + box.width).toBeLessThanOrEqual(1920);
    expect(box.y).toBe(Math.round(1080 * 0.06));
    const end = videoLogoBox("end", 0.3, 2, wide.size);
    expect(end).toMatchObject({ x: Math.round((1920 - end.width) / 2), end: true });
  });

  it("sets the title on the wide frame, clear of the bottom fifth", () => {
    const at = hookPlacement({ x: 100, y: 800, width: 1700, height: 200 }, wide.card, "lower third", 0, wide.size);
    expect(at.width).toBeLessThanOrEqual(Math.round(1920 * 0.9));
    expect(at.y + at.height).toBeLessThanOrEqual(Math.round(1080 * 0.78));
  });

  it("writes captions for the wide frame", () => {
    const ass = captionsAss([{ word: "Hi", start: 0, end: 1 }], { captions: "lines", caption_style: "", caption_font: "Inter", caption_color: "#ffffff", highlight_color: "", caption_position: "bottom" }, [], wide.size);
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
    expect(ass).toContain("Style: Cap,Inter,62,");
  });

  it("orders, prices and prompts its clip at 16:9", async () => {
    expect(clipRequest("p", null, [], wide.aspect).aspect).toBe("16:9");
    expect(framePrompt("A brief.", footageRules(undefined, wide), wide)).toMatch(/^Draw the opening frame of a landscape 16:9 social video/);
    expect(footageRules(undefined, wide)).toMatch(/^ Landscape 16:9, every part in sharp focus/);
    expect(hookPrompt("Brand", ["One"], "bold", wide)).toMatch(/^The on-screen title of a landscape \(16:9\) social video/);
    const shape = { word: wide.word, label: wide.label };
    expect(videoPlannerPrompt({ brand: "B", platform: "YouTube", copy: "c", voice: null, count: 2, postCount: 5, recent: "", frame: shape })).toContain("a new YouTube landscape video post (16:9)");
    expect(shotBriefPrompt({ brand: "B", platform: "YouTube", copy: "c", reason: "r", frame: shape })).toContain("film a new YouTube landscape video (16:9) on a phone");

    // The quote is read with the aspect the clip is ordered in (a stand-in caller: nothing is spent).
    const callTool = vi.fn(async () => ({ data: { cost: { credits: 128 } }, text: "", isError: false }));
    expect(await quoteClip({ callTool } as never, wide.aspect)).toBe(128);
    expect(await quoteClip({ callTool } as never)).toBe(128);
    const sent = callTool.mock.calls.map((c) => (c as unknown as [string, { params: Record<string, unknown> }])[1].params);
    expect(sent[0]).toMatchObject({ aspect_ratio: "16:9", get_cost: true, duration: 8, resolution: "1080p" });
    expect(sent[1]).toMatchObject({ aspect_ratio: "9:16", get_cost: true });
  });
});
