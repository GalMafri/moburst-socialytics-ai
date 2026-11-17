// supabase/functions/_shared/design/carouselLogo.ts
//
// A carousel's slides agree on one logo file (17 Nov 2026).
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
//              the cover waits until every other slide's checks have
//              passed for the cover design it is on, decides once
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
// The decision is made from pictures that have all passed their checks, so
// nothing is made again after it and it is made once for a cover design.
// Everything it rests on belongs to a design and goes with it
// (modelSteps.ts, OF_THE_DESIGN). A slide's row that was started again for
// another cover design can write nothing (coverDesign.ts), so no second
// guard is needed here: the decision's `of` is the one comparison.
//
// No wait here can outlast what it waits for. The cover waits for slides
// that are each going on by themselves to an end of their own (checks
// passed, done, failed or canceled), and a slide waits only for a cover
// that is alive, on the same design and has not decided.
//
// A single design, a video and a legacy video card are no carousel
// (inCarousel): none of this runs for them, and their state has none of
// these keys.
//
// Free of Deno and network imports: the worker hands in the two reads of
// sibling rows, its save and its two picture calls (AgreeDeps), so the
// tests run the whole agreement over plain rows.

import type { LogoFileName, Rect, Rgb, SlotFileResult } from "../picture/contract.ts";
import { followsCover } from "./coverDesign.ts";
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
 *   ready   it is done, or its checks have passed for this cover design and
 *           it is waiting for the decision. A done slide is ready whatever
 *           its row says: nothing more will be measured on it.
 *   waits   it is still on its way: not drawn from this cover design yet (a
 *           row started again has no `cover_path`), or its checks have not
 *           passed. It goes on by itself to one of the other two.
 */
export function siblingStands(row: SiblingRow, coverDesign: string): "over" | "waits" | "ready" {
  if (row.status === "failed" || row.status === "canceled") return "over";
  if (row.status === "done") return "ready";
  if (row.state?.cover_path !== coverDesign) return "waits";
  return row.state?.checks_passed ? "ready" : "waits";
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
 * A carousel's slide after its own checks have passed: the one thing left
 * is which logo file the carousel is stamped with. `job` is the job with
 * its state as the run holds it, `files` its stamp list.
 *
 * Every way out is "done", or a "wait" for something that is sure to end:
 * nothing here makes a design again, stops a job or spends a try.
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
export async function agreeOnLogo(job: { slide_index?: number | null; slide_count?: number | null; state: Record<string, any> }, files: () => StampEntry[], deps: AgreeDeps): Promise<"done" | "wait"> {
  const s = job.state;
  if (!s.logo_inks || s.logo_follows) return "done";
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
