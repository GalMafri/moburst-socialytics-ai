// @vitest-environment node
// The design worker's side of locate: what it sends for a job, what it keeps
// from the answer, and the file finish stamps.
import { describe, expect, it } from "vitest";
import { checkInput, locatePlan, locateRefusal, logoState, stampFile } from "../../../functions/_shared/design/logoChoice";
import type { LocateResult } from "../../../functions/_shared/picture/contract";
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
