// Watch an async media_jobs row (Higgsfield generation) until it finishes.
//
// generate-post-video answers in one of two shapes:
//   { video_url, ... }                — finished inline; nothing to wait for
//   { job_id, status: "processing" }  — still rendering; the higgsfield-webhook
//                                       edge function will stamp the row
//
// This helper covers the second shape. It subscribes to realtime UPDATEs on
// the row and also polls every few seconds — the same belt-and-braces pairing
// RunAnalysis uses for reports — because a realtime channel can silently miss
// events across reconnects.

import { supabase } from "@/integrations/supabase/client";

export interface FinishedMediaJob {
  id: string;
  status: string;
  output_url: string | null;
  seed_image_url: string | null;
  error: string | null;
}

const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "nsfw", "canceled", "timed_out"]);

const POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000;

/**
 * Resolves with the terminal row (completed OR failed — caller inspects
 * status). Rejects only on timeout or when the row can't be read at all.
 */
export function waitForMediaJob(
  jobId: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<FinishedMediaJob> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel(`media-job-${jobId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "media_jobs", filter: `id=eq.${jobId}` },
        (payload) => {
          const row = payload.new as FinishedMediaJob;
          if (TERMINAL_JOB_STATUSES.has(row.status)) finish(row);
        },
      )
      .subscribe();

    const cleanup = () => {
      if (pollTimer) clearInterval(pollTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      supabase.removeChannel(channel);
    };

    const finish = (row: FinishedMediaJob) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(row);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const check = async () => {
      try {
        const { data, error } = await supabase
          .from("media_jobs")
          .select("id, status, output_url, seed_image_url, error")
          .eq("id", jobId)
          .maybeSingle();
        if (error || !data) return; // transient; next tick retries
        if (TERMINAL_JOB_STATUSES.has(data.status)) finish(data as FinishedMediaJob);
      } catch {
        // transient; next tick retries
      }
    };

    opts.signal?.addEventListener("abort", () => fail(new Error("cancelled")));
    pollTimer = setInterval(check, POLL_INTERVAL_MS);
    timeoutTimer = setTimeout(
      () => fail(new Error("Timed out waiting for the video to finish rendering.")),
      timeoutMs,
    );
    void check(); // immediate first look — the job may already be done
  });
}
