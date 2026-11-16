// supabase/functions/_shared/video/frame.ts
//
// The opening frame (steps.ts, frame). The image model's picture is paid
// for, so it is counted (state.frames) only once it exists; it is stored as
// a PNG and kept on the job (state.frame_png) until the picture service has
// made the JPEG the checks and the clip read. The rule for every paid
// picture (canva/jobs.ts, saveJobProgress): stored, counted, saved to the
// job row, then used, so a run that dies in the picture call leaves the
// frame on the row and the next pass goes on from it. The kept PNG lives
// across a wait (the picture service unavailable) and across a call the
// service refused, so neither costs a second frame; a PNG the service could
// not work with is dropped, so the next try draws a new frame.
//
// The step's services are handed in (deps), so it can be run through an
// outage in a test; steps.ts gives it the image model, storage and the
// picture service. Free of Deno and network imports.

import { PictureError, notePicture } from "../picture/client.ts";
import { REASONS } from "./clip.ts";

/** Opening frames drawn for one video before it ends with REASONS.frame. */
export const MAX_FRAMES = 3;

/** The next try of the frame: a kept PNG goes on under its own number; otherwise the next frame's number, or null once MAX_FRAMES were drawn. Counts nothing: a frame is counted when it is paid for (runFrame). */
export function frameTry(s: { frames?: number; frame_png?: string | null }): { n: number; png: string | null } | null {
  if (s.frame_png) return { n: s.frames ?? 1, png: s.frame_png };
  const n = (s.frames ?? 0) + 1;
  return n > MAX_FRAMES ? null : { n, png: null };
}

export interface FrameDeps {
  /** The image model draws the opening frame (paid); a ModelBusy at its rate limit. */
  draw(): Promise<Uint8Array>;
  /** Stores the frame's PNG. */
  store(path: string, png: Uint8Array): Promise<void>;
  /** The picture service makes the frame's JPEG from its stored PNG; its time. */
  transcode(pngPath: string, jpegPath: string): Promise<number>;
  /** Saves the job's step and state to its row. */
  save(): Promise<void>;
  /** Renews the job's lease to a full model lease: one picture call may take two timeouts and the retry pause, more than what is left of the pass's lease. */
  renewLease(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FrameJob = { id: string; client_id: string; step: string; state: any };

/** frame: the opening frame drawn (or its kept PNG taken up again) and made a JPEG, then on to frame_check; the video ends once MAX_FRAMES were drawn. */
export function runFrame<R>(deps: FrameDeps, job: FrameJob, hold: (work: () => Promise<void>) => R): R {
  const s = job.state;
  const next = frameTry(s);
  if (!next) throw new Error(`FINAL: ${REASONS.frame}`);
  const { n } = next;
  return hold(async () => {
    const base = `${job.client_id}/canva-finish/${job.id}`;
    if (!s.frame_png) {
      const png = await deps.draw();
      // Counted once it is paid for: a busy image model uses no frame.
      s.frames = n;
      const pngPath = `${base}/frame-${n}.png`;
      await deps.store(pngPath, png);
      // Kept on the job, and the job saved, before the picture service is called: a try it cannot finish, or a run that dies in the call, goes on from this PNG.
      s.frame_png = pngPath;
      await deps.save();
    }
    // The draw used part of the lease; the picture call that follows gets a full one (as the title step's check has).
    await deps.renewLease();
    // Kept as a JPEG, as the kit's stills are: the checks read it and the video service starts from it.
    const path = `${base}/frame-${n}.jpg`;
    let ms: number;
    try {
      ms = await deps.transcode(s.frame_png, path);
    } catch (e) {
      // A PNG the service could not work with is of no use to a later try.
      if (e instanceof PictureError && e.why === "unusable") delete s.frame_png;
      throw e;
    }
    notePicture(s, "transcode", ms);
    delete s.frame_png;
    s.frame_path = path;
    job.step = "frame_check";
  });
}
