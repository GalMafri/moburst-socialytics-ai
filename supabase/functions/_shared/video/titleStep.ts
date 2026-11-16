// supabase/functions/_shared/video/titleStep.ts
//
// A video's title: drawn by the image model on a transparent layer (title),
// then read back, and its words must be the copy's exactly (title_check).
// Its services are handed in (deps), so the steps can be run through an
// outage in a test; steps.ts gives them the image model, storage, the
// picture service and the vision model. Free of Deno and network imports.
//
// A title is paid for, so it is counted (state.hooks) only once it exists,
// and it follows the rule for every paid picture (canva/jobs.ts,
// saveJobProgress): stored, counted, saved to the job row with its check's
// step, then used, so a run that dies in the check's picture call leaves
// the title on the row and the next pass checks it instead of paying for
// another. It is drawn again only when it is known to be no good: the picture
// service could not work with the layer, the layer came back empty, or its
// words are not the copy's. Anything else leaves the title as it is: an
// unavailable picture service or a busy image model waits (canva/stepError.ts),
// and an answer that could not be read is asked for again on the same title.

import { copyMatches } from "../design/pipeline.ts";
import { PictureError, notePicture } from "../picture/client.ts";
import type { TitleReadResult } from "../picture/contract.ts";
import { hookBoxOf } from "./hook.ts";
import type { VideoJob, VideoStepResult } from "./steps.ts";

/** Titles drawn for one video before it ends. */
export const MAX_HOOKS = 3;

export interface TitleDeps {
  /** The image model draws the title layer; a ModelBusy at its rate limit. */
  draw(): Promise<Uint8Array>;
  /** Stores the layer. */
  store(path: string, png: Uint8Array): Promise<void>;
  /** Holds the job for the picture call, which may outlast the pass's lease. */
  renewLease(): Promise<void>;
  /** The picture service finds the lettering on the stored layer and writes the picture its words are read from. */
  locate(layerPath: string, readPath: string): Promise<{ result: TitleReadResult; ms: number }>;
  /** The vision model reads that picture's words; null when its answer cannot be read. */
  read(readPath: string): Promise<string[] | null>;
  /** Saves the job's step and state to its row. */
  save(): Promise<void>;
}

const baseOf = (job: VideoJob) => `${job.client_id}/canva-finish/${job.id}`;

/** title: the next title drawn and stored, or on to `after` when the video carries none or its title is already checked. */
export async function runTitle(deps: TitleDeps, job: VideoJob, after: string): Promise<VideoStepResult> {
  const s = job.state;
  // A client whose videos carry no text over the footage gets no title; a title already checked is kept.
  if (!job.input.copy?.length || s.title_ok) { job.step = after; return "next"; }
  const n = (s.hooks ?? 0) + 1;
  if (n > MAX_HOOKS) throw new Error("FINAL: The video's title could not be drawn with the exact words.");
  const png = await deps.draw();
  // Counted once it is paid for: a wait before that uses no title.
  s.hooks = n;
  const path = `${baseOf(job)}/hook-${n}.png`;
  await deps.store(path, png);
  s.hook_path = path;
  job.step = "title_check";
  // Saved with its check's step before the check calls the picture service in this same pass.
  await deps.save();
  return "next";
}

/** title_check: the title's words read back; on to `after` when they are the copy's, back to title when the title is no good. */
export async function runTitleCheck(deps: TitleDeps, job: VideoJob, after: string): Promise<VideoStepResult> {
  const s = job.state;
  const again = (why: string): VideoStepResult => {
    console.warn(`[video-worker] job ${job.id}: ${why}; drawing the title again.`);
    delete s.hook_path;
    job.step = "title";
    return "next";
  };
  // One picture call may take two timeouts and the retry pause, more than the pass's lease: the lease covers it.
  await deps.renewLease();
  // The picture service finds where the lettering is on its layer and lays it over a mid-grey ground, so light and dark lettering both show.
  const readPath = `${baseOf(job)}/hook-${s.hooks}-read.jpg`;
  let found: { result: TitleReadResult; ms: number };
  try {
    found = await deps.locate(s.hook_path, readPath);
  } catch (e) {
    if (e instanceof PictureError && e.why === "unusable") return again(`the picture service could not work with the title (${e.message})`);
    throw e;
  }
  notePicture(s, "title-read", found.ms);
  if (!found.result.box) return again("the title came back empty");
  const { box, layer } = hookBoxOf(found.result);
  s.hook_box = box;
  s.hook_layer = layer;
  const lines = await deps.read(readPath);
  if (!lines) throw new Error("The title's words could not be read.");
  s.hook_read = lines;
  if (!copyMatches(lines, job.input.copy)) return again(`title read ${JSON.stringify(lines)}, wanted ${JSON.stringify(job.input.copy)}`);
  s.title_ok = true;
  job.step = after;
  return "next";
}
