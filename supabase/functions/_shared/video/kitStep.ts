// supabase/functions/_shared/video/kitStep.ts
//
// The cleaning of a kit's stills after a claim (steps.ts, makeKit): each
// picked still is edited by the image model, made a JPEG by the picture
// service and read back, in up to two rounds. Its services are handed in
// (deps), so the cleaning can be run through an outage in a test; steps.ts
// gives it storage, the image model, the picture service and the vision
// model. Free of Deno and network imports.
//
// Each round's edit is paid for, so it is stored, kept on the job
// (state.kit_edits, kit.ts) and saved before the picture service is called
// (the rule for every paid picture, canva/jobs.ts), and a later claim goes
// on from it.
//
// Only an error about the stills themselves is the kit's own: it is kept on
// the job (state.kit_errors), costs its claim a try of the kit and never a
// try of the job, and spent tries store the kit with what is clean. An
// error that says nothing about a still leaves the kit's handling for the
// job's hold (canva/stepError.ts) and is marked on the job
// (state.kit_spared), so the next claim counts no try of the kit for it
// (kitClaim): a wait (the picture service unavailable, the image model
// busy) costs no try of the job either, and a call the picture service
// refused (a call it could not claim, a 404, a 400) spends a try of the
// job, which fails after its tries with the service's reason. So no fault
// outside the stills ever stores an empty kit for a client. An edit the
// picture service could not work with is forgotten, so the kit's next try
// pays for that round again.

import { waitsOut } from "../canva/stepError.ts";
import { PictureError, notePicture } from "../picture/client.ts";
import { jpegSize } from "../picture/headers.ts";
import { type KitDone, kitDoneOf, kitEditKept, kitEditPath, kitEditSize, kitEditsWith, kitEditsWithout, kitPath } from "./kit.ts";

export interface KitCleanDeps {
  /** A stored still's bytes: a picked still of the style, or a cleaned one read again. */
  still(path: string): Promise<Uint8Array>;
  /** The image model's editor, once its key is read: it cleans one still at the size given (paid); a ModelBusy at its rate limit. */
  editor(): Promise<(still: Uint8Array, size: [number, number]) => Promise<Uint8Array>>;
  /** Stores a paid edit. */
  storeEdit(path: string, png: Uint8Array): Promise<void>;
  /** The picture service makes the kit's JPEG from a stored edit; its time. */
  transcode(editPath: string, jpegPath: string): Promise<number>;
  /** The cleaned still read back: any writing left in it, and whether it shows a person's face. */
  check(path: string): Promise<{ writing: boolean; face: boolean; where: string }>;
  /** Removes a cleaned still that is not kept. */
  remove(path: string): Promise<void>;
  /** Saves the job's state. */
  save(): Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KitJob = { id: string; client_id: string; state: any };

/** True when the picture service turned the call away: nothing is known about the still it was for. */
const refused = (e: unknown): boolean => e instanceof PictureError && e.why === "refused";

/** True when the error says nothing about a still (a wait, or a call the picture service refused): it is the job's to handle, not the kit's. */
const outsideTheStills = (e: unknown): boolean => waitsOut(e) || refused(e);

/** A kit error kept on the job (the last three). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function keepKitError(s: any, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[video-worker] kit:`, msg);
  s.kit_errors = [...(Array.isArray(s.kit_errors) ? s.kit_errors : []), msg.slice(0, 300)].slice(-3);
}

/**
 * The stills `todo` of the pick cleaned, each one's outcome saved on the job
 * as it comes (state.kit_done). Throws only an error from outside the
 * stills (a wait, a refused call), for the job's hold; the next pass claims
 * again and goes on with the stills still to clean, or stores the kit.
 */
export async function cleanKitStills(deps: KitCleanDeps, job: KitJob, picked: string[], todo: number[]): Promise<void> {
  const s = job.state;
  const done: KitDone = s.kit_done = kitDoneOf(s.kit_done);
  // One save at a time, in order, so an older snapshot of the state never lands after a newer one.
  let saves: Promise<void> = Promise.resolve();
  const save = () => (saves = saves.then(() => deps.save()).catch((e) => keepKitError(s, e)));
  try {
    // Inside the kit's own handling: a missing key is a claim with no progress, never a failed job.
    const edit = await deps.editor();
    const outcomes = await Promise.allSettled(todo.map(async (i) => {
      const path = kitPath(job.client_id, i);
      let still = await deps.still(picked[i]);
      // Edited at the still's own framing and aspect (kitEditSize): the model has nothing to invent outside the picture.
      const size = kitEditSize(...jpegSize(still));
      let clean: string | null = null;
      for (let n = 1; n <= 2 && !clean; n++) {
        // A round already paid for goes on from its stored edit: only its transcode is tried again (kitEditKept).
        let editPath = kitEditKept(s.kit_edits, i, n);
        if (!editPath) {
          let png: Uint8Array;
          try {
            png = await edit(still, size);
          } catch (e) {
            if (waitsOut(e)) throw e;
            // The image model would not clean this still: it is dropped.
            console.warn(`[video-worker] kit ${job.client_id} still ${i}:`, e instanceof Error ? e.message : e);
            break;
          }
          editPath = kitEditPath(job.client_id, i, n);
          await deps.storeEdit(editPath, png);
          // Kept on the job before the picture service is called, so a transcode it cannot finish never pays for the edit again.
          s.kit_edits = kitEditsWith(s.kit_edits, i, n, editPath);
          await save();
        }
        let ms: number;
        try {
          ms = await deps.transcode(editPath, path);
        } catch (e) {
          // An edit the service could not work with is of no use to a later claim.
          if (e instanceof PictureError && e.why === "unusable") {
            s.kit_edits = kitEditsWithout(s.kit_edits, i, n);
            await save();
          }
          throw e;
        }
        notePicture(s, "transcode", ms);
        // Read back as a look reference: any writing left is cleaned once more; a person's face drops the still at once.
        const seen = await deps.check(path);
        if (seen.face) {
          console.warn(`[video-worker] kit ${job.client_id} still ${i}: a face after cleaning ${n} (${seen.where}).`);
          break;
        }
        if (!seen.writing) clean = path;
        else {
          console.warn(`[video-worker] kit ${job.client_id} still ${i}: writing after cleaning ${n} (${seen.where}).`);
          still = await deps.still(path);
        }
      }
      if (!clean) await deps.remove(path);
      done[String(i)] = clean ? { path: clean } : { dropped: true };
      s.kit_edits = kitEditsWithout(s.kit_edits, i);
      // Kept on the job at once: a hold that dies loses no still it paid for.
      await save();
    }));
    const failed = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected").map((o) => o.reason);
    // An error about a still is kept and tried again on the next pass, as a try of the kit, never of the job.
    for (const e of failed) if (!outsideTheStills(e)) keepKitError(s, e);
    // One from outside the stills goes to the hold. A refusal before a wait: it is the one that spends a try and whose reason the job must keep.
    const outside = failed.find(refused) ?? failed.find(waitsOut);
    if (outside) throw outside;
  } catch (e) {
    if (!outsideTheStills(e)) return keepKitError(s, e);
    // Marked on the job, which the hold saves with the error: the next claim counts no try of the kit for it.
    s.kit_spared = true;
    throw e;
  } finally {
    await saves;
    delete s.kit_held_at;
  }
}
