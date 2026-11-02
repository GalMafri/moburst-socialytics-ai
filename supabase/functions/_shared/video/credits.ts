// supabase/functions/_shared/video/credits.ts
//
// The Higgsfield credits a video post's clips cost, recorded on its job as
// each clip and each cleaning is submitted (job state.credits), so staff see
// what a week of designs used and the week's estimate follows what clips
// really cost. Free of Deno and network imports so it can be tested.

/** Credits the account must hold before a clip is started (a 1080p clip with sound is about 100). */
export const CLIP_CREDIT_FLOOR = 130;
/** A clip's credits until one is recorded: the 1080p clip with sound the floor above is set for. */
export const CLIP_CREDITS = 100;

/** One submission to the video model: new footage, or a cleaning of footage. */
export interface ClipCredits {
  what: "footage" | "clean";
  /** The video model's job id. */
  job_id: string;
  /** What Higgsfield quoted for it (costOf); null when the quote could not be read. */
  credits: number | null;
  at: string;
}

const list = (v: unknown): ClipCredits[] => (Array.isArray(v) ? v.filter((c) => c && typeof c === "object") as ClipCredits[] : []);

/** The job's record with one more submission; a job id already recorded is kept once. */
export function withCredits(recorded: unknown, entry: ClipCredits): ClipCredits[] {
  const before = list(recorded);
  return before.some((c) => c.job_id === entry.job_id) ? before : [...before, entry];
}

/** Every credit quoted on these jobs' clips and cleanings, from their states. */
export function creditsUsed(states: unknown[]): number {
  let total = 0;
  for (const s of states) {
    for (const c of list((s as { credits?: unknown } | null)?.credits)) {
      if (typeof c.credits === "number" && Number.isFinite(c.credits)) total += c.credits;
    }
  }
  return Math.round(total * 100) / 100;
}

/** A clip's credits as recorded on these jobs (their average, rounded), or CLIP_CREDITS until one is. */
export function creditsPerClip(states: unknown[]): number {
  const clips = states.flatMap((s) => list((s as { credits?: unknown } | null)?.credits))
    .filter((c) => c.what === "footage" && typeof c.credits === "number" && Number.isFinite(c.credits) && c.credits > 0)
    .map((c) => c.credits as number);
  return clips.length ? Math.round(clips.reduce((a, b) => a + b, 0) / clips.length) : CLIP_CREDITS;
}
