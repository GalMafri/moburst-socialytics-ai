// supabase/functions/_shared/video/steps.ts
//
// A video job's steps, run by the video worker (video-worker). A generated
// video is made in this order, and orders one paid clip at most:
//   kit          the client's kit (runKitStep, kit.ts), made first by a job
//                that finds none; a client with too few clean stills takes
//                the posts route instead;
//   title        the image model draws the title on a transparent layer in
//                the type of the client's posts (skipped when the video
//                carries no text over its footage);
//   title_check  the title's words are read back and must be the copy's exactly;
//   frame        the image model draws the clip's opening frame from the
//                brief, with the kit's stills as its references (on the posts
//                route, from the brief alone), at most MAX_FRAMES times;
//   frame_check  the frame must show no writing (other than the client's own
//                scene words) and no other brand's marks, or it is drawn again;
//   clip         at the price approved for the video, the one clip is
//                ordered from Higgsfield (clipStep.ts): its order is
//                recorded on the job, once and under a renewed lease, before
//                the call, so it is never made twice;
//   clip_wait    the clip is stored once it is ready; one that failed or
//                never came back (CLIP_LOST_MS) ends the video with a reason,
//                and nothing else here uses one of the job's tries;
//   assemble     join clip, title and the client's logo file in a hosted
//                sandbox (sandbox.ts), keeping the clip's sound, and keep
//                four stills of the clip alone;
//   assemble_wait  store the finished MP4. A clip with no sound, or with
//                writing of its own in its stills, ends the video with a
//                reason: nothing orders a second clip.
// A filmed clip (input.footage_upload) is the footage: transcribe,
// transcribe_wait, title, title_check, assemble, assemble_wait.
// The clip's order, with the credits it cost, is kept in its own column
// (canva_finish_jobs.clip_order, credits.ts), never in state, so staff see
// what a week of designs used and no save of state can erase it.

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { MCP_URL, accessTokenFor } from "../higgsfield/oauth.ts";
import { McpClient } from "../higgsfield/mcp.ts";
import { awaitJobs, creditBalance, importReferences, submitVideo } from "../higgsfield/generate.ts";
import { CLIP_LOST_MS, type ClipOrder, OLD_STEPS, REASONS, clipOrderOf, clipOutcome, footageRules, framePrompt, quoteClip } from "./clip.ts";
import { runClip } from "./clipStep.ts";
import { BUCKET } from "../canva/jobs.ts";
import { canvasLogoRect } from "../canva/brief.ts";
import { anthropicMessages } from "../anthropic.ts";
import { openaiKey } from "../openai/key.ts";
import { ModelBusy, OPENAI_IMAGE_MODEL, imageEdit } from "../media/imageEdit.ts";
import { KIT_MAKE_MS, KIT_MAX, KIT_MIN, MAX_KIT_TRIES, parseKitPick, kitCleanPrompt, kitNext, kitPath, kitPaths, kitPickPrompt, type KitDone, kitClaim, kitDoneCount, kitDoneOf, kitForStyle, kitKeptFrom, kitState, kitWork, postsRouteInput } from "./kit.ts";
import { copyMatches, marksPrompt, parseMarks, parseRead, readPrompt } from "../design/pipeline.ts";
import { parseVideoStyle, videoStylePrompt } from "../canva/options.ts";
import { CARD_SIZE, FOOTAGE_STILLS, STYLE_FRAMES, VIDEO_SIZE, audioScript, captionWeight, captionsAss, framesScript, hookPlacement, parseAudio, videoLogoBox, parseFrames, composeScript, footageTextPrompt, parseComposed, parseFootageText } from "./compose.ts";
import { hookPrompt } from "./hook.ts";
import { checkScript, endScript, startScript } from "./sandbox.ts";

/** Room for each check's answer (the model may think first, and that counts against it). */
const CHECK_TOKENS = 2000;
/** How often a running clip or join is asked about. */
export const VIDEO_POLL_MS = 30_000;
const MAX_HOOKS = 3;
/** Opening frames drawn for one video before it ends with REASONS.frame. */
const MAX_FRAMES = 3;
const MAX_COMPOSE = 3;
const MAX_CLIPS = 3;
/** Where filmed clips are kept, privately. */
const FOOTAGE_BUCKET = "post-footage";
const REFERENCES = "design-references";
/** clip_order: the job's one paid clip, from its own column (clip.ts ClipOrder); never saved with state, written only by clipStep.ts's fenced statements. */
export type VideoJob = { id: string; client_id: string; step: string; state: any; input: any; design_request_id: string | null; option_index: number | null; clip_order?: ClipOrder | null };
/** next: run the following step now; wait: ask again on a later pass; done: the MP4 is stored (state.final_path); held: work goes on in the background under its own lease (hold). */
export type VideoStepResult = "next" | "wait" | "done" | "held";

/** A job is only ever moved on while it is active: a job stopped meanwhile stays stopped. */
const ACTIVE = ["queued", "running"];
/** Tries of one step before its job fails. */
export const MAX_VIDEO_ATTEMPTS = 4;
/** A job is held this long while a pass works on it (video-worker), and again right before its clip is ordered. */
export const VIDEO_JOB_LEASE_MS = 120_000;
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
  // A job from before the one-clip video is not carried on with steps that are gone.
  if ((OLD_STEPS as readonly string[]).includes(job.step)) throw new Error(`FINAL: ${REASONS.outdated}`);
  // A generated video is made with the client's kit: a job that starts before
  // the kit is ready makes it (or waits for it) first. Looked at once per job.
  if (job.step === "title" && !s.kit_checked && !input.footage_upload && input.video_route !== "posts") {
    const { data: client } = await admin.from("clients").select("video_style").eq("id", job.client_id).maybeSingle();
    s.kit_checked = true;
    if (kitState(client?.video_style) !== "ready") job.step = "kit";
  }
  if (job.step === "kit" || job.step === "kit_wait") return runKitStep(admin, job, "video");
  const base = `${job.client_id}/canva-finish/${job.id}`;
  const recently = (at: unknown) => typeof at === "number" && Date.now() - at < VIDEO_POLL_MS;
  // After the title: a generated video's opening frame, a filmed clip's assembly.
  const afterTitle = input.footage_upload ? "assemble" : "frame";
  switch (job.step) {
    case "transcribe": {
      // A filmed clip is captioned the way the client's filmed videos are: its speech is transcribed first.
      if (!input.footage_upload || !input.filmed || input.filmed.captions === "none") {
        job.step = input.filmed && input.filmed.title === "none" ? "assemble" : "title"; return "next";
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
      job.step = input.filmed.title === "none" ? "assemble" : "title"; return "next";
    }
    case "title": {
      // A client whose videos carry no text over the footage gets no title; a title already checked is kept.
      if (!input.copy?.length || s.title_ok) { job.step = afterTitle; return "next"; }
      s.hooks = (s.hooks ?? 0) + 1;
      if (s.hooks > MAX_HOOKS) throw new Error("FINAL: The video's title could not be drawn with the exact words.");
      let png: Uint8Array;
      try {
        png = await generateImage(await openaiKey(admin), hookPrompt(input.brand_name, input.copy, input.text_style), [CARD_SIZE.width, CARD_SIZE.height], true);
      } catch (e) {
        if (e instanceof ModelBusy) { s.hooks -= 1; return "wait"; }
        throw e;
      }
      const path = `${base}/hook-${s.hooks}.png`;
      const { error } = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`Could not store the title: ${error.message}`);
      s.hook_path = path;
      job.step = "title_check"; return "next";
    }
    case "title_check": {
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
      const result = await anthropicMessages({
        apiKey: anthropicKey(),
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
        job.step = "title"; return "next";
      }
      s.title_ok = true;
      job.step = afterTitle; return "next";
    }
    case "frame": {
      // The kit's stills, unless the video takes the posts route; a kit learned again since the check is made first.
      let stills: string[] = [];
      if (input.video_route !== "posts") {
        const { data: client } = await admin.from("clients").select("video_style").eq("id", job.client_id).maybeSingle();
        if (kitState(client?.video_style) !== "ready") { delete s.kit_checked; job.step = "kit"; return "next"; }
        stills = kitPaths(client.video_style);
      }
      s.frames = (s.frames ?? 0) + 1;
      if (s.frames > MAX_FRAMES) throw new Error(`FINAL: ${REASONS.frame}`);
      const n = s.frames;
      const prompt = framePrompt(input.video.prompt, footageRules(input.people, input.scene_words ?? []));
      const size: [number, number] = [CARD_SIZE.width, CARD_SIZE.height];
      return hold(admin, job, async () => {
        try {
          const apiKey = await openaiKey(admin);
          const images = [];
          for (const p of stills) {
            const { data, error } = await admin.storage.from(REFERENCES).download(p);
            if (error || !data) throw new Error(`Could not read a kit still: ${error?.message ?? "missing"}`);
            images.push({ bytes: new Uint8Array(await data.arrayBuffer()), name: "still.jpg" });
          }
          const png = images.length ? await imageEdit(apiKey, images, prompt, size) : await generateImage(apiKey, prompt, size, false);
          // Kept as a JPEG, as the kit's stills are: the checks read it and the video service starts from it.
          const jpeg = await (await Image.decode(png)).encodeJPEG(92);
          const path = `${base}/frame-${n}.jpg`;
          const { error } = await admin.storage.from(BUCKET).upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
          if (error) throw new Error(`Could not store the opening frame: ${error.message}`);
          s.frame_path = path;
          job.step = "frame_check";
        } catch (e) {
          // The image model at its rate limit uses no frame.
          if (e instanceof ModelBusy) s.frames = n - 1;
          throw e;
        }
      });
    }
    case "frame_check": {
      if (!s.frame_path) { job.step = "frame"; return "next"; }
      const scene: string[] = input.scene_words ?? [];
      const seen = await footageWriting(admin, [s.frame_path], scene, BUCKET);
      const content = await jpegBlocks(admin, BUCKET, [s.frame_path]);
      content.push({ type: "text", text: marksPrompt(input.brand_name) });
      const result = await anthropicMessages({ apiKey: anthropicKey(), body: { model: "claude-opus-5-5", max_tokens: CHECK_TOKENS, messages: [{ role: "user", content }] } });
      const marks = parseMarks(result.text);
      if (!marks) throw new Error(`The opening frame could not be read for other brands' marks: ${result.text.slice(0, 200)}`);
      s.frame_check = { writing: seen, marks };
      if (seen.writing || marks.marks) {
        console.warn(`[video-worker] job ${job.id}: the opening frame has ${seen.writing ? `writing (${seen.where})` : `other brands' marks (${marks.where})`}; drawing it again.`);
        delete s.frame_path;
        job.step = "frame"; return "next";
      }
      job.step = "clip"; return "next";
    }
    case "clip": {
      // Higgsfield is reached only when the step prices, imports or orders: an
      // order already recorded moves on (or waits) without it.
      let mcp: McpClient | null = null;
      const hf = async () => mcp ??= await higgsfield(admin);
      return runClip({
        readOrder: async (id) => {
          const { data, error } = await admin.from("canva_finish_jobs").select("clip_order").eq("id", id).maybeSingle();
          if (error) throw new Error(`Could not read the clip's order: ${error.message}`);
          return clipOrderOf(data?.clip_order);
        },
        quote: async () => quoteClip(await hf()),
        balance: async () => (await creditBalance(await hf()))?.credits ?? null,
        importImages: async (want) => {
          const out: { frame?: string | null; kit?: string[] } = {};
          if (want.frame) out.frame = (await importReferences(await hf(), [publicUrl(admin, BUCKET, s.frame_path)], "image"))[0] ?? null;
          if (want.kit) {
            const { data: client } = input.video_route === "posts" ? { data: null } : await admin.from("clients").select("video_style").eq("id", job.client_id).maybeSingle();
            const kit = kitPaths(client?.video_style);
            out.kit = kit.length ? await importReferences(await hf(), kit.map((p) => publicUrl(admin, REFERENCES, p)), "image") : [];
          }
          return out;
        },
        submit: async (req) => (await submitVideo(await hf(), req))[0],
        saveOrder: async (order) => {
          const { data, error } = await admin.rpc("video_clip_order", { p_job: job.id, p_order: order });
          if (error) throw new Error(`Could not save the clip's order: ${error.message}`);
          return data === true;
        },
        saveOrdered: async (jobId, credits) => {
          const { data, error } = await admin.rpc("video_clip_ordered", { p_job: job.id, p_job_id: jobId, p_credits: credits });
          if (error) throw new Error(`Could not record the clip's job: ${error.message}`);
          return data === true;
        },
        stopJob: async (reason) => {
          const { data, error } = await admin.rpc("video_clip_stop", { p_job: job.id, p_reason: reason });
          if (error) throw new Error(`Could not stop the video: ${error.message}`);
          return data === true;
        },
        saveJob: () => saveJob(admin, job, { step: job.step }),
        renewLease: async () => {
          const { error } = await admin.from("canva_finish_jobs").update({ lease_until: new Date(Date.now() + VIDEO_JOB_LEASE_MS).toISOString() }).eq("id", job.id).in("status", ACTIVE);
          if (error) throw new Error(`Could not hold the video for its order: ${error.message}`);
        },
        now: () => Date.now(),
        pollMs: VIDEO_POLL_MS,
      }, job);
    }
    case "clip_wait": {
      // The clip is paid for: nothing here spends one of the job's tries.
      // Only the clip's own end, or CLIP_LOST_MS, ends the video.
      const order = clipOrderOf(job.clip_order);
      // No job id yet: the clip step decides (it waits out the order's grace, or ends the video).
      if (!order?.job_id) { job.step = "clip"; return "wait"; }
      const orderedAt = Date.parse(order.at);
      const since = Number.isFinite(orderedAt) ? orderedAt : Date.now();
      if (recently(s.clip_checked_at)) return "wait";
      s.clip_checked_at = Date.now();
      try {
        const res = await awaitJobs(await higgsfield(admin), [{ index: 0, job_id: order.job_id }], { budgetMs: 0 });
        const o = res.outcomes[0];
        const outcome = clipOutcome(o, since, Date.now());
        if (outcome === "running") return "wait";
        if (outcome === "failed") {
          console.error(`[video-worker] job ${job.id} clip ${o?.status}: ${o?.error ?? ""}`);
          throw new Error(`FINAL: ${REASONS.provider}`);
        }
        if (outcome === "lost") throw new Error(`FINAL: ${REASONS.lost}`);
        const resp = await fetch(o.result_url!, { signal: AbortSignal.timeout(90_000) });
        if (!resp.ok) throw new Error(`Could not fetch the clip: ${resp.status}`);
        const path = `${base}/clip.mp4`;
        const { error } = await admin.storage.from(BUCKET).upload(path, new Uint8Array(await resp.arrayBuffer()), { contentType: "video/mp4", upsert: true });
        if (error) throw new Error(`Could not store the clip: ${error.message}`);
        s.footage_path = path;
        delete s.clip_wait_error;
        job.step = "assemble"; return "next";
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("FINAL:")) throw e;
        console.error(`[video-worker] job ${job.id} clip_wait:`, msg);
        s.clip_wait_error = msg.slice(0, 300);
        // A poll or a store that keeps failing still ends the video once the clip is lost.
        if (Date.now() - since > CLIP_LOST_MS) throw new Error(`FINAL: ${REASONS.lost}`);
        // Asked again on a later pass, until the clip ends or is lost.
        return "wait";
      }
    }
    case "assemble": {
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
      // A filmed clip is used as it is: it is not read for writing.
      for (let i = 0; i < (input.footage_upload ? 0 : FOOTAGE_STILLS); i++) {
        const path = `${base}/still-${i}.jpg`;
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
          captions: filmed && filmed.captions !== "none" && Array.isArray(s.words) && s.words.length
            ? { assB64: base64Encode(new TextEncoder().encode(captionsAss(s.words, filmed, s.sentence_starts ?? [])) as unknown as ArrayBuffer), fontUrl: await captionFontUrl(admin, filmed.caption_font, captionWeight(filmed.caption_style)) }
            : undefined,
          endCard: filmed && input.end_card?.url ? { url: input.end_card.url, seconds: input.end_card.seconds } : undefined,
        }),
        `Socialytics video ${job.id}`,
      );
      s.compose_checked_at = Date.now();
      s.video_path = out;
      job.step = "assemble_wait"; return "next";
    }
    case "assemble_wait": {
      if (recently(s.compose_checked_at)) return "wait";
      s.compose_checked_at = Date.now();
      const r = await checkScript(s.compose_session);
      if (r.state === "running") return "wait";
      await endScript(s.compose_session);
      const made = r.state === "finished" ? parseComposed(r.reply) : null;
      if (!made) {
        const why = r.state === "failed" ? r.reason : r.reply.slice(0, 300);
        console.error(`[video-worker] job ${job.id} assemble:`, why);
        // Kept with the job: a join that never came back left no reason on 14 Oct.
        s.compose_errors = [...(Array.isArray(s.compose_errors) ? s.compose_errors : []), String(why ?? "").slice(0, 300)].slice(-3);
        job.step = "assemble"; return "next";
      }
      if (input.footage_upload) {
        s.video_seconds = made.seconds;
        s.final_path = s.video_path;
        job.step = "finished"; return "done";
      }
      // A video post is never silent, and its clip is ordered once: a silent clip ends the video.
      if (made.audio < 1) throw new Error(`FINAL: ${REASONS.silent}`);
      // The clip carries no writing of its own: the only words are the title's.
      const seen = await footageWriting(admin, s.still_paths ?? [], input.scene_words ?? []);
      s.footage_writing = seen;
      if (seen.writing) {
        console.warn(`[video-worker] job ${job.id}: the clip has writing (${seen.where}).`);
        throw new Error(`FINAL: ${REASONS.writing}`);
      }
      s.video_seconds = made.seconds;
      s.final_path = s.video_path;
      job.step = "finished"; return "done";
    }
  }
  throw new Error(`FINAL: Unknown video step '${job.step}'`);
}

function anthropicKey(): string {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  return apiKey;
}

/** One picture drawn by the image model from a prompt alone, at exactly the size asked for; transparent for a title layer. */
async function generateImage(apiKey: string, prompt: string, size: [number, number], transparent: boolean): Promise<Uint8Array> {
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL, prompt, size: `${size[0]}x${size[1]}`, quality: "high", output_format: "png", n: 1,
      ...(transparent ? { background: "transparent" } : {}),
    }),
    signal: AbortSignal.timeout(transparent ? 120_000 : 360_000),
  });
  const text = await resp.text();
  if (resp.status === 429 || resp.status >= 500) throw new ModelBusy(`Image model ${resp.status}: ${text.slice(0, 200)}`);
  if (!resp.ok) throw new Error(`Image model ${resp.status}: ${text.slice(0, 300)}`);
  const b64 = JSON.parse(text)?.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image model returned no image.");
  return base64Decode(b64);
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
 *             vision model pick up to KIT_MAX of the style's stills (none with
 *             a person's face; [] when none qualifies; an answer that cannot
 *             be read is a claim with no progress), then clean up to KIT_BATCH
 *             of them per pass with the image model in the background (hold),
 *             of all lettering: a still whose writing shows again is cleaned
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
    job.step = "title"; return "next";
  }
  if (next === "wait") return "wait";
  if (!videoStyle) {
    // No style at all (the client has no videos to learn from): nothing to make a kit from.
    if (after === "finish") throw new Error("FINAL: The client's video style is missing.");
    await toPostsRoute(admin, job);
    job.step = "title"; return "next";
  }
  // The claim: only when no other job holds a fresh start (decided in the database, so two jobs never both make it).
  const { data: claimed, error: claimError } = await admin.rpc("video_style_claim_kit", { p_client: job.client_id, p_job: job.id, p_stale: `${KIT_MAKE_MS / 1000} seconds` });
  if (claimError) throw new Error(`Could not start the client's kit: ${claimError.message}`);
  if (!claimed) return "wait";
  // A kit in progress belongs to the style it was picked from; one learned again since starts the pick over.
  job.state = kitForStyle(s, videoStyle.made_at);
  const st = job.state;
  // A try is a claim that finished no still since the claim before (kitClaim).
  const claim = kitClaim({ tries: st.kit_tries, seen: st.kit_seen }, kitDoneCount(kitDoneOf(st.kit_done)));
  st.kit_tries = claim.tries;
  st.kit_seen = claim.seen;
  job.step = "kit";
  // Saved before any model call, so an error from here on never runs the steps before the kit again.
  await saveJob(admin, job, { step: job.step });
  try {
    return await makeKit(admin, job, videoStyle, job.input?.brand_name ?? client?.name ?? "the brand");
  } catch (e) {
    // A kit never fails its job: the error is kept, the next pass claims again
    // as another try, and spent tries store the kit as [] (the posts route).
    keepKitError(job.state, e);
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
  // Each picked still's outcome by its index; a still not in it is pending.
  const done: KitDone = s.kit_done = kitDoneOf(s.kit_done);
  // Decided on every claim, before the pick too: claims that never reach their pick also spend tries.
  let work = kitWork(Array.isArray(s.kit_pick) ? s.kit_pick.length : null, done, s.kit_tries);
  if (work.kind === "pick") {
    // The pick is kept on the job, so every later pass cleans the same stills.
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
    const content = await jpegBlocks(admin, REFERENCES, frames);
    content.push({ type: "text", text: kitPickPrompt(brand, frames.length, KIT_MAX) });
    const result = await anthropicMessages({ apiKey, body: { model: "claude-opus-5-5", max_tokens: CHECK_TOKENS, messages: [{ role: "user", content }] } });
    const pick = parseKitPick(result.text, frames.length, KIT_MAX);
    // An answer that cannot be read is a claim with no progress: the next pass asks again, as a try of the kit.
    if (pick === null) { keepKitError(s, "The kit's pick could not be read."); return "wait"; }
    // [] is an answer too: no still qualifies, and the kit is stored as none (the posts route).
    s.kit_pick = pick.map((i) => frames[i]);
    work = kitWork(s.kit_pick.length, done, s.kit_tries);
  }
  const picked: string[] = Array.isArray(s.kit_pick) ? s.kit_pick : [];
  if (work.kind !== "clean") {
    if (work.kind === "spent") console.warn(`[video-worker] kit ${job.client_id}: ${MAX_KIT_TRIES} tries finished no still; the client's videos take the posts route.`);
    await storeKit(admin, job.client_id, work.kind === "store" ? kitKeptFrom(picked.length, done) : []);
    job.step = "kit_wait"; return "next";
  }
  const todo = work.todo;
  s.kit_held_at = Date.now();
  return hold(admin, job, async () => {
    // One save at a time, in order, so an older snapshot of the state never lands after a newer one.
    let saves: Promise<void> = Promise.resolve();
    const save = () => (saves = saves.then(() => saveJob(admin, job, {})).catch((e) => keepKitError(s, e)));
    try {
      // Inside the kit's own handling: a missing key is a claim with no progress, never a failed job.
      const apiKey = await openaiKey(admin);
      const size: [number, number] = [CARD_SIZE.width, CARD_SIZE.height];
      const prompt = kitCleanPrompt(brand);
      const outcomes = await Promise.allSettled(todo.map(async (i) => {
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
          // A look reference: any writing left, the client's scene words included, is writing.
          const seen = await footageWriting(admin, [path], [], REFERENCES);
          if (!seen.writing) clean = path;
          else {
            console.warn(`[video-worker] kit ${job.client_id} still ${i}: writing after cleaning ${n} (${seen.where}).`);
            still = { bytes: jpeg, name: "still.jpg" };
          }
        }
        if (!clean) await admin.storage.from(REFERENCES).remove([path]);
        done[String(i)] = clean ? { path: clean } : { dropped: true };
        // Kept on the job at once: a hold that dies loses no still it paid for.
        await save();
      }));
      const failed = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected").map((o) => o.reason);
      // Any other error is kept and tried again on the next pass, as a try of the kit, never of the job.
      for (const e of failed) if (!(e instanceof ModelBusy)) keepKitError(s, e);
      const busy = failed.find((e) => e instanceof ModelBusy);
      if (busy) throw busy;
      // The next pass claims again and goes on with the stills still to clean, or stores the kit.
    } catch (e) {
      if (e instanceof ModelBusy) throw e;
      keepKitError(s, e);
    } finally {
      await saves;
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
      await mergeVideoStyle(admin, job.client_id, { profile: style, frames: s.frames, videos: videos.length, frames_per_video: STYLE_FRAMES, made_at: new Date().toISOString(), kit: null, kit_at: null, kit_started_at: null, kit_job: null });
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
