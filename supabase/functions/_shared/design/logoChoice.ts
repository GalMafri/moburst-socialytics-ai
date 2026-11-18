// supabase/functions/_shared/design/logoChoice.ts
//
// The design worker's side of locate (16 Nov 2026): the request it sends for
// a job, what it keeps on the job from the answer, and the file finish
// stamps. A job with one file (input.logos absent: a job from before the
// logo set, or a client with no current set) sends exactly the request it
// always sent and keeps exactly the state it always kept. Free of Deno and
// network imports, so the worker, the replay script and the tests share it.
//
// Since 17 Nov 2026 (spec section 13) the worker asks for the slot in place
// of locate, and the second half of this file is its side of that: the two
// requests (slotPlan, stampPlan), what it keeps (slotState, stampOutcome),
// the words each reason for making a design again starts with (REASONS),
// and how it waits for a service that does not have the two routes yet
// (waitFor). The locate half stays for the tone check's history and for a
// worker from before the change.
//
// The two slot routes search, and the service works on a call's search for
// its time budget only (17 Nov 2026, picture/client.ts). The last part of
// this file is the call a step makes to them (slotSearch) and what a job
// keeps of a search the service did not finish (searchKept, searchWorked),
// so the step's next run carries it on.

import { callPictureWithin, carriedOf, PictureError, type CallOpener, type Carried, type PictureDeps, type Worked } from "../picture/client.ts";
import type { LocateResult, LogoFileName, PictureRequests, PictureResults, Placement, Rect, Rgb, SlotFileResult, SlotResult } from "../picture/contract.ts";
import { logoFound } from "./logoMatch.ts";
import { jobLogos, stampList, type JobLogos, type LogoSet, type StampEntry } from "./logoTone.ts";

function hexRgb(hex: string): Rgb {
  const n = parseInt(String(hex || "#000000").replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** What locate is asked for a job, with storage paths where the request has links. */
export type LocatePlan =
  | { shape: "one"; logo: string; background: Rgb }
  | { shape: "set"; templates: Array<{ file: LogoFileName; path: string; ground: Rgb; fixed?: true; names?: LogoFileName[] }>; compare: Array<{ file: LogoFileName; path: string }> };

/** The part of a job's input locate reads. */
export type LocateInput = { logo_path: string; generate: { background: string }; logos?: JobLogos | null; stamp?: StampEntry[] | null };

/**
 * A job with one file: its logo over its background. A job that carries a
 * set: the canvas file over the job's background first (input.logo_path and
 * generate.background are that pair), then the template for the ground the
 * canvas file does not cover, when the set has one. A person's file is
 * marked, so it is never compared by color. The files of the set that are in
 * no template, and are not a person's, are compared. A job started under
 * the rule of 17 Nov 2026 carries, for each template, the other files that
 * may be stamped when it is the match (the files that serve the ground it
 * covers), and they are sent with it; a job from before sends none.
 */
export function locatePlan(input: LocateInput): LocatePlan {
  const logos = input.logos;
  const background = hexRgb(input.generate.background);
  const canvasPath = logos?.files?.[logos.canvas];
  if (!logos || !canvasPath) return { shape: "one", logo: input.logo_path, background };
  const fixed = new Set(logos.fixed ?? []);
  const template = (file: LogoFileName, path: string, ground: Rgb, names?: LogoFileName[]) => ({ file, path, ground, ...(fixed.has(file) ? { fixed: true as const } : {}), ...(Array.isArray(names) ? { names } : {}) });
  const templates = [template(logos.canvas, canvasPath, background, logos.names?.canvas)];
  const secondPath = logos.second ? logos.files[logos.second.file] : undefined;
  if (logos.second && secondPath) templates.push(template(logos.second.file, secondPath, hexRgb(logos.second.ground), logos.names?.second));
  const compare: Array<{ file: LogoFileName; path: string }> = [];
  for (const file of ["stored", "other", "white"] as const) {
    const path = logos.files[file];
    if (path && !fixed.has(file) && !templates.some((t) => t.file === file)) compare.push({ file, path });
  }
  return { shape: "set", templates, compare };
}

const places = (n: number, k: number) => Math.round(n * 10 ** k) / 10 ** k;

/**
 * Why a located design is made again, or null when it goes on to be
 * finished. Two reasons, in this order: the match is not the logo at a size
 * the client uses (logoFound, the test a design always had), or no file
 * that may be stamped shows on the picture's own ground around the logo (a
 * whole part of each is under 1.5:1 there, `lost` in the service's answer,
 * 17 Nov 2026). The text is for the job's record and the log, never for a screen.
 */
export function locateRefusal(found: LocateResult): string | null {
  const score = places(found.score, 3), scale = (found.width / found.usual.width).toFixed(2);
  if (!logoFound(found, found.usual.width)) {
    const each = found.scores && found.scores.length > 1 ? ` (each file: ${found.scores.map((v) => v.toFixed(3)).join(", ")})` : "";
    return `logo match ${score} at ${scale} of the usual width${each}`;
  }
  if (found.lost === true) {
    const hex = found.ground ? `#${found.ground.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase() : "its ground";
    return `logo match ${score}, and a part of the logo does not show on the picture behind it (${hex})`;
  }
  return null;
}

/**
 * What the job keeps once the logo was found. Always the score, the
 * rectangle the file is stamped at (the service's own rectangle for a named
 * file of another shape, else where the logo was found) and the design's
 * size, exactly as before. For a job that carries a set also the file
 * finish stamps (the named file, or the canvas file when the answer names
 * none), which file was named and which matched, each template's score and
 * each color distance, for review. For every job also the picture's own
 * color around the found logo, when the service answered it. All of it is
 * cleared when a design is made again (modelSteps.ts, OF_THE_DESIGN).
 */
export function logoState(input: { logo_path: string; logos?: JobLogos | null }, found: LocateResult): Record<string, unknown> {
  const state: Record<string, unknown> = {
    logo_score: places(found.score, 3),
    logo_rect: found.stamp ?? { x: found.x, y: found.y, width: found.width, height: found.height },
    logo_frame: found.frame,
  };
  // The picture's own color around the found logo, for review.
  if (found.ground) state.logo_ground = found.ground;
  const logos = input.logos;
  if (!logos) return state;
  const named: LogoFileName = found.file && logos.files[found.file] ? found.file : logos.canvas;
  state.logo_file = logos.files[named] ?? input.logo_path;
  state.logo_named = named;
  state.logo_matched = found.matched ?? logos.canvas;
  state.logo_scores = (found.scores ?? [found.score]).map((v) => places(v, 3));
  state.logo_gaps = Object.fromEntries(Object.entries(found.gaps ?? {}).map(([file, gap]) => [file, places(gap as number, 1)]));
  return state;
}

/** The file finish stamps: the one locate named for this design, else the job's own logo. */
export function stampFile(input: { logo_path: string }, state: { logo_file?: unknown } | null | undefined): string {
  return typeof state?.logo_file === "string" && state.logo_file ? state.logo_file : input.logo_path;
}

/**
 * What locate would be asked for a stored design if its job were started
 * from the client's set as it is now: the canvas file, its ground and the
 * set from the live settings row, with the job's own placement. Null when
 * the row has no current set. For the worker's tone_check, which reads and
 * reports and writes nothing.
 */
export function checkInput(
  row: { logo_path: string; background: string; source?: string | null; logo_set?: unknown },
  job: { input: { placement: Placement } },
): { logo_path: string; generate: { background: string }; logos: JobLogos; stamp: StampEntry[]; placement: Placement } | null {
  const live = jobLogos(row);
  if (!live) return null;
  return { logo_path: live.logo_path, generate: { background: live.background }, logos: live.logos, stamp: stampList(row.logo_path, row.logo_set as Partial<LogoSet>), placement: job.input.placement };
}

// ── The slot (17 Nov 2026) ──────────────────────────────────────────────────

/** What the slot route is asked for a job: one or two templates, by storage path. */
export type SlotPlan = { templates: Array<{ file: LogoFileName; path: string; ground: Rgb }> };

/**
 * The search for a design's slot uses the templates locate used: the job's
 * one file over its background, or for a job that carries a set the canvas
 * file over the canvas color and then the template for the other ground.
 * Nothing is compared and no file is named here: the file is chosen for the
 * ground under the slot once the drawing is cleaned out.
 */
export function slotPlan(input: LocateInput): SlotPlan {
  const plan = locatePlan(input);
  if (plan.shape === "one") return { templates: [{ file: "stored", path: plan.logo, ground: plan.background }] };
  return { templates: plan.templates.map((t) => ({ file: t.file, path: t.path, ground: t.ground })) };
}

/** What a job keeps about its slot: the rectangle, why it is there, the file whose shape it has, and for a found drawing the template that found it. */
export type SlotKept = { rect?: Rect; from: "drawn" | "canvas"; of: LogoFileName; template?: { file: LogoFileName; ground: Rgb } };

/**
 * What the job keeps once its slot is known. `logo_rect` and `logo_frame`
 * are where the file is stamped, as they always were; `logo_slot` keeps the
 * slot itself (a file of another shape is stamped at a rectangle fitted to
 * it, and the slot must not move with that) and says whether it is where
 * the model drew the logo or where the canvas carried it; the score, the
 * matched file and each template's score are kept for review. No file is named yet. All of it is cleared when a design is made
 * again (modelSteps.ts, OF_THE_DESIGN).
 */
export function slotState(plan: SlotPlan, found: SlotResult): Record<string, unknown> {
  const template = found.from === "drawn" ? plan.templates[found.index] : undefined;
  const kept: SlotKept = { rect: found.slot, from: found.from, of: found.of, ...(template ? { template: { file: template.file, ground: template.ground } } : {}) };
  return {
    logo_score: places(found.score, 3),
    logo_rect: found.slot,
    logo_frame: found.frame,
    logo_slot: kept,
    logo_matched: found.matched,
    logo_scores: found.scores.map((v) => places(v, 3)),
  };
}

/** What the cleaned-slot route is asked for a job, with storage paths where the request has links. */
export type StampPlan = { rect: Rect; frame: [number, number]; of: LogoFileName; files: StampEntry[]; drawn?: { file: LogoFileName; ground: Rgb } };

/**
 * The cleaned slot of a job. The files are the job's stamp list; a job that
 * carries a set from before the list existed gives its files in the same
 * order, and a job with one file its logo. The drawing is looked for again
 * only when it was found. A job the old locate step moved on has no
 * `logo_slot`: that step only let a found drawing through, so its rectangle
 * is a found drawing's, in the shape of the file it kept as matched.
 */
export function stampPlan(
  input: LocateInput,
  state: { logo_rect: Rect; logo_frame: [number, number]; logo_slot?: SlotKept | null; logo_matched?: unknown },
): StampPlan {
  const logos = input.logos;
  const files: StampEntry[] = Array.isArray(input.stamp) && input.stamp.length
    ? input.stamp
    : logos?.files?.stored
      ? (["stored", "other", "white"] as const).flatMap((file) => (logos.files[file] ? [{ file, path: logos.files[file] as string }] : []))
      : [{ file: "stored", path: input.logo_path }];
  const listed = (file: unknown): file is LogoFileName => files.some((f) => f.file === file);
  const templates = slotPlan(input).templates;
  const kept = state.logo_slot;
  const of: LogoFileName = listed(kept?.of) ? kept.of : listed(state.logo_matched) ? state.logo_matched : listed(templates[0].file) ? templates[0].file : files[0].file;
  const template = kept ? kept.template : templates.find((t) => t.file === of) ?? templates[0];
  const drawn = template && listed(template.file) && (!kept || kept.from === "drawn") ? { file: template.file, ground: template.ground } : undefined;
  return { rect: kept?.rect ?? state.logo_rect, frame: state.logo_frame, of, files, ...(drawn ? { drawn } : {}) };
}

const hexOf = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/**
 * Why a design is made again, in the words kept on the job. Each starts
 * with what it is about: the words, the ground, a mark, the logo's place.
 * For the job's record and the log, never for a screen.
 */
export const REASONS = {
  words: (read: string[]) => `words: read as ${JSON.stringify(read)}`,
  band: (read: string[]) => `words: outside the Story's band, which reads ${JSON.stringify(read)}`,
  scene: (scene: string[]) => `scene: lettering on an object in the picture is not real words spelled right: ${JSON.stringify(scene)}`,
  ground: (ground: Rgb | null) => `ground: no logo file shows on the picture under the logo (${ground ? hexOf(ground) : "no ground read"})`,
  marks: (where: string) => `marks: could not be cleaned out: ${where}`,
  drawn: (where: string) => `marks: drawn in the picture, away from the logo's place: ${where}`,
  composed: (why: string, join: number) => `logo's place: the first picture could not take the cleaned logo's place (${why}, join ${places(join, 2)})`,
  stillDrawn: (score: number) => `marks: the logo drawn at its place is still there after cleaning (match ${places(score, 3)})`,
  touched: (by: string) => `logo's place: touched by ${by}`,
};

/**
 * What the cleaned slot's answer means for the job.
 *   clean:  the drawing that was found is still on the cleaned picture. It
 *           goes back to the removal through the marks path, with `where`
 *           naming it; `reason` is kept if that path is used up.
 *   again:  no file shows on the ground under the slot. The design is made
 *           again, with the reason.
 *   stamp:  the file to stamp, where, and what was read, for the job.
 */
export function stampOutcome(plan: Pick<StampPlan, "files">, answer: SlotFileResult, brand: string):
  | { next: "clean"; where: string; reason: string }
  | { next: "again"; reason: string }
  | { next: "stamp"; state: Record<string, unknown> } {
  if (answer.drawn?.found) return { next: "clean", where: `the ${brand} logo, which is still in the picture`, reason: REASONS.stillDrawn(answer.drawn.score) };
  const path = answer.file ? plan.files.find((f) => f.file === answer.file)?.path : undefined;
  if (!answer.file || !path) return { next: "again", reason: REASONS.ground(answer.ground) };
  return {
    next: "stamp",
    state: {
      logo_file: path,
      logo_named: answer.file,
      logo_rect: answer.rect,
      ...(answer.ground ? { logo_ground: answer.ground } : {}),
      logo_flat: places(answer.flat, 3),
      logo_shows: answer.shows,
      ...(answer.drawn ? { logo_clean: places(answer.drawn.score, 3) } : {}),
    },
  };
}

/** True when the service turned a call away because it does not have the route: its own 404, which a service from before 17 Nov 2026 gives for the slot routes. */
export function notThereYet(e: unknown): boolean {
  return e instanceof PictureError && e.why === "refused" && e.status === 404;
}

/**
 * A call to a slot route that failed, as the job should take it. A service
 * that does not have the route yet is a service that is not there yet: the
 * job waits without spending a try (canva/stepError.ts), whatever order the
 * service and the worker were deployed in. Any other failure is itself.
 */
export function waitFor(e: unknown): unknown {
  return notThereYet(e) ? new PictureError("The picture service does not have this route yet.", (e as PictureError).route, "unavailable") : e;
}

// ── A search the service did not finish (17 Nov 2026) ───────────────────────

/** Where a job's state keeps a search the service did not finish, by route. Both keys go when a new design is made (modelSteps.ts, OF_THE_DESIGN). */
export const SEARCH_KEPT = { slot: "slot_so_far", "slot-file": "slot_file_so_far" } as const;
type SlotRoute = keyof typeof SEARCH_KEPT;

/**
 * What an earlier call for this search left on the job, to send with the
 * next one; null for a first call. `picture` is the stored path of the
 * picture searched (the design for the slot, the cleaned picture for the
 * slot's file): what was kept for another picture is not this search's and
 * is left out, so a new design or a new cleaning starts from the beginning
 * with its calls uncounted.
 */
export function searchKept(state: Record<string, unknown> | null | undefined, route: SlotRoute, picture: string): Carried | null {
  const kept = state?.[SEARCH_KEPT[route]] as { of?: unknown } | null | undefined;
  return kept && typeof kept === "object" && kept.of === picture ? carriedOf(kept) : null;
}

/**
 * What a step does with the service's answer to a search. The service works
 * on one call for its time budget only. When the search ended, the answer is
 * the result and nothing stays on the job. When the time was used first,
 * how far the search got is kept on the job with the picture it is of, and
 * null is answered: the step runs again, at once while the job's request
 * has time and on the next pass otherwise, and the service carries on from
 * there. No try is spent, because nothing failed. The calls spent are
 * counted with it, and after PICTURE_MAX_ASKS of them the next call carries
 * no budget (client.ts, callPictureWithin), so a step answers null for one
 * search PICTURE_MAX_ASKS times at most.
 */
export function searchWorked<R extends SlotRoute>(state: Record<string, unknown>, route: R, picture: string, worked: Worked<R>): PictureResults[R] | null {
  if ("result" in worked) {
    delete state[SEARCH_KEPT[route]];
    return worked.result;
  }
  state[SEARCH_KEPT[route]] = { of: picture, ...worked.carried };
  return null;
}

/** A call the service turned away, or a picture it could not use, leaves nothing to carry on: the next try searches from the beginning. A service that was unavailable leaves what was kept. */
export function searchFailed(state: Record<string, unknown>, route: SlotRoute, e: unknown): void {
  if (e instanceof PictureError && !e.transient) delete state[SEARCH_KEPT[route]];
}

/**
 * One call of a job's step to a slot route: worked to the service's time
 * budget and carried on from what the job kept of the call before.
 * `picture` is the stored picture searched. The answer is the route's
 * result, or null when the service's time was used first: the step then
 * answers "next" and runs again, with no try spent, and it can do so
 * PICTURE_MAX_ASKS times at most for one picture (searchWorked).
 *
 * A service that does not have the route yet is waited for, without
 * spending a try (waitFor). A call the service turned away leaves nothing
 * kept, so the try after it searches from the beginning.
 */
export async function slotSearch<R extends SlotRoute>(admin: CallOpener, state: Record<string, unknown>, route: R, picture: string, body: PictureRequests[R], deps: PictureDeps = {}): Promise<{ result: PictureResults[R] | null; ms: number }> {
  let worked: Worked<R>;
  try {
    worked = await callPictureWithin(admin, route, body, searchKept(state, route, picture), deps);
  } catch (e) {
    // First what the failure is for the job (a route that is not there yet is a wait), then what it leaves kept.
    const failure = waitFor(e);
    searchFailed(state, route, failure);
    throw failure;
  }
  return { result: searchWorked(state, route, picture, worked), ms: worked.ms };
}
