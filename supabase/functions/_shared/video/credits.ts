// supabase/functions/_shared/video/credits.ts
//
// The Higgsfield credits a week of video posts used, so staff see it. A
// video's one clip records its price on its order (canva_finish_jobs.clip_order
// credits, clipStep.ts); jobs from before 11 Nov kept a list in state.credits
// (each clip and each cleaning), still counted. The week's estimate and each
// video's approved price are Higgsfield's live price for the clip
// (_shared/video/clip.ts quoteClip), not these records. Free of Deno and
// network imports so it can be tested.

/** Credits the account must hold before a clip is started (a 1080p clip with sound is about 100). */
export const CLIP_CREDIT_FLOOR = 130;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Every credit recorded on these jobs: each clip order's credits, and the legacy entries in their states. */
export function creditsUsed(rows: Array<{ state?: unknown; clip_order?: unknown } | null | undefined>): number {
  let total = 0;
  for (const r of rows) {
    if (!r) continue;
    const order = r.clip_order;
    if (order && typeof order === "object" && !Array.isArray(order)) total += num((order as { credits?: unknown }).credits);
    const legacy = (r.state as { credits?: unknown } | null | undefined)?.credits;
    if (Array.isArray(legacy)) for (const c of legacy) if (c && typeof c === "object") total += num((c as { credits?: unknown }).credits);
  }
  return Math.round(total * 100) / 100;
}
