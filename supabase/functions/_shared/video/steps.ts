// supabase/functions/_shared/video/steps.ts
//
// A video job's steps, run by the video worker (video-worker):
//   footage      start the footage on Higgsfield, with the client's own
//                published videos as its reference and with sound;
//   hook         while it renders, the image model draws the hook on a
//                transparent layer in the type of the client's posts;
//   hook_check   the hook's words are read back and must be the copy's exactly;
//   footage_wait store the footage once it is ready;
//   compose      join footage, hook and the client's logo file in a hosted
//                sandbox (sandbox.ts), keeping the footage's sound;
//   compose_wait store the finished MP4.
// (13 Oct: video follows the client's own videos, carries the exact copy and
// the logo file, and is never silent.)

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { MCP_URL, accessTokenFor } from "../higgsfield/oauth.ts";
import { McpClient } from "../higgsfield/mcp.ts";
import { VIDEO_MODEL, awaitJobs, creditBalance, importReferences, submitVideo } from "../higgsfield/generate.ts";
import { BUCKET } from "../canva/jobs.ts";
import { canvasLogoRect } from "../canva/brief.ts";
import { anthropicMessages } from "../anthropic.ts";
import { copyMatches, parseRead, readPrompt } from "../design/pipeline.ts";
import { CARD_SIZE, TIMING, VIDEO_SIZE, composeScript, parseComposed } from "./compose.ts";
import { hookPrompt } from "./hook.ts";
import { checkScript, endScript, startScript } from "./sandbox.ts";

/** The steps a video job goes through. */
export const VIDEO_STEPS = ["footage", "hook", "hook_check", "footage_wait", "compose", "compose_wait"] as const;
/** The same, as a PostgREST list for not.in / in filters. */
export const VIDEO_STEPS_FILTER = `(${VIDEO_STEPS.join(",")})`;

/** Higgsfield credits the footage needs on the account before it is started (a 1080p clip with sound is about 100). */
const FOOTAGE_CREDIT_FLOOR = 130;
/** How often a running clip or join is asked about. */
export const VIDEO_POLL_MS = 30_000;
const MAX_FOOTAGE = 2;
const MAX_HOOKS = 3;
const MAX_COMPOSE = 3;
const FOOTAGE_RULES = " One continuous shot, vertical 9:16, every part in sharp focus. No text, letters, numbers, captions, subtitles, signs, screens with writing, logos or watermarks anywhere in frame. No real or identifiable people.";

export type VideoJob = { id: string; client_id: string; step: string; state: any; input: any; design_request_id: string | null; option_index: number | null };
/** next: run the following step now; wait: ask again on a later pass; done: the MP4 is stored (state.final_path). */
export type VideoStepResult = "next" | "wait" | "done";

async function higgsfield(admin: any): Promise<McpClient> {
  return new McpClient({ url: MCP_URL, accessToken: await accessTokenFor(admin), timeoutMs: 30_000 });
}

const publicUrl = (admin: any, bucket: string, path: string) => admin.storage.from(bucket).getPublicUrl(path).data.publicUrl as string;

export async function runVideoStep(admin: any, job: VideoJob): Promise<VideoStepResult> {
  const s = job.state ?? (job.state = {});
  const input = job.input;
  const base = `${job.client_id}/canva-finish/${job.id}`;
  const recently = (at: unknown) => typeof at === "number" && Date.now() - at < VIDEO_POLL_MS;
  switch (job.step) {
    case "footage": {
      s.footage_tries = (s.footage_tries ?? 0) + 1;
      if (s.footage_tries > MAX_FOOTAGE) throw new Error("FINAL: The footage could not be generated.");
      const mcp = await higgsfield(admin);
      const balance = await creditBalance(mcp);
      if (balance && balance.credits < FOOTAGE_CREDIT_FLOOR) throw new Error(`FINAL: The Higgsfield account has ${Math.floor(balance.credits)} credits left, too few for the footage.`);
      // The client's own published videos are the reference, imported once per job.
      if (!Array.isArray(s.video_ref_ids)) {
        const refs: string[] = (input.video_refs ?? []).map((p: string) => publicUrl(admin, "design-references", p));
        s.video_ref_ids = refs.length ? await importReferences(mcp, refs, "video") : [];
      }
      const [first] = await submitVideo(mcp, {
        prompt: `${input.video.prompt}${FOOTAGE_RULES}`,
        aspect: "9:16",
        seconds: input.video.seconds ?? TIMING.footage,
        resolution: "1080p",
        model: VIDEO_MODEL,
        withAudio: true,
        videoReferenceIds: s.video_ref_ids,
      });
      if (!first?.job_id) throw new Error("Higgsfield did not start the footage.");
      s.footage_job = first;
      s.footage_checked_at = Date.now();
      // The hook is drawn while the footage renders.
      job.step = s.hook_path ? "footage_wait" : "hook"; return "next";
    }
    case "hook": {
      s.hooks = (s.hooks ?? 0) + 1;
      if (s.hooks > MAX_HOOKS) throw new Error("FINAL: The video's title could not be drawn with the exact words.");
      const resp = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${await openaiKey(admin)}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-image-2.5-flare", prompt: hookPrompt(input.brand_name, input.copy, input.text_style),
          size: `${CARD_SIZE.width}x${CARD_SIZE.height}`, quality: "high", background: "transparent", output_format: "png", n: 1,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await resp.text();
      if (resp.status === 429 || resp.status >= 500) { s.hooks -= 1; return "wait"; }
      if (!resp.ok) throw new Error(`Image model ${resp.status}: ${text.slice(0, 300)}`);
      const b64 = JSON.parse(text)?.data?.[0]?.b64_json;
      if (!b64) throw new Error("The image model returned no title.");
      const path = `${base}/hook-${s.hooks}.png`;
      const { error } = await admin.storage.from(BUCKET).upload(path, base64Decode(b64), { contentType: "image/png", upsert: true });
      if (error) throw new Error(`Could not store the title: ${error.message}`);
      s.hook_path = path;
      job.step = "hook_check"; return "next";
    }
    case "hook_check": {
      // Read over a mid-grey ground so light and dark lettering both show.
      const { data, error } = await admin.storage.from(BUCKET).download(s.hook_path);
      if (error || !data) throw new Error(`Could not read the title: ${error?.message ?? "missing"}`);
      const hook = await Image.decode(new Uint8Array(await data.arrayBuffer()));
      const ground = new Image(hook.width, hook.height).fill(Image.rgbaToColor(70, 70, 76, 255));
      ground.composite(hook, 0, 0);
      const jpeg = await ground.resize(Math.round(hook.width / 2), Math.round(hook.height / 2)).encodeJPEG(92);
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
      const result = await anthropicMessages({
        apiKey,
        body: {
          model: "claude-opus-5-5", max_tokens: 400,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Encode(jpeg as unknown as ArrayBuffer) } },
            { type: "text", text: readPrompt(input.brand_name) },
          ] }],
        },
      });
      const lines = parseRead(result.text);
      if (!lines) throw new Error("The title's words could not be read.");
      s.hook_read = lines;
      if (!copyMatches(lines, input.copy)) {
        console.warn(`[video-worker] job ${job.id}: title read ${JSON.stringify(lines)}, wanted ${JSON.stringify(input.copy)}`);
        delete s.hook_path;
        job.step = "hook"; return "next";
      }
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
      const path = `${base}/footage-${s.footage_tries}.mp4`;
      const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: "video/mp4", upsert: true });
      if (error) throw new Error(`Could not store the footage: ${error.message}`);
      s.footage_path = path;
      job.step = "compose"; return "next";
    }
    case "compose": {
      s.composes = (s.composes ?? 0) + 1;
      if (s.composes > MAX_COMPOSE) throw new Error("FINAL: The video could not be put together.");
      // Each finished file has a name of its own, so a video made again is never shown from a cached copy.
      const out = `${base}/video-${Date.now().toString(36)}.mp4`;
      const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(out, { upsert: true });
      if (error || !signed?.signedUrl) throw new Error(`Could not prepare the video's upload: ${error?.message ?? "no URL"}`);
      const [lw, lh] = input.logo_size;
      const rect = canvasLogoRect(input.placement, lw, lh, VIDEO_SIZE.width, VIDEO_SIZE.height);
      s.compose_session = await startScript(
        composeScript({
          footageUrl: publicUrl(admin, BUCKET, s.footage_path),
          overlayUrl: publicUrl(admin, BUCKET, s.hook_path),
          logoUrl: publicUrl(admin, BUCKET, input.logo_path),
          logo: { x: rect.x, y: rect.y, width: rect.width },
          uploadUrl: signed.signedUrl,
        }),
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
      // A video post is never silent: footage that came back without sound is made again.
      if (made.audio < 1) {
        console.warn(`[video-worker] job ${job.id}: the footage has no sound; making it again.`);
        delete s.footage_job;
        job.step = "footage"; return "next";
      }
      s.video_seconds = made.seconds;
      s.final_path = s.video_path;
      job.step = "finished"; return "done";
    }
  }
  throw new Error(`FINAL: Unknown video step '${job.step}'`);
}

async function openaiKey(admin: any): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (key) return key;
  const { data } = await admin.from("app_settings").select("value").eq("key", "openai_api_key").maybeSingle();
  if (!data?.value) throw new Error("FINAL: No OpenAI key is configured.");
  return data.value as string;
}
