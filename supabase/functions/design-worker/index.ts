// supabase/functions/design-worker/index.ts
//
// Makes the designs that design-request plans, without Canva (Lital, 13 Oct:
// "drop canva"). The steps are in _shared/design/pipeline.ts: generate,
// locate, unlogo, marks, finish, verify. The image model only marks where the
// logo goes (17 Nov 2026): locate finds that slot, the model's drawing is
// cleaned out, and the client's logo file that shows on the ground under the
// slot is placed there (_shared/design/logoSlot.ts). The delivered picture is
// the model's first picture with the cleaned picture's slot where the
// logo was found and removed (_shared/design/firstPicture.ts). A carousel's slides agree on one file once each has passed
// its own checks, when one shows on every slide's ground (_shared/design/carouselLogo.ts). Each design is a row in canva_finish_jobs (the table
// keeps its old name); a video's footage and join stay with video-worker.
//
//   POST {action:"tick"}              one pass over the due jobs, then the next posts
//                                     of any week being designed (operational secret)
//   POST {action:"advance", job_id}   one job, in a request of its own (operational secret)
//   POST {action:"picture_check", count}  the finish call for the newest done designs, answered
//                                     at once with each call's time (operational secret)
//   POST {action:"tone_check", client_id, designs?, skip?}  the live logo set and the read of the
//                                     first posts of one client, asked as the lifecycle step asks
//                                     (each call worked to the service's time budget), or with
//                                     `designs` the live slot on its newest stored designs and the
//                                     file for each cleaned picture, one design after another, after
//                                     the first `skip` of them; writes nothing to a job or a client
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
import { answerText, roomFor } from "../_shared/anthropicReply.ts";
import { imageEdit } from "../_shared/media/imageEdit.ts";
import { openaiKey } from "../_shared/openai/key.ts";
import { claimJob, endOverdueRequests, endRequest, renewJobLease, saveJobProgress, settleRequest, BUCKET } from "../_shared/canva/jobs.ts";
import { MAX_PLAN_ATTEMPTS, NO_PROGRESS_MINUTES, REQUEST_MAX_MINUTES } from "../_shared/design/requestRules.ts";
import { type GenerateInput, designPrompt } from "../_shared/canva/brief.ts";
import { deliveredSize, pictureSize } from "../_shared/canva/finish.ts";
import { logoCheckPrompt, marksPrompt, parseLogoCheck, parseMarks, parseReading, postReadPrompt, readingFails, removePrompt } from "../_shared/design/pipeline.ts";
import { LOGO_SCALES } from "../_shared/design/logoMatch.ts";
import { STORY_SURFACE, storyTextBand } from "../_shared/design/story.ts";
import { NotEnded, callPicture, notePicture, pictureCheckCount, searchToEnd, signedRead, signedWrite } from "../_shared/picture/client.ts";
import { PICTURE_WORK_BUDGET_MS, type LogoTemplate, type Placement, type Rect, type SlotFileRequest, type SlotRequest } from "../_shared/picture/contract.ts";
import { heldWork } from "../_shared/canva/hold.ts";
import { DESIGN_LIMITS, MAX_DESIGN_ATTEMPTS, type StepResult, Stopped, advanceDesignJob } from "../_shared/design/advance.ts";
import { type GenerateDeps, MAX_GENERATIONS, OF_THE_DESIGN, runGenerate, runUnlogo, slideAllowance } from "../_shared/design/modelSteps.ts";
import { REASONS, type SlotPlan, type StampPlan, checkInput, slotPlan, slotSearch, slotState, stampFile, stampOutcome, stampPlan } from "../_shared/design/logoChoice.ts";
import { jobLogos, postSearchPlan } from "../_shared/design/logoTone.ts";
import { POSTS_PER_CALL, type Reading, askLogoSet, liveIo, readNextPosts } from "../_shared/design/logoSetWork.ts";
import { personOther } from "../_shared/lifecycle/designSettings.ts";
import { logoAreaRect } from "../_shared/picture/geometry.ts";
import { drawOrFallBack, dropStaleDesign } from "../_shared/design/sizeFallback.ts";
import { afterMark, afterSlot, askCleanedSlot, basePicture, composeRedesign, composedPath } from "../_shared/design/firstPictureJob.ts";
import { jobFolder, startAgain } from "../_shared/design/coverDesign.ts";
import { agreeOnLogo as agreeOnCarouselLogo, inCarousel, measuredAgain, slotFacts } from "../_shared/design/carouselLogo.ts";

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
 * Each check's answer, and room for the model to think first
 * (anthropicReply.ts, roomFor). The thinking counts against the limit: at
 * 300 to 600 tokens, answers came back cut off after a few characters
 * ("{\"marks") and good designs failed, and 2,000 in all still left a long
 * think no room.
 */
const CHECK_TOKENS = roomFor(2000);
/** Times a check is asked again when its answer comes back unreadable, before the step counts a try. */
const READ_TRIES = 3;
/**
 * The longest one check may wait for its answer, all its tries together. A
 * step asks up to three checks after a picture call, and the job is held
 * under MODEL_LEASE_MS meanwhile: three long thinks in a row must end inside
 * that lease, or the job would be claimed again while its first run lives.
 */
const CHECK_WAIT_MS = 100_000;
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
      const skip = Math.min(400, Math.max(0, Math.trunc(Number(body.skip) || 0)));
      return json(await toneCheck(admin, body.client_id, body.designs === undefined || body.designs === null ? null : pictureCheckCount(body.designs), skip));
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
  // QA 22 Nov 2026: video jobs are the video worker's, and are left out in the
  // query itself (P57-02: filtered after the limit, 40 waiting videos hid every
  // design job). The jobs worked least recently come first (P57-01): a job that
  // only waits (a carousel slide waiting for its cover) is due again every
  // minute, and oldest-first gave the same 12 waiting slides every slot, pass
  // after pass, while a newer request's job was never started. Claiming and
  // every step write updated_at, so this takes turns.
  const { data: rows } = await admin.from("canva_finish_jobs").select("id, step, status, attempts, lease_until, kind:input->>kind")
    .in("status", ["queued", "running"])
    .or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`)
    .or("input->>kind.is.null,input->>kind.neq.video")
    .order("updated_at").order("created_at").limit(40);
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

/**
 * Start one leased job's own request; if it cannot be started, the job is
 * released for the next pass. QA 22 Nov 2026 (P57-06): a hand-out that timed
 * out may still be running (the request reached the function, which answered
 * late), so its lease is left to run out instead: releasing it let the next
 * pass start the same step twice (a second paid image).
 */
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
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") return;
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
  await renewJobLease(admin, job, new Date(), MODEL_LEASE_MS);
}

// ── The steps ───────────────────────────────────────────────────────────────

async function runStep(admin: any, job: Job): Promise<StepResult> {
  const s = job.state ?? (job.state = {});
  // The folder of the job's files: its own for each cover design a carousel's slide is drawn from (_shared/design/coverDesign.ts).
  const base = jobFolder(job);
  // A job left at a step of the Canva method (before 13 Oct) goes on from the design it has.
  if (!STEPS.has(job.step)) job.step = s.design_path ? "unlogo" : "generate";
  // A design drawn for another page than the job now has (its option fell back to the 4:5 page while it was
  // being drawn, _shared/design/sizeFallback.ts) is drawn again, so every slide of an option ends in one size.
  if (job.step !== "generate" && dropStaleDesign(job.input, s)) job.step = "generate";

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
      // A carousel's slide after the cover that has made its own designs may use one its option's finished slides left
      // (_shared/design/modelSteps.ts, slideAllowance), or waits while a slide at work may still leave one.
      let more = false;
      if (job.slide_index && job.slide_index > 0 && (job.slide_count ?? 1) > 1 && job.input?.kind !== "video_card" && (s.generations ?? 0) >= MAX_GENERATIONS) {
        const { data: slides, error } = await admin.from("canva_finish_jobs").select("id, status, state")
          .eq("design_request_id", job.design_request_id).eq("option_index", job.option_index).gt("slide_index", 0);
        if (error) return "wait";
        const allowance = slideAllowance(job, slides ?? []);
        if (allowance === "wait") return "wait";
        more = allowance === "more";
      }
      // The design is counted once the image model has made it (_shared/design/modelSteps.ts).
      return runGenerate(generateDeps(admin, job), job, (work) => hold(admin, job, work), more);
    }
    case "locate": {
      await renewLease(admin, job);
      const g: GenerateInput = job.input.generate;
      // The slot: where the logo goes on this design (_shared/design/logoSlot.ts). The service searches for the
      // job's templates near the client's usual spot, in either tone. Where it finds the logo by the test a
      // design always had, the slot is where the model drew it; anywhere else it is the rectangle the canvas
      // carried. The model redraws the logo in the tone and weight its picture needs, so a drawing that is no
      // close match of the file is no reason to make the design again: nothing is sent back here.
      const plan = slotPlan({ logo_path: job.input.logo_path, generate: g, logos: job.input.logos });
      // The service works on one call for its time budget. A search that needs longer comes back with how far it got;
      // that is kept on the job, no try is spent, and the step runs again from there (logoChoice.ts, slotSearch).
      const { result: found, ms } = await slotSearch(admin, s, "slot", s.design_path, await slotRequest(admin, plan, { job: job.id, step: "locate", designPath: s.design_path, placement: job.input.placement }));
      notePicture(s, "slot", ms);
      if (!found) return "next";
      Object.assign(s, slotState(plan, found));
      // A design that already has its logo-free picture goes on to have its slot measured.
      job.step = s.nologo_path ? "marks" : "unlogo";
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
      // A design from before the locate step is located first.
      if (!s.logo_rect) { job.step = "locate"; return "next"; }
      await renewLease(admin, job);
      const g: GenerateInput = job.input.generate;
      // First the cleaned slot, with no model (_shared/design/logoSlot.ts): the drawing that was found is gone,
      // the ground under the slot is read from the picture's own pixels, and the first of the client's logo
      // files whose whole parts all show on it is the file finish stamps.
      const stamp = stampPlan({ logo_path: job.input.logo_path, generate: g, logos: job.input.logos, stamp: job.input.stamp }, s);
      // The first picture is the base (_shared/design/firstPictureJob.ts): in this same call the service composes it with the cleaned
      // picture's slot, where the logo was removed there, and reads the slot on the result, the search for a found drawing included.
      // `picture` is what every later step reads and finish stamps.
      const { result: slot, ms: slotMs } = await askCleanedSlot(s, base, async (compose) => {
        const request = await slotFileRequest(admin, stamp, { job: job.id, step: "marks", picturePath: s.nologo_path });
        if (compose) Object.assign(request, { first: await signedRead(admin, BUCKET, s.design_path), out: await signedWrite(admin, BUCKET, composedPath(base, s)) });
        // The look for the drawing at the slot is a search: worked to the service's time budget and carried on from what the job kept
        // of the call before (_shared/design/logoChoice.ts, slotSearch), with or without the first picture.
        return slotSearch(admin, s, "slot-file", s.nologo_path, request);
      });
      notePicture(s, "slot-file", slotMs);
      // The service's time was used before the search ended: nothing is decided about the slot or the composed picture yet, no try
      // is spent, and the step asks again from where the service got. The service stores a composed picture only with the call that ends the search.
      if (!slot) return "next";
      // A carousel's slide also keeps the facts of every listed file on this slot, and nothing of a measurement taken before this
      // one (_shared/design/carouselLogo.ts). A service from before it answered them leaves the slide with its own file, as always.
      const facts = inCarousel(job) ? slotFacts(slot) : null;
      if (inCarousel(job)) {
        measuredAgain(s);
        if (!facts) console.warn(`[design-worker] job ${job.id}: the picture service answered no facts of the logo files; this slide keeps its own file.`);
      }
      // A picture is never delivered re-rendered when a fresh one can be made (_shared/design/firstPictureJob.ts): the logo was removed
      // at the slot, the first picture could not take the cleaned pixels there (no clean join), and the option may still make another
      // design. A design the service answers "removal" for has nothing to compose and goes on from its cleaned picture, as before the rule.
      const refused = composeRedesign(s);
      if (refused) {
        console.warn(`[design-worker] job ${job.id}: ${refused}; designing again.`);
        await designAgain(admin, job, refused);
        return "next";
      }
      const picture = basePicture(s);
      const outcome = stampOutcome(stamp, slot, g.brand_name);
      // A check of the slot that fails (_shared/design/firstPictureJob.ts, afterSlot). On the last design the option may make, a
      // composed picture is dropped and this step runs again on the cleaned picture, which is judged as before the rule. In every
      // other case the check's own consequence follows, within the bounds a design always had: one more removal, or a new design
      // (after the last design there is none, and the option is over, as before).
      if (outcome.next !== "stamp" && afterSlot(s, outcome.reason) === "cleaned") return "next";
      if (outcome.next === "clean") {
        // The model's logo is still on the picture: taken out the way any other mark is, within the same bounds.
        console.warn(`[design-worker] job ${job.id}: ${outcome.reason}.`);
        return cleanAgain(admin, job, outcome.where, outcome.reason);
      }
      if (outcome.next === "again") {
        console.warn(`[design-worker] job ${job.id}: ${outcome.reason}; designing again.`);
        await designAgain(admin, job, outcome.reason);
        return "next";
      }
      Object.assign(s, outcome.state);
      if (facts) Object.assign(s, facts);
      // Then no logo left anywhere, the client's own or another brand's: read on the logo-free picture, at the page size.
      const page = pageOf(job);
      const marksPath = `${base}/marks-${s.generations}-${s.unlogos}${picture === s.nologo_path ? "" : "-first"}.jpg`;
      const { ms } = await callPicture(admin, "read", {
        job: job.id,
        step: "marks",
        picture: await signedRead(admin, BUCKET, picture),
        page,
        out: { page: await signedWrite(admin, BUCKET, marksPath) },
      });
      notePicture(s, "read", ms);
      const image = base64Encode((await download(admin, marksPath)) as unknown as ArrayBuffer);
      const seen = await readCheck((wait) => askAbout("image/jpeg", image, marksPrompt(g.brand_name), wait), parseMarks, "The picture's logos and brand marks");
      s.marks_check = seen;
      if (!seen.marks) {
        delete s.marks_where;
        job.step = "finish";
        return "next";
      }
      const where = seen.where || "every logo and brand mark, also on clothing, shoes, balls and equipment";
      // A mark on the composed picture is the model's own drawing: the design is made again, never cleaned further. On the last
      // design, and for a mark on a cleaned picture, it goes the way it always did (_shared/design/firstPictureJob.ts, afterMark).
      const marked = afterMark(s, where);
      if (marked.next === "cleaned") return "next";
      if (marked.next === "again") {
        console.warn(`[design-worker] job ${job.id}: the model drew a mark (${where}); designing again.`);
        await designAgain(admin, job, marked.reason);
        return "next";
      }
      console.warn(`[design-worker] job ${job.id}: marks left on the picture (${where}).`);
      return cleanAgain(admin, job, where, marked.reason);
    }
    case "finish": {
      // A design from before the locate step is located first.
      if (!s.logo_rect) { job.step = "locate"; return "next"; }
      await renewLease(admin, job);
      // The logo file in the slot, in the room the design left for it, then
      // the picture at its delivered size. The model's own drawing is gone
      // (unlogo), and the file is the one that shows on the ground there (marks).
      // The file chosen for the ground under the slot, or the job's own logo for a job moved on before that choice existed.
      s.final_path = await stampLogo(admin, job, base, stampFile(job.input, s), s.logo_rect);
      job.step = "verify";
      return "next";
    }
    case "verify": {
      // A carousel's slide whose checks have passed has only the carousel's logo file left to agree on (_shared/design/carouselLogo.ts).
      if (inCarousel(job) && s.checks_passed) return agreeOnLogo(admin, job, base);
      await renewLease(admin, job);
      // Read at the page size as a JPEG: well under the model's image limit, and every letter legible.
      // The Story's band (a crop of that page) and the area around the logo (at full size) come from the same call.
      const page = pageOf(job);
      const g: GenerateInput = job.input.generate;
      const [ow, oh] = deliveredOf(job);
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
      // The post's own words and the lettering on objects in its picture are read apart (_shared/design/pipeline.ts, postReadPrompt).
      const reading = await readCheck((wait) => askAbout("image/jpeg", jpeg, postReadPrompt(g.brand_name), wait), parseReading, "The words on the design");
      const lines = reading.lines;
      s.read = lines;
      s.read_scene = reading.scene;
      const wrong = readingFails(reading, job.input.copy);
      if (wrong) {
        // Wrong words are never fixed by hand: the design is made again.
        console.warn(`[design-worker] job ${job.id}: read ${JSON.stringify(lines)} and on objects ${JSON.stringify(reading.scene)}, wanted ${JSON.stringify(job.input.copy)}`);
        await designAgain(admin, job, wrong === "words" ? REASONS.words(lines) : REASONS.scene(reading.scene));
        return "next";
      }
      // A Story's words all sit in Meta's band (_shared/design/story.ts): the band alone is read, and holds the whole copy.
      if (band) {
        const crop = base64Encode((await download(admin, `${stem}-band.jpg`)) as unknown as ArrayBuffer);
        const inBand = await readCheck((wait) => askAbout("image/jpeg", crop, postReadPrompt(g.brand_name), wait), parseReading, "The words in the Story's band");
        s.band_read = inBand.lines;
        const bandWrong = readingFails(inBand, job.input.copy);
        if (bandWrong) {
          console.warn(`[design-worker] job ${job.id}: the Story's band read ${JSON.stringify(s.band_read)}, wanted ${JSON.stringify(job.input.copy)}`);
          await designAgain(admin, job, bandWrong === "scene" ? REASONS.scene(inBand.scene) : REASONS.band(s.band_read));
          return "next";
        }
      }
      // Nothing may touch or cross the logo, seen at full size around its known place.
      if (area) {
        const crop = base64Encode((await download(admin, `${stem}-area.png`)) as unknown as ArrayBuffer);
        const seen = await readCheck((wait) => askAbout("image/png", crop, logoCheckPrompt(g.brand_name), wait), parseLogoCheck, "The area around the logo");
        s.logo_check = seen;
        if (!seen.clear) {
          console.warn(`[design-worker] job ${job.id}: the logo is touched by ${seen.touching}; designing again.`);
          await designAgain(admin, job, REASONS.touched(seen.touching));
          return "next";
        }
      }
      // A carousel's slide is not done yet: its checks have passed with its own file, which is saved, and the step runs once more for the agreement.
      if (inCarousel(job)) {
        s.checks_passed = s.final_path;
        return "next";
      }
      return "done";
    }
  }
  throw new Error(`FINAL: Unknown step '${job.step}'`);
}

/**
 * The logo file stamped on the job's picture at a rectangle, and the picture
 * stored at its delivered size: the finish step's one call to the picture
 * service, with no model. Answers where the finished file is; the job's
 * state is the caller's to change.
 */
async function stampLogo(admin: any, job: Job, base: string, logoPath: string, rect: Rect): Promise<string> {
  const s = job.state;
  const [ow, oh] = deliveredOf(job);
  // Each finished file has a name of its own, so a design made again is never shown from a cached copy.
  const path = `${base}/final-${Date.now().toString(36)}.png`;
  const { ms } = await callPicture(admin, "finish", {
    job: job.id,
    step: "finish",
    // The picture the marks step judged: the first picture with the cleaned slot, or the cleaned picture.
    picture: await signedRead(admin, BUCKET, basePicture(s)),
    logo: await signedRead(admin, BUCKET, logoPath),
    rect,
    frame: s.logo_frame,
    output: { width: ow, height: oh },
    out: await signedWrite(admin, BUCKET, path),
  });
  notePicture(s, "finish", ms);
  return path;
}

/**
 * A carousel's slide after its own checks have passed: what is left is where the carousel's logo sits and which file it is
 * (_shared/design/carouselLogo.ts, agreeOnLogo, which decides everything). The worker gives it the two reads of the option's
 * rows, the save, and the three picture calls. Nothing here makes a design again, stops a job or spends a try.
 */
function agreeOnLogo(admin: any, job: Job, base: string): Promise<StepResult> {
  const input = { logo_path: job.input.logo_path, generate: job.input.generate, logos: job.input.logos, stamp: job.input.stamp };
  return agreeOnCarouselLogo(job, () => stampPlan(input, job.state).files, {
    // The cleaned slot read at another rectangle, on the picture every later step reads and finish stamps (the picture without a
    // logo). The rectangle is one the canvas carried, in the canvas file's shape, so no drawing is looked for there and nothing is
    // composed: the call has no search and ends in one go.
    measure: (slot) => (async () => {
      await renewLease(admin, job);
      const plan = stampPlan(input, { ...job.state, logo_matched: undefined, logo_slot: { rect: slot, from: "canvas", of: slotPlan(input).templates[0].file } });
      const { result, ms } = await callPicture(admin, "slot-file", await slotFileRequest(admin, plan, { job: job.id, step: "verify", picturePath: basePicture(job.state) }));
      notePicture(job.state, "slot-file", ms);
      return result;
    })().catch((e) => { throw keepsOwn(job, e); }),
    siblings: async () => {
      const { data } = await admin.from("canva_finish_jobs").select("status, step, state")
        .eq("design_request_id", job.design_request_id).eq("option_index", job.option_index).gt("slide_index", 0);
      return data ?? null;
    },
    cover: async () => {
      const { data, error } = await admin.from("canva_finish_jobs").select("status, state")
        .eq("design_request_id", job.design_request_id).eq("option_index", job.option_index).eq("slide_index", 0).maybeSingle();
      return error ? "unread" : data ?? null;
    },
    save: () => saveJobProgress(admin, job),
    // A second stamp or look that fails leaves the slide with the finished picture it has (agreeOnLogo, settlePlace); the reason is logged here.
    stamp: (logoPath, rect) => (async () => {
      await renewLease(admin, job);
      return stampLogo(admin, job, base, logoPath, rect);
    })().catch((e) => { throw keepsOwn(job, e); }),
    clearAt: (finalPath, rect) => logoClearAt(admin, job, base, finalPath, rect).catch((e) => { throw keepsOwn(job, e); }),
  });
}

/** Logs why a carousel's slide could not take the carousel's logo file or place, and hands the error back. */
function keepsOwn(job: Job, e: unknown): unknown {
  console.warn(`[design-worker] job ${job.id}: the carousel's logo could not be placed (${e instanceof Error ? e.message : e}); this slide keeps its own.`);
  return e;
}

/**
 * Whether nothing touches or crosses the logo on a finished file, seen at full size around `rect`: the verify step's own look
 * at the logo's area, for a slide stamped again at another rectangle than the one its checks saw (the carousel's rectangle, or
 * the rectangle of a file of another shape).
 */
async function logoClearAt(admin: any, job: Job, base: string, finalPath: string, rect: Rect): Promise<boolean> {
  const s = job.state;
  const g: GenerateInput = job.input.generate;
  const [ow, oh] = deliveredOf(job);
  const stem = `${base}/verify-${Date.now().toString(36)}`;
  const { ms } = await callPicture(admin, "read", {
    job: job.id,
    step: "verify",
    picture: await signedRead(admin, BUCKET, finalPath),
    page: pageOf(job),
    area: logoAreaRect(rect, s.logo_frame, { width: ow, height: oh }),
    out: { page: await signedWrite(admin, BUCKET, `${stem}.jpg`), area: await signedWrite(admin, BUCKET, `${stem}-area.png`) },
  });
  notePicture(s, "read", ms);
  const crop = base64Encode((await download(admin, `${stem}-area.png`)) as unknown as ArrayBuffer);
  const seen = await readCheck((wait) => askAbout("image/png", crop, logoCheckPrompt(g.brand_name), wait), parseLogoCheck, "The area around the logo");
  if (!seen.clear) console.warn(`[design-worker] job ${job.id}: the carousel's logo would be touched by ${seen.touching}; this slide keeps its own.`);
  return seen.clear;
}

/**
 * A logo or a brand mark is still on the logo-free picture: it is named in
 * the next removal, MAX_MARK_CLEANS times at most for one design, and then
 * the design is made again with the reason. One path and one count for
 * another brand's marks, the client's own logo drawn somewhere else, and
 * the drawing at the slot still found after cleaning.
 */
async function cleanAgain(admin: any, job: Job, where: string, reason: string): Promise<StepResult> {
  const s = job.state;
  s.mark_cleans = (s.mark_cleans ?? 0) + 1;
  if (s.mark_cleans <= MAX_MARK_CLEANS) {
    s.marks_where = where;
    job.step = "unlogo";
    return "next";
  }
  await designAgain(admin, job, reason);
  return "next";
}

/**
 * Send a design back to be made again. A carousel cover made again takes its
 * other slides with it, so every slide follows the cover the client sees.
 * The reason says what it is made again for (_shared/design/logoChoice.ts, REASONS).
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
    // Each other slide's row is started again for the cover's next design (_shared/design/coverDesign.ts). A run that still holds
    // one of them, its image call in flight, read the row before this: none of its writes lands from here on, so its design in
    // the old cover's look is saved to no row, and the row runs on from here.
    for (const slide of slides ?? []) {
      await admin.from("canva_finish_jobs").update(startAgain(slide.state, new Date().toISOString())).eq("id", slide.id);
    }
  }
}

function pageOf(job: Job): { width: number; height: number } {
  return job.input?.generate?.size ?? DEFAULT_PAGE;
}

/** The size a design is delivered at: 1440 wide, or its platform's own width when that is larger, in the shape of the platform's row when the job carries one, else of the page (canva/finish.ts, deliveredSize). */
function deliveredOf(job: Job): [number, number] {
  const page = pageOf(job);
  return deliveredSize([page.width, page.height], job.input?.generate?.deliver);
}

/**
 * The generate step's services (_shared/design/modelSteps.ts). The image
 * model designs the post: the client's background color with its logo file
 * at the habitual spot (a mask shaped like the logo keeps it), the client's
 * own posts as references, and the brief (brief.ts), at twice the page's size.
 */
function generateDeps(admin: any, job: Job): GenerateDeps {
  // The page, the placement and the brief are read from the job when each is used: a job whose size the image
  // model refuses is made as before in the middle of this step (_shared/design/sizeFallback.ts).
  //
  // The service draws the canvas (the background color with the logo at its
  // spot) and OpenAI's mask: transparent pixels are redrawn, opaque ones are
  // kept. Only the logo's own ink is opaque, so no box appears behind it.
  // Both are at the page's size; the model draws at twice it. (2x canvases
  // and masks, three designs at once, ran the worker out of memory on 13 Oct.)
  const canvas = async (canvasPath: string, maskPath: string) => {
    const g: GenerateInput = job.input.generate;
    const page = pageOf(job);
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
  };
  const drawOnce = async (canvasPath: string, maskPath: string) => {
    const g: GenerateInput = job.input.generate;
    const page = pageOf(job);
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
  };
  return {
    canvas,
    // A lead job whose size the image model refuses is made as before, once, and its option with it; what the
    // model did with the size is kept for the weekly refresh. Neither spends a try.
    draw: (canvasPath, maskPath) => drawOrFallBack({
      job,
      canvas: () => canvas(canvasPath, maskPath),
      draw: () => drawOnce(canvasPath, maskPath),
      asked: () => { const page = pageOf(job); return pictureSize([page.width, page.height]).join("x"); },
      fallBack: async (reason) => {
        const { error } = await admin.rpc("design_size_refused", { p_job: job.id, p_reason: reason.slice(0, 500) });
        if (error) throw new Error(`Could not make the design as before: ${error.message}`);
        console.warn(`[design-worker] job ${job.id}: the image model refused its size (${reason.slice(0, 120)}); made as before.`);
      },
      note: async (o) => {
        const { error } = await admin.rpc("note_platform_size_outcome", { p_platform: o.platform, p_format: o.format, p_width: o.width, p_height: o.height, p_outcome: o.outcome, p_reason: o.reason?.slice(0, 500) ?? null });
        if (error) console.warn(`[design-worker] job ${job.id}: could not note the size's outcome:`, error.message);
      },
    }),
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
      const [ow, oh] = deliveredOf(r as Job);
      const { ms } = await callPicture(admin, "finish", {
        job: r.id,
        step: "picture_check",
        picture: await signedRead(admin, BUCKET, basePicture(r.state)),
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

/** How long tone_check keeps asking before it reports what it has: inside the edge request's own wall time. */
const TONE_CHECK_MS = 100_000;

/**
 * The deployed picture service tried on one client's logo set, with nothing
 * written to a job or a client (the release's proof with no spend, spec
 * 2026-11-16-logo-tone-design.md, section 10).
 *
 * Without `designs`: the live logo-set call for the client's stored logo
 * (its two copies go under picture-check/tone/, so no product file changes)
 * and the read of the first posts the lifecycle step would ask for, asked
 * the way the step asks (readNextPosts, each call worked to the service's
 * time budget and carried on from the one before) until every one is read:
 * the number of calls it took, the longest of them (`ms`), their sum
 * (`total_ms`), and each post's result. The longest call is the proof of
 * the budget: it stays near PICTURE_WORK_BUDGET_MS however slow the
 * client's logo is to search for. `ended` is false when the read had not
 * ended when the check stopped asking.
 *
 * With `designs`: the live slot on the client's newest ended still
 * designs, each asked the way a job started from the client's set as it is
 * now would ask (the job's own placement) and carried on until it ends, as
 * the locate step does: whether the slot is where the model drew the logo
 * or where the canvas carried it, the matched file, each score, the number
 * of calls it took, the longest of them (`ms`) and their sum (`total_ms`);
 * and for a job that has its logo-free picture, the ground under the slot
 * and the file that would be stamped there, asked the same way. The designs
 * are asked one after another, so each call's time is the service's own and
 * not that of several searches sharing its one core, and the check stops
 * asking when its time is up: `next_skip` is then the `skip` to send to
 * carry on with the designs it did not finish, and null when it finished
 * them all. A client with no current set answers that and calls
 * nothing.
 */
async function toneCheck(admin: any, clientId: string, designs: number | null, skip = 0): Promise<Record<string, unknown>> {
  const started = Date.now();
  const timeUp = () => Date.now() - started > TONE_CHECK_MS;
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
      const posts: string[] = [...new Set<string>((Array.isArray(row.reference_paths) ? row.reference_paths : []).filter((p: unknown): p is string => typeof p === "string"))].slice(0, POSTS_PER_CALL);
      // The step's own bookkeeping, kept here in place of the step's result: what each post gave, and the post the service stopped in.
      // Every look settles a post or counts against the one it stopped in (readNextPosts), so the loop ends by itself; the time limit keeps it inside this request.
      const shown = new Map<string, unknown>();
      let reading: Reading | null = null;
      let calls = 0, longest = 0, total = 0;
      for (;;) {
        const unread = posts.filter((p) => !shown.has(p));
        if (!unread.length || timeUp()) break;
        const looked = await readNextPosts(io, { clientId, unread, placement: row.placement, plan, reading });
        for (const { post, logo } of looked.read) shown.set(post, logo);
        reading = looked.reading;
        // A look with no post left in storage made no call.
        if (looked.ms) {
          calls++;
          total += looked.ms;
          longest = Math.max(longest, looked.ms);
        }
      }
      return {
        elapsed_ms: Date.now() - started, ok: true,
        logo_set: { ms: set.ms, facts: set.facts },
        post_logos: {
          ms: longest, total_ms: total, calls, budget_ms: PICTURE_WORK_BUDGET_MS, asked: posts.length, read: shown.size, ended: shown.size === posts.length,
          posts: posts.filter((p) => shown.has(p)).map((path) => ({ path, result: shown.get(path) ?? null })),
        },
      };
    } catch (e) {
      return { elapsed_ms: Date.now() - started, ok: false, reason: reason(e) };
    }
  }

  if (!jobLogos(row)) return { elapsed_ms: Date.now() - started, set: false };
  const { data: rows, error: jobsError } = await admin.from("canva_finish_jobs").select("id, input, state, status")
    .eq("client_id", clientId).in("status", ["done", "failed", "canceled"])
    .not("state->>design_path", "is", null)
    .order("created_at", { ascending: false }).limit((skip + designs) * 3);
  if (jobsError) throw new Error(`Could not read the client's designs: ${jobsError.message}`);
  // Video jobs are left out, as in picture_check.
  const jobs = (rows ?? []).filter((r: any) => r.input?.kind !== "video" && r.input?.placement && r.state?.design_path).slice(skip, skip + designs);
  const results: Record<string, unknown>[] = [];
  // How many designs have their answer: the next check carries on after them.
  let finished = 0;
  for (const r of jobs) {
    if (timeUp()) break;
    const t = Date.now();
    try {
      const input = checkInput(row, r)!;
      const plan = slotPlan(input);
      // Asked until the search ends, each call carrying on from the one before, as the locate step does (client.ts, searchToEnd). Nothing is kept on the job.
      const slot = await searchToEnd(admin, "slot", () => slotRequest(admin, plan, { job: r.id, step: "tone_check", designPath: r.state.design_path, placement: r.input.placement }), {}, timeUp);
      const found = slot.result;
      const out: Record<string, unknown> = {
        job: r.id as string, status: r.status as string, ms: slot.ms, total_ms: slot.total, calls: slot.calls, ok: true,
        slot: found.from, of: found.of, rect: found.slot, score: Math.round(found.score * 1000) / 1000,
        matched: found.matched, scores: found.scores.map((v) => Math.round(v * 1000) / 1000),
      };
      // The job's own logo-free picture, when it got that far: the ground under the slot and the file that would be stamped.
      if (r.state.nologo_path) {
        const stamp = stampPlan(input, slotState(plan, found) as unknown as Parameters<typeof stampPlan>[1]);
        const file = await searchToEnd(admin, "slot-file", () => slotFileRequest(admin, stamp, { job: r.id, step: "tone_check", picturePath: r.state.nologo_path }), {}, timeUp);
        Object.assign(out, { file_ms: file.ms, file_total_ms: file.total, file_calls: file.calls, ground: file.result.ground, flat: Math.round(file.result.flat * 1000) / 1000, file: file.result.file, shows: file.result.shows, still_drawn: file.result.drawn ?? null });
      }
      results.push(out);
    } catch (e) {
      results.push({ job: r.id as string, status: r.status as string, ms: Date.now() - t, ok: false, reason: reason(e) });
      // The check's own time was up in the middle of this design: it has no answer yet, so the next check starts with it.
      if (e instanceof NotEnded) break;
    }
    finished++;
  }
  return { elapsed_ms: Date.now() - started, set: true, budget_ms: PICTURE_WORK_BUDGET_MS, skip, asked: jobs.length, next_skip: finished < jobs.length ? skip + finished : null, results };
}

/** The slot request for a plan (_shared/design/logoChoice.ts), with every stored path signed for the service to read. */
async function slotRequest(admin: any, plan: SlotPlan, a: { job: string; step: string; designPath: string; placement: Placement }): Promise<SlotRequest> {
  return {
    job: a.job, step: a.step, design: await signedRead(admin, BUCKET, a.designPath), placement: a.placement, scales: LOGO_SCALES,
    templates: await Promise.all(plan.templates.map(async (t) => ({ file: t.file, logo: await signedRead(admin, BUCKET, t.path), ground: t.ground }))) as [LogoTemplate] | [LogoTemplate, LogoTemplate],
  };
}

/** The cleaned-slot request for a plan, with every stored path signed. */
async function slotFileRequest(admin: any, plan: StampPlan, a: { job: string; step: string; picturePath: string }): Promise<SlotFileRequest> {
  return {
    job: a.job, step: a.step, picture: await signedRead(admin, BUCKET, a.picturePath), rect: plan.rect, frame: plan.frame, of: plan.of,
    files: await Promise.all(plan.files.map(async (f) => ({ file: f.file, logo: await signedRead(admin, BUCKET, f.path), ...(f.last ? { last: true } : {}) }))),
    ...(plan.drawn ? { drawn: plan.drawn } : {}),
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** One image and one question to the reading model, waited for at most `waitMs`; its answer as text ("" for an answer that was cut off, declined or too long in coming, which readCheck asks again). */
async function askAbout(mediaType: "image/jpeg" | "image/png", data: string, question: string, waitMs: number): Promise<string> {
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
    waitMs,
  });
  return answerText(result);
}

/**
 * A check's answer, asked again when it comes back unreadable (cut short, or
 * not in the form asked for): an unreadable answer says nothing about the
 * design, so it never costs the design a try (13 Oct: four designs ended on
 * "The area around the logo could not be read").
 */
async function readCheck<T>(ask: (waitMs: number) => Promise<string>, parse: (text: string) => T | null, what: string): Promise<T> {
  // The tries share the check's wait: each has what the ones before it left.
  const until = Date.now() + CHECK_WAIT_MS;
  let last = "";
  for (let i = 0; i < READ_TRIES; i++) {
    const left = until - Date.now();
    if (left <= 0) break;
    last = await ask(left);
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
