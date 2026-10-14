// supabase/functions/design-request/index.ts
//
// Design options for a calendar post, for staff and for the client's own
// users.
//
//   POST {action:"create", client_id, report_id, calendar_post_key, platform, format, post_copy}
//        Plans the options from the post and the client's own posts, then
//        starts them. A second call while the post's designs are being
//        prepared returns the open request.
//   POST {action:"auto"}   (operational secret) designs for upcoming calendar posts that have none
//   POST {action:"feedback", iteration_id, verdict:"rejected"|"deleted", reason?, note?, make_new?}
//        Turns a design down (its reason becomes a rule for the client's next
//        designs, and a new design is started) or deletes it.
//   POST {action:"use", iteration_id}
//        Puts one finished design in use for its post; every other design of
//        that post stops being in use.
//
// Clients cannot write post_iterations directly (staff-only RLS), so using a
// design goes through here with the service role after a membership check.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { requireMember } from "../_shared/auth/requireMember.ts";
import { anthropicMessages } from "../_shared/anthropic.ts";
import { BRIEFS_PLANNED, CAROUSEL_SLIDES, OPTIONS_WANTED, type RecentDesign, carouselPlannerPrompt, parseBriefs, parseCarouselBriefs, parseVideoBriefs, plannerPrompt, recentLines, videoPlannerPrompt, withRefs } from "../_shared/canva/options.ts";
import { type DesignRequest, type Settings, startOption } from "../_shared/canva/jobs.ts";
import { wakeWorker, wakeVideoWorker } from "../_shared/canva/worker.ts";
import { DESIGN_ANGLE } from "../_shared/canva/jobs.ts";
import { learningLines, recordFeedback } from "../_shared/design-prompts/feedback.ts";
import { loadDesignLearnings } from "../_shared/design-prompts/learnings.ts";
import { discoverVideoReferences } from "../_shared/brand-references/videos.ts";

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

    if (body?.action === "create") {
      const clientId = String(body.client_id || "");
      const postKey = String(body.calendar_post_key || "");
      const copy = String(body.post_copy || "").trim();
      if (!clientId || !postKey || !copy) return json({ error: "client_id, calendar_post_key and post_copy are required." }, 400);
      const userId = await requireMember(req, clientId);

      const { data: settings } = await admin.from("design_brand_settings").select("*").eq("client_id", clientId).maybeSingle();
      // Answered as a 200 so the screen can read the code (invoke() hides non-2xx bodies).
      if (!settings?.confirmed_at) return json({ code: "not_set_up" });

      const visual = typeof body.visual_direction === "string" ? body.visual_direction.trim().slice(0, 600) : "";
      // A video whose idea is a real person on camera (the founder speaking,
      // say) is filmed, never generated: no real or identifiable person is
      // ever made up. The answer says so plainly instead of starting anything.
      if (designKind(body.format, body.platform) === "video") {
        const person = await personOnCamera(copy, visual);
        if (person) {
          const request = await recordFilming(admin, { clientId, postKey, copy, reportId: body.report_id || null, platform: body.platform || null, format: body.format || null, requestedBy: userId, visual: visual || null }, person);
          return json({ code: "needs_filming", who: person, request });
        }
      }
      const request = await startRequest(admin, settings as Settings, {
        clientId, postKey, copy, reportId: body.report_id || null, platform: body.platform || null, format: body.format || null, requestedBy: userId, visual: visual || null,
      });
      return json({ request });
    }

    // Stop a design being prepared: whoever could start it can stop it. The
    // request and its unfinished jobs are cancelled, so the workers spend
    // nothing more on it; the post keeps the design it already had, and the
    // automatic designs leave a cancelled post alone.
    if (body?.action === "cancel") {
      const { data: request } = await admin.from("design_requests").select("id, client_id, status").eq("id", String(body.request_id || "")).maybeSingle();
      if (!request) return json({ error: "That design is not being prepared." }, 404);
      await requireMember(req, request.client_id);
      if (request.status !== "preparing" && request.status !== "needs_staff") return json({ request });
      await admin.from("canva_finish_jobs").update({ status: "canceled", lease_until: null, updated_at: new Date().toISOString() })
        .eq("design_request_id", request.id).in("status", ["queued", "running"]);
      const { data: updated } = await admin.from("design_requests").update({ status: "canceled", updated_at: new Date().toISOString() })
        .eq("id", request.id).select("*").single();
      return json({ request: updated });
    }

    // A filmed clip for a video post with a real person on camera: the clip
    // is the footage, and the post's hook and the client's logo file go over
    // it, keeping its sound. Anyone who can work on the client's posts.
    if (body?.action === "footage") {
      const clientId = String(body.client_id || "");
      const postKey = String(body.calendar_post_key || "");
      const path = String(body.path || "");
      const copy = String(body.post_copy || "").trim();
      if (!clientId || !postKey || !copy || !path) return json({ error: "client_id, calendar_post_key, post_copy and path are required." }, 400);
      const userId = await requireMember(req, clientId);
      if (!path.startsWith(`${clientId}/`) || path.includes("..")) return json({ error: "That clip does not belong to this client." }, 400);
      const { data: settings } = await admin.from("design_brand_settings").select("*").eq("client_id", clientId).maybeSingle();
      if (!settings?.confirmed_at) return json({ code: "not_set_up" });
      const { data: filmed } = await admin.from("design_requests").select("on_camera").eq("client_id", clientId).eq("calendar_post_key", postKey).eq("status", "needs_filming").order("updated_at", { ascending: false }).limit(1).maybeSingle();
      const visual = typeof body.visual_direction === "string" ? body.visual_direction.trim().slice(0, 600) : "";
      const request = await startRequest(admin, settings as Settings, {
        clientId, postKey, copy, reportId: body.report_id || null, platform: body.platform || null, format: body.format || "Video", requestedBy: userId,
        visual: visual || null, footagePath: path, onCamera: filmed?.on_camera ?? "the speaker",
      });
      return json({ request });
    }

    // The client's own published videos, kept so its video posts follow its
    // own video style. Staff or the project's own calls.
    if (body?.action === "video_references") {
      await requireStaff(req);
      const clientId = String(body.client_id || "");
      const { data: client } = await admin.from("clients").select("id, sprout_customer_id").eq("id", clientId).maybeSingle();
      if (!client) return json({ error: "No such client." }, 404);
      const found = await discoverVideoReferences(admin, client);
      if (found.refs.length) await admin.from("clients").update({ video_references: found.refs }).eq("id", clientId);
      return json(found);
    }

    // Designs for upcoming calendar posts that have none, for clients whose
    // staff switched it on. Run by the hourly schedule.
    if (body?.action === "auto") {
      const caller = await requireStaff(req);
      if (!caller.viaSecret) return json({ error: "Not allowed." }, 403);
      return json(await prepareUpcoming(admin, { dryRun: body.dry_run === true, clientId: body.client_id ? String(body.client_id) : null }));
    }

    // Turn a design down (with a reason the client's next designs learn from)
    // or delete it. Turning down the post's current design starts a new one.
    if (body?.action === "feedback") {
      const verdict = body.verdict === "rejected" ? "rejected" : body.verdict === "deleted" ? "archived" : null;
      if (!verdict) return json({ error: "verdict must be rejected or deleted." }, 400);
      const { data: it } = await admin.from("post_iterations").select("id, client_id, calendar_post_key, report_id, platform, format, post_copy, visual_direction, variant_angle, concept, is_selected").eq("id", String(body.iteration_id || "")).maybeSingle();
      if (!it || !DESIGN_ANGLE.test(it.variant_angle ?? "")) return json({ error: "That design is no longer available." }, 404);
      const userId = await requireMember(req, it.client_id);
      const learnings = await recordFeedback(admin, it, verdict, body.reason, body.note, userId);

      let request: DesignRequest | null = null;
      if (verdict === "rejected" && body.make_new !== false && it.calendar_post_key) {
        const { data: settings } = await admin.from("design_brand_settings").select("*").eq("client_id", it.client_id).maybeSingle();
        if (settings?.confirmed_at) {
          const copy = await currentCopy(admin, { client_id: it.client_id, post_key: it.calendar_post_key, copy: it.post_copy ?? "" });
          if (copy) {
            request = await startRequest(admin, settings as Settings, {
              clientId: it.client_id, postKey: it.calendar_post_key, copy, reportId: it.report_id, platform: it.platform, format: it.format, requestedBy: userId,
            });
          }
        }
      }
      return json({ ok: true, learnings: learnings.length, request });
    }

    if (body?.action === "use") {
      const { data: it } = await admin.from("post_iterations").select("id, client_id, calendar_post_key, variant_group_id").eq("id", String(body.iteration_id || "")).maybeSingle();
      if (!it) return json({ error: "That design is no longer available." }, 404);
      await requireMember(req, it.client_id);
      if (it.calendar_post_key) {
        await admin.from("post_iterations").update({ is_selected: false }).eq("client_id", it.client_id).eq("calendar_post_key", it.calendar_post_key).neq("id", it.id);
      }
      const { error } = await admin.from("post_iterations").update({ is_selected: true }).eq("id", it.id);
      if (error) throw new Error(error.message);
      return json({ ok: true });
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
  const { data: client } = await admin.from("clients").select("name, brand_identity").eq("id", request.client_id).maybeSingle();
  const brand = client?.name ?? "the brand";
  const voice = client?.brand_identity?.tone_of_voice ?? null;

  // The client's whole confirmed library, shown as numbered posts so each
  // brief can name the posts its layout builds on.
  const library: string[] = [];
  const content: unknown[] = [];
  for (const path of settings.reference_paths.slice(0, MAX_LIBRARY)) {
    const { data } = await admin.storage.from("design-references").download(path);
    if (!data) continue;
    const bytes = new Uint8Array(await data.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const mediaType = /\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : "image/jpeg";
    library.push(path);
    content.push({ type: "text", text: `Post ${library.length}:` });
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: btoa(bin) } });
  }
  if (!library.length) throw new Error("None of the client's reference posts could be read.");
  const recentList = await recentDesigns(admin, request.client_id);
  const recent = recentLines(recentList, library);
  // What people who turned down this client's earlier designs asked for.
  const guidance = learningLines(await loadDesignLearnings(admin, request.client_id));

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  const carousel = request.kind === "carousel";
  const video = request.kind === "video";
  const common = { brand, platform: request.platform ?? "social", copy: request.post_copy, voice, count: BRIEFS_PLANNED, postCount: library.length, recent, guidance };
  const filmed = video && request.footage_path ? (request.on_camera || "the speaker") : null;
  const instruction = video ? videoPlannerPrompt({ ...common, visual: (request as any).visual_direction ?? null, filmed }) : carousel ? carouselPlannerPrompt({ ...common, slides: CAROUSEL_SLIDES }) : plannerPrompt(common);
  let briefs = [] as ReturnType<typeof parseBriefs>;
  for (let attempt = 0; attempt < 2 && briefs.length < OPTIONS_WANTED; attempt++) {
    const result = await anthropicMessages({
      apiKey,
      body: {
        model: PLANNER_MODEL,
        max_tokens: carousel ? 6000 : video ? 4000 : 2000,
        messages: [{ role: "user", content: [...content, { type: "text", text: instruction }] }],
      },
    });
    briefs = video ? parseVideoBriefs(result.text, library, { filmed: !!filmed }) : carousel ? parseCarouselBriefs(result.text, CAROUSEL_SLIDES, library) : parseBriefs(result.text, library);
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
  for (let i = 0; i < first; i++) await startOption(admin, planned, settings, brand, i, i);
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
        model: PLANNER_MODEL, max_tokens: 200,
        messages: [{ role: "user", content: [{ type: "text", text:
          `A social video post is planned.\nCopy: """${copy.slice(0, 1500)}"""\nPlanned visual: """${visual || "(none given)"}"""\n` +
          "Does the video depend on a real person appearing on camera for the brand: its founder, an executive, a spokesperson, an expert or a team member speaking or presenting, named or not? " +
          "Anonymous hands, objects, places, abstract motion, or people who are only an unidentifiable part of a scene (a crowd, players in a match) do not count. " +
          'Reply with JSON only: {"person": true or false, "who": "the person, as the copy or visual names them (a name when one is given, otherwise a short description such as an executive), or empty"}' }] }],
      },
    });
    const m = result.text.match(/\{[\s\S]*\}/);
    const v = m ? JSON.parse(m[0]) : null;
    if (v?.person !== true) return null;
    return String(v.who || "a real person").trim().slice(0, 80) || "a real person";
  } catch (e) {
    console.warn("[design-request] person check failed:", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Keep the answer that a video post is filmed: one row per post, updated when
 * asked again, so the post's panel says so whenever it is opened and the
 * automatic designs leave the post alone.
 */
async function recordFilming(admin: any, p: { clientId: string; postKey: string; copy: string; reportId: string | null; platform: string | null; format: string | null; requestedBy: string | null; visual?: string | null }, who: string): Promise<DesignRequest> {
  const fields = { post_copy: p.copy, platform: p.platform, format: p.format, visual_direction: p.visual ?? null, on_camera: who, updated_at: new Date().toISOString() };
  const { data: known } = await admin.from("design_requests").select("id").eq("client_id", p.clientId).eq("calendar_post_key", p.postKey).eq("status", "needs_filming").limit(1).maybeSingle();
  if (known) {
    const { data } = await admin.from("design_requests").update(fields).eq("id", known.id).select("*").single();
    return data as DesignRequest;
  }
  const { data, error } = await admin.from("design_requests").insert({
    ...fields, client_id: p.clientId, report_id: p.reportId, calendar_post_key: p.postKey, requested_by: p.requestedBy,
    kind: "video", status: "needs_filming", stage: "ready", options_wanted: 0,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as DesignRequest;
}

/** A post with nothing to design: its format is words alone. */
export function needsNoDesign(format: string | null | undefined): boolean {
  return /^\s*text(\s*only)?\s*$|text[-\s]only/i.test(String(format || ""));
}

/** Start a design request for a post, or answer with the one already being prepared. Planning runs in the background. */
async function startRequest(admin: any, settings: Settings, p: { clientId: string; postKey: string; copy: string; reportId: string | null; platform: string | null; format: string | null; requestedBy: string | null; visual?: string | null; footagePath?: string | null; onCamera?: string | null }): Promise<DesignRequest> {
  const { data: open } = await admin.from("design_requests").select("*").eq("client_id", p.clientId).eq("calendar_post_key", p.postKey).eq("status", "preparing").maybeSingle();
  if (open) return open;

  const { data: created, error } = await admin.from("design_requests").insert({
    client_id: p.clientId, report_id: p.reportId, calendar_post_key: p.postKey,
    platform: p.platform, format: p.format, post_copy: p.copy, requested_by: p.requestedBy, visual_direction: p.visual ?? null,
    footage_path: p.footagePath ?? null, on_camera: p.footagePath ? (p.onCamera ?? null) : null,
    // A LinkedIn document is a deck of slides: it is made like a carousel. A
    // Reel, short or any video post gets a video: footage in the client's own
    // video style with the hook and logo over it.
    kind: designKind(p.format, p.platform), options_wanted: OPTIONS_WANTED,
  }).select("*").single();
  if (error) {
    // Two starts at once: the unique index let one through; answer with it.
    const { data: raced } = await admin.from("design_requests").select("*").eq("client_id", p.clientId).eq("calendar_post_key", p.postKey).eq("status", "preparing").maybeSingle();
    if (raced) return raced;
    throw new Error(error.message);
  }

  // Planning takes a few seconds; the caller already has the request and
  // shows it as being prepared while this runs.
  const work = plan(admin, created as DesignRequest, settings).catch(async (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[design-request] planning failed:", msg);
    await admin.from("design_requests").update({ status: "needs_staff", error: msg, updated_at: new Date().toISOString() }).eq("id", created.id);
  });
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work); else await work;
  return created as DesignRequest;
}

/** How far ahead designs are prepared automatically. */
const AUTO_DAYS_AHEAD = 7;
/**
 * Automatic requests being prepared at once, across clients. The worker
 * finishes designs one Canva edit at a time, so starting more at once only
 * makes each wait, and a person's own request would queue behind them.
 */
const AUTO_AT_ONCE = 2;
/**
 * What a post's design is made as, from its format: a LinkedIn document is a
 * deck of slides like a carousel; a Reel, short, story video or any post on
 * TikTok is a video.
 */
export function designKind(format: string | null | undefined, platform: string | null | undefined): "single" | "carousel" | "video" {
  const f = String(format || "");
  if (/carousel|document|pdf/i.test(f)) return "carousel";
  if (/reel|video|short|tiktok/i.test(f) || /tiktok/i.test(String(platform || ""))) return "video";
  return "single";
}

/**
 * Upcoming calendar posts with no design and no request yet, for clients with
 * confirmed settings and automatic designs switched on, soonest first. Each
 * request uses the post's current copy, so edits made before it starts are in
 * the design.
 */
async function prepareUpcoming(admin: any, opts: { dryRun?: boolean; clientId?: string | null } = {}): Promise<{ started: string[]; waiting: number; due?: Array<{ client_id: string; post_date: string; platform: string; format: string | null }> }> {
  // A dry run (staff checking what would start) also covers a client whose switch is off.
  let query = admin.from("design_brand_settings").select("*").not("confirmed_at", "is", null);
  query = opts.dryRun && opts.clientId ? query.eq("client_id", opts.clientId) : query.eq("auto_designs", true);
  const { data: clients } = await query;
  if (!clients?.length) return { started: [], waiting: 0 };
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + AUTO_DAYS_AHEAD * 86400000).toISOString().slice(0, 10);

  const due: Array<{ settings: Settings; post: any }> = [];
  for (const settings of clients) {
    const { data: posts } = await admin.from("calendar_posts").select("*").eq("client_id", settings.client_id).gte("post_date", today).lte("post_date", until).order("post_date");
    const candidates = posts ?? [];
    if (!candidates.length) continue;
    // Matched in code: a report post's key is JSON text (quotes, commas),
    // which an in() filter on the key does not survive.
    const [{ data: designed }, { data: requested }] = await Promise.all([
      admin.from("post_iterations").select("calendar_post_key").eq("client_id", settings.client_id).not("calendar_post_key", "is", null).like("variant_angle", "Design option %").limit(10000),
      admin.from("design_requests").select("calendar_post_key").eq("client_id", settings.client_id).limit(10000),
    ]);
    const has = new Set([...(designed ?? []), ...(requested ?? [])].map((r: any) => r.calendar_post_key));
    for (const post of candidates) if (!has.has(post.post_key) && !needsNoDesign(post.format)) due.push({ settings, post });
  }
  due.sort((a, b) => String(a.post.post_date).localeCompare(String(b.post.post_date)));

  if (opts.dryRun) {
    return { started: [], waiting: due.length, due: due.map(({ post }) => ({ client_id: post.client_id, post_date: post.post_date, platform: post.platform, format: post.format })) };
  }
  const { count: running } = await admin.from("design_requests").select("id", { count: "exact", head: true }).eq("status", "preparing").is("requested_by", null);
  const room = Math.max(0, AUTO_AT_ONCE - (running ?? 0));

  const started: string[] = [];
  for (const { settings, post } of due.slice(0, room)) {
    const copy = await currentCopy(admin, post);
    if (!copy) continue;
    const p = { clientId: post.client_id, postKey: post.post_key, copy, reportId: post.report_id, platform: post.platform, format: post.format, requestedBy: null, visual: post.visual_direction || null };
    // The same rule as a person asking: a video of a real person on camera is filmed.
    if (designKind(post.format, post.platform) === "video") {
      const person = await personOnCamera(copy, post.visual_direction || "");
      if (person) { await recordFilming(admin, p, person); continue; }
    }
    const request = await startRequest(admin, settings, p);
    started.push(request.id);
  }
  return { started, waiting: Math.max(0, due.length - started.length) };
}

/** A post's copy as it is now: its latest saved edit, or the copy it was planned with. */
async function currentCopy(admin: any, post: { client_id: string; post_key: string; copy: string }): Promise<string> {
  const { data: edits } = await admin.from("post_iterations").select("post_copy, media_urls, created_at, version")
    .eq("client_id", post.client_id).eq("calendar_post_key", post.post_key)
    .order("created_at", { ascending: false }).limit(20);
  const edit = (edits ?? []).find((r: any) => !(Array.isArray(r.media_urls) && r.media_urls.length) && r.post_copy);
  return String(edit?.post_copy || post.copy || "").trim();
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
