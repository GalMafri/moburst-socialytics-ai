// supabase/functions/_shared/video/steps.ts
//
// A video job's own steps, run by the video worker (video-worker), never by
// the Canva worker: generate the footage on Higgsfield, store it, then join
// cover, footage and end card in a hosted sandbox (sandbox.ts) and store the
// MP4. None of them uses Canva, so they never wait for Canva's one editing
// session. The two cards are ordinary Canva jobs of the same option.

import { MCP_URL, accessTokenFor } from "../higgsfield/oauth.ts";
import { McpClient } from "../higgsfield/mcp.ts";
import { VIDEO_MODEL, awaitJobs, creditBalance, submitVideo } from "../higgsfield/generate.ts";
import { BUCKET } from "../canva/jobs.ts";
import { TIMING, composeScript, parseComposed } from "./compose.ts";
import { checkScript, endScript, startScript } from "./sandbox.ts";

/** The steps a video job goes through. */
export const VIDEO_STEPS = ["footage", "footage_wait", "compose", "compose_wait"] as const;
/** The same, as a PostgREST list for not.in / in filters. */
export const VIDEO_STEPS_FILTER = `(${VIDEO_STEPS.join(",")})`;

/** Higgsfield credits the footage needs on the account before it is started (a 1080p clip is under 100). */
const FOOTAGE_CREDIT_FLOOR = 120;
/** How often a running clip or join is asked about. */
export const VIDEO_POLL_MS = 30_000;
const MAX_FOOTAGE = 2;
const MAX_COMPOSE = 3;
const FOOTAGE_RULES = " One continuous shot, filmed, vertical 9:16. No text, letters, numbers, captions, subtitles, signs, screens with writing, logos or watermarks anywhere in frame. No real or identifiable people.";

export type VideoJob = { id: string; client_id: string; step: string; state: any; input: any; design_request_id: string | null; option_index: number | null };
/** next: run the following step now; wait: ask again on a later pass; done: the MP4 is stored (state.final_path). */
export type VideoStepResult = "next" | "wait" | "done";

async function higgsfield(admin: any): Promise<McpClient> {
  return new McpClient({ url: MCP_URL, accessToken: await accessTokenFor(admin), timeoutMs: 30_000 });
}

export async function runVideoStep(admin: any, job: VideoJob): Promise<VideoStepResult> {
  const s = job.state;
  const base = `${job.client_id}/canva-finish/${job.id}`;
  const recently = (at: unknown) => typeof at === "number" && Date.now() - at < VIDEO_POLL_MS;
  switch (job.step) {
    case "footage": {
      s.footage_tries = (s.footage_tries ?? 0) + 1;
      if (s.footage_tries > MAX_FOOTAGE) throw new Error("FINAL: The footage could not be generated.");
      const mcp = await higgsfield(admin);
      const balance = await creditBalance(mcp);
      if (balance && balance.credits < FOOTAGE_CREDIT_FLOOR) throw new Error(`FINAL: The Higgsfield account has ${Math.floor(balance.credits)} credits left, too few for the footage.`);
      const [first] = await submitVideo(mcp, {
        prompt: `${job.input.video.prompt}${FOOTAGE_RULES}`,
        aspect: "9:16",
        seconds: job.input.video.seconds ?? TIMING.footage,
        resolution: "1080p",
        model: VIDEO_MODEL,
      });
      if (!first?.job_id) throw new Error("Higgsfield did not start the footage.");
      s.footage_job = first;
      s.footage_checked_at = Date.now();
      job.step = "footage_wait"; return "next";
    }
    case "footage_wait": {
      if (recently(s.footage_checked_at)) return "wait";
      s.footage_checked_at = Date.now();
      const res = await awaitJobs(await higgsfield(admin), [s.footage_job], { budgetMs: 0 });
      const o = res.outcomes[0];
      const terminal = !!o && (o.status === "completed" || o.status === "failed" || o.status === "nsfw" || o.status === "canceled" || o.status === "timed_out" || !!o.error);
      if (!terminal) return "wait";
      if (o.status !== "completed" || !o.result_url) {
        // Generated again from the same shot; a second failure ends the option.
        console.error(`[video-worker] job ${job.id} footage ${o.status}: ${o.error ?? ""}`);
        job.step = "footage"; return "next";
      }
      const resp = await fetch(o.result_url, { signal: AbortSignal.timeout(90_000) });
      if (!resp.ok) throw new Error(`Could not fetch the footage: ${resp.status}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      const path = `${base}/footage.mp4`;
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: true });
      if (error) throw new Error(`Could not store the footage: ${error.message}`);
      s.footage_path = path;
      job.step = "compose"; return "next";
    }
    case "compose": {
      // The cards are the option's other two jobs (Canva); the join waits for both.
      const { data: cards } = await admin.from("canva_finish_jobs").select("slide_index, status, output_path")
        .eq("design_request_id", job.design_request_id).eq("option_index", job.option_index).in("slide_index", [0, 1]);
      if ((cards ?? []).some((c: any) => c.status === "failed")) throw new Error("FINAL: A card of this video could not be made.");
      const cover = (cards ?? []).find((c: any) => c.slide_index === 0 && c.status === "done" && c.output_path);
      const end = (cards ?? []).find((c: any) => c.slide_index === 1 && c.status === "done" && c.output_path);
      if (!cover || !end) return "wait";
      s.composes = (s.composes ?? 0) + 1;
      if (s.composes > MAX_COMPOSE) throw new Error("FINAL: The video could not be put together.");
      const out = `${base}/video.mp4`;
      const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(out, { upsert: true });
      if (error || !signed?.signedUrl) throw new Error(`Could not prepare the video's upload: ${error?.message ?? "no URL"}`);
      const url = (path: string) => admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      s.compose_session = await startScript(
        composeScript({ coverUrl: url(cover.output_path), endUrl: url(end.output_path), footageUrl: url(s.footage_path), uploadUrl: signed.signedUrl }),
        `Socialytics video ${job.id}`,
      );
      s.compose_checked_at = Date.now();
      s.video_path = out;
      job.step = "compose_wait"; return "next";
    }
    case "compose_wait": {
      if (recently(s.compose_checked_at)) return "wait";
      s.compose_checked_at = Date.now();
      const r = await checkScript(s.compose_session);
      if (r.state === "running") return "wait";
      await endScript(s.compose_session);
      const made = r.state === "finished" ? parseComposed(r.reply) : null;
      if (!made) {
        console.error(`[video-worker] job ${job.id} compose:`, r.state === "failed" ? r.reason : r.reply.slice(0, 300));
        job.step = "compose"; return "next";
      }
      s.video_seconds = made.seconds;
      s.final_path = s.video_path;
      job.step = "finished"; return "done";
    }
  }
  throw new Error(`FINAL: Unknown video step '${job.step}'`);
}
