// supabase/functions/design-request/index.ts
//
// Design options for a calendar post, for staff and for the client's own
// users.
//
//   POST {action:"create", client_id, report_id, calendar_post_key, platform, format, post_copy, note?}
//        Plans the options from the post and the client's own posts, then
//        starts them. A second call while the post's designs are being
//        prepared returns the open request. A note left on Regenerate is
//        followed by every option, and teaches the brand's design memory
//        only when it is lasting (note.ts).
//   POST {action:"story", client_id, calendar_post_key}
//        "Add a Story" on a Facebook or Instagram post: one Story post linked
//        to it, designed like the post's own design once the brand's designs
//        are set up (story.ts).
//   POST {action:"close_filming"}   (operational secret, as the system) filming
//        requests closed when their footage arrived or cannot come in time; a
//        shot brief that was not written is written again, a few times at most
//   POST {action:"week_preview"|"week_start"|"week_stop"|"week_continue", ...}
//        The week's design button: a whole week's posts designed on request,
//        never automatically (week.ts).
//   POST {action:"feedback", iteration_id, verdict:"rejected"|"deleted", reason?, note?, make_new?}
//        Turns a design down (its reason becomes a rule for the client's next
//        designs, and a new design is started with the note) or deletes it.
//   POST {action:"undo_note", request_id}
//        Takes back what a request's note taught the design memory (note.ts).
//   POST {action:"use", iteration_id}
//        Puts one finished design in use for its post; every other design of
//        that post stops being in use.
//
// A strategy-only client (no active account in Sprout) gets no designs or
// videos: the actions that start one answer "not_set_up", waiting for its
// social accounts (closed.ts).
//
// Clients cannot write post_iterations directly (staff-only RLS), so using a
// design goes through here with the service role after a membership check.

import { createClient } from "../_shared/supabase.ts";
import { AuthzError, requireStaff, requireStaffOrSystem } from "../_shared/auth/requireStaff.ts";
import { requireMember } from "../_shared/auth/requireMember.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";
import { answerText, replySample, roomFor } from "../_shared/anthropicReply.ts";
import { BRIEFS_PLANNED, CAROUSEL_SLIDES, OPTIONS_WANTED, type RecentDesign, carouselPlannerPrompt, filmedNeed, parseBriefs, parseShotBrief, shotBriefPrompt, parseCarouselBriefs, parseVideoBriefs, plannerPrompt, recentLines, videoPlannerPrompt, withRefs } from "../_shared/canva/options.ts";
import { type DesignRequest, type Settings, endRequest, startOption } from "../_shared/canva/jobs.ts";
import { canFilm, filmingOutcome, postInstant } from "../_shared/design/requestRules.ts";
import { currentCopyOf, designKind, type PassStart } from "../_shared/design/weekRules.ts";
import { isStoryPost } from "../_shared/design/story.ts";
import { plannerShape } from "../_shared/design/platformSize.ts";
import { readUploadSize } from "../_shared/design/platformSizeDb.ts";
import { wakeWorker, wakeVideoWorker } from "../_shared/canva/worker.ts";
import { DESIGN_ANGLE } from "../_shared/canva/jobs.ts";
import { learnFromNote, learningLines, recordFeedback } from "../_shared/design-prompts/feedback.ts";
import { loadDesignLearnings } from "../_shared/design-prompts/learnings.ts";
import { discoverVideoReferences } from "../_shared/brand-references/videos.ts";
import { creditBalance } from "../_shared/higgsfield/generate.ts";
import { McpClient } from "../_shared/higgsfield/mcp.ts";
import { MCP_URL, accessTokenFor } from "../_shared/higgsfield/oauth.ts";
import { needsClipPrice, quoteClip } from "../_shared/video/clip.ts";
import { readVideoSize } from "../_shared/video/videoSizeDb.ts";
import { videoFrameOf, type VideoUploadSize } from "../_shared/video/videoSize.ts";
import { type WeekDeps, weekContinue, weekPreview, weekStart, weekStop } from "./week.ts";
import { designStory } from "./story.ts";
import { plannerLibrary } from "./library.ts";
import { postTimeOf } from "./postTime.ts";
import { type CreateDeps, createDesign } from "./create.ts";
import { cancelRequest } from "./cancel.ts";
import { closedForStrategyOnly } from "./closed.ts";
import { footageFor } from "./footage.ts";
import { shotBriefFor } from "./shotBrief.ts";
import { designFeedback } from "./feedback.ts";
import { putDesignInUse } from "./use.ts";
import { type NoteDeps, type NoteLearned, learnDesignNote, noteLearnedOf, undoDesignNote } from "./note.ts";
import { cleanNote } from "../_shared/notes/regenerateNote.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-socialytics-secret, x-socialytics-user",
};
const PLANNER_MODEL = "claude-opus-5-5";
/** Most of the client's posts the planner is shown. */
const MAX_LIBRARY = 16;
/** How many of the client's recent designs the planner is told about. */
const RECENT_DESIGNS = 10;

const service = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = service();
  try {
    const body = await req.json().catch(() => ({}));

    // Nothing is started for a strategy-only client (closed.ts).
    const closed = await closedForStrategyOnly({ db: admin, requireMember: (clientId) => requireMember(req, clientId) }, body);
    if (closed) return json(closed.body, closed.status ?? 200);

    if (body?.action === "create") {
      const answer = await createDesign(createDeps(admin, req), body);
      return json(answer.body, answer.status ?? 200);
    }

    // "Add a Story": whoever can work on the client's posts, as create (story.ts).
    if (body?.action === "story") {
      const answer = await designStory({
        db: admin,
        requireMember: (clientId) => requireMember(req, clientId),
        startRequest: (settings, p) => startRequest(admin, settings as Settings, p),
      }, body);
      return json(answer.body, answer.status ?? 200);
    }

    // Stop a design being prepared: whoever could start it can stop it. The
    // request and its unfinished jobs are cancelled, so the workers spend
    // nothing more on it; the post keeps the design it already had, and the
    // week's design button counts the post again next time it is pressed.
    if (body?.action === "cancel") {
      const answer = await cancelRequest({ db: admin, requireMember: (clientId) => requireMember(req, clientId), now: () => new Date() }, body);
      return json(answer.body, answer.status ?? 200);
    }

    // A filmed clip for a video post with a real person on camera: the clip
    // is the footage, and the post's hook and the client's logo file go over
    // it, keeping its sound. Anyone who can work on the client's posts.
    if (body?.action === "footage") {
      const answer = await footageFor({
        db: admin,
        requireMember: (clientId) => requireMember(req, clientId),
        clipExists: (path) => footageClipExists(admin, path),
        start: (settings, p) => startRequest(admin, settings as Settings, p as Parameters<typeof startRequest>[2]),
      }, body);
      return json(answer.body, answer.status ?? 200);
    }

    // The shot brief for a filmed video post, written (again) on request. Moburst staff only.
    if (body?.action === "shot_brief") {
      const answer = await shotBriefFor({
        db: admin,
        requireStaff: (clientId) => requireStaff(req, clientId ? { writeClientId: clientId } : {}),
        write: (requestId) => writeShotBrief(admin, requestId),
      }, body);
      return json(answer.body, answer.status ?? 200);
    }

    // A request planned again: a video that waited for the client's video
    // style (the video worker), or a request whose planning stopped (the
    // design worker). Only the project's own calls, as the system.
    if (body?.action === "replan") {
      const caller = await requireStaffOrSystem(req);
      if (!caller.viaSecret) return json({ error: "Not allowed." }, 403);
      const { data: request } = await admin.from("design_requests").select("*").eq("id", String(body.request_id || "")).maybeSingle();
      // Only a request still planning: one past planning already has its options.
      if (!request || request.status !== "preparing" || request.stage !== "planning") return json({ skipped: true });
      const { data: settings } = await admin.from("design_brand_settings").select("*").eq("client_id", request.client_id).maybeSingle();
      if (!settings) {
        await endRequest(admin, request.id, "no_progress", "The client's design settings are gone.");
        return json({ skipped: true });
      }
      const work = plan(admin, request as DesignRequest, settings as Settings).catch((e) => planStopped(admin, request.id, e));
      // deno-lint-ignore no-explicit-any
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(work); else await work;
      return json({ planning: true });
    }

    // The client's own published videos, kept so its video posts follow its
    // own video style. Staff or the project's own calls.
    if (body?.action === "video_references") {
      await requireStaff(req);
      const clientId = String(body.client_id || "");
      const { data: client } = await admin.from("clients").select("id, name, sprout_customer_id").eq("id", clientId).maybeSingle();
      if (!client) return json({ error: "No such client." }, 404);
      const found = await discoverVideoReferences(admin, client);
      if (found.refs.length) {
        await admin.from("clients").update({ video_references: found.refs, video_style: null }).eq("id", clientId);
        await ensureStyleJob(admin, clientId, client.name ?? "the brand");
      }
      return json(found);
    }

    // Filming requests whose footage arrived or cannot come in time are
    // closed. Nothing is designed here: designs are made on request only
    // (2 Nov). Run by the schedule every 10 minutes, as the system.
    if (body?.action === "close_filming") {
      const caller = await requireStaffOrSystem(req);
      if (!caller.system) return json({ error: "Not allowed." }, 403);
      return json({ filming_closed: await closeFilming(admin, new Date()) });
    }

    // The week's design button (week.ts): staff preview, press and stop it.
    const weekAction = { week_preview: weekPreview, week_start: weekStart, week_stop: weekStop }[String(body?.action)];
    if (weekAction) {
      const answer = await weekAction(weekDeps(admin, req), body);
      return json(answer.body, answer.status ?? 200);
    }

    // The design worker's minute pass, as the system: the next posts of every
    // running week start. Answered at once; the starts go on in the background.
    if (body?.action === "week_continue") {
      const deps = weekDeps(admin, req);
      if (!(await deps.isSystem())) return json({ error: "Not allowed." }, 403);
      background(weekContinue(deps));
      return json({ continuing: true }, 202);
    }

    // Turn a design down (with a reason the client's next designs learn from)
    // or delete it. Turning down the post's current design starts a new one.
    if (body?.action === "feedback") {
      const answer = await designFeedback({
        db: admin,
        requireMember: (clientId) => requireMember(req, clientId),
        record: (it, verdict, reason, note, userId) => recordFeedback(admin, it as never, verdict, reason, note, userId),
        start: (settings, p) => startRequest(admin, settings as Settings, p as Parameters<typeof startRequest>[2]),
      }, body);
      return json(answer.body, answer.status ?? 200);
    }

    // Take back what a note taught the brand's design memory (note.ts).
    if (body?.action === "undo_note") {
      const answer = await undoDesignNote(noteDeps(admin, req), body);
      return json(answer.body, answer.status ?? 200);
    }

    if (body?.action === "use") {
      const answer = await putDesignInUse({ db: admin, requireMember: (clientId) => requireMember(req, clientId) }, body);
      return json(answer.body, answer.status ?? 200);
    }

    return json({ error: `Unknown action '${body?.action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[design-request]", msg);
    return json({ error: msg }, 500);
  }
});

/** How long a request waits for another of the same client's requests to finish planning. */
const PLAN_WAIT_MS = 150_000;

/**
 * Plan the options from the post and the client's own posts, then start the
 * first ones. One request per client plans at a time: each plan is told what
 * the client's recent designs were built on, and two planned side by side
 * could not see each other's choices and picked the same posts (13 Oct).
 */
async function plan(admin: any, request: DesignRequest, settings: Settings): Promise<void> {
  const lease = `plan:${request.client_id}`;
  const holder = crypto.randomUUID();
  const until = Date.now() + PLAN_WAIT_MS;
  for (;;) {
    const { data: got } = await admin.rpc("claim_worker_lease", { p_name: lease, p_holder: holder, p_seconds: 120 });
    if (got) break;
    if (Date.now() > until) break; // plan anyway rather than never
    await new Promise((r) => setTimeout(r, 3000));
  }
  try {
    await planNow(admin, request, settings);
  } finally {
    await admin.rpc("release_worker_lease", { p_name: lease, p_holder: holder });
  }
}

async function planNow(admin: any, request: DesignRequest, settings: Settings): Promise<void> {
  const { data: client } = await admin.from("clients").select("name, brand_identity, video_references, video_style, harvested_design_references").eq("id", request.client_id).maybeSingle();
  // A video is planned from the client's own videos (14 Oct: "make videos in a
  // similar style to their VIDEOS, not statics"). Until their style has been
  // read, the request waits; the video worker plans it when the style is in.
  // A video whose post can no longer wait for footage is made from the client's posts (12 Nov 2026).
  if (request.kind === "video" && !request.footage_path && request.video_route !== "posts"
    && !canFilm(await postTimeOf(admin, request.client_id, request.calendar_post_key), new Date())) {
    await admin.from("design_requests").update({ video_route: "posts", updated_at: new Date().toISOString() }).eq("id", request.id);
    request.video_route = "posts";
  }
  // A video chosen to follow the client's posts is planned from the posts, like a design.
  const generatedVideo = request.kind === "video" && !request.footage_path && request.video_route !== "posts";
  const videoStyle = generatedVideo && Array.isArray(client?.video_style?.frames) && client.video_style.frames.length ? client.video_style : null;
  if (generatedVideo && !videoStyle && Array.isArray(client?.video_references) && client.video_references.length) {
    await ensureStyleJob(admin, request.client_id, client?.name ?? "the brand");
    return;
  }
  // A client whose own videos rest on real people, places, screens or products
  // gets the filming path, never a generated video in some other style.
  const filmedBy = generatedVideo ? filmedNeed(videoStyle?.profile) : null;
  if (filmedBy) {
    // QA 22 Nov 2026 (P56-06): only a request still being prepared turns into
    // one waiting for filming; one a person stopped while it waited for the
    // plan lease stays stopped, and gets no shot brief.
    const { data: turned } = await admin.from("design_requests").update({ status: "needs_filming", stage: "ready", options_wanted: 0, on_camera: filmedBy, updated_at: new Date().toISOString() })
      .eq("id", request.id).eq("status", "preparing").select("id");
    if (!turned?.length) return;
    await briefOrNote(admin, request.id);
    return;
  }
  const brand = client?.name ?? "the brand";
  const voice = client?.brand_identity?.tone_of_voice ?? null;

  // The client's whole library, shown as numbered posts so each brief can
  // name the posts its layout builds on: the request platform's posts first,
  // each labeled with its platform and date (library.ts).
  const { library, content, otherPlatforms } = await plannerLibrary(admin, {
    paths: videoStyle ? videoStyle.frames as string[] : settings.reference_paths, harvested: client?.harvested_design_references, platform: request.platform ?? null,
    max: videoStyle ? Infinity : MAX_LIBRARY, stills: !!videoStyle,
  });
  if (!library.length) {
    // QA 22 Nov 2026 (P56-09): settings with no reference posts at all can
    // never be planned, and were planned again and again until the 90-minute
    // limit with the card on "preparing". Ended now, as planning that cannot
    // go on ends. Posts that are there but could not be read this time may
    // be a passing storage hiccup: planned again as before.
    const sources = videoStyle ? videoStyle.frames : settings.reference_paths;
    if (!Array.isArray(sources) || !sources.some((p: unknown) => typeof p === "string" && p)) {
      await endRequest(admin, request.id, "no_progress", "The client's design settings have no reference posts.");
      return;
    }
    throw new Error("None of the client's reference posts could be read.");
  }
  const recentList = await recentDesigns(admin, request.client_id);
  const recent = recentLines(recentList, library);
  // What people who turned down this client's earlier designs asked for.
  const guidance = learningLines(await loadDesignLearnings(admin, request.client_id));

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const carousel = request.kind === "carousel";
  const video = request.kind === "video";
  const common = { brand, platform: request.platform ?? "social", copy: request.post_copy, voice, count: BRIEFS_PLANNED, postCount: library.length, recent, guidance, otherPlatforms, note: request.note ?? null };
  const filmed = video && request.footage_path ? (request.on_camera || "the speaker") : null;
  // A still whose platform is uploaded in another shape than 4:5 is planned for that shape (the request's own size).
  const shape = video ? null : plannerShape(request.upload_size, isStoryPost(request));
  // A video is planned in the shape its platform is uploaded in (the request's own size; vertical when it has none).
  const instruction = video ? videoPlannerPrompt({ ...common, visual: (request as any).visual_direction ?? null, filmed, style: videoStyle?.profile ?? null, videos: videoStyle?.videos, framesPer: videoStyle?.frames_per_video, frame: videoFrameOf(request.upload_size) }) : carousel ? carouselPlannerPrompt({ ...common, shape, slides: CAROUSEL_SLIDES }) : plannerPrompt({ ...common, shape, story: isStoryPost(request) });
  let briefs = [] as ReturnType<typeof parseBriefs>;
  for (let attempt = 0; attempt < 2 && briefs.length < OPTIONS_WANTED; attempt++) {
    const result = await anthropicMessages({
      apiKey,
      body: {
        model: PLANNER_MODEL,
        // The size of the plan itself, and room for the planner to think first (anthropicReply.ts, roomFor).
        max_tokens: roomFor(carousel ? 6000 : video ? 4000 : 2000),
        messages: [{ role: "user", content: [...content, { type: "text", text: instruction }] }],
      },
    });
    // A plan that was cut off or declined is a try that planned nothing: the next try asks again.
    const plan = answerText(result);
    briefs = video ? parseVideoBriefs(plan, videoStyle ? [] : library, { filmed: !!filmed, textless: !!videoStyle && videoStyle.profile?.on_screen_text === "none" }) : carousel ? parseCarouselBriefs(plan, CAROUSEL_SLIDES, library) : parseBriefs(plan, library);
  }
  if (!briefs.length) throw new Error("The options could not be planned.");
  briefs = withRefs(briefs, library, recentList);

  // Stopped while it was being planned: nothing is started.
  const { data: still } = await admin.from("design_requests").select("status").eq("id", request.id).maybeSingle();
  if (still?.status !== "preparing") return;

  const planned: DesignRequest = { ...request, briefs };
  // The jobs exist before the request leaves planning. The worker settles
  // every request past planning, and one it found with no jobs yet started a
  // second copy of the first option (13 Oct: two of one design; for a video,
  // two clips paid for).
  const first = Math.min(request.options_wanted, briefs.length);
  let current = settings;
  for (let i = 0; i < first; i++) current = await startOption(admin, planned, current, brand, i, i);
  await admin.from("design_requests").update({ briefs, stage: "designing", candidates_started: first, updated_at: new Date().toISOString() }).eq("id", request.id);
  await wakeWorker();
  // A video's footage starts now, on its own worker, while the cards are drawn.
  if (request.kind === "video") await wakeVideoWorker();
}

/** The client's most recent designs: the posts each was built on and what it showed (a carousel by its cover). */
async function recentDesigns(admin: any, clientId: string): Promise<RecentDesign[]> {
  const { data } = await admin.from("canva_finish_jobs").select("input, slide_index, created_at")
    .eq("client_id", clientId).not("design_request_id", "is", null)
    .order("created_at", { ascending: false }).limit(RECENT_DESIGNS * 6);
  const out: RecentDesign[] = [];
  for (const j of data ?? []) {
    if (j.slide_index && j.slide_index > 0) continue;
    const g = j.input?.generate;
    if (!g?.concept) continue;
    out.push({ refs: Array.isArray(g.refs) ? g.refs : [], layout: j.input?.layout ?? null, picture: String(g.concept) });
    if (out.length >= RECENT_DESIGNS) break;
  }
  return out;
}

/**
 * Who has to appear on camera for this video post, or null when nobody does.
 * Decided from the post's copy and planned visual by a model that only
 * answers this question.
 */
async function personOnCamera(copy: string, visual: string): Promise<string | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return null;
  try {
    const result = await anthropicMessages({
      apiKey,
      body: {
        model: PLANNER_MODEL, max_tokens: roomFor(2000),
        messages: [{ role: "user", content: [{ type: "text", text:
          `A social video post is planned.\nCopy: """${copy.slice(0, 1500)}"""\nPlanned visual: """${visual || "(none given)"}"""\n` +
          "Does the video depend on a real person appearing on camera for the brand: its founder, an executive, a spokesperson, an expert or a team member speaking or presenting, named or not? " +
          "Anonymous hands, objects, places, abstract motion, people who are only an unidentifiable part of a scene (a crowd, players in a match), and made-up characters (fictional players or models in a generated scene) do not count. " +
          'Reply with JSON only: {"person": true or false, "who": "the person, as the copy or visual names them (a name when one is given, otherwise a short description such as an executive), or empty"}' }] }],
      },
    });
    const m = answerText(result).match(/\{[\s\S]*\}/);
    const v = m ? JSON.parse(m[0]) : null;
    if (v?.person !== true) return null;
    return String(v.who || "a real person").trim().slice(0, 80) || "a real person";
  } catch (e) {
    console.warn("[design-request] person check failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Why a video post is filmed rather than generated, as a clause that follows
 * "This video is filmed:": the client's videos cannot be made by a video
 * model, or this post features a real person. Null when it can be generated.
 */
async function filmedReason(admin: any, clientId: string, copy: string, visual: string): Promise<string | null> {
  const { data: client } = await admin.from("clients").select("video_style").eq("id", clientId).maybeSingle();
  const byStyle = filmedNeed(client?.video_style?.profile);
  if (byStyle) return byStyle;
  const person = await personOnCamera(copy, visual);
  return person ? `it needs ${person} on camera` : null;
}

/**
 * Keep the answer that a video post is filmed: one row per post, updated when
 * asked again, so the post's panel says so whenever it is opened and the
 * week's design button leaves the post alone. Names the person who asked.
 */
async function recordFilming(admin: any, p: { clientId: string; postKey: string; copy: string; reportId: string | null; platform: string | null; format: string | null; requestedBy: string; visual?: string | null; batchId?: string | null }, reason: string): Promise<DesignRequest> {
  const fields = { post_copy: p.copy, platform: p.platform, format: p.format, visual_direction: p.visual ?? null, on_camera: reason, updated_at: new Date().toISOString() };
  const { data: known } = await admin.from("design_requests").select("id").eq("client_id", p.clientId).eq("calendar_post_key", p.postKey).eq("status", "needs_filming").limit(1).maybeSingle();
  let row: DesignRequest;
  if (known) {
    const { data } = await admin.from("design_requests").update(fields).eq("id", known.id).select("*").single();
    row = data as DesignRequest;
  } else {
    const { data, error } = await admin.from("design_requests").insert({
      ...fields, client_id: p.clientId, report_id: p.reportId, calendar_post_key: p.postKey, requested_by: p.requestedBy, batch_id: p.batchId ?? null,
      kind: "video", status: "needs_filming", stage: "ready", options_wanted: 0,
    }).select("*").single();
    if (error) throw new Error(error.message);
    row = data as DesignRequest;
  }
  // What to film, for Moburst staff, written while the answer goes back.
  const work = briefOrNote(admin, row.id);
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work); else await work;
  return row;
}

/** How many times a shot brief is written before it is left to staff's "write it again" (shotBrief.ts). */
const BRIEF_TRIES = 4;
/** A brief not written yet is tried again by the filming sweep once its request is this old. */
const BRIEF_RETRY_AFTER_MS = 5 * 60_000;
/** Briefs the sweep writes in one pass, so the pass ends well inside the function's time. */
const BRIEF_SWEEP_MAX = 3;
const BRIEF_NOTE = /^Shot brief not written \(try (\d+)\)/;
/** The tries a request's shot brief has had that did not write it, from the note on the request. */
const briefTries = (error: unknown) => Number(BRIEF_NOTE.exec(String(error ?? ""))?.[1] ?? 0);

/**
 * Write the shot brief, and when it is not written keep that on the request
 * with the try it was. QA 22 Nov 2026 (P56-08): a brief that failed (a model
 * hiccup, an unreadable reply) left no trace and nothing asked again, so the
 * post panel said "being written" for good. The filming sweep writes it again
 * (closeFilming), up to BRIEF_TRIES.
 */
async function briefOrNote(admin: any, requestId: string): Promise<void> {
  try {
    await writeShotBrief(admin, requestId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[design-request] shot brief:", msg);
    const { data: row } = await admin.from("design_requests").select("error").eq("id", requestId).maybeSingle();
    const tries = briefTries(row?.error) + 1;
    await admin.from("design_requests").update({ error: `Shot brief not written (try ${tries}): ${msg}`.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", requestId).eq("status", "needs_filming");
  }
}

/**
 * The shot brief for a filmed video post: who, where, framing, length, the
 * shots and the lines to say, in the client's filmed format, written from the
 * post's copy. Stored where only Moburst staff can read it.
 */
async function writeShotBrief(admin: any, requestId: string) {
  const { data: request } = await admin.from("design_requests").select("id, client_id, calendar_post_key, platform, format, post_copy, visual_direction, on_camera").eq("id", requestId).maybeSingle();
  if (!request) throw new Error("No such request.");
  // Filmed in the shape the post's platform is uploaded in (vertical when it has no stored size).
  const frame = videoFrameOf(await readVideoSize(admin, { platform: request.platform, format: request.format }));
  const { data: client } = await admin.from("clients").select("name, brand_identity, video_style").eq("id", request.client_id).maybeSingle();
  const profile = client?.video_style?.profile;
  const format = profile?.filmed?.what ?? (profile?.generatable === false ? profile?.format : undefined);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const result = await anthropicMessages({ apiKey, body: { model: "claude-opus-5-5", max_tokens: roomFor(2000), messages: [{ role: "user", content: shotBriefPrompt({
    brand: client?.name ?? "the brand", platform: request.platform ?? "social", copy: request.post_copy ?? "", visual: request.visual_direction,
    reason: request.on_camera || "it needs footage filmed for it", format, voice: client?.brand_identity?.tone_of_voice ?? null, frame,
  }) }] } });
  const brief = parseShotBrief(answerText(result));
  if (!brief) throw new Error(`The shot brief came back unreadable: ${replySample(result)}`);
  const { error } = await admin.from("design_shot_briefs").upsert({ request_id: request.id, client_id: request.client_id, calendar_post_key: request.calendar_post_key, brief, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not keep the shot brief: ${error.message}`);
  return brief;
}

/** Read the client's video style from its own videos, unless that is already under way. */
async function ensureStyleJob(admin: any, clientId: string, brand: string): Promise<void> {
  const { data: running } = await admin.from("canva_finish_jobs").select("id").eq("client_id", clientId)
    .eq("input->>purpose", "style").in("status", ["queued", "running"]).limit(1);
  if (running?.length) return;
  const { error } = await admin.from("canva_finish_jobs").insert({ client_id: clientId, step: "style_cut", input: { kind: "video", purpose: "style", brand_name: brand } });
  if (error) throw new Error(`Could not start reading the client's videos: ${error.message}`);
  await wakeVideoWorker();
}

/**
 * Start a design request for a post, or answer with the one already being
 * prepared. Planning runs in the background. Every request names the person
 * who asked (design_requests requires it since 2 Nov); a week's post names
 * whoever added it to the week, and carries the week's id. A generated
 * video carries the price approved for its one clip, which its clip step
 * holds to: the week's press hands it in (approvedCredits); any other start
 * reads Higgsfield's live price here, at its own click.
 */
async function startRequest(admin: any, settings: Settings, p: { clientId: string; postKey: string; copy: string; reportId: string | null; platform: string | null; format: string | null; requestedBy: string; visual?: string | null; footagePath?: string | null; onCamera?: string | null; route?: string | null; batchId?: string | null; note?: string | null; learnNote?: boolean; noteLearned?: NoteLearned | null; approvedCredits?: number | null; uploadSize?: VideoUploadSize | null }): Promise<DesignRequest> {
  const { data: open } = await admin.from("design_requests").select("*").eq("client_id", p.clientId).eq("calendar_post_key", p.postKey).eq("status", "preparing").maybeSingle();
  if (open) return open;

  const kind = designKind(p.format, p.platform);
  // The size the post's platform is uploaded in, read now and kept on the request (17 Nov 2026,
  // _shared/design/platformSize.ts; a video's since 18 Nov 2026, _shared/video/videoSize.ts). A post with no row
  // has none and is made as before: a still on the 4:5 page, a video vertical.
  // A week's video is made in exactly the size its price was read for at the press (p.uploadSize).
  const uploadSize = kind === "video"
    ? (p.uploadSize !== undefined ? p.uploadSize : await readVideoSize(admin, { platform: p.platform, format: p.format }))
    : await readUploadSize(admin, { platform: p.platform, format: p.format });
  // A generated video is approved at Higgsfield's live price for its one clip in the aspect it is made in, read at
  // its own click unless the week's press handed one in (priced in the same aspect); a still and a filmed clip have none.
  const approvedCredits = needsClipPrice(kind, p.footagePath, p.approvedCredits) ? await clipPrice(admin, videoFrameOf(uploadSize).aspect) : (kind === "video" && !p.footagePath ? p.approvedCredits ?? null : null);

  const { data: created, error } = await admin.from("design_requests").insert({
    client_id: p.clientId, report_id: p.reportId, calendar_post_key: p.postKey,
    platform: p.platform, format: p.format, post_copy: p.copy, requested_by: p.requestedBy, visual_direction: p.visual ?? null,
    footage_path: p.footagePath ?? null, on_camera: p.footagePath ? (p.onCamera ?? null) : null, video_route: p.route ?? null, batch_id: p.batchId ?? null,
    note: p.note ?? null, note_learned: p.noteLearned ?? null, approved_credits: approvedCredits,
    // A LinkedIn document is a deck of slides: it is made like a carousel. A
    // Reel, short or any video post gets a video: footage in the client's own
    // video style with the hook and logo over it.
    kind, options_wanted: OPTIONS_WANTED, upload_size: uploadSize,
  }).select("*").single();
  if (error) {
    // Two starts at once: the unique index let one through; answer with it.
    const { data: raced } = await admin.from("design_requests").select("*").eq("client_id", p.clientId).eq("calendar_post_key", p.postKey).eq("status", "preparing").maybeSingle();
    if (raced) return raced;
    throw new Error(error.message);
  }

  // The note's lasting part teaches the brand's design memory beside the
  // planning; the note itself reaches the planner either way.
  if (p.note && p.learnNote) background(learnDesignNote(noteDeps(admin), created, p.requestedBy));

  // Planning takes a few seconds; the caller already has the request and
  // shows it as being prepared while this runs.
  const work = plan(admin, created as DesignRequest, settings).catch((e) => planStopped(admin, created.id, e));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work); else await work;
  return created as DesignRequest;
}

/**
 * A plan that could not be made stays planning, with the reason kept for the
 * logs. The design worker plans it again once NO_PROGRESS_MINUTES pass, and
 * closes it quietly after a few tries (requestRules.ts): nobody is shown a
 * request that did not finish.
 */
async function planStopped(admin: any, requestId: string, e: unknown): Promise<void> {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[design-request] planning stopped:", msg);
  await admin.from("design_requests").update({ error: msg.slice(0, 1000), updated_at: new Date().toISOString() })
    .eq("id", requestId).eq("status", "preparing").eq("stage", "planning");
}

/** How far back a filming request's post is looked for; one older than this has passed anyway. */
const FILMING_LOOKBACK_DAYS = 31;

/**
 * Filming requests never wait for ever, for every client: closed once
 * footage arrived, once the post's time passed or the post left the
 * calendar, and a day before the post's time when no footage came. The
 * week's design button then designs that post from the client's posts.
 */
async function closeFilming(admin: any, now: Date): Promise<number> {
  const { data: waiting } = await admin.from("design_requests").select("id, client_id, calendar_post_key, created_at, error").eq("status", "needs_filming").limit(500);
  if (!waiting?.length) return 0;
  const clientIds = [...new Set((waiting as Array<{ client_id: string }>).map((w) => w.client_id))];
  const since = new Date(now.getTime() - FILMING_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
  const [{ data: zones }, { data: posts }, { data: footage }] = await Promise.all([
    admin.from("clients").select("id, timezone").in("id", clientIds),
    admin.from("calendar_posts").select("client_id, post_key, post_date, posting_time").in("client_id", clientIds).gte("post_date", since).limit(10000),
    admin.from("design_requests").select("client_id, calendar_post_key, status, created_at").in("client_id", clientIds).not("footage_path", "is", null).limit(10000),
  ]);
  // Matched in code: a report post's key is JSON text, which an in() filter does not survive.
  const zone = new Map<string, string | null>((zones ?? []).map((c: any) => [c.id, c.timezone ?? null]));
  const postOf = new Map((posts ?? []).map((p: any) => [`${p.client_id}|${p.post_key}`, p]));
  // QA 22 Nov 2026 (P56-05): footage counts for this wait when it came after
  // the post was asked to be filmed, or its video is still being made. An
  // older clip whose video ended closed a new filming request at once.
  const clips = new Map<string, Array<{ status: string; created_at: string | null }>>();
  for (const r of (footage ?? []) as any[]) {
    const key = `${r.client_id}|${r.calendar_post_key}`;
    clips.set(key, [...(clips.get(key) ?? []), r]);
  }
  const footageFor = (key: string, askedAt: string | null) => (clips.get(key) ?? []).some((c) =>
    c.status === "preparing" || Date.parse(String(c.created_at)) >= Date.parse(String(askedAt)));
  let closed = 0;
  const kept: Array<{ id: string; created_at: string | null; error: string | null }> = [];
  for (const w of waiting as Array<{ id: string; client_id: string; calendar_post_key: string; created_at: string | null; error: string | null }>) {
    const key = `${w.client_id}|${w.calendar_post_key}`;
    const post = postOf.get(key) as { post_date: string; posting_time: string | null } | undefined;
    const outcome = filmingOutcome(post ? postInstant(post.post_date, post.posting_time, zone.get(w.client_id)) : null, now, footageFor(key, w.created_at));
    if (outcome === "keep") { kept.push(w); continue; }
    await endRequest(admin, w.id, outcome);
    closed++;
  }
  await retryShotBriefs(admin, kept, now);
  return closed;
}

/** The shot briefs of posts still waiting for filming that were not written, written again (P56-08). */
async function retryShotBriefs(admin: any, kept: Array<{ id: string; created_at: string | null; error: string | null }>, now: Date): Promise<void> {
  const due = kept.filter((w) => briefTries(w.error) < BRIEF_TRIES && now.getTime() - Date.parse(String(w.created_at)) >= BRIEF_RETRY_AFTER_MS);
  if (!due.length) return;
  const { data: briefs } = await admin.from("design_shot_briefs").select("request_id").in("request_id", due.map((w) => w.id));
  const written = new Set((briefs ?? []).map((b: { request_id: string }) => b.request_id));
  for (const w of due.filter((x) => !written.has(x.id)).slice(0, BRIEF_SWEEP_MAX)) await briefOrNote(admin, w.id);
}

/**
 * Start one post of a week the way its own "Create design" does, named for
 * whoever added it to the week and carrying the week's id: a video of a real
 * person on camera is filmed (while there is still a day to film it), and
 * one too close to film is made from the client's posts.
 */
async function startWeekPost(admin: any, s: PassStart & { batchId: string; settings: Settings; post: any; approvedCredits?: number | null; uploadSize?: VideoUploadSize | null }): Promise<{ requestId: string | null; filming: boolean }> {
  const now = new Date();
  const video = s.kind === "video";
  const p = {
    clientId: s.client_id, postKey: s.post_key, copy: s.copy, reportId: s.post.report_id ?? null, platform: s.post.platform ?? null, format: s.post.format ?? null,
    requestedBy: s.added_by, visual: s.post.visual_direction || null, route: video ? s.route : null, batchId: s.batchId,
    // The clip's price approved at the press that added the post, and the size it was priced for.
    approvedCredits: video ? s.approvedCredits ?? null : null,
    ...(video && s.uploadSize !== undefined ? { uploadSize: s.uploadSize } : {}),
  };
  if (video && s.askFilming && filmingOutcome(s.postAt, now, false) === "keep") {
    const filmed = await filmedReason(admin, s.client_id, s.copy, s.post.visual_direction || "");
    if (filmed) return { requestId: (await recordFilming(admin, p, filmed)).id, filming: true };
  } else if (video && s.askFilming) {
    p.route = "posts";
  }
  return { requestId: (await startRequest(admin, s.settings, p)).id, filming: false };
}

/**
 * Higgsfield's live price for a video's one clip (get_cost: a read, nothing
 * is spent), or null when it could not be read. Failing to read it never
 * stops a press or a request: the price is then unknown.
 */
async function clipPrice(admin: any, aspect?: string): Promise<number | null> {
  try {
    const mcp = new McpClient({ url: MCP_URL, accessToken: await accessTokenFor(admin), timeoutMs: 30_000 });
    return await quoteClip(mcp, aspect);
  } catch {
    return null;
  }
}

/** What the week's actions (week.ts) need from this function: the caller's checks, the start, the Higgsfield balance and the clip's price. */
function weekDeps(admin: any, req: Request): WeekDeps {
  let system: Promise<boolean> | null = null;
  const deps: WeekDeps = {
    db: admin,
    now: () => new Date(),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    requireStaff: async (clientId) => (await requireStaff(req, { writeClientId: clientId })).userId,
    isSystem: () => (system ??= requireStaffOrSystem(req).then((c) => c.system)),
    balance: async () => {
      try {
        const mcp = new McpClient({ url: MCP_URL, accessToken: await accessTokenFor(admin), timeoutMs: 30_000 });
        return (await creditBalance(mcp))?.credits ?? null;
      } catch {
        return null;
      }
    },
    quoteClip: (aspect) => clipPrice(admin, aspect),
    startPost: (s) => startWeekPost(admin, s as PassStart & { batchId: string; settings: Settings; post: any; approvedCredits: number | null; uploadSize?: VideoUploadSize | null }),
    // A press starts the first posts at once, as the system would on its next pass.
    wake: () => background(weekContinue({ ...deps, isSystem: async () => true })),
  };
  return deps;
}

/** What create (create.ts) needs from this function. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createDeps(admin: any, req: Request): CreateDeps {
  return {
    db: admin,
    requireMember: (clientId) => requireMember(req, clientId),
    now: () => new Date(),
    filmedReason: (clientId, copy, visual) => filmedReason(admin, clientId, copy, visual),
    recordFilming: (p, reason) => recordFilming(admin, p as Parameters<typeof recordFilming>[1], reason),
    start: (settings, p) => startRequest(admin, settings as Settings, p as Parameters<typeof startRequest>[2]),
  };
}

/** Whether a clip is in the footage bucket at this path. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function footageClipExists(admin: any, path: string): Promise<boolean> {
  const slash = path.lastIndexOf("/");
  const { data, error } = await admin.storage.from("post-footage").list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 100 });
  if (error) throw new Error(error.message);
  return (data ?? []).some((f: { name: string }) => f.name === path.slice(slash + 1));
}

/** What the note's learning and Undo (note.ts) need from this function. */
function noteDeps(admin: any, req?: Request): NoteDeps {
  return {
    db: admin,
    requireMember: (clientId) => {
      if (!req) throw new AuthzError(401, "Sign-in required.");
      return requireMember(req, clientId);
    },
    learn: (n) => learnFromNote(admin, n),
    now: () => new Date(),
  };
}

/** Keep work going after the answer is sent. */
function background(work: Promise<unknown>): void {
  const w = work.catch((e) => console.error("[design-request]", e instanceof Error ? e.message : e));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(w);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
