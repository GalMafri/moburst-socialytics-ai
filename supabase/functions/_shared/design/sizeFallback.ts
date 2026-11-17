// supabase/functions/_shared/design/sizeFallback.ts
//
// A size the image model will not draw never fails a design (17 Nov 2026,
// spec docs/superpowers/specs/2026-11-17-platform-sizes-design.md, section
// 6). A job drawn in its platform's upload size carries what it would have
// been without the sizes table (input.as_before: the stored placement, and
// for a Story its page). When the image model refuses the request (a 4xx
// that is not its rate limit) for such a job, the job is made as before
// the table existed: its page and delivered size are dropped, the stored
// placement is put back, and it is drawn on the 4:5 page at today's
// delivered width. No try is spent, and it happens once: afterwards the
// job carries no upload size.
//
// One size for a whole carousel. Only an option's lead job (a single
// design, or a carousel's cover) falls back, and it takes every job of its
// option with it in one database statement (design_size_refused), before
// any other slide has drawn: slides wait for the cover's design. A slide
// after the cover never falls back alone: its cover was drawn in the same
// size, so the model draws that size, and the slide's refusal is handled as
// it always was. A design that was drawn for another page than its job now
// has (a slide whose draw was in flight while its option fell back) is
// dropped and drawn again, so no slide ends in another size.
//
// What the model did with a size is kept (platform_size_outcomes): drawn,
// or refused, which is recorded only when the same job was drawn at once in
// another picture size. The weekly refresh reads it
// (platformSizeRefresh.ts). Free of Deno and network imports.

import { ModelRefused } from "../media/modelBusy.ts";
import { OF_THE_DESIGN } from "./modelSteps.ts";

type SizeKey = { platform: string | null; format: string | null; width: number; height: number };
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Input = Record<string, any>;

/**
 * A job's input as it would have been without the sizes table, or null for
 * a job that carries no upload size (nothing to fall back from). The
 * refused size is kept (size_refused) so the job can say so once it has
 * been drawn as before. design_size_refused makes the same change in the
 * database (the migration test compares the two).
 */
export function asBeforeInput(input: Input | null | undefined): Input | null {
  const g = input?.generate, before = input?.as_before;
  if (!input || !g?.deliver || !before?.placement) return null;
  const { deliver, size: _size, ...generate } = g;
  const { as_before: _before, ...keep } = input;
  return {
    ...keep,
    placement: before.placement,
    generate: { ...generate, ...(before.size ? { size: before.size } : {}) },
    size_refused: { platform: deliver.platform ?? null, format: deliver.format ?? null, width: deliver.width, height: deliver.height },
  };
}

/** An option's lead job: a single design, or a carousel's cover. */
export const leads = (job: { slide_index?: number | null }): boolean => !job.slide_index;

/** The page a job's input asks for, as "WxH"; "" for the default page. */
export function pageKey(input: Input | null | undefined): string {
  const size = input?.generate?.size;
  return size ? `${size.width}x${size.height}` : "";
}

export type SizeOutcome = SizeKey & { outcome: "drawn" | "refusal_confirmed"; reason?: string };

/** The size a job that carries its upload size was drawn in, for the record; null for any other job. */
export function drawOutcome(input: Input): SizeOutcome | null {
  const d = input?.generate?.deliver;
  return d?.platform && d?.format ? { platform: d.platform, format: d.format, width: d.width, height: d.height, outcome: "drawn" } : null;
}

export interface DrawDeps {
  job: { input: Input; state: Input; slide_index?: number | null };
  /** The canvas for the job's page as its input has it now. */
  canvas(): Promise<unknown>;
  /** The image model's design over that canvas. */
  draw(): Promise<Uint8Array>;
  /** The picture size the model is asked for with the job's input as it is now, as "WxH". */
  asked(): string;
  /** Every job of the option made as before, in the database. */
  fallBack(reason: string): Promise<void>;
  /** What the draw said about a size, kept for the weekly refresh. Never fails the design. */
  note(outcome: SizeOutcome): Promise<void>;
}

/**
 * The design, drawn in the job's size; or, when the image model refuses a
 * lead job that carries an upload size, drawn as before. The database is
 * changed first, then the job in hand, then the canvas is made again for
 * the 4:5 page and the model is asked once more. An error from that second
 * request is an error as it always was. The page the design was drawn for
 * is kept on the job's state (drawn_for).
 *
 * The fallback follows any refusal, so nothing fails. The SIZE is recorded
 * as refused only when both hold: the second request succeeded, right
 * here, and it asked the model for another picture size than the refused
 * one. A refusal for any other cause (a key, billing, the picture's
 * content) is refused again at once, or was asked at the same size (a
 * platform whose shape is today's), and says nothing about the size.
 */
export async function drawOrFallBack(d: DrawDeps): Promise<Uint8Array> {
  let png: Uint8Array;
  let outcome: SizeOutcome | null = null;
  try {
    png = await d.draw();
    outcome = drawOutcome(d.job.input);
  } catch (e) {
    const before = e instanceof ModelRefused && leads(d.job) ? asBeforeInput(d.job.input) : null;
    if (!before) throw e;
    const reason = (e as Error).message;
    const refusedAt = d.asked();
    await d.fallBack(reason);
    d.job.input = before;
    await d.canvas();
    png = await d.draw();
    const r = before.size_refused;
    if (d.asked() !== refusedAt && r.platform && r.format) outcome = { ...r, outcome: "refusal_confirmed", reason };
  }
  d.job.state.drawn_for = pageKey(d.job.input);
  if (outcome) await d.note(outcome).catch(() => undefined);
  return png;
}

/**
 * True, with the design dropped from the state, when the job holds a design
 * drawn for another page than its input now has: the job is drawn again for
 * its page, and the dropped design does not count against its designs.
 * False for a design with no record of its page (every design from before).
 */
export function dropStaleDesign(input: Input, state: Input): boolean {
  if (!state?.design_path || typeof state.drawn_for !== "string" || state.drawn_for === pageKey(input)) return false;
  for (const k of ["design_path", "logo_check", "drawn_for", ...OF_THE_DESIGN]) delete state[k];
  state.generations = Math.max(0, (state.generations ?? 1) - 1);
  return true;
}
