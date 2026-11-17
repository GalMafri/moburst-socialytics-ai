// @vitest-environment node
// A carousel's slides agree on one logo file (17 Nov 2026, carouselLogo.ts):
// the first in the client's order that shows on every slide's ground. When
// none does, each slide keeps the file its own ground took. Nothing is made
// again, stopped or failed for the rule, and no wait in it can outlast what
// it waits for. The rows here are plain objects, in an invented brand's
// colors.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type AgreeDeps, type CarouselLogo, type CoverRow, type SiblingRow, OF_THE_MEASUREMENT, agreeOnLogo, coverDecision, decideCarousel, followCarousel, inCarousel, measuredAgain, siblingStands, slotFacts } from "../../../functions/_shared/design/carouselLogo";
import { stampOutcome } from "../../../functions/_shared/design/logoChoice";
import { pickStamp } from "../../../functions/_shared/design/logoSlot";
import type { StampEntry } from "../../../functions/_shared/design/logoTone";
import { OF_THE_DESIGN } from "../../../functions/_shared/design/modelSteps";
import type { LogoFileName, Rect, Rgb, SlotFileResult } from "../../../functions/_shared/picture/contract";
import { functionsDir } from "../../paths";

// A two-color logo (a dark word and a bright sign) and its white copy, which the client's posts never show.
const NAVY: Rgb = [11, 14, 26], TEAL: Rgb = [0, 193, 213], WHITE: Rgb = [255, 255, 255];
const FILES: StampEntry[] = [{ file: "stored", path: "c1/design-settings/logo.png" }, { file: "white", path: "c1/design-settings/logo-white.png", last: true }];
const INKS: Partial<Record<LogoFileName, Rgb[]>> = { stored: [NAVY, TEAL], white: [WHITE] };
// Five similar photo grounds. On the last the dark word is at 1.37:1, under the line a part shows at.
const SLATE: Rgb[] = [[70, 84, 96], [82, 74, 66], [60, 92, 88], [90, 70, 100]];
const DEEP: Rgb = [38, 44, 52];
// A light and a dark ground: no one file of a dark one-color logo and its white copy shows on both.
const LIGHT: Rgb = [244, 244, 244], DARK: Rgb = [16, 16, 16];
const ONE_COLOR: Partial<Record<LogoFileName, Rgb[]>> = { stored: [NAVY], white: [WHITE] };
const SLOT: Rect = { x: 130, y: 136, width: 652, height: 218 };
const FITS: Partial<Record<LogoFileName, Rect>> = { stored: SLOT, white: SLOT };
const COVER = "c1/canva-finish/cover-job/design-1.png";
const NEXT_COVER = "c1/canva-finish/cover-job/design-2.png";
// A brand's own second file, for dark grounds, in another shape than the stored file: the service fits it to the slot's width and center.
const OWN_SECOND: StampEntry[] = [FILES[0], { file: "other", path: "c1/design-settings/logo-site.png" }];
const SECOND_INKS: Partial<Record<LogoFileName, Rgb[]>> = { stored: [NAVY], other: [WHITE] };
const TALLER: Rect = { x: 130, y: 107, width: 652, height: 277 };
const SECOND_FITS: Partial<Record<LogoFileName, Rect>> = { stored: SLOT, other: TALLER };

/** The cleaned slot's answer for one slide's ground, as the service gives it: the slide's own choice and the facts of every file. */
function answerOn(ground: Rgb | null, files: StampEntry[] = FILES, inks = INKS, fits = FITS): SlotFileResult {
  const picked = ground ? pickStamp(files.map((f) => ({ file: f.file, inks: inks[f.file] as Rgb[], last: f.last })), ground) : { file: files[0].file, shows: {} };
  return { ground, flat: ground ? 0.97 : 0, file: picked.file, rect: picked.file ? (fits[picked.file] as Rect) : SLOT, shows: picked.shows, inks, fits };
}

/** A slide's state once marks has passed, built the way the worker builds it: stampOutcome's state, then the slide's facts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function measured(ground: Rgb | null, extra: Record<string, unknown> = {}, files: StampEntry[] = FILES, inks = INKS, fits = FITS): Record<string, any> {
  const answer = answerOn(ground, files, inks, fits);
  const outcome = stampOutcome({ files }, answer, "Brand");
  if (outcome.next !== "stamp") throw new Error(`This ground takes no file alone: ${outcome.next}`);
  return { logo_frame: [2176, 2720], ...outcome.state, ...slotFacts(answer), ...extra };
}

/** The same once the slide is stamped with its own file and its checks have passed: where a single design would be done. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checked(ground: Rgb | null, extra: Record<string, unknown> = {}, files: StampEntry[] = FILES, inks = INKS, fits = FITS): Record<string, any> {
  const s = measured(ground, {}, files, inks, fits);
  const own = `c1/canva-finish/job/final-own-${s.logo_named}.png`;
  return { ...s, final_path: own, checks_passed: own, ...extra };
}

const cover = (ground: Rgb | null, extra: Record<string, unknown> = {}, inks = INKS) => checked(ground, { design_path: COVER, generations: 1, ...extra }, FILES, inks);
const sibling = (ground: Rgb | null, extra: Record<string, unknown> = {}, inks = INKS): SiblingRow => ({ status: "running", step: "verify", state: checked(ground, { cover_path: COVER, ...extra }, FILES, inks) });
/** A slide still on its way: drawn from the cover, measured, its checks not passed yet. */
const onItsWay = (ground: Rgb, step = "finish"): SiblingRow => ({ status: "running", step, state: measured(ground, { cover_path: COVER }) });

describe("which jobs the rule is for", () => {
  it("is a still slide of a carousel, and no other job", () => {
    const job = { design_request_id: "req-1", input: {} };
    expect(inCarousel({ ...job, slide_count: 5 })).toBe(true);
    expect(inCarousel({ ...job, slide_count: 2 })).toBe(true);
    expect(inCarousel({ ...job, slide_count: null })).toBe(false);
    expect(inCarousel({ ...job })).toBe(false);
    expect(inCarousel({ ...job, slide_count: 1 })).toBe(false);
    // A legacy video card, a job with no request, a job with no input.
    expect(inCarousel({ ...job, slide_count: 2, input: { kind: "video_card" } })).toBe(false);
    expect(inCarousel({ slide_count: 5, design_request_id: null, input: {} })).toBe(false);
    expect(inCarousel({ slide_count: 5, input: {} })).toBe(false);
    expect(inCarousel({ slide_count: 5, design_request_id: "req-1", input: null })).toBe(true);
  });
});

describe("what a carousel's slide keeps from the cleaned slot's answer", () => {
  it("is every listed file's inks and rectangle, and the file its own ground took", () => {
    expect(slotFacts(answerOn(DEEP))).toEqual({ logo_inks: INKS, logo_fits: FITS, logo_alone: "white" });
    expect(slotFacts(answerOn(SLATE[0]))).toEqual({ logo_inks: INKS, logo_fits: FITS, logo_alone: "stored" });
    // No file shows on the slide's own ground: the facts are still the answer's.
    expect(slotFacts({ ...answerOn(DEEP), file: null })?.logo_alone).toBeNull();
  });

  it("is nothing for a service that does not answer the files' facts yet", () => {
    const { inks: _inks, fits: _fits, ...before } = answerOn(DEEP);
    expect(slotFacts(before as SlotFileResult)).toBeNull();
    expect(slotFacts({ ...before, inks: INKS } as SlotFileResult)).toBeNull();
    expect(slotFacts({ ...before, fits: FITS } as SlotFileResult)).toBeNull();
    expect(slotFacts({ ...before, inks: null, fits: null } as unknown as SlotFileResult)).toBeNull();
  });

  it("goes with the design, like everything else that was measured on it or decided from it", () => {
    for (const key of Object.keys(slotFacts(answerOn(DEEP))!)) expect(OF_THE_DESIGN).toContain(key);
    for (const key of ["carousel_logo", "checks_passed", "logo_follows"]) expect(OF_THE_DESIGN).toContain(key);
    for (const key of OF_THE_MEASUREMENT) expect(OF_THE_DESIGN).toContain(key);
  });

  it("leaves nothing of an earlier measurement when the slide is measured again: no older ground is left for the decision to read", () => {
    // Measured on a ground, with a look for the drawing; then again, where the slot has no ground and no drawing was looked for.
    const first = { ...answerOn(DEEP), drawn: { score: 0.2, found: false } };
    const s: Record<string, unknown> = { logo_frame: [2176, 2720], cover_path: COVER, nologo_path: "n.png", ...(stampOutcome({ files: FILES }, first, "Brand") as { state: Record<string, unknown> }).state, ...slotFacts(first) };
    expect(s).toMatchObject({ logo_ground: DEEP, logo_clean: 0.2, logo_named: "white" });
    const again = answerOn(null);
    const outcome = stampOutcome({ files: FILES }, again, "Brand") as { state: Record<string, unknown> };
    // Without the clearing the older ground would stay: stampOutcome keeps a ground only when there is one.
    expect({ ...s, ...outcome.state }).toMatchObject({ logo_ground: DEEP, logo_clean: 0.2 });
    // The worker's marks step, in its order: what the earlier measurement left is cleared, then the new one is kept.
    measuredAgain(s);
    expect(Object.keys(s).sort()).toEqual(["cover_path", "logo_file", "logo_frame", "logo_named", "logo_rect", "nologo_path"]);
    Object.assign(s, outcome.state, slotFacts(again));
    expect(s.logo_ground).toBeUndefined();
    expect(s.logo_clean).toBeUndefined();
    expect(s).toMatchObject({ logo_named: "stored", logo_alone: "stored", logo_flat: 0, logo_inks: INKS });
    // So the cover's decision takes no ground from this slide.
    const row: SiblingRow = { status: "running", step: "verify", state: { ...s, checks_passed: "f.png" } };
    expect(decideCarousel(cover(SLATE[0]), [row], 1, FILES)).toMatchObject({ next: "decided", logo: { by: "every", file: "stored", grounds: 1 } });
  });
});

describe("where a sibling stands for the cover's decision", () => {
  it("is over when it failed or was canceled, whatever else its row says", () => {
    expect(siblingStands({ ...sibling(SLATE[0]), status: "failed" }, COVER)).toBe("over");
    expect(siblingStands({ ...sibling(SLATE[0]), status: "canceled" }, COVER)).toBe("over");
    expect(siblingStands({ status: "canceled", step: "generate", state: null }, COVER)).toBe("over");
  });

  it("waits while it is not drawn from this cover design: another design's, or a row started again", () => {
    expect(siblingStands(sibling(SLATE[0], { cover_path: NEXT_COVER }), COVER)).toBe("waits");
    // A row started again for the cover's next design has no cover_path at all.
    expect(siblingStands({ status: "running", step: "generate", state: { for_cover: 2 } }, COVER)).toBe("waits");
    expect(siblingStands({ status: "queued", step: "generate", state: null }, COVER)).toBe("waits");
  });

  it("waits until its own checks have passed, at every step and whatever it has measured", () => {
    for (const step of ["generate", "locate", "unlogo", "marks", "finish", "verify", "export"]) {
      expect(siblingStands(onItsWay(SLATE[0], step), COVER)).toBe("waits");
      expect(siblingStands({ status: "running", step, state: { cover_path: COVER } }, COVER)).toBe("waits");
    }
  });

  it("is ready once its checks have passed for this cover design, with or without the files' facts", () => {
    expect(siblingStands(sibling(SLATE[0]), COVER)).toBe("ready");
    expect(siblingStands({ status: "running", step: "verify", state: { cover_path: COVER, checks_passed: "f.png" } }, COVER)).toBe("ready");
  });

  it("is ready when it is done, whatever its row says: nothing more will be measured on it", () => {
    // Done by a worker from before the rule, done for a cover design the row was never started again for, done with nothing kept.
    expect(siblingStands({ status: "done", step: "finished", state: { cover_path: COVER } }, COVER)).toBe("ready");
    expect(siblingStands({ status: "done", step: "finished", state: { cover_path: NEXT_COVER } }, COVER)).toBe("ready");
    expect(siblingStands({ status: "done", step: "finished", state: null }, COVER)).toBe("ready");
  });
});

describe("the cover's decision", () => {
  const four = () => [sibling(SLATE[1]), sibling(SLATE[2]), sibling(SLATE[3]), sibling(DEEP)];

  it("waits while a slide's row is missing", () => {
    expect(decideCarousel(cover(SLATE[0]), four().slice(0, 3), 4, FILES)).toEqual({ next: "wait" });
    expect(decideCarousel(cover(SLATE[0]), [], 4, FILES)).toEqual({ next: "wait" });
  });

  it("waits while one slide's checks have not passed", () => {
    const rows = four();
    rows[2] = onItsWay(SLATE[3], "verify");
    expect(decideCarousel(cover(SLATE[0]), rows, 4, FILES)).toEqual({ next: "wait" });
  });

  it("is over when one slide failed, even while another is still on its way", () => {
    const rows = four();
    rows[0] = { ...rows[0], status: "failed" };
    rows[1] = onItsWay(SLATE[2], "unlogo");
    expect(decideCarousel(cover(SLATE[0]), rows, 4, FILES)).toEqual({ next: "over" });
  });

  it("is the first file that shows on every slide: one hidden slide of five moves all five to the white copy", () => {
    const got = decideCarousel(cover(SLATE[0]), four(), 4, FILES);
    expect(got).toEqual({ next: "decided", logo: { of: COVER, by: "every", file: "white", shows: { stored: 1.37, white: 7.33 }, grounds: 5 } });
  });

  it("is the stored file when it is only weak on every slide", () => {
    const rows = four();
    rows[3] = sibling([52, 60, 70]);
    const got = decideCarousel(cover(SLATE[0]), rows, 4, FILES);
    expect(got).toMatchObject({ next: "decided", logo: { of: COVER, file: "stored", by: "every", grounds: 5 } });
  });

  it("counts the cover's own ground: a cover alone on the hiding ground decides for the others", () => {
    const got = decideCarousel(cover(DEEP), [sibling(SLATE[0]), sibling(SLATE[1])], 2, FILES);
    expect(got).toMatchObject({ next: "decided", logo: { file: "white", by: "every", grounds: 3 } });
  });

  it("takes no constraint from a slide with no ground, with no facts of the files, or of another cover design", () => {
    // A slot with no pixel on the picture has no ground.
    const none = decideCarousel(cover(SLATE[0]), [sibling(SLATE[1]), sibling(null)], 2, FILES);
    expect(none).toMatchObject({ next: "decided", logo: { file: "stored", by: "every", grounds: 2 } });
    // A slide a worker from before the rule finished: its ground was read, but with no facts it is not counted.
    const past: SiblingRow = { status: "done", step: "finished", state: { cover_path: COVER, logo_ground: DEEP, logo_named: "white" } };
    expect(decideCarousel(cover(SLATE[0]), [sibling(SLATE[1]), past], 2, FILES)).toMatchObject({ next: "decided", logo: { file: "stored", by: "every", grounds: 2 } });
    // A done slide whose row was never started again for this cover design: ready, and its ground is another picture's.
    const stale: SiblingRow = { ...sibling(DEEP, { cover_path: NEXT_COVER }), status: "done", step: "finished" };
    expect(decideCarousel(cover(SLATE[0]), [sibling(SLATE[1]), stale], 2, FILES)).toMatchObject({ next: "decided", logo: { file: "stored", by: "every", grounds: 2 } });
    // A cover with no ground of its own: the slides' grounds decide.
    expect(decideCarousel(cover(null), [sibling(SLATE[1]), sibling(DEEP)], 2, FILES)).toMatchObject({ next: "decided", logo: { file: "white", by: "every", grounds: 2 } });
  });

  it("names no file when none shows on every slide: each slide keeps its own", () => {
    const light = cover(LIGHT, {}, ONE_COLOR), dark = sibling(DARK, {}, ONE_COLOR);
    expect(light.logo_named).toBe("stored");
    expect(dark.state!.logo_named).toBe("white");
    const got = decideCarousel(light, [dark], 1, FILES);
    expect(got).toEqual({ next: "decided", logo: { of: COVER, by: "own", shows: { stored: 1.01, white: 1.1 }, grounds: 2 } });
    expect((got as { logo: CarouselLogo }).logo).not.toHaveProperty("file");
  });

  it("belongs to the cover design it was made for", () => {
    const rows = four().map((r) => ({ ...r, state: { ...r.state, cover_path: NEXT_COVER } }));
    // The slides are of the cover's second design, the cover's state still says the first: nothing is decided from them.
    expect(decideCarousel(cover(SLATE[0]), rows, 4, FILES)).toEqual({ next: "wait" });
    expect(decideCarousel(cover(SLATE[0], { design_path: NEXT_COVER }), rows, 4, FILES)).toMatchObject({ next: "decided", logo: { of: NEXT_COVER } });
  });

  it("keeps the client's order: a file the job does not list is no candidate, and a copy kept for last stays last", () => {
    // The white copy shows whole on all five; the stored file is weak on all five and comes first.
    const rows = four();
    rows[3] = sibling([52, 60, 70]);
    expect(decideCarousel(cover(SLATE[0]), rows, 4, FILES)).toMatchObject({ logo: { file: "stored" } });
    // The same copy with nothing said against it is taken, because it shows whole.
    const shown: StampEntry[] = [FILES[0], { file: "white", path: FILES[1].path }];
    expect(decideCarousel(cover(SLATE[0]), rows, 4, shown)).toMatchObject({ logo: { file: "white" } });
    // The job lists the stored file only: the copy is not chosen though the service knows its inks.
    expect(decideCarousel(cover(SLATE[0]), rows, 4, [FILES[0]])).toMatchObject({ logo: { file: "stored" } });
  });
});

describe("what a slide learns from the cover's row", () => {
  const decision: CarouselLogo = { of: COVER, by: "every", file: "white", shows: {}, grounds: 5 };
  const row = (status: string, state: Record<string, unknown> | null): CoverRow => ({ status, state });

  it("is the decision once the row holds one for the cover design the slide was drawn from, whatever the cover does now", () => {
    for (const status of ["running", "queued", "done"]) expect(coverDecision(row(status, { design_path: COVER, carousel_logo: decision }), COVER)).toEqual({ next: "decided", logo: decision });
  });

  it("waits only while the cover is alive, on that design, and has not decided", () => {
    for (const status of ["running", "queued"]) expect(coverDecision(row(status, { design_path: COVER }), COVER)).toEqual({ next: "wait" });
    expect(coverDecision(row("running", { design_path: COVER, checks_passed: "f.png" }), COVER)).toEqual({ next: "wait" });
  });

  it("never comes when the cover is done without one, gone, failed or canceled", () => {
    // Done by a worker from before the rule, or measured without the files' facts.
    expect(coverDecision(row("done", { design_path: COVER }), COVER)).toEqual({ next: "never" });
    expect(coverDecision(row("done", null), COVER)).toEqual({ next: "never" });
    expect(coverDecision(null, COVER)).toEqual({ next: "never" });
    expect(coverDecision(undefined, COVER)).toEqual({ next: "never" });
    // A failed or canceled cover says nothing even when its row still holds a decision.
    for (const status of ["failed", "canceled"]) expect(coverDecision(row(status, { design_path: COVER, carousel_logo: decision }), COVER)).toEqual({ next: "never" });
  });

  it("never comes for a cover design the cover is no longer on", () => {
    // The cover is being made again (no design on its row), or is on its next design, with or without a decision for that one.
    expect(coverDecision(row("running", {}), COVER)).toEqual({ next: "never" });
    expect(coverDecision(row("running", null), COVER)).toEqual({ next: "never" });
    expect(coverDecision(row("running", { design_path: NEXT_COVER }), COVER)).toEqual({ next: "never" });
    expect(coverDecision(row("running", { design_path: NEXT_COVER, carousel_logo: { ...decision, of: NEXT_COVER } }), COVER)).toEqual({ next: "never" });
    expect(coverDecision(row("done", { design_path: NEXT_COVER, carousel_logo: { ...decision, of: NEXT_COVER } }), COVER)).toEqual({ next: "never" });
  });
});

describe("what one slide does with the cover's decision", () => {
  const WHITE_FOR_ALL: CarouselLogo = { of: COVER, by: "every", file: "white", shows: { stored: 1.37, white: 7.33 }, grounds: 5 };

  it("takes the carousel's file in place of the file its own ground took, at the same rectangle with nothing to look at again", () => {
    const s = checked(SLATE[0], { cover_path: COVER });
    expect(s).toMatchObject({ logo_named: "stored", logo_alone: "stored", logo_file: FILES[0].path });
    expect(followCarousel(s, WHITE_FOR_ALL, FILES)).toEqual({ next: "stamp", state: { logo_file: FILES[1].path, logo_named: "white", logo_rect: SLOT }, recheck: false });
  });

  it("stays as it is when it already has the carousel's file", () => {
    expect(followCarousel(checked(DEEP, { cover_path: COVER }), WHITE_FOR_ALL, FILES)).toEqual({ next: "keep", why: "same" });
  });

  it("stays as it is when the carousel has no one file", () => {
    const own: CarouselLogo = { of: COVER, by: "own", shows: { stored: 1.01, white: 1.1 }, grounds: 2 };
    expect(followCarousel(checked(LIGHT, { cover_path: COVER }, FILES, ONE_COLOR), own, FILES)).toEqual({ next: "keep", why: "own" });
    expect(followCarousel(checked(DARK, { cover_path: COVER }, FILES, ONE_COLOR), own, FILES)).toEqual({ next: "keep", why: "own" });
  });

  it("stamps a file of another shape at that file's own rectangle in this slide's slot, and has the logo's area looked at again", () => {
    const slide = (ground: Rgb) => checked(ground, { cover_path: COVER }, OWN_SECOND, SECOND_INKS, SECOND_FITS);
    const mid = slide([128, 128, 128]);
    expect(mid).toMatchObject({ logo_named: "stored", logo_rect: SLOT });
    expect(followCarousel(mid, { ...WHITE_FOR_ALL, file: "other" }, OWN_SECOND)).toEqual({ next: "stamp", state: { logo_file: OWN_SECOND[1].path, logo_named: "other", logo_rect: TALLER }, recheck: true });
    // And back: a slide that took the taller file alone takes the stored file at the slot.
    const weak = slide([52, 60, 70]);
    expect(weak).toMatchObject({ logo_named: "other", logo_rect: TALLER });
    expect(followCarousel(weak, { ...WHITE_FOR_ALL, file: "stored" }, OWN_SECOND)).toEqual({ next: "stamp", state: { logo_file: OWN_SECOND[0].path, logo_named: "stored", logo_rect: SLOT }, recheck: true });
  });

  it("is never made again: a slide whose ground hides the carousel's file keeps its own", () => {
    // Measured after the decision was made (the only way a slide can hide a file that showed on every slide).
    const got = followCarousel(checked(DEEP, { cover_path: COVER }), { of: COVER, by: "every", file: "stored", shows: {}, grounds: 5 }, FILES);
    expect(got).toEqual({ next: "keep", why: "hidden" });
  });

  it("takes a file that is only weak on its ground: under 3:1 is not hidden", () => {
    const s = checked([52, 60, 70], { cover_path: COVER, logo_named: "white", logo_file: FILES[1].path });
    expect(s.logo_shows.stored).toBeGreaterThanOrEqual(1.5);
    expect(s.logo_shows.stored).toBeLessThan(3);
    expect(followCarousel(s, { of: COVER, by: "every", file: "stored", shows: {}, grounds: 5 }, FILES)).toMatchObject({ next: "stamp", state: { logo_named: "stored" } });
  });

  it("keeps its own when the job does not list the carousel's file or has no rectangle for it, and takes it without a ground to test", () => {
    const s = checked(SLATE[0], { cover_path: COVER });
    expect(followCarousel(s, { ...WHITE_FOR_ALL, file: "other" }, FILES)).toEqual({ next: "keep", why: "unlisted" });
    const { logo_fits: _fits, ...bare } = s;
    expect(followCarousel(bare, WHITE_FOR_ALL, FILES)).toEqual({ next: "keep", why: "unlisted" });
    const none = checked(null, { cover_path: COVER });
    expect(none.logo_ground).toBeUndefined();
    expect(followCarousel(none, WHITE_FOR_ALL, FILES)).toMatchObject({ next: "stamp", state: { logo_named: "white" } });
  });

  it("has no outcome but taking the file or staying as it is", () => {
    const logos: CarouselLogo[] = [WHITE_FOR_ALL, { ...WHITE_FOR_ALL, file: "stored" }, { ...WHITE_FOR_ALL, file: "other" }, { of: COVER, by: "own", shows: {}, grounds: 2 }];
    let tried = 0;
    for (const ground of [...SLATE, DEEP, [52, 60, 70] as Rgb, null]) for (const logo of logos) {
      expect(["stamp", "keep"]).toContain(followCarousel(checked(ground, { cover_path: COVER }), logo, FILES).next);
      tried++;
    }
    expect(tried).toBe(28);
  });
});

// ── The agreement, run over rows ────────────────────────────────────────────

type Row = { slide_index: number; status: string; step: string; state: Record<string, unknown> | null };
type Calls = { stamps: string[]; looks: string[]; saves: number };

/**
 * One run of one row's job at its agreement, as the worker runs it: the job is the run's own copy of the row, the reads are of
 * the rows as they are, and what the run answers is kept as the worker's job loop keeps it (state saved; "done" ends the job).
 */
async function runAgreement(rows: Row[], index: number, calls: Calls, over: Partial<AgreeDeps> = {}, files: StampEntry[] = FILES): Promise<"done" | "wait"> {
  const row = rows[index];
  const job = { slide_index: row.slide_index, slide_count: rows.length, state: structuredClone(row.state ?? {}) };
  const deps: AgreeDeps = {
    siblings: async () => rows.filter((r) => r.slide_index > 0).map((r) => structuredClone({ status: r.status, step: r.step, state: r.state })) as SiblingRow[],
    cover: async () => { const c = rows.find((r) => r.slide_index === 0); return c ? structuredClone({ status: c.status, state: c.state }) as CoverRow : null; },
    save: async () => { calls.saves++; row.state = structuredClone(job.state); },
    stamp: async (logoPath) => { calls.stamps.push(`${row.slide_index}:${logoPath}`); return `c1/canva-finish/job/final-${row.slide_index}-carousel.png`; },
    clearAt: async (finalPath) => { calls.looks.push(finalPath); return true; },
    ...over,
  };
  const result = await agreeOnLogo(job, () => files, deps);
  row.state = structuredClone(job.state);
  if (result === "done") Object.assign(row, { status: "done", step: "finished" });
  return result;
}

const calls = (): Calls => ({ stamps: [], looks: [], saves: 0 });
/** A carousel whose every slide has passed its own checks: the cover first. */
const carousel = (grounds: Array<Rgb | null>, inks = INKS): Row[] => grounds.map((g, i) => ({ slide_index: i, status: "running", step: "verify", state: i === 0 ? cover(g, {}, inks) : sibling(g, {}, inks).state }));
/** The same for a client whose second file is its own, in another shape. */
const secondCarousel = (grounds: Rgb[]): Row[] => grounds.map((g, i) => ({ slide_index: i, status: "running", step: "verify", state: checked(g, i === 0 ? { design_path: COVER } : { cover_path: COVER }, OWN_SECOND, SECOND_INKS, SECOND_FITS) }));
/** The most passes any carousel here may take: a pass in which the cover decides, one in which the slides follow, and a spare for a slide that had to end first. */
const PASSES = 4;
/** Passes over every row whose job is waiting at its agreement, in the order given, until every such job has ended. Answers the passes it took; more than PASSES is a wait that did not end. */
async function runToEnd(rows: Row[], c: Calls, order: number[] = rows.map((_, i) => i), over: Partial<AgreeDeps> = {}, files: StampEntry[] = FILES): Promise<number> {
  const waiting = () => rows.some((r) => r.status === "running" && r.state?.checks_passed);
  let pass = 0;
  while (waiting() && pass <= PASSES) {
    pass++;
    for (const i of order) if (rows[i].status === "running" && rows[i].state?.checks_passed) await runAgreement(rows, i, c, over, files);
  }
  return pass;
}

describe("the agreement over a whole carousel", () => {
  it("ends with one file on all five slides where each slide alone took two, with one more stamp for each slide that changes", async () => {
    const rows = carousel([...SLATE, DEEP]);
    expect(rows.map((r) => r.state!.logo_named)).toEqual(["stored", "stored", "stored", "stored", "white"]);
    const c = calls();
    // The slides are handed out before the cover: each waits, the cover decides, and the next pass ends them.
    expect(await runToEnd(rows, c, [4, 3, 2, 1, 0])).toBe(2);
    expect(rows.every((r) => r.status === "done")).toBe(true);
    expect(rows.map((r) => r.state!.logo_named)).toEqual(Array(5).fill("white"));
    expect(rows.map((r) => r.state!.logo_file)).toEqual(Array(5).fill(FILES[1].path));
    expect(rows[0].state!.carousel_logo).toEqual({ of: COVER, by: "every", file: "white", shows: { stored: 1.37, white: 7.33 }, grounds: 5 });
    // Four slides are stamped again, the fifth already had the file; the rectangle is the same, so nothing is looked at again.
    expect([...c.stamps].sort()).toEqual([0, 1, 2, 3].map((i) => `${i}:${FILES[1].path}`));
    expect(c.looks).toEqual([]);
    expect(c.saves).toBe(1);
    // The delivered picture is the one stamped with the carousel's file; what each slide measured alone stays for review.
    expect(rows.slice(0, 4).map((r) => r.state!.final_path)).toEqual([0, 1, 2, 3].map((i) => `c1/canva-finish/job/final-${i}-carousel.png`));
    expect(rows[4].state!.final_path).toBe(rows[4].state!.checks_passed);
    expect(rows.map((r) => r.state!.logo_follows)).toEqual([...Array(4).fill({ of: COVER, file: "white" }), { of: COVER, kept: "same" }]);
    expect(rows.map((r) => r.state!.logo_alone)).toEqual(["stored", "stored", "stored", "stored", "white"]);
  });

  it("changes nothing on a carousel whose slides already agreed", async () => {
    const rows = carousel(SLATE);
    const before = rows.map((r) => r.state!.final_path);
    const c = calls();
    expect(await runToEnd(rows, c)).toBe(1);
    expect(rows.every((r) => r.status === "done" && r.state!.logo_named === "stored")).toBe(true);
    expect(rows.map((r) => r.state!.final_path)).toEqual(before);
    expect(c.stamps).toEqual([]);
    expect(rows.map((r) => r.state!.logo_follows)).toEqual(Array(4).fill({ of: COVER, kept: "same" }));
  });

  it("with light and dark slides: no one file, every slide keeps its own, and nothing is stamped or made again", async () => {
    const rows = carousel([LIGHT, [215, 197, 247], DARK], ONE_COLOR);
    const before = rows.map((r) => ({ named: r.state!.logo_named, final: r.state!.final_path }));
    const c = calls();
    await runToEnd(rows, c);
    expect(rows.every((r) => r.status === "done")).toBe(true);
    expect(rows[0].state!.carousel_logo).toMatchObject({ of: COVER, by: "own", grounds: 3 });
    expect(rows[0].state!.carousel_logo).not.toHaveProperty("file");
    expect(rows.map((r) => ({ named: r.state!.logo_named, final: r.state!.final_path }))).toEqual(before);
    expect(before.map((b) => b.named)).toEqual(["stored", "stored", "white"]);
    expect(rows.map((r) => r.state!.logo_follows)).toEqual(Array(3).fill({ of: COVER, kept: "own" }));
    expect(c.stamps).toEqual([]);
  });

  it("decides once: a cover that comes back uses the decision its row holds, and a slide that comes back does nothing more", async () => {
    const rows = carousel([...SLATE, DEEP]);
    // The cover decided and saved, and its run stopped before it was stamped again: the row holds the decision and the cover's own file.
    const decided = decideCarousel(rows[0].state!, rows.slice(1) as SiblingRow[], 4, FILES) as { logo: CarouselLogo };
    rows[0].state!.carousel_logo = decided.logo;
    // Meanwhile a slide's row is no longer what it was when the cover decided: the decision is not taken again.
    rows[4].state = sibling(SLATE[0]).state;
    const c = calls();
    expect(await runAgreement(rows, 0, c, { siblings: async () => { throw new Error("no read is made"); } })).toBe("done");
    expect(c.saves).toBe(0);
    expect(rows[0]).toMatchObject({ status: "done", state: { logo_named: "white", carousel_logo: { file: "white" }, logo_follows: { of: COVER, file: "white" } } });
    // A slide that settled and whose run comes back (its last write did not reach the row) is done as it is: no read, no stamp.
    await runAgreement(rows, 1, c);
    rows[1].status = "running";
    const again = calls();
    expect(await runAgreement(rows, 1, again, { cover: async () => { throw new Error("no read is made"); } })).toBe("done");
    expect(again).toEqual(calls());
  });

  it("looks at the logo's area again when the carousel's file has another shape, and leaves a slide as it was when the file would be touched there", async () => {
    const grounds: Rgb[] = [[128, 128, 128], [120, 112, 104], DEEP];
    // The dark slide moves the carousel to the taller file: the two others are stamped again at its rectangle and looked at.
    const rows = secondCarousel(grounds), c = calls();
    await runToEnd(rows, c, [0, 1, 2], {}, OWN_SECOND);
    expect(rows.map((r) => r.state!.logo_named)).toEqual(["other", "other", "other"]);
    expect(rows.map((r) => r.state!.logo_rect)).toEqual([TALLER, TALLER, TALLER]);
    expect(c.looks).toHaveLength(2);
    // The same carousel where something touches the taller file on the second slide: that slide stays as it passed its checks.
    const touched = secondCarousel(grounds), t = calls();
    const own = structuredClone(touched[1].state);
    await runToEnd(touched, t, [0, 1, 2], { clearAt: async (path) => !path.includes("final-1-") }, OWN_SECOND);
    expect(touched.every((r) => r.status === "done")).toBe(true);
    expect(touched.map((r) => r.state!.logo_named)).toEqual(["other", "stored", "other"]);
    expect(touched[1].state).toEqual({ ...own, logo_follows: { of: COVER, kept: "touched" } });
  });

  it("never costs a slide its finished picture: a second stamp or look that fails leaves the slide done as it was", async () => {
    const failures: Array<Partial<AgreeDeps>> = [
      { stamp: async () => { throw new Error("The picture service refused the call (400)."); } },
      { clearAt: async () => { throw new Error("The area around the logo could not be read"); } },
    ];
    for (const failing of failures) {
      const rows = secondCarousel([[128, 128, 128], DEEP]);
      const before = structuredClone(rows[0].state!);
      expect(await runToEnd(rows, calls(), [0, 1], failing, OWN_SECOND)).toBe(1);
      expect(rows.every((r) => r.status === "done")).toBe(true);
      expect(rows[0].state).toEqual({ ...before, carousel_logo: { of: COVER, by: "every", file: "other", shows: { stored: 1.37, other: 3.95 }, grounds: 2 }, logo_follows: { of: COVER, kept: "unstamped" } });
      expect(rows[0].state!.final_path).toBe(before.checks_passed);
    }
  });

  it("holds no decision the cover's row does not hold: a save that fails is no decision, and the cover decides again", async () => {
    const rows = carousel([...SLATE, DEEP]);
    const c = calls();
    expect(await runAgreement(rows, 0, c, { save: async () => { throw new Error("Could not save the job's progress: timeout"); } })).toBe("wait");
    expect(rows[0].state).not.toHaveProperty("carousel_logo");
    expect(rows[0]).toMatchObject({ status: "running", state: { logo_named: "stored" } });
    expect(c.stamps).toEqual([]);
    expect(await runAgreement(rows, 0, c)).toBe("done");
    expect(rows[0].state).toMatchObject({ carousel_logo: { file: "white" }, logo_named: "white" });
  });

  it("asks again on a later pass when the rows could not be read", async () => {
    const rows = carousel([...SLATE, DEEP]);
    const c = calls();
    expect(await runAgreement(rows, 0, c, { siblings: async () => null })).toBe("wait");
    expect(await runAgreement(rows, 2, c, { cover: async () => "unread" })).toBe("wait");
    expect(rows.every((r) => r.status === "running")).toBe(true);
    expect(c).toEqual(calls());
  });
});

describe("no wait outlasts what it waits for", () => {
  const WHITE_DECISION: CarouselLogo = { of: COVER, by: "every", file: "white", shows: {}, grounds: 5 };
  /** A waiting slide of the carousel, with the cover's row as given. */
  const withCover = (coverRow: Row | null): Row[] => [...(coverRow ? [coverRow] : []), { slide_index: 2, status: "running", step: "verify", state: sibling(SLATE[1]).state }];
  const slideOf = (rows: Row[]) => rows.findIndex((r) => r.slide_index === 2);

  it("a slide whose cover is done with no decision for its design is done with its own file, at once", async () => {
    // The deploy caught the carousel mid-flight: a worker from before the rule finished the cover.
    for (const state of [{ design_path: COVER, final_path: "f.png" }, cover(SLATE[0]), null]) {
      const rows = withCover({ slide_index: 0, status: "done", step: "finished", state });
      const c = calls();
      expect(await runAgreement(rows, slideOf(rows), c)).toBe("done");
      expect(rows[slideOf(rows)]).toMatchObject({ status: "done", state: { logo_named: "stored", final_path: sibling(SLATE[1]).state!.final_path } });
      expect(rows[slideOf(rows)].state).not.toHaveProperty("logo_follows");
      expect(c).toEqual(calls());
    }
  });

  it("a slide whose cover failed, was canceled or is gone is done with its own file: the rule stops nothing", async () => {
    const covers: Array<Row | null> = [{ slide_index: 0, status: "failed", step: "generate", state: {} }, { slide_index: 0, status: "canceled", step: "verify", state: cover(SLATE[0]) }, null];
    for (const coverRow of covers) {
      const rows = withCover(coverRow);
      expect(await runAgreement(rows, slideOf(rows), calls())).toBe("done");
      expect(rows[slideOf(rows)].status).toBe("done");
    }
  });

  it("a slide whose cover is on another design is done with its own file, whether or not its row is started again", async () => {
    for (const state of [{ generations: 1 }, { design_path: NEXT_COVER }, { design_path: NEXT_COVER, carousel_logo: { ...WHITE_DECISION, of: NEXT_COVER } }]) {
      const rows = withCover({ slide_index: 0, status: "running", step: "generate", state });
      expect(await runAgreement(rows, slideOf(rows), calls())).toBe("done");
    }
  });

  it("a slide waits only for a cover that is alive on its design, at any step, and that cover decides without it", async () => {
    for (const step of ["locate", "unlogo", "marks", "finish", "verify"]) {
      const rows: Row[] = [{ slide_index: 0, status: "running", step, state: measured(SLATE[0], { design_path: COVER }) }, { slide_index: 1, status: "running", step: "verify", state: sibling(DEEP).state }];
      const c = calls();
      expect(await runAgreement(rows, 1, c)).toBe("wait");
      // The cover goes on by itself: its checks pass, and its decision needs nothing from the slide but the row it already has.
      Object.assign(rows[0], { step: "verify", state: cover(SLATE[0]) });
      expect(await runAgreement(rows, 0, c)).toBe("done");
      expect(await runAgreement(rows, 1, c)).toBe("done");
      expect(rows.map((r) => r.state!.logo_named)).toEqual(["white", "white"]);
    }
  });

  it("a cover measured without the files' facts is done as it is, and its slides after it", async () => {
    // A cover a worker or a service from before the rule measured: its checks pass under the new worker, and it has nothing to decide from.
    const { logo_inks: _inks, logo_fits: _fits, logo_alone: _alone, ...before } = cover(SLATE[0]);
    const rows: Row[] = [{ slide_index: 0, status: "running", step: "verify", state: before }, { slide_index: 1, status: "running", step: "verify", state: sibling(DEEP).state }];
    const c = calls();
    expect(await runToEnd(rows, c, [1, 0])).toBe(2);
    expect(rows.every((r) => r.status === "done")).toBe(true);
    expect(rows.map((r) => r.state!.logo_named)).toEqual(["stored", "white"]);
    expect(rows[0].state).not.toHaveProperty("carousel_logo");
    expect(c).toEqual(calls());
  });

  it("a cover whose slide failed or was canceled is done with its own file", async () => {
    for (const status of ["failed", "canceled"]) {
      const rows = carousel([...SLATE, DEEP]);
      rows[3].status = status;
      rows[2] = { slide_index: 2, status: "running", step: "unlogo", state: { cover_path: COVER } };
      const c = calls();
      expect(await runAgreement(rows, 0, c)).toBe("done");
      expect(rows[0]).toMatchObject({ status: "done", state: { logo_named: "stored" } });
      expect(rows[0].state).not.toHaveProperty("carousel_logo");
      expect(c).toEqual(calls());
    }
  });

  it("a cover does not wait for a slide that is done, whatever that slide's row holds", async () => {
    // One slide was finished by a worker from before the rule; one was done for a cover design its row was never started again for.
    const rows = carousel([SLATE[0], SLATE[1], DEEP, SLATE[2]]);
    rows[1] = { slide_index: 1, status: "done", step: "finished", state: { cover_path: COVER, logo_ground: DEEP, logo_named: "white", final_path: "old.png" } };
    rows[3] = { slide_index: 3, status: "done", step: "finished", state: { ...rows[3].state, cover_path: NEXT_COVER } };
    expect(await runToEnd(rows, calls())).toBe(1);
    expect(rows.every((r) => r.status === "done")).toBe(true);
    // The decision is made from the two slides that were measured for this design, and the done slides stay as they are.
    expect(rows[0].state!.carousel_logo).toMatchObject({ by: "every", file: "white", grounds: 2 });
    expect(rows[1].state).toMatchObject({ logo_named: "white", final_path: "old.png" });
    expect(rows[3].state).toMatchObject({ logo_named: "stored" });
  });

  it("every carousel ends: whatever each row holds when the deploy meets it, and in whatever order the jobs are handed out", async () => {
    // What a slide's row can hold once nothing but the agreement is left for it, or it has ended.
    const slides: Array<() => Omit<Row, "slide_index">> = [
      () => ({ status: "running", step: "verify", state: sibling(SLATE[1]).state }),
      () => ({ status: "running", step: "verify", state: sibling(DEEP).state }),
      () => ({ status: "running", step: "verify", state: sibling(null).state }),
      // Checks passed under the new worker, measured before the rule.
      () => ({ status: "running", step: "verify", state: { cover_path: COVER, logo_named: "stored", logo_ground: DEEP, final_path: "f.png", checks_passed: "f.png" } }),
      // Checks passed for a cover design the row was never started again for.
      () => ({ status: "running", step: "verify", state: sibling(SLATE[2], { cover_path: NEXT_COVER }).state }),
      () => ({ status: "done", step: "finished", state: { cover_path: COVER, final_path: "old.png" } }),
      () => ({ status: "done", step: "finished", state: sibling(DEEP, { cover_path: NEXT_COVER }).state }),
      () => ({ status: "failed", step: "generate", state: { cover_path: COVER } }),
      () => ({ status: "canceled", step: "marks", state: null }),
    ];
    const covers: Array<() => Omit<Row, "slide_index">> = [
      () => ({ status: "running", step: "verify", state: cover(SLATE[0]) }),
      () => ({ status: "running", step: "verify", state: cover(LIGHT, {}, ONE_COLOR) }),
      () => ({ status: "running", step: "verify", state: { design_path: COVER, logo_named: "stored", final_path: "f.png", checks_passed: "f.png" } }),
      () => ({ status: "running", step: "verify", state: cover(SLATE[0], { carousel_logo: WHITE_DECISION }) }),
      () => ({ status: "done", step: "finished", state: { design_path: COVER, final_path: "old.png" } }),
      () => ({ status: "done", step: "finished", state: cover(SLATE[0], { carousel_logo: WHITE_DECISION }) }),
      () => ({ status: "failed", step: "generate", state: {} }),
      () => ({ status: "canceled", step: "verify", state: cover(SLATE[0]) }),
    ];
    let ran = 0;
    for (const [ci, makeCover] of covers.entries()) for (let a = 0; a < slides.length; a++) for (let b = a; b < slides.length; b++) {
      for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
        const rows: Row[] = [{ slide_index: 0, ...makeCover() }, { slide_index: 1, ...slides[a]() }, { slide_index: 2, ...slides[b]() }];
        const before = structuredClone(rows);
        const label = `cover ${ci}, slides ${a} and ${b}, order ${order.join("")}`;
        // No job is left waiting, and none is stopped or failed by the agreement: every job that was active is done, with a finished picture.
        expect(await runToEnd(rows, calls(), order), label).toBeLessThanOrEqual(PASSES);
        for (const [i, row] of rows.entries()) {
          expect(row.status, label).toBe(before[i].status === "running" ? "done" : before[i].status);
          if (before[i].status === "running") expect(typeof row.state?.final_path, label).toBe("string");
        }
        ran++;
      }
    }
    expect(ran).toBe(covers.length * ((slides.length * (slides.length + 1)) / 2) * 3);
  });
});

describe("the worker's steps that run the rule", () => {
  const worker = readFileSync(join(functionsDir, "design-worker", "index.ts"), "utf8");
  /** The code of a piece of the worker, without its comments and its imports. */
  const code = (text: string) => text.split("\n").filter((line) => !/^\s*(\/\/|\/\*\*|\*|import )/.test(line)).join("\n");
  const stepOf = (name: string, next: string) => worker.slice(worker.indexOf(`case "${name}": {`), worker.indexOf(next));
  const marks = stepOf("marks", 'case "finish": {');
  const finish = stepOf("finish", 'case "verify": {');
  const verify = stepOf("verify", "throw new Error(`FINAL: Unknown step");
  const agree = worker.slice(worker.indexOf("function agreeOnLogo("), worker.indexOf("async function logoClearAt("));

  it("keeps a slide's facts in marks for a carousel only, beside the slide's own choice, and nothing of the measurement before", () => {
    expect(marks).toContain("const facts = inCarousel(job) ? slotFacts(slot) : null;");
    // The earlier measurement goes as soon as the new answer is in hand, whatever the answer then means for the design.
    expect(marks).toMatch(/if \(inCarousel\(job\)\) \{\s+measuredAgain\(s\);/);
    expect(marks.indexOf("measuredAgain(s);")).toBeGreaterThan(marks.indexOf('if (!slot) return "next";'));
    expect(marks.indexOf("measuredAgain(s);")).toBeLessThan(marks.indexOf("const refused = composeRedesign(s);"));
    // After the slide's own choice is on its state: a carousel's slide is stamped with its own file first, as always.
    expect(marks.indexOf("if (facts) Object.assign(s, facts);")).toBeGreaterThan(marks.indexOf("Object.assign(s, outcome.state);"));
    // A service that answers no facts is not waited for.
    expect(code(marks)).not.toMatch(/throw/);
    expect(code(marks).match(/inCarousel\(job\)/g)).toHaveLength(2);
  });

  it("stamps every job's own file in finish, as always: the rule is not in that step", () => {
    expect(code(finish)).not.toMatch(/carousel|logo_inks|logo_fits|agree|"wait"/i);
    expect(finish).toContain("s.final_path = await stampLogo(admin, job, base, stampFile(job.input, s), s.logo_rect);");
  });

  it("runs a slide's own checks first, and only then the agreement, where a single design is done", () => {
    // The checks are the step's own, in their order, each making the design again as it always did.
    const order = ["await renewLease(admin, job);", "REASONS.words(lines)", "REASONS.band(s.band_read)", "REASONS.touched(seen.touching)", "s.checks_passed = s.final_path;"].map((text) => verify.indexOf(text));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The agreement comes before them only for a slide whose checks have already passed, so they are never read twice.
    const first = verify.indexOf("if (inCarousel(job) && s.checks_passed) return agreeOnLogo(admin, job, base);");
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(order[0]);
    // Where a single design is done, a carousel's slide notes that its checks passed and the step runs once more.
    expect(verify).toMatch(/if \(inCarousel\(job\)\) \{\s+s\.checks_passed = s\.final_path;\s+return "next";\s+\}\s+return "done";\s+\}\s+\}\s+$/);
    expect(code(verify).match(/inCarousel\(job\)/g)).toHaveLength(2);
  });

  it("makes no design again, stops no job and moves no step in the agreement", () => {
    expect(code(agree)).not.toMatch(/designAgain|cleanAgain|afterSlot|Stopped|FINAL|job\.step\s*=/);
    expect(code(agree)).toContain("return agreeOnCarouselLogo(job,");
    // The two reads are of the job's own option: every slide after the cover, and the cover.
    expect(agree).toContain('.eq("design_request_id", job.design_request_id).eq("option_index", job.option_index).gt("slide_index", 0);');
    expect(agree).toContain('.eq("design_request_id", job.design_request_id).eq("option_index", job.option_index).eq("slide_index", 0).maybeSingle();');
    // A cover's row that could not be read says nothing about the cover.
    expect(agree).toContain('return error ? "unread" : data ?? null;');
    expect(agree).toContain("save: () => saveJobProgress(admin, job),");
  });

  it("runs nothing of it for a job that is no carousel: every line that names it is behind the carousel test", () => {
    const outside = code(worker.replace(marks, "").replace(verify, "").replace(agree, ""));
    for (const name of ["slotFacts(", "measuredAgain(", "agreeOnLogo(", "agreeOnCarouselLogo(", "carousel_logo", "logo_inks", "checks_passed", "logo_follows", "inCarousel("]) expect(outside, name).not.toContain(name);
    // The second look at the logo's area is declared outside and called from the agreement alone.
    expect(outside.split("logoClearAt(")).toHaveLength(2);
  });
});
