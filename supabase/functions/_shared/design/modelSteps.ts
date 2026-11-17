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

/** Designs made for one option before it fails (a design with wrong words, a ground no logo file shows on, a mark that cannot be cleaned out or something across the logo is made again). */
export const MAX_GENERATIONS = 3;
/** Removals of the model's logo drawing for one design before the job fails. */
export const MAX_UNLOGO = 4;

/** What a later step found on a design: all of it goes when a new design is made. The keys after logo_score are what the job keeps about its slot, the ground under it and the file chosen for it (logoChoice.ts); logo_gaps is from before 17 Nov 2026. */
export const OF_THE_DESIGN = [
  "logo_rect", "logo_frame", "logo_score", "logo_file", "logo_named", "logo_matched", "logo_scores", "logo_gaps", "logo_ground",
  "logo_slot", "logo_flat", "logo_shows", "logo_clean",
  "nologo_path", "unlogos", "final_path", "read", "band_read", "marks_check", "marks_where", "mark_cleans",
  // The composed picture of the design's cleaned picture (firstPictureJob.ts).
  "composed",
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelJob = { id: string; client_id: string; step: string; state: any };
/** How the worker runs work that outlasts its request (canva/hold.ts). */
type Hold<R> = (work: () => Promise<void>) => R;

const baseOf = (job: ModelJob) => `${job.client_id}/canva-finish/${job.id}`;

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

/** generate: the next design made and stored, then on to locate; the job ends once MAX_GENERATIONS designs were made. */
export function runGenerate<R>(deps: GenerateDeps, job: ModelJob, hold: Hold<R>): R {
  const s = job.state;
  const n = (s.generations ?? 0) + 1;
  if (n > MAX_GENERATIONS) throw new Error("FINAL: The design could not be made with the headline's exact words and the logo in its place.");
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
