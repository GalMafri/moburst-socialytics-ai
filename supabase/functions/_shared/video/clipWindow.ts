// How long a video's ordered clip may take, shared by the clip step and the
// request limit. Kept apart from clip.ts so the design job code can read it
// without loading the video service client.

/** A clip not back this long after its order is taken as lost (Seedance usually takes 3 to 10 minutes). */
export const CLIP_LOST_MS = 3 * 60 * 60_000;

/**
 * Whether a job's clip order (canva_finish_jobs.clip_order) is a paid clip
 * still on its way: ordered with the video service's job id, and not yet
 * CLIP_LOST_MS old. QA 22 Nov 2026 (P53-06): the 90-minute request limit
 * closed such a request and threw the paid clip away.
 */
export function clipStillRendering(raw: unknown, now: Date): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const order = raw as { at?: unknown; job_id?: unknown };
  if (!order.job_id) return false;
  const at = Date.parse(String(order.at ?? ""));
  return Number.isFinite(at) && now.getTime() - at < CLIP_LOST_MS;
}
