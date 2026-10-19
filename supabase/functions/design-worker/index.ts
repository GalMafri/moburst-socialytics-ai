// supabase/functions/design-worker/index.ts
//
// Makes the designs that design-request plans, without Canva (Lital, 13 Oct:
// "drop canva"). The steps are in _shared/design/pipeline.ts: generate,
// locate, unlogo, finish, verify. Each design is a row in canva_finish_jobs (the table
// keeps its old name); a video's footage and join stay with video-worker.
//
//   POST {action:"tick"}              one pass over the due jobs (operational secret)
//   POST {action:"advance", job_id}   one job, in a request of its own (operational secret)
//
// A pass hands every due job to its own request, so one design's image work
// never spends another's CPU time, and slow image-model calls run in the
// background under a longer lease.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { decode as base64Decode, encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";
import { endRequest, settleRequest, BUCKET } from "../_shared/canva/jobs.ts";
import { MAX_PLAN_ATTEMPTS, NO_PROGRESS_MINUTES } from "../_shared/design/requestRules.ts";
import { type GenerateInput, canvasLogoRect, designPrompt, resampleRGBA } from "../_shared/canva/brief.ts";
import { outputSize, pictureSize } from "../_shared/canva/finish.ts";
import { copyMatches, logoCheckPrompt, marksPrompt, parseLogoCheck, parseMarks, parseRead, readPrompt, removePrompt } from "../_shared/design/pipeline.ts";
import { LOGO_SCALES, findLogo, logoFound } from "../_shared/design/logoMatch.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};
const PASS_BUDGET_MS = 50_000;
const LEASE_MS = 120_000;
/** The image model can take minutes; its call is held under a longer lease. */
const MODEL_LEASE_MS = 420_000;
const MAX_ATTEMPTS = 4;
/** Designs made for one option before it fails (a design with wrong words, or without the logo in its place, is made again). */
const MAX_GENERATIONS = 3;
const MAX_UNLOGO = 4;
/** Removals that name another brand's marks before the design is made again. */
const MAX_MARK_CLEANS = 2;
const DEFAULT_PAGE = { width: 1088, height: 1360 };
const IMAGE_MODEL = "gpt-image-2.5-flare";
const READ_MODEL = "claude-opus-5-5";
/**
 * Room for each check's answer. The model may think before it answers and
 * that counts against the limit: at 300 to 600 tokens, answers came back cut
 * off after a few characters ("{\"marks") and good designs failed.
 */
const CHECK_TOKENS = 2000;
/** Times a check is asked again when its answer comes back unreadable, before the step counts a try. */
const READ_TRIES = 3;
const STEPS = new Set(["generate", "locate", "unlogo", "marks", "finish", "verify"]);
/** A job is only ever moved on while it is active: a cancelled design stays cancelled. */
const ACTIVE = ["queued", "running"];

const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = db();
  try {
    const body = await req.json().catch(() => ({}));
    if (!(await secretEquals(req.headers.get("x-socialytics-secret") ?? "", Deno.env.get("SOCIALYTICS_N8N_SECRET")))) {
      return json({ error: "Not allowed." }, 401);
    }
    if (body?.action === "tick") return background(runPass(admin));
    if (body?.action === "advance" && typeof body.job_id === "string") return background(advanceOne(admin, body.job_id));
    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    console.error("[design-worker]", err instanceof Error ? err.message : err);
    return json({ error: "The design worker could not run." }, 500);
  }
});

/** Answer at once and keep working in the background, so whoever called never waits. */
function background(work: Promise<unknown>): Response {
  const w = work.catch((e) => console.error("[design-worker]", e instanceof Error ? e.message : e));
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(w);
  return json({ accepted: true }, 202);
}

type Job = { id: string; client_id: string; step: string; status: string; attempts: number; input: any; state: any; design_request_id: string | null; option_index: number | null; slide_index: number | null; slide_count: number | null };
/** next: run the following step now; wait: a later pass; held: work continues in the background under its lease; done. */
type StepResult = "next" | "wait" | "held" | "done";
const JOB_COLUMNS = "id, client_id, step, status, attempts, input, state, design_request_id, option_index, slide_index, slide_count";

// ── The pass ────────────────────────────────────────────────────────────────

async function runPass(admin: any) {
  const { data: rows } = await admin.from("canva_finish_jobs").select("id, kind:input->>kind")
    .in("status", ["queued", "running"])
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .order("created_at").limit(40);
  // Video jobs are the video worker's.
  const due = (rows ?? []).filter((r: { kind: string | null }) => r.kind !== "video").slice(0, 12);
  const leased: string[] = [];
  for (const { id } of due) {
    const now = new Date();
    const { data: claimed } = await admin.from("canva_finish_jobs")
      .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString(), status: "running", updated_at: now.toISOString() })
      .eq("id", id).in("status", ["queued", "running"])
      .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
      .select("id");
    if (claimed?.[0]) leased.push(id);
  }
  await Promise.all(leased.map((id) => handOut(admin, id)));
  // Requests whose jobs all ended earlier (a replacement still to start) are settled here.
  const { data: open } = await admin.from("design_requests").select("id").eq("status", "preparing").neq("stage", "planning");
  for (const r of open ?? []) await settleRequest(admin, r.id).catch((e) => console.error(`[design-worker] request ${r.id}:`, e instanceof Error ? e.message : e));
  await replanStalled(admin).catch((e) => console.error("[design-worker] stalled planning:", e instanceof Error ? e.message : e));
  return { ran: leased.length };
}

/**
 * Requests whose planning stopped (the request that planned them died, or
 * the plan could not be made): planned again by design-request, as the
 * system, after NO_PROGRESS_MINUTES without progress. After MAX_PLAN_ATTEMPTS
 * the request closes quietly and the automatic designs make it again later.
 */
async function replanStalled(admin: any): Promise<void> {
  const cutoff = new Date(Date.now() - NO_PROGRESS_MINUTES * 60_000).toISOString();
  const { data: stalled } = await admin.from("design_requests").select("id, plan_attempts, updated_at")
    .eq("status", "preparing").eq("stage", "planning").lt("updated_at", cutoff).order("updated_at").limit(10);
  for (const r of stalled ?? []) {
    const tries = r.plan_attempts ?? 1;
    if (tries >= MAX_PLAN_ATTEMPTS) {
      await endRequest(admin, r.id, "no_progress");
      continue;
    }
    // Claimed by moving its clock, so two passes never plan it twice.
    const { data: claimed } = await admin.from("design_requests").update({ plan_attempts: tries + 1, updated_at: new Date().toISOString() })
      .eq("id", r.id).eq("status", "preparing").eq("updated_at", r.updated_at).select("id");
    if (!claimed?.length) continue;
    try {
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/design-request`, {
        method: "POST",
        // The system's own call: no person is named.
        headers: { "Content-Type": "application/json", "X-Socialytics-Secret": Deno.env.get("SOCIALYTICS_N8N_SECRET") ?? "" },
        body: JSON.stringify({ action: "replan", request_id: r.id }),
        signal: AbortSignal.timeout(15_000),
      });
      await res.body?.cancel();
      if (!res.ok) throw new Error(`replan answered ${res.status}`);
    } catch (e) {
      // Its clock moved, so the next sweep asks again.
      console.error(`[design-worker] could not plan request ${r.id} again:`, e instanceof Error ? e.message : e);
    }
  }
}

/** Start one leased job's own request; if it cannot be started, the job is released for the next pass. */
async function handOut(admin: any, jobId: string): Promise<void> {
  try {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/design-worker`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Socialytics-Secret": Deno.env.get("SOCIALYTICS_N8N_SECRET") ?? "" },
      body: JSON.stringify({ action: "advance", job_id: jobId }),
      signal: AbortSignal.timeout(15_000),
    });
    await res.body?.cancel();
    if (!res.ok) throw new Error(`advance answered ${res.status}`);
  } catch (e) {
    console.error(`[design-worker] could not hand out job ${jobId}:`, e instanceof Error ? e.message : e);
    await admin.from("canva_finish_jobs").update({ lease_until: null }).eq("id", jobId);
  }
}

/** One job: its steps until it waits, is held or is done; then its request is settled. */
async function advanceOne(admin: any, jobId: string) {
  const { data: job } = await admin.from("canva_finish_jobs").select(JOB_COLUMNS).eq("id", jobId).in("status", ["queued", "running"]).maybeSingle();
  if (!job) return;
  const started = Date.now();
  try {
    let result: StepResult = "next";
    while (result === "next" && Date.now() - started < PASS_BUDGET_MS) {
      result = await runStep(admin, job as Job);
      if (result !== "held") {
        await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, error: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
      }
    }
    if (result === "done") {
      await admin.from("canva_finish_jobs").update({ status: "done", step: "finished", output_path: job.state.final_path, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
    } else if (result !== "held") {
      await admin.from("canva_finish_jobs").update({ lease_until: null }).eq("id", job.id).in("status", ACTIVE);
    }
  } catch (e) {
    if (e instanceof Stopped) {
      await admin.from("canva_finish_jobs").update({ status: "canceled", error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
    } else {
      await recordFailure(admin, job as Job, e);
    }
  }
  if (job.design_request_id) {
    await settleRequest(admin, job.design_request_id).catch((e) => console.error(`[design-worker] request ${job.design_request_id}:`, e instanceof Error ? e.message : e));
  }
}

async function recordFailure(admin: any, job: Job, e: unknown): Promise<void> {
  const msg = e instanceof Error ? e.message : String(e);
  const attempts = job.attempts + 1;
  const failed = attempts >= MAX_ATTEMPTS || msg.startsWith("FINAL:");
  console.error(`[design-worker] job ${job.id} step ${job.step}:`, msg);
  await admin.from("canva_finish_jobs").update({
    attempts, state: job.state, error: msg.replace(/^FINAL:\s*/, ""), status: failed ? "failed" : "running", lease_until: null, updated_at: new Date().toISOString(),
  }).eq("id", job.id).in("status", ACTIVE);
}

/** Model work that runs past the request: the job is held under a longer lease and moves on when it ends. */
function hold(admin: any, job: Job, work: () => Promise<void>): StepResult {
  const run = (async () => {
    await admin.from("canva_finish_jobs").update({ lease_until: new Date(Date.now() + MODEL_LEASE_MS).toISOString(), state: job.state }).eq("id", job.id).in("status", ACTIVE);
    try {
      await work();
      await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
    } catch (e) {
      // The image model at its rate limit, or briefly down, is waited out without using a try.
      if (e instanceof ModelBusy) {
        await admin.from("canva_finish_jobs").update({ state: job.state, error: e.message, lease_until: null, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
      } else {
        await recordFailure(admin, job, e);
      }
    }
  })();
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(run);
  return "held";
}

// ── The steps ───────────────────────────────────────────────────────────────

async function runStep(admin: any, job: Job): Promise<StepResult> {
  const s = job.state ?? (job.state = {});
  const base = `${job.client_id}/canva-finish/${job.id}`;
  // A job left at a step of the Canva method (before 13 Oct) goes on from the design it has.
  if (!STEPS.has(job.step)) job.step = s.design_path ? "unlogo" : "generate";

  switch (job.step) {
    case "generate": {
      // A carousel slide after the cover follows the cover's look, so it waits for the cover's design.
      if (job.slide_index && job.slide_index > 0) {
        const { data: cover } = await admin.from("canva_finish_jobs").select("status, state").eq("design_request_id", job.design_request_id).eq("option_index", job.option_index).eq("slide_index", 0).maybeSingle();
        // The option is over with its cover; this slide stops with it, as it did nothing wrong.
        if (!cover || cover.status === "failed" || cover.status === "canceled") throw new Stopped("The carousel's cover was not made, so its option is over.");
        if (!cover.state?.design_path) return "wait";
        s.cover_path = cover.state.design_path;
      }
      s.generations = (s.generations ?? 0) + 1;
      if (s.generations > MAX_GENERATIONS) throw new Error("FINAL: The design could not be made with the headline's exact words and the logo in its place.");
      return hold(admin, job, async () => {
        s.design_path = await generateDesign(admin, job, `${base}/design-${s.generations}.png`);
        for (const k of ["logo_rect", "logo_frame", "logo_score", "nologo_path", "unlogos", "final_path", "read", "marks_check", "marks_where", "mark_cleans"]) delete s[k];
        job.step = "locate";
      });
    }
    case "locate": {
      const design = await Image.decode(await download(admin, s.design_path));
      const logo = await Image.decode(await download(admin, job.input.logo_path));
      const W = design.width, H = design.height;
      const usual = canvasLogoRect(job.input.placement, logo.width, logo.height, W, H);
      const g: GenerateInput = job.input.generate;
      const found = findLogo(design.bitmap, W, H, logo.bitmap, logo.width, logo.height, usual, hexRgb(g.background), { scales: LOGO_SCALES });
      s.logo_score = Math.round(found.score * 1000) / 1000;
      if (!logoFound(found, usual.width)) {
        // No logo at the client's usual spot, or one at a size the client never
        // uses: designed again, the way every other check sends a design back,
        // so the reason is kept and a carousel cover takes its slides with it
        // (slides drawn on a cover sent back here used to keep following it).
        const why = `logo match ${s.logo_score} at ${(found.width / usual.width).toFixed(2)} of the usual width`;
        console.warn(`[design-worker] job ${job.id}: ${why}; designing again.`);
        await designAgain(admin, job, why);
        return "next";
      }
      s.logo_rect = { x: found.x, y: found.y, width: found.width, height: found.height };
      s.logo_frame = [W, H];
      job.step = s.nologo_path ? "finish" : "unlogo";
      return "next";
    }
    case "unlogo": {
      s.unlogos = (s.unlogos ?? 0) + 1;
      if (s.unlogos > MAX_UNLOGO) throw new Error("FINAL: The logo could not be taken out of the design.");
      return hold(admin, job, async () => {
        const g: GenerateInput = job.input.generate;
        const page = pageOf(job);
        const size = pictureSize([page.width, page.height]);
        const bytes = await imageEdit([{ bytes: await download(admin, s.design_path), name: "design.png" }], removePrompt(g.brand_name, s.marks_where), size);
        const path = `${base}/nologo-${s.generations}-${s.unlogos}.png`;
        await upload(admin, path, bytes, "image/png");
        s.nologo_path = path;
        job.step = "marks";
      });
    }
    case "marks": {
      // No other brand's marks: read on the logo-free picture, at the page size.
      const pic = await Image.decode(await download(admin, s.nologo_path));
      const page = pageOf(job);
      const small = new Image(page.width, page.height);
      small.bitmap.set(resampleRGBA(pic.bitmap, pic.width, pic.height, page.width, page.height));
      const g: GenerateInput = job.input.generate;
      const image = base64Encode((await small.encodeJPEG(92)) as unknown as ArrayBuffer);
      const seen = await readCheck(() => askAbout("image/jpeg", image, marksPrompt(g.brand_name)), parseMarks, "The picture's other brand marks");
      s.marks_check = seen;
      if (!seen.marks) {
        delete s.marks_where;
        job.step = "finish";
        return "next";
      }
      s.mark_cleans = (s.mark_cleans ?? 0) + 1;
      if (s.mark_cleans <= MAX_MARK_CLEANS) {
        console.warn(`[design-worker] job ${job.id}: other brands' marks (${seen.where}); removing them.`);
        s.marks_where = seen.where || "every brand mark on clothing, shoes, balls and equipment";
        job.step = "unlogo";
        return "next";
      }
      await designAgain(admin, job, `other brands' marks: ${seen.where}`);
      return "next";
    }
    case "finish": {
      // A design from before the locate step is located first.
      if (!s.logo_rect) { job.step = "locate"; return "next"; }
      const pic = await Image.decode(await download(admin, s.nologo_path));
      const logo = await Image.decode(await download(admin, job.input.logo_path));
      const W = pic.width, H = pic.height;
      // The logo file exactly where and at the size the model drew it, in the
      // room the design left for it. The model's own drawing is gone (unlogo).
      const k = W / s.logo_frame[0];
      const r = { x: Math.round(s.logo_rect.x * k), y: Math.round(s.logo_rect.y * k), width: Math.round(s.logo_rect.width * k), height: Math.round(s.logo_rect.height * k) };
      // The logo file blended in place, inside its own rectangle only (a
      // full-size layer per design ran the worker out of memory on 13 Oct).
      const lp = resampleRGBA(logo.bitmap, logo.width, logo.height, r.width, r.height);
      const px = pic.bitmap;
      for (let y = 0; y < r.height; y++) {
        const ty = r.y + y;
        if (ty < 0 || ty >= H) continue;
        for (let x = 0; x < r.width; x++) {
          const tx = r.x + x;
          if (tx < 0 || tx >= W) continue;
          const k = (y * r.width + x) * 4, a = lp[k + 3];
          if (a === 0) continue;
          const i = (ty * W + tx) * 4, f = a / 255;
          px[i] = Math.round(lp[k] * f + px[i] * (1 - f));
          px[i + 1] = Math.round(lp[k + 1] * f + px[i + 1] * (1 - f));
          px[i + 2] = Math.round(lp[k + 2] * f + px[i + 2] * (1 - f));
          px[i + 3] = 255;
        }
      }
      const page = pageOf(job);
      const [ow, oh] = outputSize([page.width, page.height]);
      const out = new Image(ow, oh);
      out.bitmap.set(resampleRGBA(pic.bitmap, W, H, ow, oh));
      // Each finished file has a name of its own, so a design made again is never shown from a cached copy.
      const path = `${base}/final-${Date.now().toString(36)}.png`;
      await upload(admin, path, await out.encode(), "image/png");
      s.final_path = path;
      job.step = "verify";
      return "next";
    }
    case "verify": {
      const final = await Image.decode(await download(admin, s.final_path));
      // Read at the page size as a JPEG: well under the model's image limit, and every letter legible.
      const page = pageOf(job);
      const small = new Image(page.width, page.height);
      small.bitmap.set(resampleRGBA(final.bitmap, final.width, final.height, page.width, page.height));
      const jpeg = await small.encodeJPEG(92);
      const g: GenerateInput = job.input.generate;
      const lines = await readCheck(() => askAbout("image/jpeg", base64Encode(jpeg as unknown as ArrayBuffer), readPrompt(g.brand_name)), parseRead, "The words on the design");
      s.read = lines;
      if (!copyMatches(lines, job.input.copy)) {
        // Wrong words are never fixed by hand: the design is made again.
        console.warn(`[design-worker] job ${job.id}: read ${JSON.stringify(lines)}, wanted ${JSON.stringify(job.input.copy)}`);
        await designAgain(admin, job, `words read as ${JSON.stringify(lines)}`);
        return "next";
      }
      // Nothing may touch or cross the logo, seen at full size around its known place.
      if (s.logo_rect && s.logo_frame) {
        const k = final.width / s.logo_frame[0];
        const r = s.logo_rect;
        const mx = Math.round(r.height * k * 0.6), my = Math.round(r.height * k * 0.6);
        const x0 = Math.max(0, Math.round(r.x * k) - mx), y0 = Math.max(0, Math.round(r.y * k) - my);
        const x1 = Math.min(final.width, Math.round((r.x + r.width) * k) + mx), y1 = Math.min(final.height, Math.round((r.y + r.height) * k) + my);
        const area = final.clone().crop(x0, y0, x1 - x0, y1 - y0);
        const crop = base64Encode((await area.encode()) as unknown as ArrayBuffer);
        const seen = await readCheck(() => askAbout("image/png", crop, logoCheckPrompt(g.brand_name)), parseLogoCheck, "The area around the logo");
        s.logo_check = seen;
        if (!seen.clear) {
          console.warn(`[design-worker] job ${job.id}: the logo is touched by ${seen.touching}; designing again.`);
          await designAgain(admin, job, `logo touched by ${seen.touching}`);
          return "next";
        }
      }
      return "done";
    }
  }
  throw new Error(`FINAL: Unknown step '${job.step}'`);
}

/**
 * Send a design back to be made again. A carousel cover made again takes its
 * other slides with it, so every slide follows the cover the client sees.
 */
async function designAgain(admin: any, job: Job, reason: string): Promise<void> {
  const s = job.state;
  // Why each earlier design was made again, kept for review.
  s.redesigns = [...(Array.isArray(s.redesigns) ? s.redesigns : []), reason].slice(-5);
  for (const k of ["design_path", "logo_rect", "logo_frame", "logo_score", "logo_check", "nologo_path", "unlogos", "final_path", "read", "marks_check", "marks_where", "mark_cleans"]) delete s[k];
  job.step = "generate";
  if ((job.slide_count ?? 1) > 1 && (job.slide_index ?? 0) === 0 && job.design_request_id) {
    // The cover's old design is gone from its record before any slide can look for it.
    await admin.from("canva_finish_jobs").update({ step: job.step, state: s, updated_at: new Date().toISOString() }).eq("id", job.id).in("status", ACTIVE);
    const { data: slides } = await admin.from("canva_finish_jobs").select("id, state")
      .eq("design_request_id", job.design_request_id).eq("option_index", job.option_index).gt("slide_index", 0)
      .in("status", ["queued", "running", "done"]);
    for (const slide of slides ?? []) {
      const keep = slide.state?.replaces ? { replaces: slide.state.replaces } : {};
      await admin.from("canva_finish_jobs").update({ step: "generate", status: "running", state: keep, output_path: null, attempts: 0, error: null, lease_until: null, updated_at: new Date().toISOString() }).eq("id", slide.id);
    }
  }
}

function pageOf(job: Job): { width: number; height: number } {
  return job.input?.generate?.size ?? DEFAULT_PAGE;
}

/**
 * The image model designs the post: the client's background colour with its
 * logo file at the habitual spot (a mask shaped like the logo keeps it), the
 * client's own posts as references, and the brief (brief.ts), at twice the
 * page's size.
 */
async function generateDesign(admin: any, job: Job, path: string): Promise<string> {
  const g: GenerateInput = job.input.generate;
  const page = pageOf(job);
  // The canvas and its mask are at the page's size; the model draws at twice
  // it. (2x canvases and masks, three designs at once, ran the worker out of
  // memory on 13 Oct.)
  const size = pictureSize([page.width, page.height]);
  const W = page.width, H = page.height;
  const file = await Image.decode(await download(admin, job.input.logo_path));
  const rect = canvasLogoRect(job.input.placement, file.width, file.height, W, H);
  const logo = new Image(rect.width, rect.height);
  logo.bitmap.set(resampleRGBA(file.bitmap, file.width, file.height, rect.width, rect.height));
  const [r, gr, b] = hexRgb(g.background);
  const canvas = new Image(W, H).fill(Image.rgbaToColor(r, gr, b, 255));
  canvas.composite(logo, rect.x, rect.y);
  // OpenAI's mask: transparent pixels are redrawn, opaque ones are kept. Only
  // the logo's own ink is opaque, so no box appears behind it.
  const mask = new Image(W, H);
  for (let y = 0; y < logo.height; y++) {
    for (let x = 0; x < logo.width; x++) {
      if (logo.bitmap[(y * logo.width + x) * 4 + 3] === 0) continue;
      const tx = x + rect.x, ty = y + rect.y;
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
      mask.bitmap.set([255, 255, 255, 255], (ty * W + tx) * 4);
    }
  }
  const slide = job.slide_count && job.slide_count > 1 && job.input?.kind !== "video_card"
    ? { index: job.slide_index ?? 0, count: job.slide_count, withCover: !!job.state.cover_path }
    : (job.input?.kind === "video_card" && job.state.cover_path ? { index: 1, count: 2, withCover: true } : undefined);
  const images: { bytes: Uint8Array; name: string }[] = [{ bytes: await canvas.encode(), name: "canvas.png" }];
  if (job.state.cover_path) images.push({ bytes: await download(admin, job.state.cover_path), name: "cover.png" });
  for (const [i, p] of g.refs.entries()) {
    const { data, error } = await admin.storage.from("design-references").download(p);
    if (error || !data) throw new Error(`Could not read the client post ${p}: ${error?.message ?? "missing"}`);
    images.push({ bytes: new Uint8Array(await data.arrayBuffer()), name: `ref${i}${p.slice(p.lastIndexOf("."))}` });
  }
  const bytes = await imageEdit(images, designPrompt(g, job.input.copy, g.refs.length, slide), size, await mask.encode());
  await upload(admin, path, bytes, "image/png");
  return path;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The image model is at its rate limit or briefly down; the step is tried again on a later pass. */
class ModelBusy extends Error {}

/** A job that has nothing left to do because its option is over: it stops, which is not a failure of its own. */
class Stopped extends Error {}

/** One image and one question to the reading model; its answer as text. */
async function askAbout(mediaType: "image/jpeg" | "image/png", data: string, question: string): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const result = await anthropicMessages({
    apiKey,
    body: {
      model: READ_MODEL,
      max_tokens: CHECK_TOKENS,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data } },
        { type: "text", text: question },
      ] }],
    },
  });
  return result.text;
}

/**
 * A check's answer, asked again when it comes back unreadable (cut short, or
 * not in the form asked for): an unreadable answer says nothing about the
 * design, so it never costs the design a try (13 Oct: four designs ended on
 * "The area around the logo could not be read").
 */
async function readCheck<T>(ask: () => Promise<string>, parse: (text: string) => T | null, what: string): Promise<T> {
  let last = "";
  for (let i = 0; i < READ_TRIES; i++) {
    last = await ask();
    const value = parse(last);
    if (value) return value;
  }
  throw new Error(`${what} could not be read: ${last.slice(0, 200)}`);
}

async function imageEdit(images: { bytes: Uint8Array; name: string }[], prompt: string, size: [number, number], mask?: Uint8Array): Promise<Uint8Array> {
  const form = new FormData();
  form.append("model", IMAGE_MODEL);
  form.append("size", `${size[0]}x${size[1]}`);
  form.append("quality", "high");
  form.append("n", "1");
  for (const im of images) {
    const type = /\.png$/i.test(im.name) ? "image/png" : /\.webp$/i.test(im.name) ? "image/webp" : "image/jpeg";
    form.append("image[]", new Blob([im.bytes as unknown as BlobPart], { type }), im.name);
  }
  if (mask) form.append("mask", new Blob([mask as unknown as BlobPart], { type: "image/png" }), "mask.png");
  form.append("prompt", prompt);
  const resp = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${await openaiKey()}` },
    body: form,
    signal: AbortSignal.timeout(360_000),
  });
  const text = await resp.text();
  if (resp.status === 429 || resp.status >= 500) throw new ModelBusy(`Image model ${resp.status}: ${text.slice(0, 200)}`);
  if (!resp.ok) throw new Error(`Image model ${resp.status}: ${text.slice(0, 300)}`);
  const b64 = JSON.parse(text)?.data?.[0]?.b64_json;
  if (!b64) throw new Error("The image model returned no image.");
  const bytes = base64Decode(b64);
  const [w, h] = pngSize(bytes);
  if (w !== size[0] || h !== size[1]) throw new Error(`The image model answered at ${w}x${h}; ${size[0]}x${size[1]} was asked for.`);
  return bytes;
}

async function openaiKey(): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (key) return key;
  const { data } = await db().from("app_settings").select("value").eq("key", "openai_api_key").maybeSingle();
  if (!data?.value) throw new Error("FINAL: No OpenAI key is configured.");
  return data.value as string;
}

async function download(admin: any, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Could not read ${path}: ${error?.message ?? "missing"}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function upload(admin: any, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Could not store ${path}: ${error.message}`);
}

function pngSize(bytes: Uint8Array): [number, number] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || v.getUint32(0) !== 0x89504e47) throw new Error("The image model did not return a PNG.");
  return [v.getUint32(16), v.getUint32(20)];
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(String(hex || "#000000").replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
