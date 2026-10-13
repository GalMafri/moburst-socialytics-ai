// supabase/functions/_shared/canva/jobs.ts
//
// Starting a post's design options and keeping its request up to date. Used
// by design-request (to start the first options) and by canva-finish's worker
// (after every step, to record progress, hand finished options to the post,
// and replace any option that did not finish).

import { type Brief, optionStates, requestProgress, type JobState } from "./options.ts";
import { CARD_SIZE, TIMING } from "../video/compose.ts";

export const BUCKET = "generated-media";

export interface Settings {
  client_id: string;
  logo_path: string;
  placement: { anchor: "left" | "center" | "right"; width: number; top: number; left?: number };
  background: string;
  reference_paths: string[];
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
}

/** A PNG's pixel size from its header. */
export function pngSize(bytes: Uint8Array): [number, number] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || v.getUint32(0) !== 0x89504e47) throw new Error("The logo must be a PNG file.");
  return [v.getUint32(16), v.getUint32(20)];
}

async function logoSize(admin: any, path: string): Promise<[number, number]> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Could not read the logo file: ${error?.message ?? "missing"}`);
  return pngSize(new Uint8Array(await data.arrayBuffer()));
}

/**
 * Start one option: a job that designs the post from a brief and finishes it
 * in Canva, or for a carousel one such job per slide (the slides after the
 * cover wait for it and follow its look).
 */
export async function startOption(admin: any, req: DesignRequest, settings: Settings, brandName: string, briefIndex: number, optionIndex: number): Promise<void> {
  const brief = req.briefs[briefIndex % req.briefs.length];
  const [lw, lh] = await logoSize(admin, settings.logo_path);
  if (req.kind === "video") return startVideoOption(admin, req, settings, brandName, brief, optionIndex, [lw, lh]);
  const slides = req.kind === "carousel" && brief.slides?.length ? brief.slides : [brief];
  const carousel = req.kind === "carousel" && slides.length > 1;
  const rows = slides.map((slide, i) => ({
    client_id: req.client_id,
    created_by: req.requested_by,
    design_request_id: req.id,
    option_index: optionIndex,
    slide_index: carousel ? i : null,
    slide_count: carousel ? slides.length : null,
    step: "generate",
    input: {
      logo_path: settings.logo_path,
      logo_size: [lw, lh],
      copy: slide.headline,
      placement: settings.placement,
      title: `${brandName} ${req.platform ?? ""} option ${optionIndex + 1}${carousel ? ` slide ${i + 1}` : ""}`.replace(/\s+/g, " "),
      layout: brief.layout ?? null,
      // The posts this design builds on, as the planner chose them for this
      // post; a brief from before that choice existed uses the first three.
      generate: { brand_name: brandName, platform: req.platform ?? "social", concept: slide.picture, background: settings.background, refs: brief.refs?.length ? brief.refs : settings.reference_paths.slice(0, 3) },
    },
  }));
  const { error } = await admin.from("canva_finish_jobs").insert(rows);
  if (error) throw new Error(`Could not start a design option: ${error.message}`);
}

/**
 * A video option: its cover card and end card, designed like a carousel's
 * slides but at 9:16 (the end card waits for the cover and follows its look),
 * and a third job that generates the footage and joins the three.
 */
async function startVideoOption(admin: any, req: DesignRequest, settings: Settings, brandName: string, brief: Brief, optionIndex: number, logo: [number, number]): Promise<void> {
  const [cover, end] = brief.slides?.length === 2 ? brief.slides : [brief, brief];
  const refs = brief.refs?.length ? brief.refs : settings.reference_paths.slice(0, 3);
  const title = `${brandName} ${req.platform ?? ""} video ${optionIndex + 1}`.replace(/\s+/g, " ");
  const card = (slide: { headline: string[]; picture: string }, i: 0 | 1) => ({
    client_id: req.client_id,
    created_by: req.requested_by,
    design_request_id: req.id,
    option_index: optionIndex,
    slide_index: i,
    slide_count: 3,
    step: "generate",
    input: {
      kind: "video_card",
      logo_path: settings.logo_path,
      logo_size: logo,
      copy: slide.headline,
      placement: settings.placement,
      title: `${title} ${i === 0 ? "cover" : "end card"}`,
      layout: brief.layout ?? null,
      generate: { brand_name: brandName, platform: req.platform ?? "social", concept: slide.picture, background: settings.background, refs, size: CARD_SIZE, video_card: i === 0 ? "cover" : "end" },
    },
  });
  const rows = [card(cover, 0), card(end, 1), {
    client_id: req.client_id,
    created_by: req.requested_by,
    design_request_id: req.id,
    option_index: optionIndex,
    slide_index: 2,
    slide_count: 3,
    step: "footage",
    input: { kind: "video", title, video: { prompt: brief.footage ?? brief.picture, seconds: TIMING.footage } },
  }];
  const { error } = await admin.from("canva_finish_jobs").insert(rows);
  if (error) throw new Error(`Could not start the video: ${error.message}`);
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
  const { data: jobs } = await admin.from("canva_finish_jobs").select("id, status, step, option_index, slide_index, slide_count, output_path, state, input").eq("design_request_id", requestId).order("created_at");
  type Row = JobState & { id: string; option_index: number; slide_index: number | null; slide_count: number | null; output_path: string | null; state: any; input: any };
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
    const inUse = await takeOverPost(admin, req);
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
    await admin.from("canva_finish_jobs").update({ state: { ...job.state, iteration_id: row.id } }).eq("id", job.id);
  }

  const options = optionStates(list);
  const progress = requestProgress(options, req.options_wanted, (req.briefs ?? []).length);
  let started = options.length;
  if (progress.start_brief !== null) {
    const { data: settings } = await admin.from("design_brand_settings").select("*").eq("client_id", req.client_id).maybeSingle();
    const { data: client } = await admin.from("clients").select("name").eq("id", req.client_id).maybeSingle();
    if (settings) {
      await startOption(admin, req, settings, client?.name ?? "the brand", progress.start_brief, started);
      started += 1;
    }
  }
  await admin.from("design_requests").update({
    status: progress.status,
    stage: progress.status === "needs_staff" ? "designing" : progress.stage,
    options_ready: progress.options_ready,
    candidates_started: started,
    updated_at: new Date().toISOString(),
  }).eq("id", requestId);
}
