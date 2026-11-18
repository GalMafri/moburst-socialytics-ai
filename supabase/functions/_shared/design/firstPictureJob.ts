// supabase/functions/_shared/design/firstPictureJob.ts
//
// The design worker's side of the first picture as the base (17 Nov 2026,
// spec 2026-11-16-logo-tone-design.md, section 14; the rule itself is in
// firstPicture.ts and runs in the picture service).
//
// The cleaned picture is used in one place only: the slot, when it is a
// fact that the logo was removed there. Whether it is, is decided in one
// place, the rule itself (firstPicture.ts, composeFirst), for every slot:
// the found drawing's rectangle, or the canvas rectangle when the two
// pictures show the removal inside it, or, when the slot holds none, the
// one place away from it that the cleaning took the drawing out of (the
// slot stays where the logo file is stamped). So the worker asks the same way for
// every design and keeps the reason the service gives.
//
// Where the rule can lay no rectangle, the service may still compose (18
// Nov 2026, night, firstPictureStrokes.ts): the first picture with only the
// strokes the cleaning took out patched, wherever the model drew them. To
// the worker that is a composed picture like any other, stored at the same
// place and read by the same steps; what it keeps says it was made that way
// (`by`). Nothing here decides differently for it.
//
// The worker asks for the composed picture in the call it already makes for
// the cleaned slot, so no call is added. What the service stored is the
// picture every later step reads and finish stamps: the reading for marks,
// the logo file's stamping, and through the finished file the reading of
// the words and of the area around the logo. One picture is judged and the
// same picture is delivered.
//
// A picture is never delivered re-rendered when a fresh one can be made
// (17 Nov 2026: a design whose composed picture showed a faint monogram the
// model drew went back to its cleaned picture, was cleaned again, and was
// delivered after two whole-picture redraws). While the option may still
// make another design (`lastDesign`), a design that cannot be delivered as
// its first picture is made again instead, through the worker's one path
// for making a design again: when the logo was removed at the slot and the
// first picture could not take the cleaned picture's pixels there, for what
// the two pictures show around it (`composeRedesign`), and when the read
// for marks finds a mark on the composed picture, which is the model's own
// drawing (`afterMark`). A check of the slot itself that fails on a
// composed picture has its own consequence, one more removal or a new
// design (`afterSlot`): both keep the first picture as the base. Before
// this rule such a picture was dropped and the cleaned one judged in its
// place, and delivered when it passed; that is no longer done while a new
// design can be made.
//
// The cleaned picture is the base in three cases only, with nobody doing
// anything. On the last design the option may make, so that the rule never
// costs an option the design it would have had before: no composed
// picture, or one that fails a check the cleaned one has to pass (it is
// dropped, and the design is judged again on the cleaned picture exactly as
// before the rule, once for each cleaned picture). That design is delivered
// when its cleaned picture passes. When it does not (no logo file shows on
// its ground, its words read wrong, something touches the logo, or a mark
// is still there after the removals a design has), the option is over, as
// it was before the rule: no design can be made after the last. When
// the slot is no place the logo was removed from (the canvas rectangle,
// with no drawing found there and no removal shown inside it): there is
// nothing to compose, on any design, and the design goes on exactly as it
// did before the rule, with no call added and no design made again. And
// when composing failed for a reason no new drawing would change: the
// service is one from before the rule (it refuses the two fields it does
// not know, and is asked again without them), or it could not read, size or
// store a picture.
//
// Free of Deno and network imports: the worker and the tests share it.

import { PictureError } from "../picture/client.ts";
import type { FirstPictureFacts, FirstPictureMeasure, Rect } from "../picture/contract.ts";
import { REASONS } from "./logoChoice.ts";
import { MAX_GENERATIONS } from "./modelSteps.ts";

/**
 * What a job keeps about its composed picture. `of` is the cleaned picture
 * it belongs to, so a later removal never reads an earlier one's. `path` is
 * where it is stored, null when there is none for this cleaned picture, and
 * `why` then says so: the service's own reason ("first", "size", "slot",
 * "removal", "join", "store"),
 * "service" for a service from before the rule, or "check: ..." with the
 * check the composed picture failed. The numbers are the service's, for
 * review; `measured` is what it read against the pair of pictures itself,
 * when it read anything (picture/contract.ts, FirstPictureMeasure). `by`
 * is "strokes" for a picture the service composed from the strokes the
 * cleaning took out, where no rectangle could be laid; `join` and `removed`
 * are then the refused rectangle's own.
 */
export type ComposedKept = { of: string; path: string | null; by?: "strokes"; why?: string; share?: number; join?: number; removed?: number; measured?: FirstPictureMeasure; box?: Rect };

/** The part of a job's state this reads and writes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = { design_path?: string; nologo_path?: string; generations?: number; unlogos?: number; composed?: ComposedKept | null; [key: string]: any };

/** Where the composed picture of the job's current design and removal is stored. */
export function composedPath(base: string, s: State): string {
  return `${base}/composed-${s.generations}-${s.unlogos}.png`;
}

/** True when the cleaned-slot call should ask for a composed picture: the job has its first and its cleaned picture, and composing was not ruled out for this cleaned picture. */
export function composeWanted(s: State): boolean {
  if (!s.design_path || !s.nologo_path) return false;
  return !(s.composed && s.composed.of === s.nologo_path && s.composed.path === null);
}

/** The picture every later step reads and finish stamps: the composed picture of the current cleaned picture when there is one, else the cleaned picture. */
export function basePicture(s: State): string {
  const kept = s.composed;
  return kept && kept.of === s.nologo_path && typeof kept.path === "string" && kept.path ? kept.path : (s.nologo_path as string);
}

/** True when the job has made the last design its option may make (modelSteps.ts, MAX_GENERATIONS). Only that design may fall back to its cleaned picture: it is then judged as before the rule, and a check it fails there ends the option, as before. */
export function lastDesign(s: State): boolean {
  return (s.generations ?? 0) >= MAX_GENERATIONS;
}

/**
 * The one refusal that makes a design again: the logo was removed at the
 * slot, and the ring around it does not show the same thing in both
 * pictures, so the first picture cannot take the cleaned picture's pixels
 * there. A new drawing can come out differently. Every other reason leaves
 * the design on its cleaned picture: the slot is no place the logo was
 * removed from ("removal": nothing to compose, as for every such slot
 * before the rule; the service answers it too for a canvas rectangle that
 * only its reading against the pair of pictures made a place, when the
 * join there fails), or the reason is about a file or the service.
 */
const NO_JOIN: NonNullable<FirstPictureFacts["why"]> = "join";

/**
 * Why the design is made again when the first picture could not take the
 * cleaned slot, or null when it is not: the join was refused (`NO_JOIN`),
 * the refusal is this cleaned picture's, and the option may still make
 * another design. The reason is kept on the job (logoChoice.ts, REASONS).
 */
export function composeRedesign(s: State): string | null {
  const kept = s.composed;
  if (!kept || kept.of !== s.nologo_path || kept.path !== null || kept.why !== NO_JOIN || lastDesign(s)) return null;
  return REASONS.composed(NO_JOIN, kept.join ?? 0);
}

/**
 * What a failed check of the cleaned slot means for the design: the drawing
 * is still found there, or no logo file shows on the ground under it
 * (logoChoice.ts, stampOutcome).
 *   cleaned  it was made on the composed picture of the last design the
 *            option may make: that picture is dropped here, and the step
 *            runs again on the cleaned picture, as before the rule. The
 *            design is delivered when the cleaned picture passes; a check
 *            that fails there too has its own consequence, which on the
 *            last design ends the option once no removal is left.
 *   own      the check's own consequence follows, within the bounds a
 *            design always had: one more removal, or a new design. On a
 *            cleaned picture that is the way before the rule. On a composed
 *            picture both keep the first picture as the base: the slot is
 *            the one place it takes from the cleaned picture, so the next
 *            removal mends it there and the next cleaned picture is
 *            composed again, and a new design starts from its own first
 *            picture. Nothing is dropped, which is a change from before
 *            the rule: then the cleaned picture was judged in the composed
 *            one's place and delivered when it passed, a re-rendered
 *            picture while a fresh one can be made.
 */
export function afterSlot(s: State, reason: string): "cleaned" | "own" {
  return lastDesign(s) && dropComposed(s, reason) ? "cleaned" : "own";
}

/**
 * What a mark the reader found on the job's picture means for the design.
 *   again    it was seen on the composed picture, which is the first
 *            picture outside the slot, so the model drew it. Cleaning it
 *            out would redraw the whole picture: the design is made again,
 *            with `reason`.
 *   cleaned  the same on the last design the option may make: the composed
 *            picture is dropped here, and the step runs again on the
 *            cleaned picture, as before the rule.
 *   clean    it was seen on the cleaned picture: it is named in the next
 *            removal, as before the rule, with `reason` kept if that path
 *            is used up.
 */
export function afterMark(s: State, where: string): { next: "again" | "cleaned" | "clean"; reason: string } {
  if (basePicture(s) === s.nologo_path) return { next: "clean", reason: REASONS.marks(where) };
  if (!lastDesign(s)) return { next: "again", reason: REASONS.drawn(where) };
  dropComposed(s, REASONS.marks(where));
  return { next: "cleaned", reason: REASONS.marks(where) };
}

/** What the service read against the pair of pictures itself, kept as it is; no key at all when it answered none (a service from before those readings, or a call the rule's own numbers decided). */
function measuredOf(facts: FirstPictureFacts): { measured?: FirstPictureMeasure } {
  return facts.measured ? { measured: facts.measured } : {};
}

/** True for the refusal a service from before the rule gives a request that carries the two fields: its own 400, before it reads anything. */
export function beforeTheRule(e: unknown): boolean {
  return e instanceof PictureError && e.why === "refused" && e.status === 400;
}

/**
 * The cleaned-slot call for a job. `call(true)` sends the request with the
 * first picture and the place for the composed one, `call(false)` the
 * request as it was before the rule. What came of composing is kept on the
 * state; the answer is the service's, read on the picture
 * `basePicture` then names.
 *
 * The call's search works to the service's time budget (logoChoice.ts,
 * slotSearch), so its answer can be no result yet (null): the service
 * stores a composed picture only with the call that ends the search, so
 * nothing is known about composing then and nothing is kept. The step asks
 * again, this function makes the same choice from the same state, and what
 * came of composing is kept from the call that ends the search.
 */
export async function askCleanedSlot<T extends { composed?: FirstPictureFacts }>(
  s: State,
  base: string,
  call: (compose: boolean) => Promise<{ result: T | null; ms: number }>,
): Promise<{ result: T | null; ms: number }> {
  // Ruled out for this cleaned picture: asked as before the rule, and the record of why stays.
  if (!composeWanted(s)) return call(false);
  const of = s.nologo_path as string;
  let answer: { result: T | null; ms: number };
  try {
    answer = await call(true);
  } catch (e) {
    if (!beforeTheRule(e)) throw e;
    answer = await call(false);
    s.composed = { of, path: null, why: "service" };
    return answer;
  }
  // Not finished within the service's time: no composed picture is stored yet, and the same request is asked again.
  if (!answer.result) return answer;
  const facts = answer.result.composed;
  if (!facts) s.composed = { of, path: null, why: "service" };
  else if (facts.made) s.composed = { of, path: composedPath(base, s), ...(facts.by ? { by: facts.by } : {}), share: facts.share, join: facts.join, removed: facts.removed, ...measuredOf(facts), box: facts.box };
  else s.composed = { of, path: null, why: facts.why, share: facts.share, join: facts.join, removed: facts.removed, ...measuredOf(facts) };
  return answer;
}

/**
 * A check failed. When it was made on the composed picture, that picture is
 * dropped and true is answered: the step runs again and judges the cleaned
 * picture, exactly as before the rule. When it was made on the cleaned
 * picture, false: the design goes the way it always did.
 */
export function dropComposed(s: State, check: string): boolean {
  if (basePicture(s) === s.nologo_path) return false;
  const { box: _box, ...kept } = s.composed as ComposedKept;
  s.composed = { ...kept, path: null, why: `check: ${check}` };
  return true;
}
