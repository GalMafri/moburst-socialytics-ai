// supabase/functions/_shared/canva/jobs.ts
//
// Starting a post's design options and keeping its request up to date. Used
// by design-request (to start the first options) and by canva-finish's worker
// (after every step, to record progress, hand finished options to the post,
// and replace any option that did not finish).

import { type Brief, requestProgress, type JobState } from "./options.ts";

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

/** Start one option: a job that designs the post from a brief, then finishes it in Canva. */
export async function startOption(admin: any, req: DesignRequest, settings: Settings, brandName: string, briefIndex: number, optionIndex: number): Promise<void> {
  const brief = req.briefs[briefIndex % req.briefs.length];
  const [lw, lh] = await logoSize(admin, settings.logo_path);
  const { error } = await admin.from("canva_finish_jobs").insert({
    client_id: req.client_id,
    created_by: req.requested_by,
    design_request_id: req.id,
    option_index: optionIndex,
    step: "generate",
    input: {
      logo_path: settings.logo_path,
      logo_size: [lw, lh],
      copy: brief.headline,
      placement: settings.placement,
      title: `${brandName} ${req.platform ?? ""} option ${optionIndex + 1}`.replace(/\s+/g, " "),
      generate: { brand_name: brandName, platform: req.platform ?? "social", concept: brief.picture, background: settings.background, refs: settings.reference_paths },
    },
  });
  if (error) throw new Error(`Could not start a design option: ${error.message}`);
}

/**
 * Bring a request up to date with its jobs: hand every finished option to the
 * post (a post_iterations row in the request's group, not yet in use), start a
 * replacement for any option that did not finish, and record the stage.
 */
export async function settleRequest(admin: any, requestId: string): Promise<void> {
  const { data: req } = await admin.from("design_requests").select("*").eq("id", requestId).maybeSingle();
  if (!req || req.status !== "preparing") return;
  const { data: jobs } = await admin.from("canva_finish_jobs").select("id, status, step, option_index, output_path, state, input").eq("design_request_id", requestId).order("created_at");
  const list = (jobs ?? []) as Array<JobState & { id: string; option_index: number; output_path: string | null; state: any; input: any }>;

  for (const job of list) {
    if (job.status !== "done" || !job.output_path || job.state?.iteration_id) continue;
    const url = admin.storage.from(BUCKET).getPublicUrl(job.output_path).data.publicUrl;
    const { data: row, error } = await admin.from("post_iterations").insert({
      client_id: req.client_id,
      report_id: req.report_id,
      calendar_post_key: req.calendar_post_key,
      platform: req.platform,
      post_copy: req.post_copy,
      format: req.format,
      source: "calendar",
      media_urls: [url],
      variant_group_id: req.id,
      variant_angle: `Design option ${job.option_index + 1}`,
      concept: job.input?.generate?.concept ?? null,
      is_selected: false,
      created_by: req.requested_by,
    }).select("id").single();
    if (error) throw new Error(`Could not add the finished design to the post: ${error.message}`);
    await admin.from("canva_finish_jobs").update({ state: { ...job.state, iteration_id: row.id } }).eq("id", job.id);
  }

  const progress = requestProgress(list, req.options_wanted, (req.briefs ?? []).length);
  let started = list.length;
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
