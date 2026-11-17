// @vitest-environment node
// The design worker's side of locate: what it sends for a job, what it keeps
// from the answer, and the file finish stamps.
import { describe, expect, it } from "vitest";
import { REASONS, checkInput, locatePlan, locateRefusal, logoState, notThereYet, slotPlan, slotState, stampFile, stampOutcome, stampPlan, waitFor } from "../../../functions/_shared/design/logoChoice";
import { PictureError } from "../../../functions/_shared/picture/client";
import type { LocateResult, SlotResult } from "../../../functions/_shared/picture/contract";
import type { JobLogos } from "../../../functions/_shared/design/logoTone";

const STORED = "c1/design-settings/logo-site-aaaa.png";
const OTHER = "c1/design-settings/logo-0123456789abcdef-other.png";
const WHITE = "c1/design-settings/logo-0123456789abcdef-white.png";
const logos = (over: Partial<JobLogos> = {}): JobLogos => ({ files: { stored: STORED, other: OTHER, white: WHITE }, canvas: "stored", second: { file: "other", ground: "#0B0E1A" }, fixed: [], ...over });

describe("the locate request for a job", () => {
  it("sends one logo and one background for a job with one file", () => {
    const one = { shape: "one", logo: STORED, background: [255, 207, 218] };
    expect(locatePlan({ logo_path: STORED, generate: { background: "#FFCFDA" } })).toEqual(one);
    expect(locatePlan({ logo_path: STORED, generate: { background: "#FFCFDA" }, logos: null })).toEqual(one);
    // A set that does not hold its own canvas file is not read.
    expect(locatePlan({ logo_path: STORED, generate: { background: "#FFCFDA" }, logos: logos({ files: { stored: STORED }, canvas: "white" }) })).toEqual(one);
  });

  it("sends the canvas file first, the second template after it, and compares the rest", () => {
    expect(locatePlan({ logo_path: STORED, generate: { background: "#F7E8E5" }, logos: logos() })).toEqual({
      shape: "set",
      templates: [{ file: "stored", path: STORED, ground: [247, 232, 229] }, { file: "other", path: OTHER, ground: [11, 14, 26] }],
      compare: [{ file: "white", path: WHITE }],
    });
    // The copy on the canvas, on the ground the client's posts have: the stored file covers the light ground.
    expect(locatePlan({ logo_path: OTHER, generate: { background: "#0F294C" }, logos: logos({ files: { stored: STORED, other: OTHER }, canvas: "other", second: { file: "stored", ground: "#FFFFFF" } }) })).toEqual({
      shape: "set",
      templates: [{ file: "other", path: OTHER, ground: [15, 41, 76] }, { file: "stored", path: STORED, ground: [255, 255, 255] }],
      compare: [],
    });
    // No file serves the other ground: one template, and the rest compared.
    expect(locatePlan({ logo_path: STORED, generate: { background: "#0B0E1A" }, logos: logos({ files: { stored: STORED, white: WHITE }, second: null }) })).toEqual({
      shape: "set", templates: [{ file: "stored", path: STORED, ground: [11, 14, 26] }], compare: [{ file: "white", path: WHITE }],
    });
    // A file that serves both grounds is both templates, and is never compared with itself.
    expect(locatePlan({ logo_path: STORED, generate: { background: "#0B0E1A" }, logos: logos({ files: { stored: STORED }, second: { file: "stored", ground: "#FFFFFF" } }) })).toEqual({
      shape: "set", templates: [{ file: "stored", path: STORED, ground: [11, 14, 26] }, { file: "stored", path: STORED, ground: [255, 255, 255] }], compare: [],
    });
  });

  it("sends with each template the other files that may be stamped when it is the match", () => {
    // A set started under the rule of 17 Nov carries the lists: the white file serves the dark ground the copy's template covers.
    const names = { canvas: [], second: ["white" as const] };
    expect(locatePlan({ logo_path: STORED, generate: { background: "#E8E8E8" }, logos: logos({ names }) })).toEqual({
      shape: "set",
      templates: [{ file: "stored", path: STORED, ground: [232, 232, 232], names: [] }, { file: "other", path: OTHER, ground: [11, 14, 26], names: ["white"] }],
      compare: [{ file: "white", path: WHITE }],
    });
    // One template: its own list.
    expect(locatePlan({ logo_path: STORED, generate: { background: "#0B0E1A" }, logos: logos({ files: { stored: STORED, white: WHITE }, second: null, names: { canvas: ["white"], second: [] } }) })).toEqual({
      shape: "set", templates: [{ file: "stored", path: STORED, ground: [11, 14, 26], names: ["white"] }], compare: [{ file: "white", path: WHITE }],
    });
    // A job started before the lists existed sends none, and is answered as it was.
    const before = locatePlan({ logo_path: STORED, generate: { background: "#F7E8E5" }, logos: logos() });
    expect(before.shape === "set" && before.templates.every((t) => !("names" in t))).toBe(true);
  });

  it("marks a person's file and never compares it", () => {
    const person = "c1/design-settings/logo-other-9.png";
    expect(locatePlan({ logo_path: STORED, generate: { background: "#FFFFFF" }, logos: logos({ files: { stored: STORED, other: person, white: WHITE }, fixed: ["other"] }) })).toEqual({
      shape: "set",
      templates: [{ file: "stored", path: STORED, ground: [255, 255, 255] }, { file: "other", path: person, ground: [11, 14, 26], fixed: true }],
      compare: [{ file: "white", path: WHITE }],
    });
    // In no template (the white file is on the canvas and the stored file covers the light ground): a person's file is left out.
    expect(locatePlan({ logo_path: WHITE, generate: { background: "#0B0E1A" }, logos: logos({ files: { stored: STORED, other: person, white: WHITE }, canvas: "white", second: { file: "stored", ground: "#FFFFFF" }, fixed: ["other"] }) })).toEqual({
      shape: "set",
      templates: [{ file: "white", path: WHITE, ground: [11, 14, 26] }, { file: "stored", path: STORED, ground: [255, 255, 255] }],
      compare: [],
    });
  });
});

describe("what the worker keeps from locate's answer", () => {
  const answer = (over: Partial<LocateResult> = {}): LocateResult => ({ x: 466, y: 1218, width: 150, height: 44, score: 0.96437, usual: { x: 468, y: 1262, width: 152, height: 44 }, frame: [1088, 1360], ...over });

  it("names the file the service named", () => {
    const found = answer({ file: "other", matched: "stored", scores: [0.96437, 0.31449], gaps: { stored: 281.4567, other: 37.2412 } });
    expect(logoState({ logo_path: STORED, logos: logos() }, found)).toEqual({
      logo_score: 0.964, logo_rect: { x: 466, y: 1218, width: 150, height: 44 }, logo_frame: [1088, 1360],
      logo_file: OTHER, logo_named: "other", logo_matched: "stored", logo_scores: [0.964, 0.314], logo_gaps: { stored: 281.5, other: 37.2 },
    });
    // The white file, compared and never a template.
    expect(logoState({ logo_path: STORED, logos: logos() }, answer({ file: "white", matched: "stored", scores: [0.9], gaps: { white: 11.2 } }))).toMatchObject({ logo_file: WHITE, logo_named: "white", logo_matched: "stored" });
  });

  it("keeps today's state for a job with one file", () => {
    const state = logoState({ logo_path: STORED }, answer());
    expect(state).toEqual({ logo_score: 0.964, logo_rect: { x: 466, y: 1218, width: 150, height: 44 }, logo_frame: [1088, 1360] });
    expect(Object.keys(state)).toEqual(["logo_score", "logo_rect", "logo_frame"]);
    expect(Object.keys(logoState({ logo_path: STORED, logos: null }, answer()))).toEqual(["logo_score", "logo_rect", "logo_frame"]);
  });

  it("keeps the picture's own ground around the logo for review, for a job with one file too", () => {
    expect(logoState({ logo_path: STORED }, answer({ ground: [232, 232, 232] }))).toEqual({ logo_score: 0.964, logo_rect: { x: 466, y: 1218, width: 150, height: 44 }, logo_frame: [1088, 1360], logo_ground: [232, 232, 232] });
    expect(logoState({ logo_path: STORED, logos: logos() }, answer({ file: "stored", matched: "stored", scores: [0.9], gaps: {}, ground: [15, 41, 76] }))).toMatchObject({ logo_file: STORED, logo_ground: [15, 41, 76] });
  });

  it("makes a design again when the match is not the logo, or when no file that may be stamped shows on the picture's ground", () => {
    // Found at a size the client uses, and a file to stamp: the design goes on.
    expect(locateRefusal(answer())).toBeNull();
    expect(locateRefusal(answer({ file: "other", matched: "other", scores: [0.31, 0.964], ground: [20, 20, 20] }))).toBeNull();
    // The test a design always had.
    expect(locateRefusal(answer({ score: 0.471, scores: [0.407, 0.471] }))).toBe("logo match 0.471 at 0.99 of the usual width (each file: 0.407, 0.471)");
    expect(locateRefusal(answer({ score: 0.61 }))).toBe("logo match 0.61 at 0.99 of the usual width");
    expect(locateRefusal(answer({ width: 60 }))).toMatch(/^logo match 0\.964 at 0\.39 of the usual width/);
    // A match that is the logo, on a picture whose ground has the color of a whole part of every file that may be stamped.
    expect(locateRefusal(answer({ file: null, matched: "stored", scores: [0.974], lost: true, ground: [26, 26, 25] }))).toBe("logo match 0.964, and a part of the logo does not show on the picture behind it (#1A1A19)");
    expect(locateRefusal(answer({ lost: true }))).toBe("logo match 0.964, and a part of the logo does not show on the picture behind it (its ground)");
    // A low match is said first, whatever else is true.
    expect(locateRefusal(answer({ score: 0.4, lost: true, ground: [26, 26, 25] }))).toBe("logo match 0.4 at 0.99 of the usual width");
  });

  it("stores the rectangle to stamp when the service gave one", () => {
    const stamp = { x: 466, y: 1216, width: 150, height: 48 };
    expect(logoState({ logo_path: STORED, logos: logos() }, answer({ file: "other", matched: "stored", scores: [0.9], gaps: {}, stamp })).logo_rect).toEqual(stamp);
  });

  it("stamps the job's own logo when no file was named", () => {
    // An answer with no file named: the canvas file, which is the job's logo_path.
    expect(logoState({ logo_path: OTHER, logos: logos({ canvas: "other" }) }, answer({ matched: "other", scores: [0.9], gaps: {} }))).toMatchObject({ logo_file: OTHER, logo_named: "other" });
    expect(stampFile({ logo_path: STORED }, { logo_file: OTHER })).toBe(OTHER);
    expect(stampFile({ logo_path: STORED }, {})).toBe(STORED);
    expect(stampFile({ logo_path: STORED }, null)).toBe(STORED);
    expect(stampFile({ logo_path: STORED }, { logo_file: "" })).toBe(STORED);
  });
});

describe("a stored design checked against the client's live set", () => {
  it("builds a stored design's locate from the client's live set and the job's own placement, and nothing when there is no current set", () => {
    const placement = { anchor: "center" as const, width: 0.14, top: 0.928 };
    const row = {
      logo_path: STORED, background: "#FFFFFF",
      logo_set: {
        of: STORED, rule: 2, own: "light", both: false, inks: [[23, 87, 132]], other: { path: OTHER, from: "made", size: [300, 87] }, white: null, made: { other: OTHER, white: null }, site: null,
        posts: { read: 16, found: 5, shown: { stored: 0, other: 5, white: 0 } }, canvas: { file: "other", ground: "#0F294C", from: "client_posts" }, at: "2026-11-16T09:00:00.000Z",
      },
    };
    // The job was made with one file on white; the check asks what the live set would recognize on its design.
    const job = { input: { logo_path: STORED, placement, generate: { background: "#FFFFFF" } } };
    const input = checkInput(row, job)!;
    expect(input).toEqual({
      logo_path: OTHER, generate: { background: "#0F294C" }, placement,
      logos: { files: { stored: STORED, other: OTHER }, canvas: "other", second: { file: "stored", ground: "#FFFFFF" }, fixed: [], names: { canvas: [], second: [] } },
      // The files a design started from this set may be stamped with (17 Nov 2026).
      stamp: [{ file: "stored", path: STORED }, { file: "other", path: OTHER }],
    });
    expect(locatePlan(input)).toEqual({
      shape: "set",
      templates: [{ file: "other", path: OTHER, ground: [15, 41, 76], names: [] }, { file: "stored", path: STORED, ground: [255, 255, 255], names: [] }],
      compare: [],
    });
    expect(checkInput({ ...row, logo_set: null }, job)).toBeNull();
    expect(checkInput({ ...row, logo_path: "c1/newer-logo.png" }, job)).toBeNull();
  });
});

describe("the slot: what the worker asks and keeps", () => {
  const STAMP = [{ file: "stored" as const, path: STORED }, { file: "other" as const, path: OTHER, last: true as const }, { file: "white" as const, path: WHITE }];
  const slot = (over: Partial<SlotResult> = {}): SlotResult => ({
    slot: { x: 785, y: 154, width: 594, height: 113 }, from: "drawn", of: "stored", index: 0, frame: [2176, 2720], canvas: { x: 816, y: 109, width: 544, height: 103 },
    drawn: { x: 785, y: 154, width: 594, height: 113 }, score: 0.91834, matched: "stored", scores: [0.91834], ...over,
  });

  it("asks for the slot with the job's own templates, one for a job with one file", () => {
    expect(slotPlan({ logo_path: STORED, generate: { background: "#FFCFDA" } })).toEqual({ templates: [{ file: "stored", path: STORED, ground: [255, 207, 218] }] });
    expect(slotPlan({ logo_path: STORED, generate: { background: "#F7E8E5" }, logos: logos() })).toEqual({
      templates: [{ file: "stored", path: STORED, ground: [247, 232, 229] }, { file: "other", path: OTHER, ground: [11, 14, 26] }],
    });
  });

  it("keeps the slot as the rectangle the file is stamped at, with why and the template that found the drawing", () => {
    const plan = slotPlan({ logo_path: STORED, generate: { background: "#F7E8E5" }, logos: logos() });
    expect(slotState(plan, slot({ index: 1, matched: "other", of: "other", scores: [0.31, 0.91834] }))).toEqual({
      logo_score: 0.918, logo_rect: { x: 785, y: 154, width: 594, height: 113 }, logo_frame: [2176, 2720],
      logo_slot: { rect: { x: 785, y: 154, width: 594, height: 113 }, from: "drawn", of: "other", template: { file: "other", ground: [11, 14, 26] } }, logo_matched: "other", logo_scores: [0.31, 0.918],
    });
    // Nothing found: the canvas rectangle, in the canvas file's shape, and no template to look for again.
    const weak = slot({ slot: { x: 816, y: 109, width: 544, height: 103 }, from: "canvas", of: "stored", score: 0.2351, scores: [0.2351, 0.19], drawn: { x: 994, y: 192, width: 326, height: 62 } });
    expect(slotState(plan, weak)).toEqual({
      logo_score: 0.235, logo_rect: { x: 816, y: 109, width: 544, height: 103 }, logo_frame: [2176, 2720],
      logo_slot: { rect: { x: 816, y: 109, width: 544, height: 103 }, from: "canvas", of: "stored" }, logo_matched: "stored", logo_scores: [0.235, 0.19],
    });
  });

  it("asks about the cleaned slot with the job's stamp list, and looks for the drawing again only when it was found", () => {
    const state = { logo_rect: { x: 785, y: 154, width: 594, height: 113 }, logo_frame: [2176, 2720] as [number, number], logo_slot: { from: "drawn" as const, of: "stored" as const, template: { file: "stored" as const, ground: [247, 232, 229] as [number, number, number] } } };
    const input = { logo_path: STORED, generate: { background: "#F7E8E5" }, logos: logos(), stamp: STAMP };
    expect(stampPlan(input, state)).toEqual({ rect: state.logo_rect, frame: [2176, 2720], of: "stored", files: STAMP, drawn: { file: "stored", ground: [247, 232, 229] } });
    expect(stampPlan(input, { ...state, logo_slot: { from: "canvas", of: "stored" } })).toEqual({ rect: state.logo_rect, frame: [2176, 2720], of: "stored", files: STAMP });
    // The slot stays where it was found when a file of another shape was stamped at a fitted rectangle and the picture is cleaned once more.
    const slot = { x: 785, y: 154, width: 594, height: 113 };
    expect(stampPlan(input, { ...state, logo_rect: { ...slot, y: 140, height: 141 }, logo_slot: { rect: slot, from: "canvas", of: "stored" } }).rect).toEqual(slot);
  });

  it("builds the stamp list of a job from before this change from its files, and of a job with one file from its logo", () => {
    const state = { logo_rect: { x: 466, y: 1218, width: 150, height: 44 }, logo_frame: [1088, 1360] as [number, number] };
    // A job that was located by the old step: its found rectangle is its slot, and the matched template is looked for again.
    const old = stampPlan({ logo_path: STORED, generate: { background: "#F7E8E5" }, logos: logos() }, { ...state, logo_matched: "other" });
    expect(old).toEqual({
      rect: state.logo_rect, frame: [1088, 1360], of: "other",
      files: [{ file: "stored", path: STORED }, { file: "other", path: OTHER }, { file: "white", path: WHITE }],
      drawn: { file: "other", ground: [11, 14, 26] },
    });
    expect(stampPlan({ logo_path: STORED, generate: { background: "#FFCFDA" } }, state)).toEqual({
      rect: state.logo_rect, frame: [1088, 1360], of: "stored", files: [{ file: "stored", path: STORED }], drawn: { file: "stored", ground: [255, 207, 218] },
    });
  });

  it("stamps the file chosen for the ground, where the service says", () => {
    const plan = { files: STAMP };
    const got = stampOutcome(plan, { ground: [212, 240, 245], flat: 0.97342, file: "stored", rect: { x: 785, y: 154, width: 594, height: 113 }, shows: { stored: 1.83, other: 16.1, white: 1.19 }, drawn: { score: 0.1182, found: false } }, "Brand");
    expect(got).toEqual({ next: "stamp", state: {
      logo_file: STORED, logo_named: "stored", logo_rect: { x: 785, y: 154, width: 594, height: 113 },
      logo_ground: [212, 240, 245], logo_flat: 0.973, logo_shows: { stored: 1.83, other: 16.1, white: 1.19 }, logo_clean: 0.118,
    } });
    expect(stampOutcome(plan, { ground: [98, 2, 73], flat: 0.99, file: "white", rect: { x: 816, y: 109, width: 544, height: 143 }, shows: { stored: 1.62, white: 12.93 } }, "Brand")).toMatchObject({ next: "stamp", state: { logo_file: WHITE, logo_named: "white" } });
  });

  it("sends the picture to be cleaned again when the drawing is still there, and says why if cleaning is used up", () => {
    const got = stampOutcome({ files: STAMP }, { ground: [20, 20, 20], flat: 0.5, file: "white", rect: { x: 1, y: 1, width: 10, height: 4 }, shows: {}, drawn: { score: 0.9123, found: true } }, "Brand");
    expect(got).toEqual({ next: "clean", where: "the Brand logo, which is still in the picture", reason: "marks: the logo drawn at its place is still there after cleaning (match 0.912)" });
  });

  it("makes the design again when no file shows on the ground, and says which ground", () => {
    const got = stampOutcome({ files: STAMP }, { ground: [244, 244, 244], flat: 0.9, file: null, rect: { x: 1, y: 1, width: 10, height: 4 }, shows: { stored: 1.1, white: 1.09 } }, "Brand");
    expect(got).toEqual({ next: "again", reason: "ground: no logo file shows on the picture under the logo (#F4F4F4)" });
  });

  it("says in each reason what the design is made again for", () => {
    expect(REASONS.words(["Wrong", "words"])).toBe('words: read as ["Wrong","words"]');
    expect(REASONS.band(["Inside"])).toBe('words: outside the Story\'s band, which reads ["Inside"]');
    expect(REASONS.marks("three stripes on the boot")).toBe("marks: could not be cleaned out: three stripes on the boot");
    expect(REASONS.touched("a frame line")).toBe("logo's place: touched by a frame line");
  });

  it("waits for a service that does not know the new routes yet, and for nothing else", () => {
    const e = (why: "refused" | "unusable" | "unavailable", status?: number) => new PictureError("x", "slot", why, status);
    expect(notThereYet(e("refused", 404))).toBe(true);
    expect(notThereYet(e("refused", 400))).toBe(false);
    expect(notThereYet(e("refused", 401))).toBe(false);
    expect(notThereYet(e("unusable"))).toBe(false);
    expect(notThereYet(new Error("x"))).toBe(false);
    const waits = waitFor(e("refused", 404));
    expect(waits).toBeInstanceOf(PictureError);
    expect((waits as PictureError).transient).toBe(true);
    const other = e("refused", 400);
    expect(waitFor(other)).toBe(other);
  });
});
