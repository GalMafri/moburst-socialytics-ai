// supabase/functions/_shared/higgsfield/generate.ts
//
// Generating a still or a clip through Higgsfield's MCP.
//
// The shapes here were read off the live server on 2026-09-10, not off a
// spec, because the published one has been wrong before. What was measured:
//
//   media_import_url {url,type}          → {media_id, type, content_type, source_url}
//   generate_image_batch {requests[]}    → {jobs:[{index,job_id,status}], submitted_count, failed_count}
//   jobs_wait {jobs[],timeout_seconds}   → {jobs:[{index,job_id,status,type,model,result_url}],
//                                           summary:{total,completed,failed,active,errors}, all_terminal}
//   generate_image {…,get_cost:true}     → {cost:{credits, credits_exact}} and submits nothing
//   balance {}                           → {credits, subscription_plan_type}
//
// Four things about this API will bite anyone who assumes otherwise:
//
//  1. `use_unlim` must be sent. Left out, the server may answer a generation
//     request with a QUESTION (`unlim_choice`) about which balance to spend,
//     submit nothing, and look like a success. There is no human here to
//     answer it, so every call states `false` and spends credits.
//  2. `medias[].value` is a media id, never a URL. References have to be
//     imported first, which is what importReference is for.
//  3. The batch tools are the headless ones. `generate_image` opens a widget
//     in a chat client; `generate_image_batch` just returns job ids.
//  4. A video submission can come back `submission_failed` with a style
//     preset the server would rather run. Nothing was created and nothing
//     was charged; the answer is to resubmit with declined_preset_id.
//
// Kept free of Deno globals so vitest can drive it with a stub client.

/** What this module needs of an MCP client — the real one satisfies it. */
export interface ToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<{ data: unknown; text: string; isError: boolean }>;
}

export const IMAGE_MODEL = "nano_banana_pro";
export const VIDEO_MODEL = "seedance_2_5";

/** Read from models_explore on 2026-09-10. */
const IMAGE_ASPECTS = ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "9:16", "16:9", "21:9"];
const VIDEO_ASPECTS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];

export interface JobRef {
  index: number;
  job_id: string;
}

export interface JobOutcome extends JobRef {
  status: string;
  model?: string;
  result_url?: string;
  error?: string;
}

export class HiggsfieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiggsfieldError";
  }
}

const ratio = (aspect: string): number | null => {
  const [w, h] = aspect.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : null;
};

/**
 * The supported aspect closest to the one asked for.
 *
 * Video has no 4:5, so a request for the Instagram portrait format has to
 * land somewhere. Nearest-by-ratio puts it on 3:4 rather than on the much
 * taller 9:16, which is the smaller lie.
 */
function nearestAspect(want: string, supported: string[]): string {
  const target = ratio(want);
  if (target == null) return supported[0];
  if (supported.includes(want)) return want;
  let best = supported[0];
  let bestGap = Infinity;
  for (const candidate of supported) {
    const r = ratio(candidate);
    if (r == null) continue;
    const gap = Math.abs(Math.log(r) - Math.log(target));
    if (gap < bestGap) {
      bestGap = gap;
      best = candidate;
    }
  }
  return best;
}

export const imageAspect = (want: string): string => nearestAspect(want, IMAGE_ASPECTS);
export const videoAspect = (want: string): string => nearestAspect(want, VIDEO_ASPECTS);

/** Structured content if the tool gave any, else whatever parsed out of the text. */
function payload(result: { data: unknown; text: string; isError: boolean }, tool: string): any {
  if (result.isError) throw new HiggsfieldError(`Higgsfield ${tool} failed: ${result.text.slice(0, 300)}`);
  const data = result.data as any;
  // A generation call that comes back asking which balance to spend has not
  // generated anything. Better a clear failure than a silent no-op.
  if (data && typeof data === "object" && "unlim_choice" in data) {
    throw new HiggsfieldError(
      `Higgsfield asked which balance to spend instead of generating. This is a bug: use_unlim must be sent on every ${tool} call.`,
    );
  }
  return data;
}

/**
 * Pull one reference into Higgsfield's storage and return its media id.
 *
 * The url has to be fetchable by Higgsfield, so a Supabase signed url is
 * what gets passed: the references bucket is private and stays that way.
 * Verified against the live server with a 15-minute signed url.
 */
export async function importReference(
  mcp: ToolCaller,
  url: string,
  type: "image" | "video" = "image",
): Promise<string | null> {
  try {
    const data = payload(await mcp.callTool("media_import_url", { url, type }), "media_import_url");
    const id = data?.media_id;
    return typeof id === "string" && id.length > 0 ? id : null;
  } catch {
    // One unreadable reference should not sink a generation that has others.
    return null;
  }
}

/** Import several, keeping order and dropping the ones that would not load. */
export async function importReferences(
  mcp: ToolCaller,
  urls: string[],
  type: "image" | "video" = "image",
): Promise<string[]> {
  const ids: string[] = [];
  for (const url of urls) {
    const id = await importReference(mcp, url, type);
    if (id) ids.push(id);
  }
  return ids;
}

export interface Balance {
  credits: number;
  plan: string | null;
}

export async function creditBalance(mcp: ToolCaller): Promise<Balance | null> {
  try {
    const data = payload(await mcp.callTool("balance", {}), "balance");
    const credits = Number(data?.credits);
    if (!Number.isFinite(credits)) return null;
    return { credits, plan: typeof data?.subscription_plan_type === "string" ? data.subscription_plan_type : null };
  } catch {
    return null;
  }
}

/**
 * What this exact generation would cost, without submitting it.
 *
 * Not supported inside the batch tools, so it goes through the single-shot
 * tool with get_cost set — which the server answers without opening a widget
 * and without creating a job.
 */
export async function costOf(
  mcp: ToolCaller,
  kind: "image" | "video",
  params: Record<string, unknown>,
): Promise<number | null> {
  try {
    const tool = kind === "image" ? "generate_image" : "generate_video";
    const data = payload(await mcp.callTool(tool, { params: { ...params, use_unlim: false, get_cost: true } }), tool);
    const credits = Number(data?.cost?.credits_exact ?? data?.cost?.credits);
    return Number.isFinite(credits) ? credits : null;
  } catch {
    return null;
  }
}

/**
 * The preset id the server wants declined, when it recommended one instead
 * of generating.
 *
 * Measured on the live server: a video submission can come back with
 * `status:"submission_failed"` and a `preset_recommendation`, having created
 * nothing and charged nothing. It is the same shape of trap as unlim_choice —
 * the server asking a human a question — and the documented answer is to
 * resubmit with declined_preset_id. Nobody is here to answer, so the caller
 * declines and resubmits by itself.
 */
export function recommendedPresetId(data: any): string | null {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  for (const j of jobs) {
    const id = j?.preset_recommendation?.preset_id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

function readJobs(data: any, tool: string): JobRef[] {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
  const refs = jobs
    .filter((j: any) => typeof j?.job_id === "string" && j.status !== "submission_failed")
    .map((j: any) => ({ index: Number(j.index) || 0, job_id: j.job_id as string }));
  if (!refs.length) {
    const why = jobs.find((j: any) => typeof j?.error === "string")?.error;
    throw new HiggsfieldError(
      why
        ? `Higgsfield did not start the generation: ${String(why).slice(0, 200)}`
        : `Higgsfield ${tool} accepted the request but returned no job.`,
    );
  }
  return refs;
}

export interface ImageRequest {
  prompt: string;
  aspect: string;
  /** Media ids from importReference, not urls. */
  referenceIds?: string[];
  resolution?: "1k" | "2k" | "4k";
  model?: string;
}

export async function submitImage(mcp: ToolCaller, req: ImageRequest): Promise<JobRef[]> {
  const params: Record<string, unknown> = {
    model: req.model || IMAGE_MODEL,
    prompt: req.prompt,
    aspect_ratio: imageAspect(req.aspect),
    resolution: req.resolution || "2k",
    use_unlim: false,
  };
  if (req.referenceIds?.length) {
    params.medias = req.referenceIds.map((value) => ({ value, role: "image_references" }));
  }
  const data = payload(
    await mcp.callTool("generate_image_batch", { requests: [{ index: 0, params }] }),
    "generate_image_batch",
  );
  return readJobs(data, "generate_image_batch");
}

export interface VideoRequest {
  prompt: string;
  aspect: string;
  seconds?: number;
  /** The designed still the clip moves, if there is one. */
  startImageId?: string;
  referenceIds?: string[];
  resolution?: "480p" | "720p" | "1080p";
  withAudio?: boolean;
  model?: string;
}

export async function submitVideo(mcp: ToolCaller, req: VideoRequest): Promise<JobRef[]> {
  const medias: Array<{ value: string; role: string }> = [];
  if (req.startImageId) medias.push({ value: req.startImageId, role: "start_image" });
  for (const value of req.referenceIds || []) medias.push({ value, role: "image_references" });

  const params: Record<string, unknown> = {
    model: req.model || VIDEO_MODEL,
    prompt: req.prompt,
    aspect_ratio: videoAspect(req.aspect),
    duration: req.seconds || 5,
    resolution: req.resolution || "720p",
    // Silent by default: these clips sit in a report next to other media and
    // an invented soundtrack is not something anyone asked for.
    generate_audio: req.withAudio === true,
    use_unlim: false,
  };
  // t2v refuses reference media outright; omni_reference is the mode that
  // takes a still and moves it.
  if (medias.length) {
    params.mode = "omni_reference";
    params.medias = medias;
  }
  let data = payload(
    await mcp.callTool("generate_video_batch", { requests: [{ index: 0, params }] }),
    "generate_video_batch",
  );

  // The server may answer with a style preset it would rather run. Declining
  // it and resubmitting is the documented way through; without this the clip
  // never starts and the reason reads like a failure.
  const preset = recommendedPresetId(data);
  if (preset) {
    data = payload(
      await mcp.callTool("generate_video_batch", {
        requests: [{ index: 0, params: { ...params, declined_preset_id: preset } }],
      }),
      "generate_video_batch",
    );
  }
  return readJobs(data, "generate_video_batch");
}

export interface WaitResult {
  outcomes: JobOutcome[];
  allTerminal: boolean;
  waitedMs: number;
}

export interface WaitOptions {
  /** Total time to spend waiting. Edge functions die at 150s. */
  budgetMs?: number;
  /** Longest single long-poll the server accepts. */
  pollSeconds?: number;
  now?: () => number;
}

/**
 * Wait for jobs, up to a budget.
 *
 * jobs_wait long-polls for at most 15 seconds, so finishing a generation
 * means calling it repeatedly. The budget matters: the platform kills an
 * edge request at 150 seconds, and a caller that spends all of it waiting
 * has no time left to store what it fetched. When the budget runs out this
 * returns what it has with allTerminal false rather than throwing, so the
 * caller can decide between reporting a timeout and handing back job ids.
 */
export async function awaitJobs(mcp: ToolCaller, jobs: JobRef[], opts: WaitOptions = {}): Promise<WaitResult> {
  const budgetMs = opts.budgetMs ?? 90_000;
  const pollSeconds = Math.min(Math.max(opts.pollSeconds ?? 15, 0), 15);
  const now = opts.now ?? (() => Date.now());
  const started = now();
  let outcomes: JobOutcome[] = jobs.map((j) => ({ ...j, status: "pending" }));

  // do/while, so a zero budget still asks once. A caller that wants a
  // snapshot rather than a wait passes budgetMs 0, and getting no answer at
  // all for that would be a trap.
  do {
    const data = payload(
      await mcp.callTool("jobs_wait", {
        jobs: jobs.map((j) => ({ index: j.index, job_id: j.job_id })),
        timeout_seconds: pollSeconds,
      }),
      "jobs_wait",
    );
    const seen = Array.isArray(data?.jobs) ? data.jobs : [];
    if (seen.length) {
      outcomes = seen.map((j: any) => ({
        index: Number(j.index) || 0,
        job_id: String(j.job_id || ""),
        status: String(j.status || "unknown"),
        model: typeof j.model === "string" ? j.model : undefined,
        result_url: typeof j.result_url === "string" ? j.result_url : undefined,
        error: typeof j.error === "string" ? j.error : undefined,
      }));
    }
    if (data?.all_terminal === true) return { outcomes, allTerminal: true, waitedMs: now() - started };
  } while (now() - started < budgetMs);
  return { outcomes, allTerminal: false, waitedMs: now() - started };
}

/** The first finished result, or an explanation of why there is not one. */
export function firstResult(result: WaitResult): { url: string; model?: string } {
  const done = result.outcomes.find((o) => o.status === "completed" && o.result_url);
  if (done) return { url: done.result_url!, model: done.model };
  const failed = result.outcomes.find((o) => o.status === "failed" || o.error);
  if (failed) throw new HiggsfieldError(`Higgsfield could not finish the generation: ${failed.error || failed.status}`);
  if (!result.allTerminal) {
    throw new HiggsfieldError(
      `Higgsfield was still working after ${Math.round(result.waitedMs / 1000)}s. Nothing was lost, so try again in a moment.`,
    );
  }
  throw new HiggsfieldError("Higgsfield finished without returning an image.");
}
