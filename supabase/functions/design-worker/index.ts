// supabase/functions/design-worker/index.ts
//
// Makes the designs that design-request plans, without Canva (Lital, 13 Oct:
// "drop canva"). The steps are in _shared/design/pipeline.ts: generate,
// locate, unlogo, finish, verify. Each design is a row in canva_finish_jobs (the table
// keeps its old name); a video's footage and join stay with video-worker.
//
//   POST {action:"tick"}              one pass over the due jobs, then the next posts
//                                     of any week being designed (operational secret)
//   POST {action:"advance", job_id}   one job, in a request of its own (operational secret)
//   POST {action:"picture_check", count}  the finish call for the newest done designs, answered
//                                     at once with each call's time (operational secret)
//   POST {action:"tone_check", client_id, designs?}  the live logo set and one read of posts for
//                                     one client, or with `designs` the live locate on its newest
//                                     stored designs; writes nothing to a job or a client
//                                     (operational secret)
//
// Every picture is made, read and resized by the picture service on Vercel
// (_shared/picture/client.ts, 12 Nov 2026); this worker never decodes one.
//
// A pass hands every due job to its own request, so one design's image work
// never spends another's CPU time, and slow image-model calls run in the
// background under a longer lease.

import { createClient } from "../_shared/supabase.ts";
import { encode as base64Encode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { secretEquals } from "../_shared/auth/secretEquals.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";
import { imageEdit } from "../_shared/media/imageEdit.ts";
import { openaiKey } from "../_shared/openai/key.ts";
import { claimJob, endOverdueRequests, endRequest, renewJobLease, saveJobProgress, settleRequest, BUCKET } from "../_shared/canva/jobs.ts";
import { MAX_PLAN_ATTEMPTS, NO_PROGRESS_MINUTES, REQUEST_MAX_MINUTES } from "../_shared/design/requestRules.ts";
import { type GenerateInput, designPrompt } from "../_shared/canva/brief.ts";
import { outputSize, pictureSize } from "../_shared/canva/finish.ts";
import { copyMatches, logoCheckPrompt, marksPrompt, parseLogoCheck, parseMarks, parseRead, readPrompt, removePrompt } from "../_shared/design/pipeline.ts";
import { LOGO_SCALES, logoFound } from "../_shared/design/logoMatch.ts";
import { STORY_SURFACE, storyTextBand } from "../_shared/design/story.ts";
import { callPicture, notePicture, pictureCheckCount, signedRead, signedWrite } from "../_shared/picture/client.ts";
import type { LocateRequest, LogoTemplate } from "../_shared/picture/contract.ts";
import { heldWork } from "../_shared/canva/hold.ts";
import { DESIGN_LIMITS, MAX_DESIGN_ATTEMPTS, type StepResult, Stopped, advanceDesignJob } from "../_shared/design/advance.ts";
import { type GenerateDeps, OF_THE_DESIGN, runGenerate, runUnlogo } from "../_shared/design/modelSteps.ts";
import { type LocatePlan, checkInput, locatePlan, locateRefusal, logoState, stampFile } from "../_shared/design/logoChoice.ts";
import { jobLogos, postSearchPlan } from "../_shared/design/logoTone.ts";
import { POSTS_PER_CALL, askLogoSet, askPostLogos, liveIo } from "../_shared/design/logoSetWork.ts";
import { personOther } from "../_shared/lifecycle/designSettings.ts";
import { logoAreaRect } from "../_shared/picture/geometry.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret",
};
const PASS_BUDGET_MS = 50_000;
const LEASE_MS = 120_000;
/** The image model can take minutes; its call is held under a longer lease. */
const MODEL_LEASE_MS = 420_000;
const MAX_ATTEMPTS = MAX_DESIGN_ATTEMPTS;
/** Removals that name another brand's marks before the design is made again. */
const MAX_MARK_CLEANS = 2;
const DEFAULT_PAGE = { width: 1088, height: 1360 };
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
/** A job is only ever moved on while it is active: a canceled design stays canceled. */
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
    if (body?.action === "picture_check") return json(await pictureCheck(admin, pictureCheckCount(body.count)));
    if (body?.action === "tone_check" && typeof body.client_id === "string") {
      return json(await toneCheck(admin, body.client_id, body.designs === undefined || body.designs === null ? null : pictureCheckCount(body.designs)));
    }
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

type Job = { id: string; client_id: string; step: string; status: string; attempts: number; input: any; state: any; design_request_id: string | null; option_index: number | null; slide_index: number | null; slide_count: number | null; created_at: string };
const JOB_COLUMNS = "id, client_id, step, status, attempts, input, state, design_request_id, option_index, slide_index, slide_count, created_at";

// ── The pass ────────────────────────────────────────────────────────────────

async function runPass(admin: any) {
  // A request prepared for longer than REQUEST_MAX_MINUTES ends first, before any more work is handed out for it.
  await endOverdueRequests(admin).then((ended) => {
    for (const id of ended) console.error(`[design-worker] request ${id} was still being prepared after ${REQUEST_MAX_MINUTES} minutes; closed.`);
  }).catch((e) => console.error("[design-worker] overdue requests:", e instanceof Error ? e.message : e));
  const { data: rows } = await admin.from("canva_finish_jobs").select("id, step, status, attempts, lease_until, kind:input->>kind")
    .in("status", ["queued", "running"])
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .order("created_at").limit(40);
  // Video jobs are the video worker's.
  const due = (rows ?? []).filter((r: { kind: string | null }) => r.kind !== "video").slice(0, 12);
  const leased: string[] = [];
  for (const row of due) {
    // A job whose last run died (its lease ran out with the job still going) uses a try; at MAX_ATTEMPTS it fails and its option is replaced.
    const claim = await claimJob(admin, row, new Date(), LEASE_MS, MAX_ATTEMPTS);
    if (claim === "claimed") leased.push(row.id);
    if (claim === "failed") console.error(`[design-worker] job ${row.id} step ${row.step ?? "?"}: the run died ${MAX_ATTEMPTS} times; its option is over.`);
  }
  await Promise.all(leased.map((id) => handOut(admin, id)));
  // Requests whose jobs all ended earlier (a replacement still to start) are settled here.
  const { data: open } = await admin.from("design_requests").select("id").eq("status", "preparing").neq("stage", "planning");
  for (const r of open ?? []) await settleRequest(admin, r.id).catch((e) => console.error(`[design-worker] request ${r.id}:`, e instanceof Error ? e.message : e));
  await replanStalled(admin).catch((e) => console.error("[design-worker] stalled planning:", e instanceof Error ? e.message : e));
  await continueWeeks(admin).catch((e) => console.error("[design-worker] weeks:", e instanceof Error ? e.message : e));
  return { ran: leased.length };
}

/**
 * Weeks being designed (the week's design button): design-request starts
 * their next posts, as the system, at the pace it sets (at most two week
 * posts designing across the app, one per client at a time).
 */
async function continueWeeks(admin: any): Promise<void> {
  const { data: running } = await admin.from("design_week_runs").select("id").eq("status", "running").limit(1);
  if (!running?.length) return;
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/design-request`, {
    method: "POST",
    // The system's own call: each post's request names the person who added it to the week.
    headers: { "Content-Type": "application/json", "X-Socialytics-Secret": Deno.env.get("SOCIALYTICS_N8N_SECRET") ?? "" },
    body: JSON.stringify({ action: "week_continue" }),
    signal: AbortSignal.timeout(15_000),
  });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`week_continue answered ${res.status}`);
}

/**
 * Requests whose planning stopped (the request that planned them died, or
 * the plan could not be made): planned again by design-request, as the
 * system, after NO_PROGRESS_MINUTES without progress. After MAX_PLAN_ATTEMPTS
 * the request closes quietly, and the week's design button counts its post
 * again the next time it is pressed.
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

/** One job: its steps until it waits, is held or is done (_shared/design/advance.ts); then its request is settled. */
async function advanceOne(admin: any, jobId: string) {
  const { data: job } = await admin.from("canva_finish_jobs").select(JOB_COLUMNS).eq("id", jobId).in("status", ["queued", "running"]).maybeSingle();
  if (!job) return;
  const started = Date.now();
  await advanceDesignJob(admin, job as Job, () => runStep(admin, job as Job), () => Date.now() - started < PASS_BUDGET_MS);
  if (job.design_request_id) {
    await settleRequest(admin, job.design_request_id).catch((e) => console.error(`[design-worker] request ${job.design_request_id}:`, e instanceof Error ? e.message : e));
  }
}

/**
 * Model work that runs past the request (canva/hold.ts, the video worker's
 * too): the job is held under a longer lease and moves on when the work
 * ends. The image model at its rate limit, or the picture service
 * unavailable, is waited out without using a try (canva/stepError.ts).
 */
function hold(admin: any, job: Job, work: () => Promise<void>): StepResult {
  const run = heldWork(admin, job, work, { ...DESIGN_LIMITS, leaseMs: MODEL_LEASE_MS });
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(run);
  return "held";
}

/**
 * A picture step's lease, renewed as it starts: one picture service call may
 * wait up to two timeouts, and the lease must cover it. The edge request's own
 * wall limit stays the bound; a run that dies spends a try as before.
 */
async function renewLease(admin: any, job: Job): Promise<void> {
  await renewJobLease(admin, job.id, new Date(), MODEL_LEASE_MS);
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
      // The design is counted once the image model has made it (_shared/design/modelSteps.ts).
      return runGenerate(generateDeps(admin, job), job, (work) => hold(admin, job, work));
    }
    case "locate": {
      await renewLease(admin, job);
      const g: GenerateInput = job.input.generate;
      // The service finds the logo on the design, near the client's usual spot for it (usual).
      // A job with one file sends that file over its background, as always. A job that
      // carries its client's logo set (input.logos) sends the canvas file first, then the
      // file for the other ground, and the service also names the file closest in color
      // to what the model drew (_shared/design/logoChoice.ts).
      const plan = locatePlan({ logo_path: job.input.logo_path, generate: g, logos: job.input.logos });
      const { result: found, ms } = await callPicture(admin, "locate", await locateRequest(admin, plan, { job: job.id, step: "locate", designPath: s.design_path, placement: job.input.placement }));
      notePicture(s, "locate", ms);
      s.logo_score = Math.round(found.score * 1000) / 1000;
      // Two reasons a located design is made again (_shared/design/logoChoice.ts, locateRefusal). The test of the
      // match, whatever the job sent: the better match is the logo at a size the client uses. And, since 17 Nov
      // 2026, no file that may be stamped shows on the picture's own ground around the logo.
      const why = locateRefusal(found);
      if (why) {
        // Designed again, the way every other check sends a design back, so the reason is
        // kept and a carousel cover takes its slides with it (slides drawn on a cover sent
        // back here used to keep following it).
        console.warn(`[design-worker] job ${job.id}: ${why}; designing again.`);
        await designAgain(admin, job, why);
        return "next";
      }
      // Where the logo was drawn, and for a job with a set the file finish stamps there.
      Object.assign(s, logoState(job.input, found));
      job.step = s.nologo_path ? "finish" : "unlogo";
      return "next";
    }
    case "unlogo": {
      // The removal is counted once the image model has made it (_shared/design/modelSteps.ts).
      return runUnlogo({
        edit: async () => {
          const g: GenerateInput = job.input.generate;
          const page = pageOf(job);
          const size = pictureSize([page.width, page.height]);
          return imageEdit(await openaiKey(db()), [{ bytes: await download(admin, s.design_path), name: "design.png" }], removePrompt(g.brand_name, s.marks_where), size);
        },
        store: (path, png) => upload(admin, path, png, "image/png"),
        save: () => saveJobProgress(admin, job),
      }, job, (work) => hold(admin, job, work));
    }
    case "marks": {
      await renewLease(admin, job);
      // No other brand's marks: read on the logo-free picture, at the page size.
      const page = pageOf(job);
      const marksPath = `${base}/marks-${s.generations}-${s.unlogos}.jpg`;
      const { ms } = await callPicture(admin, "read", {
        job: job.id,
        step: "marks",
        picture: await signedRead(admin, BUCKET, s.nologo_path),
        page,
        out: { page: await signedWrite(admin, BUCKET, marksPath) },
      });
      notePicture(s, "read", ms);
      const g: GenerateInput = job.input.generate;
      const image = base64Encode((await download(admin, marksPath)) as unknown as ArrayBuffer);
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
      await renewLease(admin, job);
      // The logo file exactly where and at the size the model drew it, in the
      // room the design left for it, then the picture at its delivered size.
      // The model's own drawing is gone (unlogo).
      const page = pageOf(job);
      const [ow, oh] = outputSize([page.width, page.height]);
      // Each finished file has a name of its own, so a design made again is never shown from a cached copy.
      const path = `${base}/final-${Date.now().toString(36)}.png`;
      const { ms } = await callPicture(admin, "finish", {
        job: job.id,
        step: "finish",
        picture: await signedRead(admin, BUCKET, s.nologo_path),
        // The file locate named for this design, or the job's own logo.
        logo: await signedRead(admin, BUCKET, stampFile(job.input, s)),
        rect: s.logo_rect,
        frame: s.logo_frame,
        output: { width: ow, height: oh },
        out: await signedWrite(admin, BUCKET, path),
      });
      notePicture(s, "finish", ms);
      s.final_path = path;
      job.step = "verify";
      return "next";
    }
    case "verify": {
      await renewLease(admin, job);
      // Read at the page size as a JPEG: well under the model's image limit, and every letter legible.
      // The Story's band (a crop of that page) and the area around the logo (at full size) come from the same call.
      const page = pageOf(job);
      const g: GenerateInput = job.input.generate;
      const [ow, oh] = outputSize([page.width, page.height]);
      const stem = `${base}/verify-${Date.now().toString(36)}`;
      const band = g.surface === STORY_SURFACE ? storyTextBand(page.width, page.height) : null;
      const area = s.logo_rect && s.logo_frame ? logoAreaRect(s.logo_rect, s.logo_frame, { width: ow, height: oh }) : null;
      const { ms } = await callPicture(admin, "read", {
        job: job.id,
        step: "verify",
        picture: await signedRead(admin, BUCKET, s.final_path),
        page,
        ...(band ? { band } : {}),
        ...(area ? { area } : {}),
        out: {
          page: await signedWrite(admin, BUCKET, `${stem}.jpg`),
          ...(band ? { band: await signedWrite(admin, BUCKET, `${stem}-band.jpg`) } : {}),
          ...(area ? { area: await signedWrite(admin, BUCKET, `${stem}-area.png`) } : {}),
        },
      });
      notePicture(s, "read", ms);
      const jpeg = base64Encode((await download(admin, `${stem}.jpg`)) as unknown as ArrayBuffer);
      const lines = await readCheck(() => askAbout("image/jpeg", jpeg, readPrompt(g.brand_name)), parseRead, "The words on the design");
      s.read = lines;
      if (!copyMatches(lines, job.input.copy)) {
        // Wrong words are never fixed by hand: the design is made again.
        console.warn(`[design-worker] job ${job.id}: read ${JSON.stringify(lines)}, wanted ${JSON.stringify(job.input.copy)}`);
        await designAgain(admin, job, `words read as ${JSON.stringify(lines)}`);
        return "next";
      }
      // A Story's words all sit in Meta's band (_shared/design/story.ts): the band alone is read, and holds the whole copy.
      if (band) {
        const crop = base64Encode((await download(admin, `${stem}-band.jpg`)) as unknown as ArrayBuffer);
        s.band_read = await readCheck(() => askAbout("image/jpeg", crop, readPrompt(g.brand_name)), parseRead, "The words in the Story's band");
        if (!copyMatches(s.band_read, job.input.copy)) {
          console.warn(`[design-worker] job ${job.id}: the Story's band read ${JSON.stringify(s.band_read)}, wanted ${JSON.stringify(job.input.copy)}`);
          await designAgain(admin, job, `words outside the Story's band: ${JSON.stringify(s.band_read)} inside it`);
          return "next";
        }
      }
      // Nothing may touch or cross the logo, seen at full size around its known place.
      if (area) {
        const crop = base64Encode((await download(admin, `${stem}-area.png`)) as unknown as ArrayBuffer);
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
  for (const k of ["design_path", "logo_check", ...OF_THE_DESIGN]) delete s[k];
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
 * The generate step's services (_shared/design/modelSteps.ts). The image
 * model designs the post: the client's background color with its logo file
 * at the habitual spot (a mask shaped like the logo keeps it), the client's
 * own posts as references, and the brief (brief.ts), at twice the page's size.
 */
function generateDeps(admin: any, job: Job): GenerateDeps {
  const g: GenerateInput = job.input.generate;
  const page = pageOf(job);
  return {
    // The service draws the canvas (the background color with the logo at its
    // spot) and OpenAI's mask: transparent pixels are redrawn, opaque ones are
    // kept. Only the logo's own ink is opaque, so no box appears behind it.
    // Both are at the page's size; the model draws at twice it. (2x canvases
    // and masks, three designs at once, ran the worker out of memory on 13 Oct.)
    canvas: async (canvasPath, maskPath) => {
      const { ms } = await callPicture(admin, "canvas", {
        job: job.id,
        step: "generate",
        logo: await signedRead(admin, BUCKET, job.input.logo_path),
        page: { width: page.width, height: page.height },
        placement: job.input.placement,
        background: hexRgb(g.background),
        out: { canvas: await signedWrite(admin, BUCKET, canvasPath), mask: await signedWrite(admin, BUCKET, maskPath) },
      });
      return ms;
    },
    draw: async (canvasPath, maskPath) => {
      const slide = job.slide_count && job.slide_count > 1 && job.input?.kind !== "video_card"
        ? { index: job.slide_index ?? 0, count: job.slide_count, withCover: !!job.state.cover_path }
        : (job.input?.kind === "video_card" && job.state.cover_path ? { index: 1, count: 2, withCover: true } : undefined);
      const images: { bytes: Uint8Array; name: string }[] = [{ bytes: await download(admin, canvasPath), name: "canvas.png" }];
      if (job.state.cover_path) images.push({ bytes: await download(admin, job.state.cover_path), name: "cover.png" });
      for (const [i, p] of g.refs.entries()) {
        const { data, error } = await admin.storage.from("design-references").download(p);
        if (error || !data) throw new Error(`Could not read the client post ${p}: ${error?.message ?? "missing"}`);
        images.push({ bytes: new Uint8Array(await data.arrayBuffer()), name: `ref${i}${p.slice(p.lastIndexOf("."))}` });
      }
      return imageEdit(await openaiKey(db()), images, designPrompt(g, job.input.copy, g.refs.length, slide), pictureSize([page.width, page.height]), await download(admin, maskPath));
    },
    store: (path, png) => upload(admin, path, png, "image/png"),
    save: () => saveJobProgress(admin, job),
  };
}

/**
 * The deployed picture service tried on real work: the finish call for the
 * newest `count` done designs, all at once, each written to
 * picture-check/<job>.png so no delivered picture changes. Answered at once,
 * so the caller reads each call's time, or the reason it failed.
 */
async function pictureCheck(admin: any, count: number): Promise<{ elapsed_ms: number; results: Array<{ job: string; ms: number; ok: boolean; reason?: string }> }> {
  const started = Date.now();
  const { data: rows, error } = await admin.from("canva_finish_jobs").select("id, client_id, input, state")
    .eq("status", "done")
    .not("state->>nologo_path", "is", null).not("state->>final_path", "is", null)
    .order("created_at", { ascending: false }).limit(count * 3);
  if (error) throw new Error(`Could not read the finished designs: ${error.message}`);
  // Video jobs are left out here, as runPass does: a static design has no kind, and SQL's <> drops a missing one.
  const jobs = (rows ?? [])
    .filter((r: any) => r.input?.kind !== "video" && r.state?.logo_rect && r.state?.logo_frame && r.input?.logo_path)
    .slice(0, count);
  const took: number[] = [];
  const settled = await Promise.allSettled(jobs.map(async (r: any, i: number) => {
    const t = Date.now();
    try {
      const page = pageOf(r as Job);
      const [ow, oh] = outputSize([page.width, page.height]);
      const { ms } = await callPicture(admin, "finish", {
        job: r.id,
        step: "picture_check",
        picture: await signedRead(admin, BUCKET, r.state.nologo_path),
        logo: await signedRead(admin, BUCKET, stampFile(r.input, r.state)),
        rect: r.state.logo_rect,
        frame: r.state.logo_frame,
        output: { width: ow, height: oh },
        out: await signedWrite(admin, BUCKET, `picture-check/${r.id}.png`),
      });
      return ms;
    } finally {
      took[i] = Date.now() - t;
    }
  }));
  const results = settled.map((x, i) => x.status === "fulfilled"
    ? { job: jobs[i].id as string, ms: x.value, ok: true }
    : { job: jobs[i].id as string, ms: took[i], ok: false, reason: x.reason instanceof Error ? x.reason.message : String(x.reason) });
  return { elapsed_ms: Date.now() - started, results };
}

/**
 * The deployed picture service tried on one client's logo set, with nothing
 * written to a job or a client (the release's proof with no spend, spec
 * 2026-11-16-logo-tone-design.md, section 10).
 *
 * Without `designs`: the live logo-set call for the client's stored logo
 * (its two copies go under picture-check/tone/, so no product file changes)
 * and one post-logos call for the first four of its posts, with each call's
 * time: the service's speed on these searches.
 *
 * With `designs`: the live locate on the client's newest ended still
 * designs, each asked the way a job started from the client's set as it is
 * now would ask (the job's own placement), with the matched file, the named
 * file, each score, the time and whether the one test (logoFound) holds. A
 * client with no current set answers that and calls nothing.
 */
async function toneCheck(admin: any, clientId: string, designs: number | null): Promise<Record<string, unknown>> {
  const started = Date.now();
  const { data: row, error } = await admin.from("design_brand_settings").select("source, logo_path, placement, background, reference_paths, logo_set").eq("client_id", clientId).maybeSingle();
  if (error) throw new Error(`Could not read the design settings: ${error.message}`);
  if (!row) return { elapsed_ms: Date.now() - started, settings: false };
  const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

  if (designs === null) {
    const io = liveIo(admin);
    const person = personOther(row)?.path ?? null;
    const out = { other: `picture-check/tone/${clientId}-other.png`, white: `picture-check/tone/${clientId}-white.png` };
    try {
      const set = await askLogoSet(io, { clientId, logoPath: row.logo_path, site: [], person, out });
      const plan = postSearchPlan(row.logo_path, set.facts, { other: set.facts.made.other ? out.other : null, white: set.facts.made.white ? out.white : null, site: null, person: set.facts.person ? person : null });
      const posts: string[] = (Array.isArray(row.reference_paths) ? row.reference_paths : []).slice(0, POSTS_PER_CALL);
      const read = posts.length ? await askPostLogos(io, { clientId, posts, placement: row.placement, plan }) : { posts: [], ms: 0 };
      return {
        elapsed_ms: Date.now() - started, ok: true,
        logo_set: { ms: set.ms, facts: set.facts },
        post_logos: { ms: read.ms, posts: posts.map((path, i) => ({ path, result: read.posts[i] ?? null })) },
      };
    } catch (e) {
      return { elapsed_ms: Date.now() - started, ok: false, reason: reason(e) };
    }
  }

  if (!jobLogos(row)) return { elapsed_ms: Date.now() - started, set: false };
  const { data: rows, error: jobsError } = await admin.from("canva_finish_jobs").select("id, input, state, status")
    .eq("client_id", clientId).in("status", ["done", "failed", "canceled"])
    .not("state->>design_path", "is", null)
    .order("created_at", { ascending: false }).limit(designs * 3);
  if (jobsError) throw new Error(`Could not read the client's designs: ${jobsError.message}`);
  // Video jobs are left out, as in picture_check.
  const jobs = (rows ?? []).filter((r: any) => r.input?.kind !== "video" && r.input?.placement && r.state?.design_path).slice(0, designs);
  const results = await Promise.all(jobs.map(async (r: any) => {
    const t = Date.now();
    try {
      const plan = locatePlan(checkInput(row, r)!);
      const { result: found, ms } = await callPicture(admin, "locate", await locateRequest(admin, plan, { job: r.id, step: "tone_check", designPath: r.state.design_path, placement: r.input.placement }));
      return {
        job: r.id as string, status: r.status as string, ms, ok: true,
        found: logoFound(found, found.usual.width), score: Math.round(found.score * 1000) / 1000,
        made_again: locateRefusal(found), ground: found.ground ?? null,
        matched: found.matched ?? null, file: found.file ?? null,
        scores: (found.scores ?? []).map((v) => Math.round(v * 1000) / 1000),
        gaps: Object.fromEntries(Object.entries(found.gaps ?? {}).map(([file, gap]) => [file, Math.round((gap as number) * 10) / 10])),
      };
    } catch (e) {
      return { job: r.id as string, status: r.status as string, ms: Date.now() - t, ok: false, reason: reason(e) };
    }
  }));
  return { elapsed_ms: Date.now() - started, set: true, results };
}

/** The locate request for a plan (_shared/design/logoChoice.ts), with every stored path signed for the service to read. */
async function locateRequest(admin: any, plan: LocatePlan, a: { job: string; step: string; designPath: string; placement: LocateRequest["placement"] }): Promise<LocateRequest> {
  const common = { job: a.job, step: a.step, design: await signedRead(admin, BUCKET, a.designPath), placement: a.placement, scales: LOGO_SCALES };
  if (plan.shape === "one") return { ...common, logo: await signedRead(admin, BUCKET, plan.logo), background: plan.background };
  return {
    ...common,
    templates: await Promise.all(plan.templates.map(async (t) => ({ file: t.file, logo: await signedRead(admin, BUCKET, t.path), ground: t.ground, ...(t.fixed ? { fixed: true } : {}), ...(t.names ? { names: t.names } : {}) }))) as [LogoTemplate] | [LogoTemplate, LogoTemplate],
    compare: await Promise.all(plan.compare.map(async (c) => ({ file: c.file, logo: await signedRead(admin, BUCKET, c.path) }))),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

async function download(admin: any, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Could not read ${path}: ${error?.message ?? "missing"}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function upload(admin: any, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Could not store ${path}: ${error.message}`);
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(String(hex || "#000000").replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
