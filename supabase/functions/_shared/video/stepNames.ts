// supabase/functions/_shared/video/stepNames.ts
//
// The names of every step the video worker (video-worker) owns, so the Canva
// worker (canva-finish) never takes one, the request's progress can tell a
// video still being made from one being finished, and the worker's minute
// timer (cron video-worker) runs while one waits. Free of Deno and network
// imports so it can be tested.

/** A video job's steps (steps.ts runVideoStep), then a style job's (runStyleStep); both make the kit. */
export const VIDEO_STEPS = [
  "kit", "kit_wait", "title", "title_check", "frame", "frame_check", "clip", "clip_wait",
  "assemble", "assemble_wait", "transcribe", "transcribe_wait", "style_cut", "style_wait", "style_read",
] as const;

/** The same, as a PostgREST list for not.in / in filters. */
export const VIDEO_STEPS_FILTER = `(${VIDEO_STEPS.join(",")})`;
