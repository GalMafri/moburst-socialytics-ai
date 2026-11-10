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
// Each footage and each cleaning records what Higgsfield quoted for it
// (state.credits, credits.ts), so staff see what a week of designs used.
// (13 Oct: video follows the client's own videos, carries the exact copy and
// the logo file, and is never silent.)

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { MCP_URL, accessTokenFor } from "../higgsfield/oauth.ts";
import { McpClient } from "../higgsfield/mcp.ts";
import { VIDEO_MODEL, type VideoRequest, awaitJobs, creditBalance, editVideo, importReferences, quoteEdit, quoteVideo, submitVideo } from "../higgsfield/generate.ts";
import { CLIP_CREDIT_FLOOR, withCredits } from "./credits.ts";
import { BUCKET } from "../canva/jobs.ts";
import { canvasLogoRect } from "../canva/brief.ts";
import { anthropicMessages } from "../anthropic.ts";
import { openaiKey } from "../openai/key.ts";
import { ModelBusy, imageEdit } from "../media/imageEdit.ts";
import { KIT_MAKE_MS, KIT_MAX, KIT_MIN, MAX_KIT_TRIES, kitChosen, kitCleanPrompt, kitKept, kitNext, kitPath, kitPickPrompt, kitClaim, kitDoneCount, kitState, kitWork, postsRouteInput } from "./kit.ts";
import { copyMatches, parseRead, readPrompt } from "../design/pipeline.ts";
import { parseVideoStyle, videoStylePrompt } from "../canva/options.ts";
import { CARD_SIZE, FOOTAGE_STILLS, STYLE_FRAMES, TIMING, VIDEO_SIZE, audioScript, captionWeight, captionsAss, cleanFootagePrompt, framesScript, hookPlacement, parseAudio, videoLogoBox, parseFrames, clipScript, composeScript, footageTextPrompt, parseClipped, parseComposed, parseFootageText, referenceClipPath } from "./compose.ts";
import { hookPrompt } from "./hook.ts";
import { checkScript, endScript, startScript } from "./sandbox.ts";

/** The steps a video job goes through. */
export const VIDEO_STEPS = ["kit", "kit_wait", "references", "references_wait", "footage", "hook", "hook_check", "footage_wait", "compose", "compose_wait", "clean", "clean_wait"] as const;
/** The same, as a PostgREST list for not.in / in filters. */
export const VIDEO_STEPS_FILTER = `(${VIDEO_STEPS.join(",")})`;

/** Room for each check's answer (the model may think first, and that counts against it). */
const CHECK_TOKENS = 2000;
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
/** next: run the following step now; wait: ask again on a later pass; done: the MP4 is stored (state.final_path); held: work goes on in the background under its own lease (hold). */
export type VideoStepResult = "next" | "wait" | "done" | "held";

/** A job is only ever moved on while it is active: a job stopped meanwhile stays stopped. */
const ACTIVE = ["queued", "running"];
/** Tries of one step before its job fails. */
export const MAX_VIDEO_ATTEMPTS = 4;
/** A job held for model work keeps its lease this long (as the design worker's). */
const MODEL_LEASE_MS = 420_000;

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/** A step's error kept on its job: tried again on a later pass, or the job fails (a FINAL: reason, or its last try). */
export async function recordVideoFailure(admin: any, job: VideoJob & { attempts?: number }, e: unknown): Promise<void> {
  const msg = e instanceof Error ? e.message : String(e);
  const attempts = (job.attempts ?? 0) + 1;
  const final = attempts >= MAX_VIDEO_ATTEMPTS || msg.startsWith("FINAL:");
  console.error(`[video-worker] job ${job.id} step ${job.step}:`, msg);
  await admin.from("canva_finish_jobs").update({
    attempts, state: job.state, error: msg.replace(/^FINAL:\s*/, ""), status: final ? "failed" : "running", lease_until: null, updated_at: new Date().toISOString(),
  }).eq("id", job.id).in("status", ACTIVE);
}

/**
 * Model work that runs past the worker's pass (the shape of the design
 * worker's): the job is held under a longer lease with its step and state saved, and
 * moves on (its step, state, no error) when the work ends. The image model at
 * its rate limit is waited out without using a try.
 */
function hold(admin: any, job: VideoJob, work: () => Promise<void>): VideoStepResult {
  const run = (async () => {
    // The step is saved too: the steps run before the hold in this pass (style_read, say) are not run again.
    await admin.from("canva_finish_jobs").update({ step: job.step, lease_until: new Date(Date.now() + MODEL_LEASE_MS).toISOString(), state: job.state, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
    try {
      await work();
      await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
    } catch (e) {
      if (e instanceof ModelBusy) {
        await admin.from("canva_finish_jobs").update({ state: job.state, error: e.message, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
      } else {
        await recordVideoFailure(admin, job, e);
      }
    }
  })();
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(run);
  return "held";
}

async function higgsfield(admin: any): Promise<McpClient> {
  return new McpClient({ url: MCP_URL, accessToken: await accessTokenFor(admin), timeoutMs: 30_000 });
}

const publicUrl = (admin: any, bucket: string, path: string) => admin.storage.from(bucket).getPublicUrl(path).data.publicUrl as string;

export async function runVideoStep(admin: any, job: VideoJob): Promise<VideoStepResult> {
  if (job.input?.purpose === "style") return runStyleStep(admin, job);
  const s = job.state ?? (job.state = {});
  const input = job.input;
  // A generated video is made with the client's kit: a job that starts before
  // the kit is ready makes it (or waits for it) first.
  if (job.step === "references" && !input.footage_upload && input.video_route !== "posts") {
    const { data: client } = await admin.from("clients").select("video_style").eq("id", job.client_id).maybeSingle();
    if (kitState(client?.video_style) !== "ready") job.step = "kit";
  }
  if (job.step === "kit" || job.step === "kit_wait") return runKitStep(admin, job, "video");
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
      if (balance && balance.credits < CLIP_CREDIT_FLOOR) throw new Error(`FINAL: The Higgsfield account has ${Math.floor(balance.credits)} credits left, too few for the footage.`);
      // Short cuts of the client's own published videos are the reference, imported once per job.
      if (!Array.isArray(s.video_ref_ids)) {
        const refs: string[] = s.clip_paths.map((p: string) => publicUrl(admin, REFERENCES, p));
        s.video_ref_ids = refs.length ? await importReferences(mcp, refs, "video") : [];
      }
      const clip: VideoRequest = {
        prompt: `${input.video.prompt}${footageRules(input.people, input.scene_words ?? [])}`,
        aspect: "9:16",
        seconds: input.video.seconds ?? TIMING.footage,
        resolution: "1080p",
        model: VIDEO_MODEL,
        withAudio: true,
        videoReferenceIds: s.video_ref_ids,
      };
      const [first] = await submitVideo(mcp, clip);
      if (!first?.job_id) throw new Error("Higgsfield did not start the footage.");
      s.footage_job = first;
      s.credits = withCredits(s.credits, { what: "footage", job_id: first.job_id, credits: await quoteVideo(mcp, clip), at: new Date().toISOString() });
      s.footage_checked_at = Date.now();
      s.footage_started_at = Date.now();
      // The hook is drawn while the footage renders.
      // A client whose videos carry no text over the footage gets no hook.
      job.step = s.hook_path || !input.copy?.length ? "footage_wait" : "hook"; return "next";
    }
    case "transcribe": {
      // A filmed clip is captioned the way the client's filmed videos are: its speech is transcribed first.
      if (!input.footage_upload || !input.filmed || input.filmed.captions === "none") {
        job.step = input.filmed && input.filmed.title === "none" ? "compose" : "hook"; return "next";
      }
      s.audio_tries = (s.audio_tries ?? 0) + 1;
      if (s.audio_tries > 3) throw new Error("FINAL: The clip's sound could not be taken for its captions.");
      const audioPath = `${base}/speech.mp3`;
      const { data: up, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(audioPath, { upsert: true });
      if (error || !up?.signedUrl) throw new Error(`Could not prepare the sound's upload: ${error?.message ?? "no URL"}`);
      s.audio_path = audioPath;
      s.audio_session = await startScript(audioScript({ clipUrl: await signedUrl(admin, FOOTAGE_BUCKET, input.footage_upload), uploadUrl: up.signedUrl }), `Socialytics clip sound ${job.id}`);
      s.audio_checked_at = Date.now();
      job.step = "transcribe_wait"; return "next";
    }
    case "transcribe_wait": {
      if (recently(s.audio_checked_at)) return "wait";
      s.audio_checked_at = Date.now();
      const r = await checkScript(s.audio_session);
      if (r.state === "running") return "wait";
      await endScript(s.audio_session);
      const got = r.state === "finished" ? parseAudio(r.reply) : null;
      if (!got) {
        console.error(`[video-worker] job ${job.id} sound:`, r.state === "failed" ? r.reason : r.reply.slice(0, 300));
        job.step = "transcribe"; return "next";
      }
      s.clip_seconds = got.seconds;
      const { data, error } = await admin.storage.from(BUCKET).download(s.audio_path);
      if (error || !data) throw new Error(`Could not read the clip's sound: ${error?.message ?? "missing"}`);
      const said = await transcribeWords(await openaiKey(admin), data);
      s.words = said.words;
      s.sentence_starts = said.sentenceStarts;
      job.step = input.filmed.title === "none" ? "compose" : "hook"; return "next";
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
      // A filmed clip follows the client's filmed videos: their logo spot, captions and end card.
      const filmed = input.footage_upload ? input.filmed : null;
      if (filmed?.logo_at) { input.logo_at = filmed.logo_at; input.logo_width = filmed.logo_width ?? null; }
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
          captions: filmed && filmed.captions !== "none" && Array.isArray(s.words) && s.words.length
            ? { assB64: base64Encode(new TextEncoder().encode(captionsAss(s.words, filmed, s.sentence_starts ?? [])) as unknown as ArrayBuffer), fontUrl: await captionFontUrl(admin, filmed.caption_font, captionWeight(filmed.caption_style)) }
            : undefined,
          endCard: filmed && input.end_card?.url ? { url: input.end_card.url, seconds: input.end_card.seconds } : undefined,
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
        const why = r.state === "failed" ? r.reason : r.reply.slice(0, 300);
        console.error(`[video-worker] job ${job.id} compose:`, why);
        // Kept with the job: a join that never came back left no reason on 14 Oct.
        s.compose_errors = [...(Array.isArray(s.compose_errors) ? s.compose_errors : []), String(why ?? "").slice(0, 300)].slice(-3);
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
      const edit = { prompt: cleanFootagePrompt(input.scene_words ?? [], s.footage_writing?.where ?? ""), videoId: id };
      const [first] = await editVideo(mcp, edit);
      if (!first?.job_id) throw new Error("Higgsfield did not start the cleaning.");
      s.clean_job = first;
      s.credits = withCredits(s.credits, { what: "clean", job_id: first.job_id, credits: await quoteEdit(mcp, edit), at: new Date().toISOString() });
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
async function footageWriting(admin: any, paths: string[], allowed: string[] = [], bucket = BUCKET): Promise<{ writing: boolean; where: string }> {
  if (!paths.length) throw new Error("The footage's stills are missing.");
  const content: unknown[] = await jpegBlocks(admin, bucket, paths);
  content.push({ type: "text", text: footageTextPrompt(allowed) });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const result = await anthropicMessages({ apiKey, body: { model: "claude-opus-5-5", max_tokens: CHECK_TOKENS, messages: [{ role: "user", content }] } });
  const seen = parseFootageText(result.text);
  if (!seen) throw new Error(`The footage's stills could not be read: ${result.text.slice(0, 200)}`);
  return seen;
}

/** JPEG stills in storage as image blocks for the vision model. */
async function jpegBlocks(admin: any, bucket: string, paths: string[]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const p of paths) {
    const { data, error } = await admin.storage.from(bucket).download(p);
    if (error || !data) throw new Error(`Could not read a still: ${error?.message ?? "missing"}`);
    out.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64Encode(new Uint8Array(await data.arrayBuffer()) as unknown as ArrayBuffer) } });
  }
  return out;
}

/**
 * The client's kit (kit.ts), made once by the first job that needs it: the
 * style job right after it reads the style, or a video job that finds no kit.
 *   kit       claim the making on the client (video_style_claim_kit; the
 *             holder renews its claim each pass), let the
 *             vision model pick up to KIT_MAX of the style's stills, then clean
 *             up to KIT_BATCH of them per pass with the image model in the
 *             background (hold): a still whose writing shows again is cleaned
 *             once more, then dropped. Each still's outcome is saved on the job
 *             as it comes. Once every picked still is done, the clean ones
 *             (kitPath) are listed on video_style.kit ([] with fewer than
 *             KIT_MIN). After MAX_KIT_TRIES claims that finished no still
 *             (kitClaim) the kit is stored as []:
 *             the client's videos take the posts route, and nothing fails;
 *   kit_wait  until the kit is stored. The style job then plans the video
 *             posts that waited for the style and ends; a video job goes on,
 *             on the posts route when the kit has too few stills.
 * after: what the job does once the kit is in ("finish" for the style job).
 */
async function runKitStep(admin: any, job: VideoJob, after: "finish" | "video"): Promise<VideoStepResult> {
  const s = job.state ?? (job.state = {});
  const { data: client } = await admin.from("clients").select("name, video_style").eq("id", job.client_id).maybeSingle();
  const videoStyle = client?.video_style ?? null;
  const next = kitNext(videoStyle, Date.now(), job.id, s.kit_held_at);
  if (job.step === "kit_wait" || next === "ready" || next === "none") {
    if (next === "wait") return "wait";
    // The last maker stopped without storing a kit: it is made again.
    if (next === "make") { job.step = "kit"; return "next"; }
    if (after === "finish") {
      // Planned now, so planning sees the kit as it is.
      await planWaitingVideos(admin, job.client_id);
      s.final_path = null;
      job.step = "finished"; return "done";
    }
    if (next === "none") await toPostsRoute(admin, job);
    job.step = "references"; return "next";
  }
  if (next === "wait") return "wait";
  if (!videoStyle) {
    // No style at all (the client has no videos to learn from): nothing to make a kit from.
    if (after === "finish") throw new Error("FINAL: The client's video style is missing.");
    await toPostsRoute(admin, job);
    job.step = "references"; return "next";
  }
  // The claim: only when no other job holds a fresh start (decided in the database, so two jobs never both make it).
  const { data: claimed, error: claimError } = await admin.rpc("video_style_claim_kit", { p_client: job.client_id, p_job: job.id, p_stale: `${KIT_MAKE_MS / 1000} seconds` });
  if (claimError) throw new Error(`Could not start the client's kit: ${claimError.message}`);
  if (!claimed) return "wait";
  // A try is a claim that finished no still since the claim before (kitClaim).
  const claim = kitClaim({ tries: s.kit_tries, seen: s.kit_seen }, kitDoneCount(Array.isArray(s.kit_done) ? s.kit_done : []));
  s.kit_tries = claim.tries;
  s.kit_seen = claim.seen;
  job.step = "kit";
  // Saved before any model call, so an error from here on never runs the steps before the kit again.
  await saveJob(admin, job, { step: job.step });
  try {
    return await makeKit(admin, job, videoStyle, job.input?.brand_name ?? client?.name ?? "the brand");
  } catch (e) {
    // A kit never fails its job: the error is kept, the next pass claims again
    // as another try, and spent tries store the kit as [] (the posts route).
    keepKitError(s, e);
    return "wait";
  }
}

/** A kit error kept on the job (the last three). */
function keepKitError(s: any, e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[video-worker] kit:`, msg);
  s.kit_errors = [...(Array.isArray(s.kit_errors) ? s.kit_errors : []), msg.slice(0, 300)].slice(-3);
}

/** The kit's work after a claim: the pick, then the next batch of cleaning, or the kit stored. */
async function makeKit(admin: any, job: VideoJob, videoStyle: any, brand: string): Promise<VideoStepResult> {
  const s = job.state;
  const frames: string[] = Array.isArray(videoStyle.frames) ? videoStyle.frames.filter((f: unknown) => typeof f === "string" && f) : [];
  if (frames.length < KIT_MIN) {
    await storeKit(admin, job.client_id, []);
    job.step = "kit_wait"; return "next";
  }
  const sceneWords: string[] = Array.isArray(videoStyle.profile?.scene_words) ? videoStyle.profile.scene_words : [];
  // The pick is kept on the job, so every later pass cleans the same stills.
  if (!Array.isArray(s.kit_pick)) {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    const content = await jpegBlocks(admin, REFERENCES, frames);
    content.push({ type: "text", text: kitPickPrompt(brand, frames.length, KIT_MAX) });
    const result = await anthropicMessages({ apiKey, body: { model: "claude-opus-5-5", max_tokens: CHECK_TOKENS, messages: [{ role: "user", content }] } });
    s.kit_pick = kitChosen(result.text, frames.length, KIT_MAX).map((i) => frames[i]);
  }
  const picked: string[] = s.kit_pick;
  // Each picked still's outcome: its clean path, or null when it was dropped.
  const done: Array<string | null | undefined> = Array.isArray(s.kit_done) ? s.kit_done : (s.kit_done = []);
  const work = kitWork(picked.length, done, s.kit_tries);
  if (work.kind !== "clean") {
    if (work.kind === "spent") console.warn(`[video-worker] kit ${job.client_id}: ${MAX_KIT_TRIES} tries finished no still; the client's videos take the posts route.`);
    await storeKit(admin, job.client_id, work.kind === "store" ? kitKept(picked.map((_, i) => done[i] ?? null)) : []);
    job.step = "kit_wait"; return "next";
  }
  s.kit_held_at = Date.now();
  return hold(admin, job, async () => {
    try {
      const apiKey = await openaiKey(admin);
      const size: [number, number] = [CARD_SIZE.width, CARD_SIZE.height];
      const prompt = kitCleanPrompt(brand, sceneWords);
      const outcomes = await Promise.allSettled(work.todo.map(async (i) => {
        const path = kitPath(job.client_id, i);
        const { data, error } = await admin.storage.from(REFERENCES).download(picked[i]);
        if (error || !data) throw new Error(`Could not read a still: ${error?.message ?? "missing"}`);
        let still = { bytes: new Uint8Array(await data.arrayBuffer()), name: "still.jpg" };
        let clean: string | null = null;
        for (let n = 1; n <= 2 && !clean; n++) {
          let png: Uint8Array;
          try {
            png = await imageEdit(apiKey, [still], prompt, size);
          } catch (e) {
            if (e instanceof ModelBusy) throw e;
            // The image model would not clean this still: it is dropped.
            console.warn(`[video-worker] kit ${job.client_id} still ${i}:`, e instanceof Error ? e.message : e);
            break;
          }
          const jpeg = await (await Image.decode(png)).encodeJPEG(90);
          const { error: upError } = await admin.storage.from(REFERENCES).upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
          if (upError) throw new Error(`Could not store a kit still: ${upError.message}`);
          const seen = await footageWriting(admin, [path], sceneWords, REFERENCES);
          if (!seen.writing) clean = path;
          else {
            console.warn(`[video-worker] kit ${job.client_id} still ${i}: writing after cleaning ${n} (${seen.where}).`);
            still = { bytes: jpeg, name: "still.jpg" };
          }
        }
        if (!clean) await admin.storage.from(REFERENCES).remove([path]);
        done[i] = clean;
        // Kept on the job at once: a hold that dies loses no still it paid for.
        await saveJob(admin, job, {});
      }));
      const failed = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected").map((o) => o.reason);
      // Any other error is kept and tried again on the next pass, as a try of the kit, never of the job.
      for (const e of failed) if (!(e instanceof ModelBusy)) keepKitError(s, e);
      const busy = failed.find((e) => e instanceof ModelBusy);
      if (busy) throw busy;
      // The next pass claims again and goes on with the stills still to clean, or stores the kit.
    } finally {
      delete s.kit_held_at;
    }
  });
}

/** The job's state (and any other fields given) saved to its row while it is active. */
async function saveJob(admin: any, job: VideoJob, fields: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("canva_finish_jobs").update({ ...fields, state: job.state, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
  if (error) throw new Error(`Could not save the video's progress: ${error.message}`);
}

/** A video job moved to the posts route: its input is saved on its row, since the worker saves only step and state. */
async function toPostsRoute(admin: any, job: VideoJob): Promise<void> {
  job.input = postsRouteInput(job.input);
  const { error } = await admin.from("canva_finish_jobs").update({ input: job.input }).eq("id", job.id).in("status", ACTIVE);
  if (error) throw new Error(`Could not move the video to the posts route: ${error.message}`);
}

/** Keys merged into the client's video style in one statement (video_style_merge); a null key is taken as missing. */
async function mergeVideoStyle(admin: any, clientId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await admin.rpc("video_style_merge", { p_client: clientId, p_patch: patch });
  if (error) throw new Error(`Could not keep the client's video style: ${error.message}`);
}

/** The kit on the client's video style, with its time; the claim is cleared. */
async function storeKit(admin: any, clientId: string, kit: string[]): Promise<void> {
  await mergeVideoStyle(admin, clientId, { kit, kit_at: new Date().toISOString(), kit_started_at: null, kit_job: null });
}

/** Video posts that waited for the client's video style are planned. */
async function planWaitingVideos(admin: any, clientId: string): Promise<void> {
  const { data: waiting } = await admin.from("design_requests").select("id, briefs")
    .eq("client_id", clientId).eq("kind", "video").eq("status", "preparing").eq("stage", "planning");
  for (const w of waiting ?? []) {
    if (Array.isArray(w.briefs) && w.briefs.length) continue;
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/design-request`, {
      method: "POST",
      // The system's own call: it never acts as a person, and the request
      // it plans already names the person who asked.
      headers: { "Content-Type": "application/json", "X-Socialytics-Secret": Deno.env.get("SOCIALYTICS_N8N_SECRET") ?? "" },
      body: JSON.stringify({ action: "replan", request_id: w.id }),
      signal: AbortSignal.timeout(15_000),
    }).then(async (r) => {
      const text = await r.text();
      if (!r.ok) throw new Error(`replan answered ${r.status}: ${text.slice(0, 200)}`);
    }).catch((e) => console.error(`[video-worker] could not plan ${w.id}:`, e instanceof Error ? e.message : e));
  }
}

/**
 * A client's video style, read once from stills of its own published videos
 * (14 Oct: videos follow the client's VIDEOS, not its statics):
 *   style_cut   STYLE_FRAMES stills from each video, taken in the sandbox;
 *   style_wait  until they are stored;
 *   style_read  the vision model describes the style; it is kept on the client
 *               (clients.video_style) with the stills; the kit is made next
 *               (runKitStep), and then the video posts waiting for the style
 *               are planned.
 */
async function runStyleStep(admin: any, job: VideoJob): Promise<VideoStepResult> {
  const s = job.state ?? (job.state = {});
  const recently = (at: unknown) => typeof at === "number" && Date.now() - at < VIDEO_POLL_MS;
  if (job.step === "kit" || job.step === "kit_wait") return runKitStep(admin, job, "finish");
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
      const content: unknown[] = await jpegBlocks(admin, REFERENCES, s.frames as string[]);
      content.push({ type: "text", text: videoStylePrompt(client?.name ?? "the brand", videos.length, STYLE_FRAMES) });
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
      const result = await anthropicMessages({ apiKey, body: { model: "claude-opus-5-5", max_tokens: 4000, messages: [{ role: "user", content }] } });
      const style = parseVideoStyle(result.text);
      if (!style) throw new Error(`The client's videos could not be read: ${result.text.slice(0, 200)}`);
      // A style learned again gets a new kit, made next from these stills.
      await mergeVideoStyle(admin, job.client_id, { profile: style, frames: s.frames, videos: videos.length, frames_per_video: STYLE_FRAMES, made_at: new Date().toISOString(), kit: null, kit_at: null });
      s.style = style;
      // The client's kit is made next, from these stills.
      job.step = "kit"; return "next";
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

/**
 * The caption font's TrueType file in the app's storage, fetched from Google
 * Fonts the first time a family and weight is used. The video sandbox reaches
 * only the app's storage, so it cannot fetch fonts itself. Falls back to
 * Montserrat when the family is not on Google Fonts.
 */
async function captionFontUrl(admin: any, family: string, weight: number): Promise<string> {
  for (const name of [family, "Montserrat"]) {
    const path = `fonts/${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${weight}.ttf`;
    if (await stored(admin, REFERENCES, path)) return publicUrl(admin, REFERENCES, path);
    // An old browser's user agent gets TrueType files, which the caption renderer needs.
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@${weight}`, { headers: { "User-Agent": "Mozilla/4.0" }, signal: AbortSignal.timeout(15_000) });
    if (!css.ok) continue;
    const url = /url\((https:[^)]+)\)/.exec(await css.text())?.[1];
    if (!url) continue;
    const file = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!file.ok) continue;
    const { error } = await admin.storage.from(REFERENCES).upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: "font/ttf", upsert: true });
    if (error) throw new Error(`Could not keep the caption font: ${error.message}`);
    return publicUrl(admin, REFERENCES, path);
  }
  throw new Error("FINAL: The caption font could not be found.");
}

/** The clip's speech, word by word with timings (OpenAI transcription). An empty list when nothing is said. */
async function transcribeWords(apiKey: string, audio: Blob): Promise<{ words: Array<{ word: string; start: number; end: number }>; sentenceStarts: number[] }> {
  const form = new FormData();
  form.append("file", new File([audio], "speech.mp3", { type: "audio/mpeg" }));
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(120_000) });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Transcription ${resp.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  const words = Array.isArray(body?.words)
    ? body.words.map((w: { word?: unknown; start?: unknown; end?: unknown }) => ({ word: String(w.word ?? "").trim(), start: Number(w.start) || 0, end: Number(w.end) || 0 })).filter((w: { word: string }) => w.word)
    : [];
  // Where each sentence of the transcript starts: a segment whose text follows a full stop, question or exclamation.
  const segments: Array<{ start?: unknown; text?: unknown }> = Array.isArray(body?.segments) ? body.segments : [];
  const sentenceStarts: number[] = [];
  segments.forEach((seg, i) => { if (i > 0 && /[.!?]["']?\s*$/.test(String(segments[i - 1].text ?? ""))) sentenceStarts.push(Number(seg.start) || 0); });
  // Inside a segment, a full stop in its text also starts a sentence: placed at the word that follows it.
  return { words, sentenceStarts: [...sentenceStarts, ...sentenceBreaksInside(segments, words)] };
}

/** Sentence starts inside transcript segments, found by matching each segment's punctuated text to its timed words. */
function sentenceBreaksInside(segments: Array<{ start?: unknown; end?: unknown; text?: unknown }>, words: Array<{ word: string; start: number; end: number }>): number[] {
  const out: number[] = [];
  for (const seg of segments) {
    const start = Number(seg.start) || 0, end = Number(seg.end) || 0;
    const inSeg = words.filter((w) => w.start >= start - 0.05 && w.start < end);
    const tokens = String(seg.text ?? "").trim().split(/\s+/).filter(Boolean);
    if (tokens.length !== inSeg.length) continue;
    tokens.forEach((t, i) => { if (i + 1 < inSeg.length && /[.!?]["']?$/.test(t)) out.push(inSeg[i + 1].start); });
  }
  return out;
}
