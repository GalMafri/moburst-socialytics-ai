// supabase/functions/_shared/video/steps.ts
//
// A video job's steps, run by the video worker (video-worker):
//   references   short cuts of the client's own published videos, made once
//                per video in a hosted sandbox (the video model refuses long
//                references), then kept beside the videos;
//   references_wait  until the cuts are stored;
//   footage      start the footage on Higgsfield, with those cuts as its
//                reference and with sound;
//   hook         while it renders, the image model draws the hook on a
//                transparent layer in the type of the client's posts;
//   hook_check   the hook's words are read back and must be the copy's exactly;
//   footage_wait store the footage once it is ready;
//   compose      join footage, hook and the client's logo file in a hosted
//                sandbox (sandbox.ts), keeping the footage's sound, and keep
//                four stills of the footage alone;
//   compose_wait store the finished MP4; footage with no sound is made
//                again, and footage with any writing in its stills (14 Oct:
//                garbled words on dashboard screens, brand stripes on boots)
//                is cleaned;
//   clean        the video model removes the writing from the footage and
//                keeps everything else (its first sound is kept);
//   clean_wait   store the cleaned footage, then join and read it again.
//                Footage still written on after two cleanings is made again.
// (13 Oct: video follows the client's own videos, carries the exact copy and
// the logo file, and is never silent.)

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { MCP_URL, accessTokenFor } from "../higgsfield/oauth.ts";
import { McpClient } from "../higgsfield/mcp.ts";
import { VIDEO_MODEL, awaitJobs, creditBalance, editVideo, importReferences, submitVideo } from "../higgsfield/generate.ts";
import { BUCKET } from "../canva/jobs.ts";
import { canvasLogoRect } from "../canva/brief.ts";
import { anthropicMessages } from "../anthropic.ts";
import { copyMatches, parseRead, readPrompt } from "../design/pipeline.ts";
import { parseVideoStyle, videoStylePrompt } from "../canva/options.ts";
import { CARD_SIZE, FOOTAGE_STILLS, STYLE_FRAMES, TIMING, VIDEO_SIZE, cleanFootagePrompt, framesScript, hookPlacement, videoLogoBox, parseFrames, clipScript, composeScript, footageTextPrompt, parseClipped, parseComposed, parseFootageText, referenceClipPath } from "./compose.ts";
import { hookPrompt } from "./hook.ts";
import { checkScript, endScript, startScript } from "./sandbox.ts";

/** The steps a video job goes through. */
export const VIDEO_STEPS = ["references", "references_wait", "footage", "hook", "hook_check", "footage_wait", "compose", "compose_wait", "clean", "clean_wait"] as const;
/** The same, as a PostgREST list for not.in / in filters. */
export const VIDEO_STEPS_FILTER = `(${VIDEO_STEPS.join(",")})`;

/** Room for each check's answer (the model may think first, and that counts against it). */
const CHECK_TOKENS = 2000;
/** Higgsfield credits the footage needs on the account before it is started (a 1080p clip with sound is about 100). */
const FOOTAGE_CREDIT_FLOOR = 130;
/** How often a running clip or join is asked about. */
export const VIDEO_POLL_MS = 30_000;
const MAX_FOOTAGE = 2;
const MAX_HOOKS = 3;
const MAX_COMPOSE = 3;
const MAX_CLIPS = 3;
/** Where filmed clips are kept, privately. */
const FOOTAGE_BUCKET = "post-footage";
/** Cleanings of one footage before it is made again. */
const MAX_CLEANS = 2;
/** Footage still not back after this long is asked for again (Seedance usually takes 3 to 10 minutes). */
export const FOOTAGE_WAIT_MS = 30 * 60_000;
const REFERENCES = "design-references";
/** What all footage keeps to; people as the client's own videos show them (made-up characters, or nobody). */
function footageRules(people: string | undefined, sceneWords: string[] = []): string {
  const lettering = sceneWords.length
    ? `Lettering only as these names, spelled exactly: ${sceneWords.map((w) => `"${w}"`).join(", ")}; no other text, captions, subtitles, signs, logos, watermarks or real brand marks anywhere in frame`
    : "No text, letters, numbers, captions, subtitles, signs, logos or watermarks anywhere in frame";
  return ` Vertical 9:16, every part in sharp focus. ${lettering}, and no screens, dashboards, charts, documents or interfaces. ` +
    // Sportswear marks are what the video model adds most often, and the hardest to clean off moving feet.
    "Boots, shoes, socks and balls are plain, and no clothing carries a maker's mark: no swooshes, stripes or makers' logos. " +
    (people === "fictional" ? "Any people are made-up characters, never real or famous people." : "No real or identifiable people.");
}

export type VideoJob = { id: string; client_id: string; step: string; state: any; input: any; design_request_id: string | null; option_index: number | null };
/** next: run the following step now; wait: ask again on a later pass; done: the MP4 is stored (state.final_path). */
export type VideoStepResult = "next" | "wait" | "done";

async function higgsfield(admin: any): Promise<McpClient> {
  return new McpClient({ url: MCP_URL, accessToken: await accessTokenFor(admin), timeoutMs: 30_000 });
}

const publicUrl = (admin: any, bucket: string, path: string) => admin.storage.from(bucket).getPublicUrl(path).data.publicUrl as string;

export async function runVideoStep(admin: any, job: VideoJob): Promise<VideoStepResult> {
  if (job.input?.purpose === "style") return runStyleStep(admin, job);
  const s = job.state ?? (job.state = {});
  const input = job.input;
  const base = `${job.client_id}/canva-finish/${job.id}`;
  const recently = (at: unknown) => typeof at === "number" && Date.now() - at < VIDEO_POLL_MS;
  switch (job.step) {
    case "references": {
      // The short cuts already kept for this client are reused.
      const sources: string[] = (input.video_refs ?? []).slice(0, 3);
      const clips = sources.map(referenceClipPath);
      const missing: number[] = [];
      for (let i = 0; i < clips.length; i++) if (!(await stored(admin, REFERENCES, clips[i]))) missing.push(i);
      if (!missing.length) {
        s.clip_paths = clips;
        job.step = "footage"; return "next";
      }
      s.clip_tries = (s.clip_tries ?? 0) + 1;
      if (s.clip_tries > MAX_CLIPS) throw new Error("FINAL: The client's own videos could not be prepared as references.");
      const parts = [];
      for (const i of missing) {
        const { data: signed, error } = await admin.storage.from(REFERENCES).createSignedUploadUrl(clips[i], { upsert: true });
        if (error || !signed?.signedUrl) throw new Error(`Could not prepare a reference upload: ${error?.message ?? "no URL"}`);
        parts.push({ sourceUrl: publicUrl(admin, REFERENCES, sources[i]), uploadUrl: signed.signedUrl });
      }
      s.clip_session = await startScript(clipScript(parts), `Socialytics video references ${job.client_id}`);
      s.clip_count = parts.length;
      s.clip_checked_at = Date.now();
      job.step = "references_wait"; return "next";
    }
    case "references_wait": {
      if (recently(s.clip_checked_at)) return "wait";
      s.clip_checked_at = Date.now();
      const r = await checkScript(s.clip_session);
      if (r.state === "running") return "wait";
      await endScript(s.clip_session);
      if (!(r.state === "finished" && parseClipped(r.reply, s.clip_count))) {
        console.error(`[video-worker] job ${job.id} references:`, r.state === "failed" ? r.reason : r.reply.slice(0, 300));
      }
      // Either way the stored cuts are looked at again; any still missing are made again.
      job.step = "references"; return "next";
    }
    case "footage": {
      // A job from before the reference cuts gets them first.
      if (!Array.isArray(s.clip_paths)) { job.step = "references"; return "next"; }
      s.footage_tries = (s.footage_tries ?? 0) + 1;
      if (s.footage_tries > MAX_FOOTAGE) throw new Error("FINAL: The footage could not be generated.");
      const mcp = await higgsfield(admin);
      const balance = await creditBalance(mcp);
      if (balance && balance.credits < FOOTAGE_CREDIT_FLOOR) throw new Error(`FINAL: The Higgsfield account has ${Math.floor(balance.credits)} credits left, too few for the footage.`);
      // Short cuts of the client's own published videos are the reference, imported once per job.
      if (!Array.isArray(s.video_ref_ids)) {
        const refs: string[] = s.clip_paths.map((p: string) => publicUrl(admin, REFERENCES, p));
        s.video_ref_ids = refs.length ? await importReferences(mcp, refs, "video") : [];
      }
      const [first] = await submitVideo(mcp, {
        prompt: `${input.video.prompt}${footageRules(input.people, input.scene_words ?? [])}`,
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
      s.footage_started_at = Date.now();
      // The hook is drawn while the footage renders.
      // A client whose videos carry no text over the footage gets no hook.
      job.step = s.hook_path || !input.copy?.length ? "footage_wait" : "hook"; return "next";
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
      // Where the lettering is on its layer (its visible pixels), so it can be placed exactly.
      let x0 = hook.width, y0 = hook.height, x1 = -1, y1 = -1;
      for (let y = 0; y < hook.height; y++) {
        for (let x = 0; x < hook.width; x++) {
          if (hook.bitmap[(y * hook.width + x) * 4 + 3] > 16) {
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) throw new Error("The title came back empty.");
      s.hook_box = { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
      s.hook_layer = { width: hook.width, height: hook.height };
      const ground = new Image(hook.width, hook.height).fill(Image.rgbaToColor(70, 70, 76, 255));
      ground.composite(hook, 0, 0);
      const jpeg = await ground.resize(Math.round(hook.width / 2), Math.round(hook.height / 2)).encodeJPEG(92);
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
      const result = await anthropicMessages({
        apiKey,
        body: {
          model: "claude-opus-5-5", max_tokens: CHECK_TOKENS,
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
      // A filmed clip is already the footage.
      job.step = input.footage_upload ? "compose" : "footage_wait"; return "next";
    }
    case "footage_wait": {
      if (recently(s.footage_checked_at)) return "wait";
      s.footage_checked_at = Date.now();
      const res = await awaitJobs(await higgsfield(admin), [s.footage_job], { budgetMs: 0 });
      const o = res.outcomes[0];
      const terminal = !!o && (o.status === "completed" || o.status === "failed" || o.status === "nsfw" || o.status === "canceled" || o.status === "timed_out" || !!o.error);
      if (!terminal) {
        // A render left waiting in the video model's queue is asked for again, as one of the footage's tries.
        if (typeof s.footage_started_at === "number" && Date.now() - s.footage_started_at > FOOTAGE_WAIT_MS) {
          console.warn(`[video-worker] job ${job.id}: the footage has not come back in ${FOOTAGE_WAIT_MS / 60_000} minutes; asking again.`);
          delete s.footage_job;
          job.step = "footage"; return "next";
        }
        return "wait";
      }
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
      s.footage_first_path = path;
      // New footage starts its own count of cleans and assemblies.
      delete s.cleans;
      delete s.composes;
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
      // The logo where the client's own videos have it, else where its posts have it.
      // A vertical frame's shorter side is its width. A closing logo is never smaller than the client's posts show it.
      const box = input.logo_at
        ? videoLogoBox(input.logo_at, input.logo_at === "end" ? Math.max(input.logo_width ?? 0, input.placement.width) : input.logo_width ?? input.placement.width, lw / lh)
        : { ...canvasLogoRect(input.placement, lw, lh, VIDEO_SIZE.width, VIDEO_SIZE.height), end: false };
      const logoBottom = box.end || box.y > VIDEO_SIZE.height / 2 ? 0 : box.y + Math.round(box.width * lh / lw);
      const at = s.hook_box ? hookPlacement(s.hook_box, s.hook_layer ?? CARD_SIZE, input.text_style ?? "", logoBottom) : null;
      const stills: string[] = [];
      const frameUploads: string[] = [];
      // A filmed clip is used as it is: it is not read for writing or cleaned.
      for (let i = 0; i < (input.footage_upload ? 0 : FOOTAGE_STILLS); i++) {
        const path = `${base}/still-${s.footage_tries}-${i}.jpg`;
        const { data: up, error: upError } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
        if (upError || !up?.signedUrl) throw new Error(`Could not prepare a still's upload: ${upError?.message ?? "no URL"}`);
        stills.push(path);
        frameUploads.push(up.signedUrl);
      }
      s.still_paths = stills;
      s.compose_session = await startScript(
        composeScript({
          footageUrl: input.footage_upload ? await signedUrl(admin, FOOTAGE_BUCKET, input.footage_upload) : publicUrl(admin, BUCKET, s.footage_path),
          overlayUrl: s.hook_path ? publicUrl(admin, BUCKET, s.hook_path) : undefined,
          hook: at && s.hook_box ? { crop: s.hook_box, at: { x: at.x, y: at.y, width: at.width } } : undefined,
          // The logo goes over the footage only when the client's own videos show it.
          logoUrl: input.show_logo === false ? undefined : publicUrl(admin, BUCKET, input.logo_path),
          logo: input.show_logo === false ? undefined : { x: box.x, y: box.y, width: box.width, end: box.end },
          uploadUrl: signed.signedUrl,
          frameUploads,
          audioUrl: s.footage_first_path && s.footage_first_path !== s.footage_path ? publicUrl(admin, BUCKET, s.footage_first_path) : undefined,
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
      if (input.footage_upload) {
        s.video_seconds = made.seconds;
        s.final_path = s.video_path;
        job.step = "finished"; return "done";
      }
      // A video post is never silent: footage that came back without sound is made again.
      if (made.audio < 1) {
        console.warn(`[video-worker] job ${job.id}: the footage has no sound; making it again.`);
        delete s.footage_job;
        job.step = "footage"; return "next";
      }
      // The footage carries no writing of its own: the only words are the hook's.
      const seen = await footageWriting(admin, s.still_paths ?? [], input.scene_words ?? []);
      s.footage_writing = seen;
      if (seen.writing) {
        s.cleans = (s.cleans ?? 0) + 1;
        if (s.cleans <= MAX_CLEANS) {
          console.warn(`[video-worker] job ${job.id}: the footage has writing (${seen.where}); cleaning it.`);
          job.step = "clean"; return "next";
        }
        console.warn(`[video-worker] job ${job.id}: the footage still has writing after cleaning (${seen.where}); making it again.`);
        delete s.footage_job;
        job.step = "footage"; return "next";
      }
      s.video_seconds = made.seconds;
      s.final_path = s.video_path;
      job.step = "finished"; return "done";
    }
    case "clean": {
      const mcp = await higgsfield(admin);
      const [id] = await importReferences(mcp, [publicUrl(admin, BUCKET, s.footage_path)], "video");
      if (!id) throw new Error("Could not hand the footage to the video model.");
      const [first] = await editVideo(mcp, { prompt: cleanFootagePrompt(input.scene_words ?? [], s.footage_writing?.where ?? ""), videoId: id });
      if (!first?.job_id) throw new Error("Higgsfield did not start the cleaning.");
      s.clean_job = first;
      s.clean_checked_at = Date.now();
      job.step = "clean_wait"; return "next";
    }
    case "clean_wait": {
      if (recently(s.clean_checked_at)) return "wait";
      s.clean_checked_at = Date.now();
      const res = await awaitJobs(await higgsfield(admin), [s.clean_job], { budgetMs: 0 });
      const o = res.outcomes[0];
      const terminal = !!o && (o.status === "completed" || o.status === "failed" || o.status === "nsfw" || o.status === "canceled" || o.status === "timed_out" || !!o.error);
      if (!terminal) return "wait";
      if (o.status !== "completed" || !o.result_url) {
        console.error(`[video-worker] job ${job.id} cleaning ${o.status}: ${o.error ?? ""}`);
        // A cleaning that did not finish counts as one; the next is tried, then new footage.
        job.step = (s.cleans ?? 0) < MAX_CLEANS ? "clean" : "footage";
        if (job.step === "clean") s.cleans = (s.cleans ?? 0) + 1; else delete s.footage_job;
        return "next";
      }
      const resp = await fetch(o.result_url, { signal: AbortSignal.timeout(90_000) });
      if (!resp.ok) throw new Error(`Could not fetch the cleaned footage: ${resp.status}`);
      const path = `${base}/footage-${s.footage_tries}-clean-${s.cleans}.mp4`;
      const { error } = await admin.storage.from(BUCKET).upload(path, new Uint8Array(await resp.arrayBuffer()), { contentType: "video/mp4", upsert: true });
      if (error) throw new Error(`Could not store the cleaned footage: ${error.message}`);
      s.footage_path = path;
      job.step = "compose"; return "next";
    }
  }
  throw new Error(`FINAL: Unknown video step '${job.step}'`);
}

/** Whether the footage's stills show any writing, read by the vision model. */
async function footageWriting(admin: any, paths: string[], allowed: string[] = []): Promise<{ writing: boolean; where: string }> {
  if (!paths.length) throw new Error("The footage's stills are missing.");
  const content: unknown[] = [];
  for (const p of paths) {
    const { data, error } = await admin.storage.from(BUCKET).download(p);
    if (error || !data) throw new Error(`Could not read a still of the footage: ${error?.message ?? "missing"}`);
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Encode(new Uint8Array(await data.arrayBuffer()) as unknown as ArrayBuffer) } });
  }
  content.push({ type: "text", text: footageTextPrompt(allowed) });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const result = await anthropicMessages({ apiKey, body: { model: "claude-opus-5-5", max_tokens: CHECK_TOKENS, messages: [{ role: "user", content }] } });
  const seen = parseFootageText(result.text);
  if (!seen) throw new Error(`The footage's stills could not be read: ${result.text.slice(0, 200)}`);
  return seen;
}

/**
 * A client's video style, read once from stills of its own published videos
 * (14 Oct: videos follow the client's VIDEOS, not its statics):
 *   style_cut   STYLE_FRAMES stills from each video, taken in the sandbox;
 *   style_wait  until they are stored;
 *   style_read  the vision model describes the style; it is kept on the client
 *               (clients.video_style) with the stills, and video posts waiting
 *               for it are planned.
 */
async function runStyleStep(admin: any, job: VideoJob): Promise<VideoStepResult> {
  const s = job.state ?? (job.state = {});
  const recently = (at: unknown) => typeof at === "number" && Date.now() - at < VIDEO_POLL_MS;
  const { data: client } = await admin.from("clients").select("name, video_references").eq("id", job.client_id).maybeSingle();
  const videos: string[] = (Array.isArray(client?.video_references) ? client.video_references : []).map((r: { path?: unknown }) => String(r?.path ?? "")).filter(Boolean).slice(0, 3);
  if (!videos.length) throw new Error("FINAL: The client has no published videos to learn from.");
  switch (job.step) {
    case "style_cut": {
      s.cuts = (s.cuts ?? 0) + 1;
      if (s.cuts > MAX_CLIPS) throw new Error("FINAL: Stills could not be taken from the client's videos.");
      const frames: string[] = [];
      const parts = [];
      for (let i = 0; i < videos.length; i++) {
        const uploads: string[] = [];
        for (let j = 0; j < STYLE_FRAMES; j++) {
          const path = `${job.client_id}/style/v${i}-f${j}.jpg`;
          const { data: up, error } = await admin.storage.from(REFERENCES).createSignedUploadUrl(path, { upsert: true });
          if (error || !up?.signedUrl) throw new Error(`Could not prepare a still's upload: ${error?.message ?? "no URL"}`);
          frames.push(path);
          uploads.push(up.signedUrl);
        }
        parts.push({ sourceUrl: publicUrl(admin, REFERENCES, videos[i]), uploads });
      }
      s.frames = frames;
      s.style_session = await startScript(framesScript(parts), `Socialytics video style ${job.client_id}`);
      s.style_checked_at = Date.now();
      job.step = "style_wait"; return "next";
    }
    case "style_wait": {
      if (recently(s.style_checked_at)) return "wait";
      s.style_checked_at = Date.now();
      const r = await checkScript(s.style_session);
      if (r.state === "running") return "wait";
      await endScript(s.style_session);
      if (!(r.state === "finished" && parseFrames(r.reply, s.frames.length))) {
        console.error(`[video-worker] style ${job.id}:`, r.state === "failed" ? r.reason : r.reply.slice(0, 300));
        job.step = "style_cut"; return "next";
      }
      job.step = "style_read"; return "next";
    }
    case "style_read": {
      const content: unknown[] = [];
      for (const p of s.frames as string[]) {
        const { data, error } = await admin.storage.from(REFERENCES).download(p);
        if (error || !data) throw new Error(`Could not read a still: ${error?.message ?? "missing"}`);
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Encode(new Uint8Array(await data.arrayBuffer()) as unknown as ArrayBuffer) } });
      }
      content.push({ type: "text", text: videoStylePrompt(client?.name ?? "the brand", videos.length, STYLE_FRAMES) });
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
      const result = await anthropicMessages({ apiKey, body: { model: "claude-opus-5-5", max_tokens: 4000, messages: [{ role: "user", content }] } });
      const style = parseVideoStyle(result.text);
      if (!style) throw new Error(`The client's videos could not be read: ${result.text.slice(0, 200)}`);
      await admin.from("clients").update({ video_style: { profile: style, frames: s.frames, videos: videos.length, frames_per_video: STYLE_FRAMES, made_at: new Date().toISOString() } }).eq("id", job.client_id);
      s.style = style;
      // Video posts that waited for the style are planned now.
      const { data: waiting } = await admin.from("design_requests").select("id, briefs, requested_by")
        .eq("client_id", job.client_id).eq("kind", "video").eq("status", "preparing").eq("stage", "planning");
      for (const w of waiting ?? []) {
        if (Array.isArray(w.briefs) && w.briefs.length) continue;
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/design-request`, {
          method: "POST",
          // A server call names the person it acts for: the one who asked for the video.
          headers: { "Content-Type": "application/json", "X-Socialytics-Secret": Deno.env.get("SOCIALYTICS_N8N_SECRET") ?? "", "X-Socialytics-User": String(w.requested_by ?? "") },
          body: JSON.stringify({ action: "replan", request_id: w.id }),
          signal: AbortSignal.timeout(15_000),
        }).then(async (r) => {
          const text = await r.text();
          if (!r.ok) throw new Error(`replan answered ${r.status}: ${text.slice(0, 200)}`);
        }).catch((e) => console.error(`[video-worker] could not plan ${w.id}:`, e instanceof Error ? e.message : e));
      }
      s.final_path = null;
      job.step = "finished"; return "done";
    }
  }
  throw new Error(`FINAL: Unknown style step '${job.step}'`);
}

/** A short-lived link to a private file, for the hosted sandbox to download. */
async function signedUrl(admin: any, bucket: string, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(`Could not open the filmed clip: ${error?.message ?? "missing"}`);
  return data.signedUrl;
}

/** Whether a file is in storage. */
async function stored(admin: any, bucket: string, path: string): Promise<boolean> {
  const at = path.lastIndexOf("/");
  const { data, error } = await admin.storage.from(bucket).list(path.slice(0, at), { search: path.slice(at + 1), limit: 5 });
  if (error) throw new Error(`Could not look in storage: ${error.message}`);
  return (data ?? []).some((f: { name: string }) => f.name === path.slice(at + 1));
}

async function openaiKey(admin: any): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (key) return key;
  const { data } = await admin.from("app_settings").select("value").eq("key", "openai_api_key").maybeSingle();
  if (!data?.value) throw new Error("FINAL: No OpenAI key is configured.");
  return data.value as string;
}
