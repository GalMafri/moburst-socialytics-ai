// supabase/functions/_shared/design/firstPictureJob.ts
//
// The design worker's side of the first picture as the base (17 Nov 2026,
// spec 2026-11-16-logo-tone-design.md, section 14; the rule itself is in
// firstPicture.ts and runs in the picture service).
//
// The cleaned picture is used in one place only: the slot, and only when
// the slot is the drawing the search found (`logo_slot.from` "drawn"),
// because the removed logo's place is then an exact fact and the service
// looks for the drawing again on the composed picture. A slot at the canvas
// rectangle says the drawing was not found: its place is unknown, nothing
// is composed and the cleaned picture is the base, as before the rule.
//
// The worker asks for the composed picture in the call it already makes for
// the cleaned slot, so no call is added. What the service stored is the
// picture every later step reads and finish stamps: the reading for marks,
// the logo file's stamping, and through the finished file the reading of
// the words and of the area around the logo. One picture is judged and the
// same picture is delivered.
//
// The cleaned picture stays the fallback, per design, with nobody doing
// anything: when no picture is composed (the service says why), when a
// composed picture fails a check the cleaned one has to pass (it is
// dropped, and the design is judged again on the cleaned picture exactly as
// before the rule, once for each cleaned picture), and when the service is
// one from before the rule (it refuses the two fields it does not know, and
// is asked again without them). A mark the removal took out somewhere other
// than the slot is still on the composed picture: the read for marks names
// it there, and that is the second case. None of these costs an image-model
// call.
//
// Free of Deno and network imports: the worker and the tests share it.

import { PictureError } from "../picture/client.ts";
import type { FirstPictureFacts, Rect } from "../picture/contract.ts";

/**
 * What a job keeps about its composed picture. `of` is the cleaned picture
 * it belongs to, so a later removal never reads an earlier one's. `path` is
 * where it is stored, null when there is none for this cleaned picture, and
 * `why` then says so: "canvas" when the slot is not a found drawing, the
 * service's own reason ("first", "size", "slot", "join", "store"),
 * "service" for a service from before the rule, or "check: ..." with the
 * check the composed picture failed. The numbers are the service's, for
 * review.
 */
export type ComposedKept = { of: string; path: string | null; why?: string; share?: number; join?: number; box?: Rect };

/** The part of a job's state this reads and writes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = { design_path?: string; nologo_path?: string; generations?: number; unlogos?: number; logo_slot?: { from?: string } | null; composed?: ComposedKept | null; [key: string]: any };

/** Where the composed picture of the job's current design and removal is stored. */
export function composedPath(base: string, s: State): string {
  return `${base}/composed-${s.generations}-${s.unlogos}.png`;
}

/** True when the job's slot is the drawing the search found, and the cleaned-slot request looks for that drawing again (`checked`): the one case a picture is composed in. */
export function slotFound(s: State, checked: boolean): boolean {
  return s.logo_slot?.from === "drawn" && checked;
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

/** True for the refusal a service from before the rule gives a request that carries the two fields: its own 400, before it reads anything. */
export function beforeTheRule(e: unknown): boolean {
  return e instanceof PictureError && e.why === "refused" && e.status === 400;
}

/**
 * The cleaned-slot call for a job. `call(true)` sends the request with the
 * first picture and the place for the composed one, `call(false)` the
 * request as it was before the rule. `checked` says the request looks for
 * the found drawing again (it carries `drawn`). What came of composing is
 * kept on the state; the answer is the service's, read on the picture
 * `basePicture` then names.
 */
export async function askCleanedSlot<T extends { composed?: FirstPictureFacts }>(
  s: State,
  base: string,
  checked: boolean,
  call: (compose: boolean) => Promise<{ result: T; ms: number }>,
): Promise<{ result: T; ms: number }> {
  // Ruled out for this cleaned picture: asked as before the rule, and the record of why stays.
  if (!composeWanted(s)) return call(false);
  const of = s.nologo_path as string;
  // The drawing was not found, so its place is not known: the cleaned picture is the base.
  if (!slotFound(s, checked)) {
    s.composed = { of, path: null, why: "canvas" };
    return call(false);
  }
  let answer: { result: T; ms: number };
  try {
    answer = await call(true);
  } catch (e) {
    if (!beforeTheRule(e)) throw e;
    answer = await call(false);
    s.composed = { of, path: null, why: "service" };
    return answer;
  }
  const facts = answer.result.composed;
  if (!facts) s.composed = { of, path: null, why: "service" };
  else if (facts.made) s.composed = { of, path: composedPath(base, s), share: facts.share, join: facts.join, box: facts.box };
  else s.composed = { of, path: null, why: facts.why, share: facts.share, join: facts.join };
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
