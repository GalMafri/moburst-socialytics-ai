// supabase/functions/_shared/design/carouselLogo.ts
//
// A carousel's slides agree on one logo file, in one place at one size
// (17 Nov 2026).
//
// Each slide of a carousel is a job of its own, and each chooses its file
// alone, on the one ground under its own slot (logoSlot.ts, pickStamp). Two
// slides with similar grounds could land on opposite sides of a line and
// take different files, so one post showed the logo in two tones.
//
// The rule. When one file shows on every slide's ground, the whole carousel
// is stamped with it: the first such file in the client's stamp order, by
// the two lines a single design already has (every whole part at 3:1 on
// every slide, else no whole part under 1.5:1 on any slide), with a made
// copy marked `last` after the others as always. The weakest slide decides.
// When no file shows on every slide, the grounds really differ (light
// slides and dark slides), and each slide keeps the file its own ground
// took, as before the rule. Nothing is ever made again, stopped or failed
// for this rule: the worst it does is leave a slide as it was.
//
// The place. A design's logo goes in its slot (logoSlot.ts): where the
// model drew the logo when the search finds its drawing, at the size it
// drew it, else the rectangle the canvas carried. In a carousel the two
// stood side by side, and the logo jumped in size and place from one slide
// to the next. So within a carousel the logo sits in the carousel's
// rectangle on every slide where that is possible: the client's own
// placement rectangle on the slide's frame, which is the rectangle the
// canvas carried (carouselSlot). It is the same on every slide by itself,
// it is the size the client's own posts have, and every slide's design was
// drawn with the logo there, so most slides are in it already. (The cover's
// own rectangle was the other candidate. When the cover is the one slide
// whose drawing was found, at a size of the model's choosing, it would
// move the four slides that are right to the one that is off.) A slide
// whose slot is another rectangle is measured there and stamped there, and
// keeps its own place when that cannot be done: no logo file shows on the
// ground there, something would touch the logo there, or a call failed.
//
// How it runs, with nothing stored anywhere but the jobs' own state:
//
//   marks    each slide's own measurement, as always. A carousel's slide
//            also keeps what the service answers about every listed file:
//            its ink colors and its own rectangle in the slot (slotFacts).
//   finish   stamps the slide's own file, as always.
//   verify   checks the stamped picture, as always, so a design that has to
//            be made again is made again as early as it always was. Where a
//            single design is done, a carousel's slide notes that its
//            checks have passed (`checks_passed`) and the agreement is all
//            that is left:
//              first the place, each slide for itself (settlePlace): a
//              slide whose slot is not the carousel's rectangle has the
//              ground read there, is stamped there with the file that
//              ground takes, and has the area around the logo looked at
//              again, all by the picture service and the reader, with no
//              image model. What it kept or took is on its state
//              (`logo_place`), and from then on everything it measured is
//              of the place it is stamped at;
//              the cover waits until every other slide's checks have
//              passed and its place is settled for the cover design it is
//              on, decides once
//              (decideCarousel) and keeps the decision on its own state,
//              keyed by its design (`carousel_logo.of`). The cover's run is
//              the only writer of the cover's row;
//              every other slide waits until the cover's row holds a
//              decision for the cover design the slide was drawn from
//              (coverDecision), and is done as it is once none can come;
//              a slide whose own file is not the carousel's is stamped
//              again with it by the picture service, with no model call
//              (followCarousel), and is then done.
//
// The decision is made from pictures that have all passed their checks and
// from the ground under the rectangle each slide is stamped at, so nothing
// is made again after it and it is made once for a cover design.
// Everything it rests on belongs to a design and goes with it
// (modelSteps.ts, OF_THE_DESIGN). A slide's row that was started again for
// another cover design can write nothing (coverDesign.ts), so no second
// guard is needed here: the decision's `of` is the one comparison.
//
// No wait here can outlast what it waits for. The cover waits for slides
// that are each going on by themselves to an end of their own (checks
// passed and place settled, done, failed or canceled), and a slide waits
// only for a cover that is alive, on the same design and has not decided.
// Settling the place waits for nothing.
//
// A single design, a video and a legacy video card are no carousel
// (inCarousel): none of this runs for them, and their state has none of
// these keys.
//
// Free of Deno and network imports: the worker hands in the two reads of
// sibling rows, its save and its three picture calls (AgreeDeps), so the
// tests run the whole agreement over plain rows.

import { canvasLogoRect } from "../canva/brief.ts";
import type { LogoFileName, Placement, Rect, Rgb, SlotFileResult } from "../picture/contract.ts";
import { followsCover } from "./coverDesign.ts";
import { stampOutcome } from "./logoChoice.ts";
import { carouselStamp, type StampInks } from "./logoSlot.ts";
import { hidesPart, type StampEntry } from "./logoTone.ts";

/**
 * What the cover's state keeps: the cover design it belongs to, how the
 * carousel is stamped ("every": one file on all slides, `file`; "own": no
 * file shows on every slide, so each keeps its own), each file's weakest
 * contrast over the slides, and how many grounds were read.
 */
export type CarouselLogo = { of: string; by: "every" | "own"; file?: LogoFileName; shows: Partial<Record<LogoFileName, number>>; grounds: number };

/** A sibling slide's row as the cover reads it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SiblingRow = { status: string; step: string; state: Record<string, any> | null };

/** What a carousel's slide keeps from the cleaned slot's answer beside its own choice: each listed file's inks, each file's rectangle in the slot, and the file its own ground took. */
export type SlotFacts = { logo_inks: Partial<Record<LogoFileName, Rgb[]>>; logo_fits: Partial<Record<LogoFileName, Rect>>; logo_alone: LogoFileName | null };

/** Why a slide keeps the file it has. */
export type Kept = "own" | "same" | "unlisted" | "hidden" | "touched" | "unstamped";

/**
 * What a slide's state says about its place in the carousel (`logo_place`).
 * `at` is the carousel's rectangle on this slide's frame. `from`: the slide
 * was moved there from that slot of its own. `kept`: it stays where it was,
 * and why: its slot is that rectangle already ("same"); the rectangle
 * cannot be told for this job ("unknown"); the ground there could not be
 * read ("unmeasured"); no logo file shows on the ground there ("hidden");
 * something would touch the logo there ("touched"); the stamp or the look
 * failed ("unstamped").
 */
export type Placed = { at: Rect; from: Rect } | { at?: Rect; kept: "same" | "unknown" | "unmeasured" | "hidden" | "touched" | "unstamped" };

/** What a slide's state says it did with the cover's decision (`logo_follows`): the cover design it was for, and the file it took or why it kept its own. */
export type Followed = { of: string; file: LogoFileName } | { of: string; kept: Kept };

/** True for a still job that is one slide of a carousel. */
export function inCarousel(job: { slide_count?: number | null; design_request_id?: string | null; input?: { kind?: unknown } | null }): boolean {
  return (job.slide_count ?? 1) > 1 && !!job.design_request_id && job.input?.kind !== "video_card";
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * What a carousel job keeps from the cleaned slot's answer beside
 * stampOutcome's state. Null when the service answered no facts of the
 * files (one from before it did): the slide then has nothing to agree with
 * and is delivered with its own file, as before the rule. `logo_alone` is
 * the file this slide's own ground took, for review beside the carousel's.
 */
export function slotFacts(answer: SlotFileResult): SlotFacts | null {
  const { inks, fits } = answer as Partial<SlotFileResult>;
  if (!isRecord(inks) || !isRecord(fits)) return null;
  return { logo_inks: inks, logo_fits: fits, logo_alone: answer.file ?? null };
}

/** What one measurement of the cleaned slot leaves on a job's state (logoChoice.ts, stampOutcome, and slotFacts). */
export const OF_THE_MEASUREMENT = ["logo_ground", "logo_flat", "logo_shows", "logo_clean", "logo_inks", "logo_fits", "logo_alone"];

/**
 * A carousel's slide is measured again (another removal, or its cleaned
 * picture in place of its composed one): nothing of the measurement before
 * stays, so a new one with no ground never leaves an older ground for the
 * cover's decision to read.
 */
export function measuredAgain(state: Record<string, unknown>): void {
  for (const key of OF_THE_MEASUREMENT) delete state[key];
}

/**
 * Where a sibling stands for the cover's decision on cover design
 * `coverDesign` (the cover's `design_path`).
 *   over    it failed or was canceled: the option is over.
 *   ready   it is done, or its checks have passed for this cover design,
 *           its place is settled, and it is waiting for the decision. A
 *           done slide is ready whatever its row says: nothing more will be
 *           measured on it. A slide measured without the files' facts has
 *           no place to settle.
 *   waits   it is still on its way: not drawn from this cover design yet (a
 *           row started again has no `cover_path`), its checks have not
 *           passed, or its place is not settled (its ground may still
 *           become another rectangle's). It goes on by itself to one of the
 *           other two.
 */
export function siblingStands(row: SiblingRow, coverDesign: string): "over" | "waits" | "ready" {
  if (row.status === "failed" || row.status === "canceled") return "over";
  if (row.status === "done") return "ready";
  if (row.state?.cover_path !== coverDesign || !row.state?.checks_passed) return "waits";
  return row.state.logo_place || !row.state.logo_inks ? "ready" : "waits";
}

/**
 * The cover's decision, or why there is none yet. `cover` is the cover's
 * own state once its checks have passed, `siblings` the option's other
 * slides as read now, `expected` how many of them there are (slide_count
 * less one), `files` the job's stamp list in order.
 *
 * The grounds are the cover's own and every sibling's that was read for
 * this cover design with the files' facts; a slide with no ground on its
 * picture, or measured before the rule, adds no constraint. The inks are
 * the cover's own answer: every slide of an option has the same files. The
 * decision is the pick on all those grounds, or that there is none.
 * `over`: a slide failed or was canceled, so the option is over and there
 * is nothing to decide.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function decideCarousel(cover: Record<string, any>, siblings: SiblingRow[], expected: number, files: StampEntry[]):
  | { next: "over" } | { next: "wait" } | { next: "decided"; logo: CarouselLogo } {
  const stands = siblings.map((row) => siblingStands(row, cover.design_path));
  if (stands.includes("over")) return { next: "over" };
  if (siblings.length < expected || stands.includes("waits")) return { next: "wait" };
  const grounds: Rgb[] = [];
  if (cover.logo_ground) grounds.push(cover.logo_ground);
  for (const row of siblings) if (row.state?.cover_path === cover.design_path && row.state?.logo_ground && row.state?.logo_inks) grounds.push(row.state.logo_ground);
  const inks: Partial<Record<LogoFileName, Rgb[]>> = cover.logo_inks ?? {};
  const candidates: StampInks[] = files.flatMap((f) => (inks[f.file] ? [{ file: f.file, inks: inks[f.file] as Rgb[], ...(f.last ? { last: true } : {}) }] : []));
  const picked = carouselStamp(candidates, grounds);
  return { next: "decided", logo: { of: cover.design_path, by: picked.by, ...(picked.file ? { file: picked.file } : {}), shows: picked.shows, grounds: grounds.length } };
}

/**
 * What a slide learns from the cover's row about the cover design it was
 * drawn from (`coverPath`).
 *   decided  the row holds a decision for that design.
 *   wait     the cover is alive, on that design, and has not decided: it
 *            will, or it will be made again (which starts this slide's row
 *            again), fail or be done, and each of those ends the wait.
 *   never    no decision for that design can come any more: the cover is
 *            gone, failed, canceled or done without one, or it is on
 *            another design by now. The slide is done as it is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function coverDecision(cover: { status: string; state: Record<string, any> | null } | null | undefined, coverPath: string):
  | { next: "decided"; logo: CarouselLogo } | { next: "wait" } | { next: "never" } {
  if (!cover || cover.status === "failed" || cover.status === "canceled") return { next: "never" };
  const logo = cover.state?.carousel_logo;
  if (logo && logo.of === coverPath) return { next: "decided", logo };
  if (cover.status === "done" || cover.state?.design_path !== coverPath) return { next: "never" };
  return { next: "wait" };
}

const sameRect = (a: Rect | undefined, b: Rect | undefined) => !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/** The part of a job the place reads: the client's placement and the size of the file the canvas carried, as the job was started with them. */
export type PlacedJob = { input?: { placement?: Placement | null; logo_size?: unknown } | null };

/**
 * The carousel's rectangle on a slide: the client's placement rectangle on
 * the slide's own frame, which is the rectangle the canvas carried the logo
 * at (canva/brief.ts, canvasLogoRect, from the same placement, the same
 * file's size and the same frame the service's slot search uses). The
 * placement is in shares of the page, so slides of one option, which share
 * a page and a placement, have the same rectangle. Null when the job or its
 * state does not say enough to tell it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function carouselSlot(job: PlacedJob, state: Record<string, any>): Rect | null {
  const placement = job.input?.placement, size = job.input?.logo_size, frame = state.logo_frame;
  const whole = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && n > 0);
  if (!placement || typeof placement.width !== "number" || typeof placement.top !== "number" || !whole(size) || !whole(frame)) return null;
  return canvasLogoRect(placement, size[0], size[1], frame[0], frame[1]);
}

/**
 * What one slide does with the cover's decision. `state` is the slide's
 * own once its checks have passed, `files` the job's stamp list.
 *   stamp   the carousel's file is another than the slide is stamped with:
 *           it is stamped again with that file at the file's own rectangle
 *           in this slide's slot (a brand's second file can have another
 *           shape than the stored one). `state` replaces the slide's own
 *           choice once that is done. `recheck`: the rectangle is another
 *           than the one the slide's checks saw, so the area around the
 *           logo is looked at again.
 *   keep    the slide stays as it is, and `why`: the carousel has no one
 *           file ("own"), the slide already has it ("same"), the job does
 *           not list the file or has no rectangle for it ("unlisted"), or
 *           this slide's ground hides a whole part of it, under 1.5:1
 *           ("hidden": a slide measured after the decision was made). The
 *           worker adds two of its own: the file would be touched at its
 *           rectangle ("touched"), or it could not be stamped ("unstamped").
 * Weaker than 3:1 is not hidden: the carousel's file is stamped, the same
 * file as on every other slide. There is no outcome that makes a design
 * again.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function followCarousel(state: Record<string, any>, logo: CarouselLogo, files: StampEntry[]):
  | { next: "stamp"; state: { logo_file: string; logo_named: LogoFileName; logo_rect: Rect }; recheck: boolean } | { next: "keep"; why: Kept } {
  if (logo.by !== "every" || !logo.file) return { next: "keep", why: "own" };
  if (state.logo_named === logo.file) return { next: "keep", why: "same" };
  const path = files.find((f) => f.file === logo.file)?.path;
  const rect: Rect | undefined = state.logo_fits?.[logo.file];
  if (!path || !rect) return { next: "keep", why: "unlisted" };
  const ground: Rgb | undefined = state.logo_ground, inks: Rgb[] | undefined = state.logo_inks?.[logo.file];
  if (ground && inks && hidesPart(inks, ground)) return { next: "keep", why: "hidden" };
  return { next: "stamp", state: { logo_file: path, logo_named: logo.file, logo_rect: rect }, recheck: !sameRect(rect, state.logo_rect) };
}

/** A row of the option as a slide reads it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CoverRow = { status: string; state: Record<string, any> | null };

/** What the agreement needs from the worker. */
export interface AgreeDeps {
  /** The cleaned slot's answer for the job's picture without a logo at another slot (the picture service, no model): the ground under it, the file that shows there, every listed file's facts there. */
  measure(slot: Rect): Promise<SlotFileResult>;
  /** The option's other slides (every slide after the cover) as they are now; null when they could not be read. */
  siblings(): Promise<SiblingRow[] | null>;
  /** The cover's row as it is now, null when there is none; "unread" when it could not be read. */
  cover(): Promise<CoverRow | null | "unread">;
  /** Saves the job's step and state to its row. */
  save(): Promise<void>;
  /** Stamps a logo file on the job's picture at a rectangle, with no model; answers where the finished file is. */
  stamp(logoPath: string, rect: Rect): Promise<string>;
  /** Whether nothing touches or crosses the logo on a finished file, seen around a rectangle. */
  clearAt(finalPath: string, rect: Rect): Promise<boolean>;
}

/**
 * A slide's place in its carousel, settled by the slide for itself. A slide
 * whose slot is the carousel's rectangle already stays as it is, with no
 * call. A slide whose slot is another rectangle (the model's drawing was
 * found, at the place and size the model drew it) is moved when that can be
 * done:
 *
 *   the ground under the carousel's rectangle is read on the slide's
 *   picture without a logo, and the file that ground takes is the slide's
 *   own choice there, by the rule every slot has (logoChoice.ts,
 *   stampOutcome). No file shows there: the slide stays ("hidden");
 *   the slide is stamped there, on its picture without a logo, so nothing
 *   of the first stamp is under it. The place it leaves is the cleaned
 *   place: the drawing was taken out of it, looked for again there and not
 *   found, and the picture was read as carrying no logo anywhere before any
 *   file was stamped (the marks step), so it is left bare as it is;
 *   the area around the logo is looked at again at the new rectangle.
 *   Something touches the logo there: the slide stays ("touched").
 *
 * A slide that is moved keeps the new measurement in place of its own (its
 * ground, its own file there, every file's rectangle there) and the new
 * finished picture, so the file decision reads the ground under the
 * rectangle the slide is stamped at. A slide that stays has changed
 * nothing: the state is written only once all of it is done. Nothing here
 * throws: a call that fails leaves the slide where it was.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function settlePlace(job: PlacedJob & { state: Record<string, any> }, files: StampEntry[], deps: Pick<AgreeDeps, "measure" | "stamp" | "clearAt">): Promise<Placed> {
  const s = job.state;
  const own: Rect | undefined = s.logo_slot?.rect;
  // A slot that is where the canvas carried the logo is the carousel's rectangle, as the service itself computed it.
  if (own && s.logo_slot.from === "canvas") return { at: own, kept: "same" };
  const at = carouselSlot(job, s);
  if (!own || !at) return { kept: "unknown" };
  if (sameRect(own, at)) return { at, kept: "same" };
  let facts: SlotFacts | null, outcome: ReturnType<typeof stampOutcome> | null;
  try {
    const answer = await deps.measure(at);
    // Reading the answer is part of the read: an answer that is no result at all is a ground that was not read, never an error of the job.
    facts = slotFacts(answer);
    // No drawing is looked for there, so the answer is a file to stamp or none.
    outcome = facts ? stampOutcome({ files }, answer, "") : null;
  } catch {
    return { at, kept: "unmeasured" };
  }
  if (!facts || !outcome) return { at, kept: "unmeasured" };
  if (outcome.next !== "stamp") return { at, kept: "hidden" };
  const there = outcome.state as { logo_file: string; logo_rect: Rect };
  try {
    const path = await deps.stamp(there.logo_file, there.logo_rect);
    if (!(await deps.clearAt(path, there.logo_rect))) return { at, kept: "touched" };
    measuredAgain(s);
    Object.assign(s, outcome.state, facts, { final_path: path });
    return { at, from: own };
  } catch {
    return { at, kept: "unstamped" };
  }
}

/**
 * A carousel's slide after its own checks have passed: what is left is
 * where the carousel's logo sits and which file it is. `job` is the job
 * with its state as the run holds it, `files` its stamp list.
 *
 * Every way out is "done", a "next" (the state is to be saved and this
 * runs once more), or a "wait" for something that is sure to end: nothing
 * here makes a design again, stops a job or spends a try.
 *
 *   First the place (settlePlace), once, for the cover and every other
 *   slide alike. What came of it is kept (`logo_place`) and "next" is
 *   answered, so it is on the slide's row before anything reads the
 *   slide's ground.
 *
 *   The cover decides once every other slide's checks have passed for its
 *   design, keeps the decision on its own state and saves it before
 *   anything uses it. While a slide is still on its way it waits; a slide
 *   that failed or was canceled ends the option, and the cover is done as
 *   it is. A sibling read that failed is a later pass's to ask again.
 *
 *   Every other slide reads the cover's row. It waits only while the cover
 *   is alive, on the design this slide was drawn from, and has not decided
 *   (coverDecision); when no decision can come it is done as it is. A cover
 *   row that could not be read says nothing, and the slide asks again.
 *
 *   A slide whose own file is not the carousel's is stamped again with that
 *   file (the picture service alone). When the file's rectangle is another
 *   than the one the slide's checks saw, the area around the logo is looked
 *   at again, and a logo that is touched there leaves the slide as it was.
 *   The state is changed only once all of that is done, so a run that stops
 *   in between leaves the slide with its own file and its own finished
 *   picture. A stamp or a look that fails does the same ("unstamped"): the
 *   slide's delivery never depends on a call made for this rule.
 *
 * What the slide did is kept on its state (`logo_follows`), so a run that
 * comes back after it does nothing more. A slide measured without the
 * files' facts (a service or a worker from before the rule) has nothing to
 * agree with and is done as it is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function agreeOnLogo(job: PlacedJob & { slide_index?: number | null; slide_count?: number | null; state: Record<string, any> }, files: () => StampEntry[], deps: AgreeDeps): Promise<"done" | "wait" | "next"> {
  const s = job.state;
  if (!s.logo_inks || s.logo_follows) return "done";
  if (!s.logo_place) {
    s.logo_place = await settlePlace(job, files(), deps);
    return "next";
  }
  let logo: CarouselLogo;
  if (!followsCover(job)) {
    if (s.carousel_logo && s.carousel_logo.of === s.design_path) logo = s.carousel_logo;
    else {
      const decision = decideCarousel(s, (await deps.siblings()) ?? [], (job.slide_count ?? 1) - 1, files());
      if (decision.next === "over") return "done";
      if (decision.next === "wait") return "wait";
      s.carousel_logo = logo = decision.logo;
      // Saved before it is used, so no slide can read a decision the cover's row does not hold. A save that fails is no
      // decision: a later pass decides again, from the same rows.
      try {
        await deps.save();
      } catch {
        delete s.carousel_logo;
        return "wait";
      }
    }
  } else {
    const cover = await deps.cover();
    if (cover === "unread") return "wait";
    const known = coverDecision(cover, s.cover_path);
    if (known.next === "never") return "done";
    if (known.next === "wait") return "wait";
    logo = known.logo;
  }
  const follow = followCarousel(s, logo, files());
  let followed: Followed = follow.next === "keep" ? { of: logo.of, kept: follow.why } : { of: logo.of, file: follow.state.logo_named };
  if (follow.next === "stamp") {
    try {
      const path = await deps.stamp(follow.state.logo_file, follow.state.logo_rect);
      if (follow.recheck && !(await deps.clearAt(path, follow.state.logo_rect))) followed = { of: logo.of, kept: "touched" };
      else Object.assign(s, follow.state, { final_path: path });
    } catch {
      // The slide has a finished picture that passed its checks: a second stamp that fails, for whatever reason, never costs it that.
      followed = { of: logo.of, kept: "unstamped" };
    }
  }
  s.logo_follows = followed;
  return "done";
}
