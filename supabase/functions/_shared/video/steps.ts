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
//   frame_check  the frame must show no writing a viewer could make out
//                (compose.ts, writingCounts) and no other brand's marks, or
//                it is drawn again;
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

import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { MCP_URL, accessTokenFor } from "../higgsfield/oauth.ts";
import { McpClient } from "../higgsfield/mcp.ts";
import { awaitJobs, creditBalance, importReferences, submitVideo } from "../higgsfield/generate.ts";
import { CLIP_LOST_MS, type ClipOrder, OLD_STEPS, REASONS, clipOrderOf, clipOutcome, footageRules, framePrompt, quoteClip } from "./clip.ts";
import { runClip } from "./clipStep.ts";
import { BUCKET, renewJobLease, saveJobProgress } from "../canva/jobs.ts";
import { canvasLogoRect } from "../canva/brief.ts";
import { anthropicMessages } from "../anthropic.ts";
import { answerText, replySample, roomFor } from "../anthropicReply.ts";
import { openaiKey } from "../openai/key.ts";
import { ModelBusy, OPENAI_IMAGE_MODEL, imageEdit } from "../media/imageEdit.ts";
import { KIT_MAKE_MS, KIT_MAX, KIT_MIN, MAX_KIT_TRIES, parseKitPick, kitCleanPrompt, kitStillCheckPrompt, parseKitStillCheck, kitNext, kitPaths, kitPickPrompt, type KitDone, kitClaimed, kitDoneOf, kitHolderOf, kitKeptFrom, kitState, kitTakenOver, kitWork, postsRouteInput } from "./kit.ts";
import { cleanKitStills, keepKitError } from "./kitStep.ts";
import { marksPrompt, parseMarks, parseRead, readPrompt } from "../design/pipeline.ts";
import { parseVideoStyle, videoStylePrompt } from "../canva/options.ts";
import { FOOTAGE_STILLS, STYLE_FRAMES, audioScript, captionWeight, captionsAss, framesScript, hookPlacement, parseAudio, videoLogoBox, parseFrames, composeScript, footageTextPrompt, parseComposed, parseFootageText } from "./compose.ts";
import { hookPrompt } from "./hook.ts";
import { callPicture, notePicture, signedRead, signedWrite } from "../picture/client.ts";
import { heldWork } from "../canva/hold.ts";
import { VIDEO_LIMITS } from "./advance.ts";
import { type TitleDeps, runTitle, runTitleCheck } from "./titleStep.ts";
import { runFrame } from "./frame.ts";
import { FRAME_JPEG_QUALITY, KIT_JPEG_QUALITY } from "../picture/contract.ts";
import { checkScript, endScript, startScript } from "./sandbox.ts";
import { isVertical, jobVideoFrame } from "./videoSize.ts";
import { pagePlacement } from "../design/platformSize.ts";
import { type GroundDeps, type VideoLogoPick, centeredIn, pickVideoLogo } from "./logoGround.ts";
import { pngSize } from "../picture/headers.ts";
import type { Rgb } from "../picture/contract.ts";

/** Each check's answer, and room for the model to think first, which counts against the limit (anthropicReply.ts, roomFor). */
const CHECK_TOKENS = roomFor(2000);
/** How often a running clip or join is asked about. */
export const VIDEO_POLL_MS = 30_000;
const MAX_COMPOSE = 3;
const MAX_CLIPS = 3;
/** Where filmed clips are kept, privately. */
const FOOTAGE_BUCKET = "post-footage";
const REFERENCES = "design-references";
/** clip_order: the job's one paid clip, from its own column (clip.ts ClipOrder); never saved with state, written only by clipStep.ts's fenced statements. */
export type VideoJob = { id: string; client_id: string; step: string; state: any; input: any; design_request_id: string | null; option_index: number | null; created_at?: string; clip_order?: ClipOrder | null };
/** next: run the following step now; wait: ask again on a later pass; done: the MP4 is stored (state.final_path); held: work goes on in the background under its own lease (hold). */
export type VideoStepResult = "next" | "wait" | "done" | "held";

/** A job is only ever moved on while it is active: a job stopped meanwhile stays stopped. */
const ACTIVE = ["queued", "running"];
/** A job is held this long while a pass works on it (video-worker), and again right before its clip is ordered. */
export const VIDEO_JOB_LEASE_MS = 120_000;
/** A job held for model work keeps its lease this long (as the design worker's). */
const MODEL_LEASE_MS = 420_000;

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

/**
 * Model work that runs past the worker's pass (canva/hold.ts, the design
 * worker's too): the job is held under a longer lease with its step and
 * state saved, and moves on when the work ends. The image model at its rate
 * limit, or the picture service unavailable, is waited out without using a
 * try (canva/stepError.ts).
 */
function hold(admin: any, job: VideoJob, work: () => Promise<void>): VideoStepResult {
  const run = heldWork(admin, job, work, { ...VIDEO_LIMITS, leaseMs: MODEL_LEASE_MS });
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
    case "title": return runTitle(titleDeps(admin, job), job, afterTitle);
    case "title_check": return runTitleCheck(titleDeps(admin, job), job, afterTitle);
    case "frame": {
      // The kit's stills, unless the video takes the posts route; a kit learned again since the check is made first.
      let stills: string[] = [];
      if (input.video_route !== "posts") {
        const { data: client } = await admin.from("clients").select("video_style").eq("id", job.client_id).maybeSingle();
        // A frame kept from before the kit was learned again is drawn again from the new kit.
        if (kitState(client?.video_style) !== "ready") { delete s.kit_checked; delete s.frame_png; job.step = "kit"; return "next"; }
        stills = kitPaths(client.video_style);
      }
      // Drawn, or taken up again from the PNG already paid for, and made a JPEG (frame.ts), in the
      // video's own frame (videoSize.ts): the clip starts from it, so it has the clip's shape.
      const frame = jobVideoFrame(input);
      const prompt = framePrompt(input.video.prompt, footageRules(input.people, frame), frame);
      const size: [number, number] = [frame.card.width, frame.card.height];
      return runFrame({
        draw: async () => {
          const apiKey = await openaiKey(admin);
          const images = [];
          for (const p of stills) {
            const { data, error } = await admin.storage.from(REFERENCES).download(p);
            if (error || !data) throw new Error(`Could not read a kit still: ${error?.message ?? "missing"}`);
            images.push({ bytes: new Uint8Array(await data.arrayBuffer()), name: "still.jpg" });
          }
          return images.length ? imageEdit(apiKey, images, prompt, size) : generateImage(apiKey, prompt, size, false);
        },
        store: async (path, png) => {
          const { error } = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
          if (error) throw new Error(`Could not store the opening frame: ${error.message}`);
        },
        transcode: async (pngPath, jpegPath) => (await callPicture(admin, "transcode", {
          job: job.id,
          step: "frame",
          picture: await signedRead(admin, BUCKET, pngPath),
          quality: FRAME_JPEG_QUALITY,
          out: await signedWrite(admin, BUCKET, jpegPath),
        })).ms,
        save: () => saveJobProgress(admin, job),
        renewLease: () => renewJobLease(admin, job, new Date(), MODEL_LEASE_MS),
      }, job, (work) => hold(admin, job, work));
    }
    case "frame_check": {
      if (!s.frame_path) { job.step = "frame"; return "next"; }
      const seen = await footageWriting(admin, [s.frame_path], BUCKET);
      const content = await jpegBlocks(admin, BUCKET, [s.frame_path]);
      content.push({ type: "text", text: marksPrompt(input.brand_name) });
      const result = await anthropicMessages({ apiKey: anthropicKey(), body: { model: "claude-opus-5-5", max_tokens: CHECK_TOKENS, messages: [{ role: "user", content }] } });
      const marks = parseMarks(answerText(result));
      if (!marks) throw new Error(`The opening frame could not be read for other brands' marks: ${replySample(result)}`);
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
        // Priced in the aspect the clip is ordered in, as the approved price was.
        quote: async () => quoteClip(await hf(), jobVideoFrame(input).aspect),
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
        clearOrder: async (at) => {
          const { data, error } = await admin.rpc("video_clip_unorder", { p_job: job.id, p_at: at });
          if (error) throw new Error(`Could not clear the clip's order: ${error.message}`);
          return data === true;
        },
        stopJob: async (reason) => {
          const { data, error } = await admin.rpc("video_clip_stop", { p_job: job.id, p_reason: reason });
          if (error) throw new Error(`Could not stop the video: ${error.message}`);
          return data === true;
        },
        saveJob: () => saveJobProgress(admin, job),
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
      const [sw, sh] = input.logo_size;
      // The frame the video is made in: its platform's upload size, or the vertical frame (videoSize.ts).
      const frame = jobVideoFrame(input);
      const F = frame.size;
      // A filmed clip follows the client's filmed videos: their logo spot, captions and end card.
      const filmed = input.footage_upload ? input.filmed : null;
      if (filmed?.logo_at) { input.logo_at = filmed.logo_at; input.logo_width = filmed.logo_width ?? null; }
      // The logo where the client's own videos have it, else where its posts have it.
      // A vertical frame's shorter side is its width. A closing logo is never smaller than the client's posts show it.
      // The posts' spot is defined on their 4:5 page: on a frame that is not vertical it is moved onto the frame
      // as a still's is onto its page (platformSize.ts pagePlacement); a vertical frame takes it as it always did.
      const placeLogo = (lw: number, lh: number) => {
        const postSpot = isVertical(frame) ? input.placement : pagePlacement(input.placement, lw, lh, F);
        return input.logo_at
          ? videoLogoBox(input.logo_at, input.logo_at === "end" ? Math.max(input.logo_width ?? 0, input.placement.width) : input.logo_width ?? input.placement.width, lw / lh, F)
          : { ...canvasLogoRect(postSpot, lw, lh, F.width, F.height), end: false };
      };
      // The logo file is chosen by the footage's ground under the logo's place (logoGround.ts), read on
      // frames of the footage at the stored file's place, as a still's file is chosen by the ground under its slot.
      const slot = placeLogo(sw, sh);
      if (input.show_logo !== false && !s.logo_pick) {
        const picked = await pickVideoLogo(groundDeps(admin, job), s, input, slot, F);
        if (!picked) return "wait";
        s.logo_pick = picked;
      }
      const pick = s.logo_pick as VideoLogoPick | undefined;
      const logoPath = pick?.path ?? input.logo_path;
      const [lw, lh] = pick?.size ?? [sw, sh];
      // A file of another shape keeps the slot's middle (logoGround.ts, centeredIn).
      const box = centeredIn(placeLogo(lw, lh), [lw, lh], slot, [sw, sh]);
      s.composes = (s.composes ?? 0) + 1;
      if (s.composes > MAX_COMPOSE) throw new Error("FINAL: The video could not be put together.");
      // Each finished file has a name of its own, so a video made again is never shown from a cached copy.
      const out = `${base}/video-${Date.now().toString(36)}.mp4`;
      const { data: signed, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(out, { upsert: true });
      if (error || !signed?.signedUrl) throw new Error(`Could not prepare the video's upload: ${error?.message ?? "no URL"}`);
      const logoBottom = box.end || box.y > F.height / 2 ? 0 : box.y + Math.round(box.width * lh / lw);
      const at = s.hook_box ? hookPlacement(s.hook_box, s.hook_layer ?? frame.card, input.text_style ?? "", logoBottom, F) : null;
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
          logoUrl: input.show_logo === false ? undefined : publicUrl(admin, BUCKET, logoPath),
          logo: input.show_logo === false ? undefined : { x: box.x, y: box.y, width: box.width, end: box.end },
          uploadUrl: signed.signedUrl,
          frameUploads,
          captions: filmed && filmed.captions !== "none" && Array.isArray(s.words) && s.words.length
            ? { assB64: base64Encode(new TextEncoder().encode(captionsAss(s.words, filmed, s.sentence_starts ?? [], F)) as unknown as ArrayBuffer), fontUrl: await captionFontUrl(admin, filmed.caption_font, captionWeight(filmed.caption_style)) }
            : undefined,
          endCard: filmed && input.end_card?.url ? { url: input.end_card.url, seconds: input.end_card.seconds } : undefined,
          // Written only when it is not the vertical frame, so a vertical video's script is the one it always was.
          ...(isVertical(frame) ? {} : { size: F }),
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
      // The clip carries no writing of its own a viewer could make out: the only words are the title's.
      const seen = await footageWriting(admin, s.still_paths ?? []);
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

/** The pick's services (logoGround.ts, pickVideoLogo): the settings row, storage, the sandbox and the clock. */
function groundDeps(admin: any, job: VideoJob): GroundDeps {
  const input = job.input, s = job.state;
  return {
    liveRow: async () => {
      const { data, error } = await admin.from("design_brand_settings").select("logo_path, logo_set").eq("client_id", job.client_id).maybeSingle();
      if (error) throw new Error(`Could not read the logo settings: ${error.message}`);
      return data ?? null;
    },
    footageUrl: async () => input.footage_upload ? await signedUrl(admin, FOOTAGE_BUCKET, input.footage_upload) : publicUrl(admin, BUCKET, s.footage_path),
    prepareUploads: async (count) => {
      const paths: string[] = [], uploads: string[] = [];
      for (let i = 0; i < count; i++) {
        const path = `${job.client_id}/canva-finish/${job.id}/ground-${i}.png`;
        const { data: up, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: true });
        if (error || !up?.signedUrl) throw new Error(`Could not prepare a frame's upload: ${error?.message ?? "no URL"}`);
        paths.push(path); uploads.push(up.signedUrl);
      }
      return { paths, uploads };
    },
    start: (script) => startScript(script, `Socialytics video logo ground ${job.id}`),
    check: (session) => checkScript(session),
    end: (session) => endScript(session),
    save: () => saveJobProgress(admin, job),
    readFrame: async (path) => {
      const { data, error } = await admin.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(`Could not read a frame of the footage: ${error?.message ?? "missing"}`);
      const { Image } = await import("https://deno.land/x/imagescript@1.3.0/mod.ts");
      const img = await Image.decode(new Uint8Array(await data.arrayBuffer()));
      return { width: img.width, height: img.height, data: img.bitmap as unknown as Uint8ClampedArray };
    },
    readLogo: async (path) => {
      const { data, error } = await admin.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(`Could not read the logo file: ${error?.message ?? "missing"}`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      const { logoWhole } = await import("../lifecycle/imaging.ts");
      // A file with no whole part has nothing to test and shows anywhere.
      return { inks: ((await logoWhole(bytes))?.inks ?? []) as Rgb[], size: pngSize(bytes) };
    },
    now: () => Date.now(),
    log: (m) => console.log(`[video-worker] job ${job.id}: ${m}`),
  };
}

/** The title steps' services (titleStep.ts): the image model, storage, the picture service and the vision model. */
function titleDeps(admin: any, job: VideoJob): TitleDeps {
  const input = job.input;
  return {
    // The title layer has the video's frame shape (videoSize.ts), so its lettering is laid out for that frame.
    draw: async () => {
      const frame = jobVideoFrame(input);
      return generateImage(await openaiKey(admin), hookPrompt(input.brand_name, input.copy, input.text_style, frame), [frame.card.width, frame.card.height], true);
    },
    store: async (path, png) => {
      const { error } = await admin.storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`Could not store the title: ${error.message}`);
    },
    renewLease: () => renewJobLease(admin, job, new Date(), MODEL_LEASE_MS),
    save: () => saveJobProgress(admin, job),
    locate: async (layerPath, readPath) => callPicture(admin, "title-read", {
      job: job.id,
      step: "title_check",
      layer: await signedRead(admin, BUCKET, layerPath),
      out: await signedWrite(admin, BUCKET, readPath),
    }),
    read: async (readPath) => {
      const result = await anthropicMessages({
        apiKey: anthropicKey(),
        body: {
          model: "claude-opus-5-5", max_tokens: CHECK_TOKENS,
          messages: [{ role: "user", content: [
            ...(await jpegBlocks(admin, BUCKET, [readPath])),
            { type: "text", text: readPrompt(input.brand_name) },
          ] }],
        },
      });
      return parseRead(answerText(result));
    },
  };
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


/** Whether the footage's stills show writing that counts (compose.ts, writingCounts), read by the vision model; left is what it saw and let through. */
async function footageWriting(admin: any, paths: string[], bucket = BUCKET): Promise<{ writing: boolean; where: string; left: string }> {
  if (!paths.length) throw new Error("The footage's stills are missing.");
  const content: unknown[] = await jpegBlocks(admin, bucket, paths);
  content.push({ type: "text", text: footageTextPrompt() });
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const result = await anthropicMessages({ apiKey, body: { model: "claude-opus-5-5", max_tokens: CHECK_TOKENS, messages: [{ role: "user", content }] } });
  const seen = parseFootageText(answerText(result));
  if (!seen) throw new Error(`The footage's stills could not be read: ${replySample(result)}`);
  return seen;
}

/** A stored file's bytes. */
async function downloadFrom(admin: any, bucket: string, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`Could not read a still: ${error?.message ?? "missing"}`);
  return new Uint8Array(await data.arrayBuffer());
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
 *             of all lettering, each at its own framing (kitEditSize): a still
 *             whose writing shows again is cleaned once more, then dropped; one
 *             that shows a person's face is dropped at once. Each still's outcome is saved on the job
 *             as it comes. Once every picked still is done, the clean ones
 *             (kitPath) are listed on video_style.kit ([] with fewer than
 *             KIT_MIN). After MAX_KIT_TRIES claims that finished no still
 *             (kitClaim) the kit is stored with what is clean so far, so one
 *             still that never comes out costs no clean ones; with fewer
 *             than KIT_MIN the client's videos take the posts route, and
 *             nothing fails. Only errors about the stills are tries of the
 *             kit: a wait (the picture service unavailable, the image model
 *             busy) is waited out, and a call the picture service refused
 *             spends a try of the job, which fails with the service's
 *             reason after its tries (kitStep.ts);
 *   kit_wait  until the kit is stored. The style job then plans the video
 *             posts that waited for the style and ends; a video job goes on,
 *             on the posts route when the kit has too few stills.
 * after: what the job does once the kit is in ("finish" for the style job).
 */
export async function runKitStep(admin: any, job: VideoJob, after: "finish" | "video"): Promise<VideoStepResult> {
  const s = job.state ?? (job.state = {});
  const { data: client } = await admin.from("clients").select("name, video_style").eq("id", job.client_id).maybeSingle();
  const videoStyle = client?.video_style ?? null;
  const next = kitNext(videoStyle, Date.now(), job.id, s.kit_held_at);
  // A claim held by a job that has ended is free now, not when it lapses (endedHolder).
  const ended = next === "wait" ? await endedHolder(admin, videoStyle, job.id) : null;
  if (job.step === "kit_wait" || next === "ready" || next === "none") {
    if (next === "wait" && !ended) return "wait";
    // The last maker stopped without storing a kit: it is made again.
    if (next === "make" || ended) { job.step = "kit"; return "next"; }
    if (after === "finish") {
      // Planned now, so planning sees the kit as it is.
      await planWaitingVideos(admin, job.client_id);
      s.final_path = null;
      job.step = "finished"; return "done";
    }
    if (next === "none") await toPostsRoute(admin, job);
    job.step = "title"; return "next";
  }
  if (next === "wait" && !ended) return "wait";
  if (!videoStyle) {
    // No style at all (the client has no videos to learn from): nothing to make a kit from.
    if (after === "finish") throw new Error("FINAL: The client's video style is missing.");
    await toPostsRoute(admin, job);
    job.step = "title"; return "next";
  }
  // The claim: only when no other job holds a fresh start (decided in the database, so two jobs never both make it).
  // From an ended holder it is taken over only while that job still holds it (compare-and-set on it), so a claim another live job made since is never taken.
  const { data: claimed, error: claimError } = ended
    ? await admin.rpc("video_style_take_kit", { p_client: job.client_id, p_job: job.id, p_ended: ended.id })
    : await admin.rpc("video_style_claim_kit", { p_client: job.client_id, p_job: job.id, p_stale: `${KIT_MAKE_MS / 1000} seconds` });
  if (claimError) throw new Error(`Could not start the client's kit: ${claimError.message}`);
  if (!claimed) return "wait";
  // A kit in progress belongs to the style it was picked from; one learned again since starts the pick over.
  // A try is a claim that finished no still since the claim before, unless it ended for a reason outside its stills: a wait or a refused picture call (kitClaimed).
  job.state = kitClaimed(s, videoStyle.made_at);
  // From a holder that ended: its pick, outcomes and paid edits go on, so the next job pays for nothing twice.
  if (ended) job.state = kitTakenOver(job.state, ended.state, videoStyle.made_at);
  job.step = "kit";
  // Saved before any model call, so an error from here on never runs the steps before the kit again.
  await saveJobProgress(admin, job);
  try {
    return await makeKit(admin, job, videoStyle, job.input?.brand_name ?? client?.name ?? "the brand");
  } catch (e) {
    // An error before the cleaning never fails the job: it is kept, the next
    // pass claims again as another try, and spent tries store the kit as []
    // (the posts route). The cleaning runs in the hold and keeps its own
    // errors about the stills the same way (kitStep.ts).
    keepKitError(job.state, e);
    return "wait";
  }
}

/**
 * The row of the job that holds a fresh claim on the client's kit when that
 * job has ended (failed, canceled, or finished without storing the kit), or
 * null when no other job holds one or it is still at work. The claim then
 * belongs to nobody: waiting for it to lapse (KIT_MAKE_MS) only made the next
 * job wait out a dead claim, and pay again for edits the dead job had kept.
 */
async function endedHolder(admin: any, videoStyle: unknown, jobId: string): Promise<{ id: string; state: unknown } | null> {
  const holder = kitHolderOf(videoStyle, Date.now(), jobId);
  if (!holder) return null;
  const { data, error } = await admin.from("canva_finish_jobs").select("status, state").eq("id", holder).maybeSingle();
  // A read that did not answer is not an ended job: the claim is waited for as before.
  if (error) return null;
  if (data && ACTIVE.includes(data.status)) return null;
  return { id: holder, state: data?.state ?? null };
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
    const pick = parseKitPick(answerText(result), frames.length, KIT_MAX);
    // An answer that cannot be read, or was cut off, is a claim with no progress: the next pass asks again, as a try of the kit.
    if (pick === null) { keepKitError(s, `The kit's pick could not be read: ${replySample(result)}`); return "wait"; }
    // [] is an answer too: no still qualifies, and the kit is stored as none (the posts route).
    s.kit_pick = pick.map((i) => frames[i]);
    work = kitWork(s.kit_pick.length, done, s.kit_tries);
  }
  const picked: string[] = Array.isArray(s.kit_pick) ? s.kit_pick : [];
  if (work.kind !== "clean") {
    // Spent tries store what is clean so far: one still that never comes out costs no clean ones.
    const kept = kitKeptFrom(picked.length, done);
    if (work.kind === "spent") console.warn(`[video-worker] kit ${job.client_id}: ${MAX_KIT_TRIES} tries finished no still; stored with ${kept.length} clean.`);
    await storeKit(admin, job.client_id, kept);
    job.step = "kit_wait"; return "next";
  }
  const todo = work.todo;
  s.kit_held_at = Date.now();
  // Cleaned in the background (kitStep.ts): a wait or a refused picture call is thrown to the hold and costs no try of the kit; the wait costs no try of the job either.
  return hold(admin, job, () => cleanKitStills({
    still: (path) => downloadFrom(admin, REFERENCES, path),
    editor: async () => {
      const apiKey = await openaiKey(admin);
      const prompt = kitCleanPrompt();
      return (still, size) => imageEdit(apiKey, [{ bytes: still, name: "still.jpg" }], prompt, size);
    },
    storeEdit: async (path, png) => {
      const { error } = await admin.storage.from(REFERENCES).upload(path, png, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`Could not store a kit still: ${error.message}`);
    },
    transcode: async (editPath, jpegPath) => (await callPicture(admin, "transcode", {
      job: job.id,
      step: "kit",
      picture: await signedRead(admin, REFERENCES, editPath),
      quality: KIT_JPEG_QUALITY,
      out: await signedWrite(admin, REFERENCES, jpegPath),
    })).ms,
    check: (path) => kitStillCheck(admin, path),
    remove: async (path) => { await admin.storage.from(REFERENCES).remove([path]); },
    save: () => saveJobProgress(admin, job),
  }, job, picked, todo));
}

/** One kit still read back by the vision model: the writing left in it, and whether it shows a person's face. */
async function kitStillCheck(admin: any, path: string): Promise<{ writing: boolean; face: boolean; where: string }> {
  const content: unknown[] = await jpegBlocks(admin, REFERENCES, [path]);
  content.push({ type: "text", text: kitStillCheckPrompt() });
  const result = await anthropicMessages({ apiKey: anthropicKey(), body: { model: "claude-opus-5-5", max_tokens: CHECK_TOKENS, messages: [{ role: "user", content }] } });
  const seen = parseKitStillCheck(answerText(result));
  if (!seen) throw new Error(`The kit still could not be read: ${replySample(result)}`);
  return seen;
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
      const result = await anthropicMessages({ apiKey, body: { model: "claude-opus-5-5", max_tokens: roomFor(4000), messages: [{ role: "user", content }] } });
      const style = parseVideoStyle(answerText(result));
      if (!style) throw new Error(`The client's videos could not be read: ${replySample(result)}`);
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
