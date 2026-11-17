// supabase/functions/_shared/canva/jobs.ts
//
// Starting a post's design options and keeping its request up to date. Used
// by design-request (to start the first options) and by canva-finish's worker
// (after every step, to record progress, hand finished options to the post,
// and replace any option that did not finish).

import { type Brief, candidatesFor, optionStates, requestProgress, type JobState } from "./options.ts";
import { REQUEST_MAX_MINUTES, requestOverdue, type EndReason } from "../design/requestRules.ts";
import { STORY_PAGE, STORY_SURFACE, isStoryPost, storyLogoPlacement } from "../design/story.ts";
import { videoRouteFor } from "../video/kit.ts";
import { pngSize } from "../picture/headers.ts";
import { settleLogo } from "../design/logoFit.ts";
import { jobLogos, restGround, stampList, type JobLogos, type LogoSet, type StampEntry } from "../design/logoTone.ts";
import { jobShape, pagePlacement } from "../design/platformSize.ts";

export const BUCKET = "generated-media";

export interface Settings {
  client_id: string;
  logo_path: string;
  placement: { anchor: "left" | "center" | "right"; width: number; top: number; left?: number };
  background: string;
  reference_paths: string[];
  /** Who set the row: a person (the card's save) or the lifecycle. A person's row is never changed automatically. */
  source?: string | null;
  // deno-lint-ignore no-explicit-any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  derived?: Record<string, any> | null;
  /** The client's logo files for light and dark pictures, when the lifecycle has settled them (_shared/design/logoTone.ts). */
  logo_set?: unknown;
}

export interface DesignRequest {
  id: string;
  client_id: string;
  report_id: string | null;
  calendar_post_key: string;
  platform: string | null;
  format: string | null;
  post_copy: string;
  requested_by: string | null;
  status: string;
  kind?: "single" | "carousel" | "video";
  options_wanted: number;
  candidates_started: number;
  briefs: Brief[];
  /** A filmed clip uploaded for the post (post-footage bucket): the video's footage. */
  footage_path?: string | null;
  /** Who is on camera in a filmed video. */
  on_camera?: string | null;
  /** 'posts': a generated video in the look of the client's static posts, chosen instead of filming. */
  video_route?: string | null;
  /** The note the person left on Regenerate: its planner and every design job follow it. */
  note?: string | null;
  /** A video's Higgsfield price for its one clip, approved at the press; null when it could not be read, or for a still. */
  approved_credits?: number | null;
  /** The platform_sizes row the request read when it was made ({platform, format, width, height}); null for a post with no row and for a request from before 17 Nov 2026. */
  upload_size?: unknown;
}

export { pngSize } from "../picture/headers.ts";

async function logoBytes(admin: any, path: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Could not read the logo file: ${error?.message ?? "missing"}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function logoSize(admin: any, path: string): Promise<[number, number]> {
  return pngSize(await logoBytes(admin, path));
}

/**
 * The colors of a stored logo's whole parts and the ground it was made for,
 * read from the file's own pixels (imaging.ts, logoWhole) once for the
 * settings a request's options are started from: startOption hands its
 * settings back and the next option starts from that same object, so the
 * read is kept beside it and the file is decoded once for a request, not
 * once for an option. Null is a file with no whole part or one whose pixels
 * could not be read; that is kept too.
 */
type Whole = { inks: Array<[number, number, number]>; own: "light" | "dark" };
const WHOLE = new WeakMap<Settings, { path: string; whole: Whole | null }>();
/** `bytes` are the stored file's, when this call is the one that read them, so its size is not read from storage again. */
async function logoWholeOnce(admin: any, settings: Settings): Promise<{ whole: Whole | null; bytes?: Uint8Array }> {
  const kept = WHOLE.get(settings);
  if (kept && kept.path === settings.logo_path) return { whole: kept.whole };
  let whole: Whole | null = null;
  let bytes: Uint8Array | undefined;
  try {
    bytes = await logoBytes(admin, settings.logo_path);
    whole = await (await import("../lifecycle/imaging.ts")).logoWhole(bytes);
  } catch {
    whole = null;
  }
  WHOLE.set(settings, { path: settings.logo_path, whole });
  return { whole, bytes };
}

/**
 * What a still starts from (17 Nov 2026): the file on the canvas, the color
 * behind it, the set the job carries, and where the color came from, which
 * is kept on the job (`input.generate.background_from`).
 *
 *   "set":  the row has a set of the current rule that needs nothing else.
 *   "file": the stored file's whole parts were read from its own pixels. A
 *           set of rule 1 is then read with them (logoTone.ts, jobLogos),
 *           and with no set to read the job has the one file, resting where
 *           a set would rest it (restGround): on the settings background,
 *           or on the neutral its weakest whole part shows best on. So a
 *           canvas, and the template locate lays over the same color, never
 *           carries the file on a ground chosen for the average of its ink,
 *           whatever the row holds at this moment and whoever set it.
 *   "row":  the file has no whole part or its pixels could not be read: the
 *           one file on the row's background as it is. Recorded, so a job
 *           that started this way can be told from the others.
 *
 * A job that carries a set also carries the files it may be stamped with
 * (`input.stamp`): the stored file, the second file and the white copy,
 * with the copies the service made whether or not a post shows them.
 *
 * Nothing of the row is written.
 */
async function stillStart(admin: any, settings: Settings): Promise<{ logoPath: string; background: string; logos: JobLogos | null; stamp?: StampEntry[]; from: "set" | "file" | "row"; bytes?: Uint8Array }> {
  // The files the design may be stamped with, from the same set the logos are read from (logoTone.ts, stampList).
  const stamp = () => stampList(settings.logo_path, settings.logo_set as Partial<LogoSet>);
  const set = jobLogos(settings);
  if (set) return { logoPath: set.logo_path, background: set.background, logos: set.logos, stamp: stamp(), from: "set" };
  const { whole, bytes } = await logoWholeOnce(admin, settings);
  if (!whole) return { logoPath: settings.logo_path, background: settings.background, logos: null, from: "row", bytes };
  const read = jobLogos(settings, whole);
  if (read) return { logoPath: read.logo_path, background: read.background, logos: read.logos, stamp: stamp(), from: "file", ...(read.logo_path === settings.logo_path ? { bytes } : {}) };
  return { logoPath: settings.logo_path, background: restGround(whole.inks, settings.background, whole.own, settings.source === "person").ground, logos: null, from: "file", bytes };
}

/**
 * Add an option's jobs, skipping any the request already has for that option
 * and slide: a plan that died after inserting its jobs and before leaving
 * planning runs again and must not draw the same slide twice. The unique index
 * on (design_request_id, option_index, slide_index or -1) holds the same rule
 * when two runs insert at once; its refusal of one row means that job is
 * already there. Each row goes in on its own, so a refused row never keeps
 * the others out (a carousel planned again with more slides).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insertJobs(admin: any, requestId: string, optionIndex: number, rows: Array<{ slide_index: number | null }>, what: string): Promise<void> {
  const { data: there } = await admin.from("canva_finish_jobs").select("slide_index").eq("design_request_id", requestId).eq("option_index", optionIndex);
  const have = new Set((there ?? []).map((r: { slide_index: number | null }) => r.slide_index ?? -1));
  const fresh = rows.filter((r) => !have.has(r.slide_index ?? -1));
  if (!fresh.length) return;
  for (const row of fresh) {
    const { error } = await admin.from("canva_finish_jobs").insert(row);
    if (error && error.code !== "23505") throw new Error(`Could not start ${what}: ${error.message}`);
  }
}

/**
 * Start one option: a job that designs the post from a brief and finishes it
 * in Canva, or for a carousel one such job per slide (the slides after the
 * cover wait for it and follow its look). Answers the settings it used, so
 * the next option of the same request starts from them.
 *
 * A still starts from the client's logo set when the row has one to read
 * (16 Nov 2026): the canvas carries the file most of the client's posts show,
 * on the ground they show it on, and the job carries the set (input.logos)
 * for locate. With no set to read (none settled yet, or the logo changed
 * since, as when it was trimmed at this very start) the job has the one
 * file, and nothing waits. Either way the color behind the file is one the
 * file shows on (stillStart). The settings handed back are never changed by
 * this, and a video keeps the stored file.
 */
export async function startOption(admin: any, req: DesignRequest, given: Settings, brandName: string, briefIndex: number, optionIndex: number): Promise<Settings> {
  const brief = req.briefs[briefIndex % req.briefs.length];
  // The logo is its ink alone before a design is built on it (a logo stored padded is trimmed here, once).
  const settings = await settleLogo(admin, given, async () => (await import("../lifecycle/imaging.ts")).refitStoredLogo);
  if (req.kind === "video") { await startVideoOption(admin, req, settings, brandName, brief, optionIndex, await logoSize(admin, settings.logo_path)); return settings; }
  const start = await stillStart(admin, settings);
  const logoPath = start.logoPath;
  // The size of the file the canvas carries, read from the file itself.
  const [lw, lh] = pngSize(start.bytes ?? await logoBytes(admin, logoPath));
  // The color the canvas starts from: one the file shows on.
  const background = start.background;
  const slides = req.kind === "carousel" && brief.slides?.length ? brief.slides : [brief];
  const carousel = req.kind === "carousel" && slides.length > 1;
  // A Story is drawn on its own 9:16 page, as a Story, with the client's logo spot moved into Meta's safe band.
  const story = isStoryPost(req);
  // The size the request read for its platform (17 Nov 2026, _shared/design/platformSize.ts): the page every slide is
  // drawn on, the size it is delivered at, and the client's logo spot on that page. A request with none is made as before.
  const shape = jobShape(req.upload_size, story);
  // What the job would have been without the sizes table: the stored placement, and a Story's page. A job whose size the
  // image model refuses is made from this, so a size never fails a design (_shared/design/sizeFallback.ts).
  const asBefore = shape ? { placement: story ? storyLogoPlacement(settings.placement, lw, lh) : settings.placement, ...(story ? { size: { ...STORY_PAGE } } : {}) } : null;
  const rows = slides.map((slide, i) => ({
    client_id: req.client_id,
    created_by: req.requested_by,
    design_request_id: req.id,
    option_index: optionIndex,
    slide_index: carousel ? i : null,
    slide_count: carousel ? slides.length : null,
    step: "generate",
    input: {
      logo_path: logoPath,
      logo_size: [lw, lh],
      // The files locate may recognize and finish may stamp; absent for a job with one file.
      ...(start.logos ? { logos: start.logos } : {}),
      // The files finish may stamp, in order: the ground under the slot chooses among them (17 Nov 2026).
      ...(start.logos && start.stamp ? { stamp: start.stamp } : {}),
      copy: slide.headline,
      // The lettering beyond the headline, when the planned visual calls for any (options.ts); checked with the headline (pipeline.ts, wordsMatch).
      ...(slide.labels?.length ? { labels: slide.labels, ...(slide.placing ? { placing: slide.placing } : {}) } : {}),
      placement: story ? storyLogoPlacement(settings.placement, lw, lh) : shape ? pagePlacement(settings.placement, lw, lh, shape.page) : settings.placement,
      ...(asBefore ? { as_before: asBefore } : {}),
      title: `${brandName} ${req.platform ?? ""} option ${optionIndex + 1}${carousel ? ` slide ${i + 1}` : ""}`.replace(/\s+/g, " "),
      layout: brief.layout ?? null,
      // The posts this design builds on, as the planner chose them for this
      // post; a brief from before that choice existed uses the first three.
      generate: {
        brand_name: brandName, platform: req.platform ?? "social", concept: slide.picture, background, background_from: start.from, refs: brief.refs?.length ? brief.refs : settings.reference_paths.slice(0, 3),
        ...(story ? { size: { ...(shape?.page ?? STORY_PAGE) }, surface: STORY_SURFACE } : shape ? { size: { ...shape.page } } : {}),
        ...(shape ? { deliver: { ...shape.deliver } } : {}),
        // The person's note, so the image model sees it and a retry of the job keeps it.
        ...(req.note?.trim() ? { note: req.note.trim() } : {}),
      },
    },
  }));
  await insertJobs(admin, req.id, optionIndex, rows, "a design option");
  return settings;
}

/**
 * A video option: one job on the video worker. Its footage is one clip with
 * fixed settings (_shared/video/clip.ts), ordered only at the price approved
 * on the request, with sound; its hook is drawn on a transparent layer and
 * its words checked; the client's logo file goes on at its habitual spot
 * (_shared/video/steps.ts).
 */
async function startVideoOption(admin: any, req: DesignRequest, settings: Settings, brandName: string, brief: Brief, optionIndex: number, logo: [number, number]): Promise<void> {
  const { data: client } = await admin.from("clients").select("video_references, video_style").eq("id", req.client_id).maybeSingle();
  // A filmed clip is edited the way the client's filmed videos are: captions, title, logo spot and their own end card.
  const filmed = req.footage_path ? (client?.video_style?.profile?.filmed ?? null) : null;
  const endSource = filmed?.end_card_video ? (Array.isArray(client?.video_references) ? client.video_references : [])[filmed.end_card_video - 1]?.path : null;
  const endCard = endSource ? { url: admin.storage.from("design-references").getPublicUrl(endSource).data.publicUrl, seconds: filmed.end_card_seconds } : null;
  // A video made from the client's posts follows their posts, not their videos;
  // so does one whose client's kit was made with too few clean stills.
  const route = videoRouteFor(client?.video_style, req.video_route ?? null);
  const style = route === "posts" ? undefined : client?.video_style?.profile as { logo?: string; logo_at?: string; logo_width?: number; people?: string } | undefined;
  const title = `${brandName} ${req.platform ?? ""} video ${optionIndex + 1}`.replace(/\s+/g, " ");
  const row = {
    client_id: req.client_id,
    created_by: req.requested_by,
    design_request_id: req.id,
    option_index: optionIndex,
    // A filmed clip is the footage: its speech is captioned, then the hook is drawn and laid over it.
    // A generated video starts at its title; the worker makes the client's kit first when it is missing.
    step: req.footage_path ? "transcribe" : "title",
    input: {
      kind: "video",
      title,
      brand_name: brandName,
      copy: brief.headline,
      text_style: brief.text_style ?? "bold white sans-serif with a soft shadow, centered in the lower third",
      logo_path: settings.logo_path,
      logo_size: logo,
      placement: settings.placement,
      // The one clip's prompt; its length and every other setting are fixed (_shared/video/clip.ts CLIP).
      video: { prompt: brief.footage ?? brief.picture },
      // The clip's price approved on the request: the clip step orders only at this price or less.
      approved_credits: req.approved_credits ?? null,
      footage_upload: req.footage_path ?? null,
      video_route: route,
      // Logo and people as the client's own videos have them; a filmed clip keeps the logo.
      show_logo: req.footage_path ? true : style ? style.logo !== "none" : true,
      // Where and when, as in the client's videos; a filmed clip keeps the spot its posts use.
      logo_at: req.footage_path ? null : style?.logo_at ?? null,
      logo_width: req.footage_path ? null : style?.logo_width ?? null,
      people: style?.people ?? "none",
      filmed,
      end_card: endCard,
    },
  };
  await insertJobs(admin, req.id, optionIndex, [{ ...row, slide_index: null }], "the video");
}

/** Designs made by design requests, as opposed to media from older generators or uploads. */
export const DESIGN_ANGLE = /^Design option \d+$/;

/**
 * Whether a finished design becomes the post's design. It does, replacing the
 * post's earlier designs, unless someone put other media in use for the post
 * (an upload, or an older generator's image); that choice is theirs to change.
 * Earlier designs stay on the post, so any of them can be put back in use.
 */
async function takeOverPost(admin: any, req: DesignRequest): Promise<boolean> {
  const { data: selected } = await admin.from("post_iterations").select("id, variant_angle")
    .eq("client_id", req.client_id).eq("calendar_post_key", req.calendar_post_key).eq("is_selected", true);
  if ((selected ?? []).some((r: { variant_angle: string | null }) => !DESIGN_ANGLE.test(r.variant_angle ?? ""))) return false;
  const ids = (selected ?? []).map((r: { id: string }) => r.id);
  if (ids.length) await admin.from("post_iterations").update({ is_selected: false }).in("id", ids);
  return true;
}

/** Whether a design on a post is the one in use. */
async function wasInUse(admin: any, iterationId: string): Promise<boolean> {
  const { data } = await admin.from("post_iterations").select("is_selected, archived_at").eq("id", iterationId).maybeSingle();
  return !!data?.is_selected && !data?.archived_at;
}

/**
 * Bring a request up to date with its jobs: hand every finished option to the
 * post (a post_iterations row in the request's group, in use unless someone
 * chose other media for the post), start a
 * replacement for any option that did not finish, and record the stage.
 */
export async function settleRequest(admin: any, requestId: string): Promise<void> {
  // The Canva worker and the video worker both settle requests; one at a time
  // per request, so a finished design is handed to its post once.
  const holder = crypto.randomUUID();
  const lease = `settle:${requestId}`;
  const { data: claimed } = await admin.rpc("claim_worker_lease", { p_name: lease, p_holder: holder, p_seconds: 60 });
  if (!claimed) return;
  try {
    await settleRequestNow(admin, requestId);
  } finally {
    await admin.rpc("release_worker_lease", { p_name: lease, p_holder: holder });
  }
}

async function settleRequestNow(admin: any, requestId: string): Promise<void> {
  const { data: req } = await admin.from("design_requests").select("*").eq("id", requestId).maybeSingle();
  if (!req || req.status !== "preparing") return;
  const { data: jobs } = await admin.from("canva_finish_jobs").select("id, status, step, option_index, slide_index, slide_count, output_path, state, input, error").eq("design_request_id", requestId).order("created_at");
  type Row = JobState & { id: string; option_index: number; slide_index: number | null; slide_count: number | null; output_path: string | null; state: any; input: any; error?: string | null };
  const list = (jobs ?? []) as Row[];

  // One finished option, one design on the post: a single design, or a
  // carousel's slides in order. The first job of the option records the row.
  const byOption = new Map<number, Row[]>();
  for (const j of list) byOption.set(j.option_index, [...(byOption.get(j.option_index) ?? []), j]);
  for (const [optionIndex, rows] of byOption) {
    const ordered = [...rows].sort((a, b) => (a.slide_index ?? 0) - (b.slide_index ?? 0));
    const lead = ordered[0];
    const expected = lead.slide_count ?? 1;
    if (lead.state?.iteration_id) continue;
    if (ordered.length < expected || !ordered.every((j) => j.status === "done" && j.output_path)) continue;
    // A video's post media is the finished MP4 alone; its cards are inside it.
    const media = ordered.some((j) => j.input?.kind === "video") ? ordered.filter((j) => j.input?.kind === "video") : ordered;
    const urls = media.map((j) => admin.storage.from(BUCKET).getPublicUrl(j.output_path).data.publicUrl);
    const job = { ...lead, option_index: optionIndex };
    // A design finished again (state.replaces) takes the earlier one's place:
    // in use only if that one was, which then leaves the post.
    const replaces: string | undefined = lead.state?.replaces;
    const inUse = replaces ? await wasInUse(admin, replaces) : await takeOverPost(admin, req);
    const { data: row, error } = await admin.from("post_iterations").insert({
      client_id: req.client_id,
      report_id: req.report_id,
      calendar_post_key: req.calendar_post_key,
      platform: req.platform,
      post_copy: req.post_copy,
      format: req.format,
      source: "calendar",
      media_urls: urls,
      variant_group_id: req.id,
      variant_angle: `Design option ${job.option_index + 1}`,
      concept: job.input?.generate?.concept ?? null,
      is_selected: inUse,
      created_by: req.requested_by,
    }).select("id").single();
    if (error) throw new Error(`Could not add the finished design to the post: ${error.message}`);
    if (replaces) await admin.from("post_iterations").update({ is_selected: false, archived_at: new Date().toISOString() }).eq("id", replaces);
    await admin.from("canva_finish_jobs").update({ state: { ...job.state, iteration_id: row.id } }).eq("id", job.id);
  }

  // An option ends with its first slide that does not finish; its other
  // slides stop with it, so nothing more is spent on an option that is over.
  const over = new Set([...byOption].filter(([, rows]) => rows.some((j) => j.status === "failed" || j.status === "canceled")).map(([k]) => k));
  const stop = list.filter((j) => over.has(j.option_index) && (j.status === "queued" || j.status === "running"));
  if (stop.length) {
    await admin.from("canva_finish_jobs").update({ status: "canceled", lease_until: null, updated_at: new Date().toISOString() })
      .in("id", stop.map((j) => j.id)).in("status", ["queued", "running"]);
    for (const j of stop) j.status = "canceled";
  }

  const options = optionStates(list);
  // A video starts one option only (each buys a clip), so it is never replaced.
  const progress = requestProgress(options, req.options_wanted, (req.briefs ?? []).length, candidatesFor(req.kind));
  // Every option tried and none finished: closed, and made again later. A
  // video keeps its job's reason, so the post shows why.
  if (progress.status === "closed") {
    const why = req.kind === "video" ? list.find((j) => j.status === "failed" && j.error)?.error ?? null : null;
    return endRequest(admin, requestId, "no_design", why);
  }
  let started = options.length;
  if (progress.start_brief !== null) {
    const { data: settings } = await admin.from("design_brand_settings").select("*").eq("client_id", req.client_id).maybeSingle();
    if (!settings) return endRequest(admin, requestId, "no_design", "The client's design settings are gone.");
    const { data: client } = await admin.from("clients").select("name").eq("id", req.client_id).maybeSingle();
    await startOption(admin, req, settings, client?.name ?? "the brand", progress.start_brief, started);
    started += 1;
  }
  await admin.from("design_requests").update({
    status: progress.status,
    stage: progress.stage,
    options_ready: progress.options_ready,
    candidates_started: started,
    updated_at: new Date().toISOString(),
    // When the designs came back, so the post panel's usual time is measured from started_at to here.
    ...(progress.status === "ready" ? { ended_at: new Date().toISOString() } : {}),
  }).eq("id", requestId).eq("status", "preparing");
}

/**
 * Close a request quietly (status closed, with why): its unfinished jobs
 * stop, nobody is shown anything, and the week's design button counts the
 * post again the next time it is pressed when the reason calls for it
 * (weekDecision, _shared/design/requestRules.ts). Nothing is made again on
 * its own. The note is kept on the request as its error.
 */
export async function endRequest(admin: any, requestId: string, reason: EndReason, note?: string | null): Promise<void> {
  const now = new Date().toISOString();
  await admin.from("canva_finish_jobs").update({ status: "canceled", lease_until: null, updated_at: now })
    .eq("design_request_id", requestId).in("status", ["queued", "running"]);
  await admin.from("design_requests").update({
    status: "closed", end_reason: reason, ended_at: now, updated_at: now, ...(note ? { error: String(note).slice(0, 1000) } : {}),
  }).eq("id", requestId).in("status", ["preparing", "needs_filming"]);
}

/**
 * End every request that has been prepared for longer than REQUEST_MAX_MINUTES
 * (requestOverdue), the way a request whose planning stopped ends: quietly, as
 * "no_progress", its jobs stopped, the post counted again by the week's design
 * button. Run at the start of every worker pass, so a request is never handed
 * more work after its time is up and no stuck step can keep it open. Returns
 * the ids it ended.
 */
export async function endOverdueRequests(admin: any, now: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - REQUEST_MAX_MINUTES * 60_000).toISOString();
  const { data } = await admin.from("design_requests").select("id, status, stage, started_at, created_at")
    .eq("status", "preparing").lt("started_at", cutoff).order("started_at").limit(50);
  const ended: string[] = [];
  for (const r of data ?? []) {
    if (!requestOverdue(r, now)) continue;
    await endRequest(admin, r.id, "no_progress", `No design after ${REQUEST_MAX_MINUTES} minutes.`);
    ended.push(r.id);
  }
  return ended;
}

/** claimed: the job is this pass's for one lease; lost: another pass has it or it ended; failed: its last try was used up by runs that died. */
export type Claim = "claimed" | "lost" | "failed";

/**
 * A job's lease renewed to now + ms as a step starts that calls the picture
 * service: one call may take two timeouts and the retry pause between them,
 * which outlasts a pass's own lease. Used by the design worker's picture
 * steps and the video worker's title check. A job stopped meanwhile is left
 * as it is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function renewJobLease(admin: any, jobId: string, now: Date, ms: number): Promise<void> {
  await admin.from("canva_finish_jobs").update({ lease_until: new Date(now.getTime() + ms).toISOString(), updated_at: now.toISOString() })
    .eq("id", jobId).in("status", ["queued", "running"]);
}

/**
 * A job's step and state saved to its row, together, while it is active.
 * The rule for every picture the image model was paid for (a video's title,
 * its opening frame, a kit still's edit, a design, a logo removal): stored,
 * counted, saved to the job row, then used. A run that dies after the save,
 * in a picture service call that hangs, leaves the picture on the row, so
 * the next pass goes on from it instead of paying for another. Throws when
 * the row could not be written, so nothing is used as if it were saved. A
 * job stopped meanwhile is left as it is.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveJobProgress(admin: any, job: { id: string; step: string; state: unknown }): Promise<void> {
  const { error } = await admin.from("canva_finish_jobs").update({ step: job.step, state: job.state, updated_at: new Date().toISOString() })
    .eq("id", job.id).in("status", ["queued", "running"]);
  if (error) throw new Error(`Could not save the job's progress: ${error.message}`);
}

/**
 * Take a due job for one lease. A job whose lease ran out while it was still
 * queued or running was being worked on by a run that died (the edge runtime
 * cuts a run off for time or memory without letting it write anything), so
 * taking it counts a try; its other tries are counted where an error is
 * caught (recordFailure). At maxAttempts the job fails and its option is
 * replaced, instead of the same step dying every few minutes for days (10 Nov
 * 2026: one job, five days). The claim holds only while the row is as the pass
 * read it, so two passes never count one dead run twice.
 */
export async function claimJob(
  admin: any,
  job: { id: string; status: string; attempts: number | null; lease_until: string | null },
  now: Date,
  leaseMs: number,
  maxAttempts: number,
): Promise<Claim> {
  if (job.status !== "queued" && job.status !== "running") return "lost";
  const heldUntil = job.lease_until ? Date.parse(job.lease_until) : null;
  if (heldUntil !== null && heldUntil > now.getTime()) return "lost";
  const died = heldUntil !== null;
  const before = job.attempts ?? 0;
  const attempts = before + (died ? 1 : 0);
  const over = died && attempts >= maxAttempts;
  const at = now.toISOString();
  const change = over
    ? { status: "failed", attempts, error: `The design stopped before it finished, ${attempts} times in a row.`, lease_until: null, updated_at: at }
    : { status: "running", attempts, lease_until: new Date(now.getTime() + leaseMs).toISOString(), updated_at: at };
  const held = admin.from("canva_finish_jobs").update(change).eq("id", job.id).in("status", ["queued", "running"]).eq("attempts", before);
  const { data } = await (job.lease_until ? held.eq("lease_until", job.lease_until) : held.is("lease_until", null)).select("id");
  if (!data?.length) return "lost";
  return over ? "failed" : "claimed";
}
