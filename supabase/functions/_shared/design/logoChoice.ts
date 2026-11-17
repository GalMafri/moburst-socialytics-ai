// supabase/functions/_shared/design/logoChoice.ts
//
// The design worker's side of locate (16 Nov 2026): the request it sends for
// a job, what it keeps on the job from the answer, and the file finish
// stamps. A job with one file (input.logos absent: a job from before the
// logo set, or a client with no current set) sends exactly the request it
// always sent and keeps exactly the state it always kept. Free of Deno and
// network imports, so the worker, the replay script and the tests share it.

import type { LocateResult, LogoFileName, Placement, Rgb } from "../picture/contract.ts";
import { jobLogos, type JobLogos } from "./logoTone.ts";

function hexRgb(hex: string): Rgb {
  const n = parseInt(String(hex || "#000000").replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** What locate is asked for a job, with storage paths where the request has links. */
export type LocatePlan =
  | { shape: "one"; logo: string; background: Rgb }
  | { shape: "set"; templates: Array<{ file: LogoFileName; path: string; ground: Rgb; fixed?: true; names?: LogoFileName[] }>; compare: Array<{ file: LogoFileName; path: string }> };

/** The part of a job's input locate reads. */
export type LocateInput = { logo_path: string; generate: { background: string }; logos?: JobLogos | null };

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
 * What the job keeps once the logo was found. Always the score, the
 * rectangle the file is stamped at (the service's own rectangle for a named
 * file of another shape, else where the logo was found) and the design's
 * size, exactly as before. For a job that carries a set also the file
 * finish stamps (the named file, or the canvas file when the answer names
 * none), which file was named and which matched, each template's score and
 * each color distance, for review. All of it is cleared when a design is
 * made again (modelSteps.ts, OF_THE_DESIGN).
 */
export function logoState(input: { logo_path: string; logos?: JobLogos | null }, found: LocateResult): Record<string, unknown> {
  const state: Record<string, unknown> = {
    logo_score: places(found.score, 3),
    logo_rect: found.stamp ?? { x: found.x, y: found.y, width: found.width, height: found.height },
    logo_frame: found.frame,
  };
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
): { logo_path: string; generate: { background: string }; logos: JobLogos; placement: Placement } | null {
  const live = jobLogos(row);
  if (!live) return null;
  return { logo_path: live.logo_path, generate: { background: live.background }, logos: live.logos, placement: job.input.placement };
}
