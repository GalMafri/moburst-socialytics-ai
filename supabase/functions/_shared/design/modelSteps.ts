// supabase/functions/_shared/design/modelSteps.ts
//
// The design worker's two steps that pay the image model: generate (the
// design, drawn over the canvas the picture service makes) and unlogo (the
// model's own logo drawing taken out). Their services are handed in (deps),
// so the steps can be run through an outage in a test; design-worker gives
// them the picture service, the image model and storage. Free of Deno and
// network imports.
//
// A design and a removal are counted (state.generations, state.unlogos)
// only once the image model has made them. A wait before that (the picture
// service unavailable for the canvas, the image model at its rate limit)
// counts nothing, so an outage of any length never uses up a job's designs.
// Both follow the rule for every paid picture (canva/jobs.ts,
// saveJobProgress): stored, counted, saved to the job row with the step
// that uses it, then used, so a run that dies once the picture is stored
// leaves it on the row and no later pass pays for another.

import { notePicture } from "../picture/client.ts";
import { jobFolder } from "./coverDesign.ts";
import { siblingStands } from "./carouselLogo.ts";

/** Designs made for one job before it fails (a design with wrong words, a ground no logo file shows on, a mark that cannot be cleaned out or something across the logo is made again); a carousel's slide after the cover may use more that its option's other slides left (slideAllowance). */
export const MAX_GENERATIONS = 3;
/** Removals of the model's logo drawing for one design before the job fails. */
export const MAX_UNLOGO = 4;

/** What a later step found on a design: all of it goes when a new design is made. The keys after logo_score are what the job keeps about its slot, the ground under it and the file chosen for it (logoChoice.ts); logo_gaps is from before 17 Nov 2026; slot_so_far and slot_file_so_far are how far a search of the design got in a call that used its time (logoChoice.ts, SEARCH_KEPT). The last seven are a carousel's (carouselLogo.ts): a slide's facts of the files on its ground, that its checks have passed, its place in the carousel, what it did with the carousel's file, and on the cover the file chosen for the whole carousel, which belongs to the cover's design. */
export const OF_THE_DESIGN = [
  "logo_rect", "logo_frame", "logo_score", "logo_file", "logo_named", "logo_matched", "logo_scores", "logo_gaps", "logo_ground",
  "logo_slot", "logo_flat", "logo_shows", "logo_clean", "slot_so_far", "slot_file_so_far",
  "logo_inks", "logo_fits", "logo_alone", "checks_passed", "logo_place", "logo_follows", "carousel_logo",
  "nologo_path", "unlogos", "final_path", "read", "band_read", "marks_check", "marks_where", "mark_cleans",
  // The composed picture of the design's cleaned picture (firstPictureJob.ts).
  "composed",
  // The lettering read on objects in the design's picture (pipeline.ts, postReadPrompt).
  "read_scene",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelJob = { id: string; client_id: string; step: string; state: any; slide_index?: number | null };
/** How the worker runs work that outlasts its request (canva/hold.ts). */
type Hold<R> = (work: () => Promise<void>) => R;

/** The folder of the job's files: its own for each cover design a carousel's slide is drawn from (coverDesign.ts). */
const baseOf = (job: ModelJob) => jobFolder(job);

export interface GenerateDeps {
  /** The picture service draws the canvas and its mask at these paths; its time. */
  canvas(canvasPath: string, maskPath: string): Promise<number>;
  /** The image model's design over that canvas (paid); a ModelBusy at its rate limit. */
  draw(canvasPath: string, maskPath: string): Promise<Uint8Array>;
  /** Stores a picture. */
  store(path: string, png: Uint8Array): Promise<void>;
  /** Saves the job's step and state to its row. */
  save(): Promise<void>;
}

/**
 * Why a job ended with no design, from the reason its last design was made
 * again for (logoChoice.ts, REASONS, kept in state.redesigns). Before 18 Nov
 * 2026 every such job said it was the headline's words, whatever check had
 * sent its designs back. Plain words, safe for anyone who reads the job.
 */
export function endedFor(redesigns: unknown): string {
  const last = Array.isArray(redesigns) && redesigns.length ? String(redesigns[redesigns.length - 1]) : "";
  if (last.startsWith("scene:")) return "The design could not be made with clear, correctly spelled lettering in its picture.";
  if (last.startsWith("words:")) return "The design could not be made with the headline's exact words.";
  if (last.startsWith("marks:")) return "The design could not be made free of logos and brand marks drawn in the picture.";
  if (last.startsWith("ground:") || last.startsWith("logo's place:")) return "The design could not be made with the logo in its place.";
  return "The design could not be made with the headline's exact words and the logo in its place.";
}

/**
 * What a carousel's slide after the cover may do once it has made its own
 * MAX_GENERATIONS designs (18 Nov 2026). The designs belong to the option:
 * MAX_GENERATIONS for each slide after the cover, for one design of the
 * cover. A slide that needs more may use what a slide that is done left
 * unused, so one hard slide no longer ends an option whose other slides
 * are finished (the option was over, every slide thrown away, and a new
 * option designed every slide from the start). The facts are the counts on
 * the option's rows for the same cover design (coverDesign.ts, for_cover):
 *   more: a design that a finished slide left unused is free (a slide
 *         whose checks passed and that waits for the cover's logo
 *         decision is finished for this);
 *   wait: none is free yet, and a slide still at work may leave one;
 *   over: none is free and none can be; the job ends as before.
 * Two slides that read the same free design at once may both use it, so the
 * option's designs can pass its share by one for each slide past its own
 * at that moment, never more.
 */
export type Allowance = "more" | "wait" | "over";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SlideRow = { id: string; status: string; state?: any };
export function slideAllowance(job: Pick<ModelJob, "id" | "state">, slides: SlideRow[]): Allowance {
  const cover = (st: unknown) => {
    const n = (st as Record<string, unknown> | null | undefined)?.for_cover;
    return typeof n === "number" ? n : null;
  };
  const made = (st: unknown) => {
    const n = (st as Record<string, unknown> | null | undefined)?.generations;
    return typeof n === "number" && n > 0 ? n : 0;
  };
  const mine = cover(job.state);
  const others = slides.filter((r) => r.id !== job.id && cover(r.state) === mine);
  // A slide that failed or was stopped ends the option (canva/jobs.ts, settleRequest): nothing is shared with it.
  if (others.some((r) => r.status !== "done" && r.status !== "queued" && r.status !== "running")) return "over";
  let free = -Math.max(0, made(job.state) - MAX_GENERATIONS);
  let mayLeave = false;
  // QA 22 Nov 2026: a slide whose checks have passed for the cover design this slide is drawn from waits only for
  // the cover's logo decision, and the cover waits for this slide: its count is as final as a done slide's. Counted
  // as one that may still leave a design, it kept the cover, it and this slide waiting on each other until the
  // 90-minute cut.
  const coverPath = typeof job.state?.cover_path === "string" ? job.state.cover_path : null;
  const final = (r: SlideRow) => r.status === "done" || (coverPath !== null && siblingStands({ status: r.status, step: "", state: r.state ?? null }, coverPath) === "ready");
  for (const r of others) {
    const n = made(r.state);
    // A finished slide's count is final: what it left is free, and what it used past its share is already spent.
    if (final(r)) free += MAX_GENERATIONS - n;
    else {
      free -= Math.max(0, n - MAX_GENERATIONS);
      if (n < MAX_GENERATIONS) mayLeave = true;
    }
  }
  if (free > 0) return "more";
  return mayLeave ? "wait" : "over";
}

/**
 * generate: the next design made and stored, then on to locate; the job ends once MAX_GENERATIONS designs were made, unless
 * `more` (a carousel's slide after the cover, slideAllowance) says one more is free.
 */
export function runGenerate<R>(deps: GenerateDeps, job: ModelJob, hold: Hold<R>, more = false): R {
  const s = job.state;
  const n = (s.generations ?? 0) + 1;
  if (n > MAX_GENERATIONS && !more) throw new Error(`FINAL: ${endedFor(s.redesigns)}`);
  return hold(async () => {
    const base = baseOf(job);
    const canvasPath = `${base}/canvas-${n}.png`, maskPath = `${base}/mask-${n}.png`;
    notePicture(s, "canvas", await deps.canvas(canvasPath, maskPath));
    const png = await deps.draw(canvasPath, maskPath);
    // Counted once it is paid for: a wait before this uses no design.
    s.generations = n;
    const path = `${base}/design-${n}.png`;
    await deps.store(path, png);
    s.design_path = path;
    for (const k of OF_THE_DESIGN) delete s[k];
    job.step = "locate";
    // Saved with the step that reads it, before anything uses the design.
    await deps.save();
  });
}

export interface UnlogoDeps {
  /** The image model's edit of the design with its logo drawing taken out (paid); a ModelBusy at its rate limit. */
  edit(): Promise<Uint8Array>;
  /** Stores a picture. */
  store(path: string, png: Uint8Array): Promise<void>;
  /** Saves the job's step and state to its row. */
  save(): Promise<void>;
}

/** unlogo: the next removal made and stored, then on to marks; the job ends once MAX_UNLOGO removals were made. */
export function runUnlogo<R>(deps: UnlogoDeps, job: ModelJob, hold: Hold<R>): R {
  const s = job.state;
  const n = (s.unlogos ?? 0) + 1;
  if (n > MAX_UNLOGO) throw new Error("FINAL: The logo could not be taken out of the design.");
  return hold(async () => {
    const png = await deps.edit();
    // Counted once it is paid for.
    s.unlogos = n;
    const path = `${baseOf(job)}/nologo-${s.generations}-${n}.png`;
    await deps.store(path, png);
    s.nologo_path = path;
    job.step = "marks";
    // Saved with the step that reads it, before anything uses the picture.
    await deps.save();
  });
}
