// supabase/functions/_shared/design/platformSizeRefresh.ts
//
// The weekly platform_sizes job (17 Nov 2026, spec
// docs/superpowers/specs/2026-11-17-platform-sizes-design.md, section 3):
// fetch Sprout Social's image sizes guide, have the planning model pick the
// post sizes out of it into a strict structure, check each on exact facts,
// compare with the size in use and write. What is read and what it changes
// is decided in platformSizeRead.ts and platformSize.ts; this file fetches,
// asks and writes.
//
// A failure of any kind changes no size: a fetch that fails, a page that is
// not the guide, an answer that is not the structure. The run is recorded
// with its reason (platform_size_reads), the queue tries the job again, and
// nobody is told or asked anything. Every design goes on reading the last
// good size.

import { anthropicMessages, type AnthropicResult } from "../anthropic.ts";
import { costCtx, hasKey } from "../paid/index.ts";
import type { JobOutcome, ScheduledJob } from "../scheduled-jobs/types.ts";
import {
  EXTRACT_TOOL, GUIDE_URL, MIN_GUIDE_CHARS,
  NO_WORD, decide, extractPrompt, guideParts, guideText, guideUpdated, jsonIn, modelWord, parseExtract, refusedRow, sizesIn,
  type Key, type ModelWord, type RowResult, type SizeOutcomeRow, type SizeRow,
} from "./platformSizeRead.ts";
import { UPLOAD_FORMATS, type UploadFormat } from "./platformSize.ts";
import { VIDEO_FORMATS, type VideoFormat } from "../video/videoSize.ts";
import { VIDEO_GUIDE_URL, decideVideo, videoGuideParts, type VideoRowResult, type VideoSizeRow } from "../video/videoSizeRead.ts";

/** The planning model (design-request's PLANNER_MODEL). */
export const SIZES_MODEL = "claude-opus-5-5";
const FETCH_TIMEOUT_MS = 20_000;
const MODEL_TIMEOUT_MS = 120_000;
/** Room for the model's thinking, which counts here, and the answer after it (about 600 tokens for seven rows). */
const MODEL_MAX_TOKENS = 16_000;

/**
 * The request the read sends. The model chooses the tool itself: this model
 * answers a forced tool choice (type "tool" or "any") with a 400 that says
 * those types "are not supported for this model", which failed every read
 * until 18 Nov 2026. The instruction asks for the call (extractPrompt), the
 * tool is strict so the call's input keeps the schema, and what comes back
 * is checked in code either way (parseExtract). The choice is written out
 * here in full: the test that reads every function for a forced choice
 * (supabase/tests/_shared) passes no other way of naming it.
 */
export function extractRequest(prompt: string): Record<string, unknown> {
  return {
    model: SIZES_MODEL,
    max_tokens: MODEL_MAX_TOKENS,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: prompt }],
  };
}

/**
 * The model's answer out of its reply: the tool's input when it called the
 * tool, else the JSON it wrote. A reply cut off at the token limit, or one
 * that ended on a refusal, is no answer, whatever part of one it holds: the
 * read fails and is tried again.
 */
export function extractAnswer(result: AnthropicResult): unknown {
  if (result.stopReason === "max_tokens") throw new Error("The answer was cut off before it ended.");
  if (result.stopReason === "refusal") throw new Error("The model declined to read the guide.");
  const blocks = (result.raw as { content?: Array<{ type?: string; name?: string; input?: unknown }> } | null)?.content ?? [];
  const call = blocks.find((b) => b?.type === "tool_use" && b.name === EXTRACT_TOOL.name);
  return call?.input ?? jsonIn(result.text);
}

export interface SizeDeps {
  /** The guide's HTML, and the HTTP status it came with. */
  fetchGuide(url: string): Promise<{ status: number; html: string }>;
  /** The model's answer to the instruction: the tool's input, or what it wrote. */
  extract(prompt: string): Promise<unknown>;
}

export interface SizeRun {
  ok: boolean;
  source: string;
  source_updated: string | null;
  error: string | null;
  rows: RowResult[];
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

/** The table's rows, in a fixed order: the stills' (read from the image sizes guide) and the videos' (from the video specs guide, since 18 Nov 2026). */
async function allRows(db: Db): Promise<{ stills: SizeRow[]; videos: VideoSizeRow[] }> {
  const { data, error } = await db.from("platform_sizes").select("platform, format, width, height, pending_width, pending_height, pending_at, previous_width, previous_height, usable").order("platform").order("format");
  if (error) throw new Error(`Could not read the sizes: ${error.message}`);
  const rows = (data ?? []) as Array<SizeRow & { pending_at?: string | null }>;
  return {
    stills: rows.filter((r) => UPLOAD_FORMATS.includes(r.format as UploadFormat)),
    videos: rows.filter((r) => VIDEO_FORMATS.includes(r.format as unknown as VideoFormat)) as unknown as VideoSizeRow[],
  };
}

/** What the image model did with each size (platform_size_outcomes). A read that fails says nothing: no size is taken back on it. */
async function modelWords(db: Db): Promise<ModelWord> {
  const { data, error } = await db.from("platform_size_outcomes").select("platform, format, width, height, drawn_at, refusal_confirmed_at").order("platform").order("format");
  if (error) {
    console.warn("[platform-sizes] could not read what the image model did with the sizes:", error.message);
    return NO_WORD;
  }
  return modelWord((data ?? []) as SizeOutcomeRow[]);
}

/**
 * One read of the guide against the rows given: what each row's read comes
 * to, with nothing written. A read that fails as a whole says why and has
 * no rows.
 */
export async function readGuide(rows: SizeRow[], deps: SizeDeps, word: ModelWord = NO_WORD, now: Date = new Date()): Promise<SizeRun> {
  const run = (over: Partial<SizeRun>): SizeRun => ({ ok: false, source: GUIDE_URL, source_updated: null, error: null, rows: [], ...over });
  let page: { status: number; html: string };
  try {
    page = await deps.fetchGuide(GUIDE_URL);
  } catch (e) {
    return run({ error: `The guide could not be fetched: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500) });
  }
  if (page.status !== 200) return run({ error: `The guide answered ${page.status}.` });
  const updated = guideUpdated(page.html);
  const text = guideText(page.html);
  const parts = guideParts(text);
  // The guide: a page of its length with sizes on it and a part for at least one platform the table holds.
  const known = rows.some((r) => parts.cheat.has(r.platform) || parts.section.has(r.platform));
  if (text.length < MIN_GUIDE_CHARS || !sizesIn(text).length || !known) {
    return run({ source_updated: updated, error: `The page is not the sizes guide: ${text.length} characters, ${sizesIn(text).length} sizes, ${parts.cheat.size} cheat sheet rows, ${parts.section.size} sections.` });
  }
  const keys: Key[] = rows.map((r) => ({ platform: r.platform, format: r.format }));
  let answer: unknown;
  try {
    answer = await deps.extract(extractPrompt(keys, text));
  } catch (e) {
    return run({ source_updated: updated, error: `The sizes could not be read from the guide: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500) });
  }
  const read = parseExtract(answer, keys);
  if (!read) return run({ source_updated: updated, error: "The answer about the guide was not in the form asked for." });
  return run({ ok: true, source_updated: updated, rows: rows.map((r) => decide(r, read.get(`${r.platform}/${r.format}`), parts, word, now)) });
}

/** A read of the video specs guide against the video rows: one run of its own, recorded on its own. */
export interface VideoSizeRun extends Omit<SizeRun, "rows"> { rows: VideoRowResult[] }

/**
 * One read of the video specs guide against the video rows given: what each
 * row's read comes to, with nothing written (videoSizeRead.ts). A read that
 * fails as a whole says why and has no rows.
 */
export async function readVideoGuide(rows: VideoSizeRow[], deps: SizeDeps, now: Date = new Date()): Promise<VideoSizeRun> {
  const run = (over: Partial<VideoSizeRun>): VideoSizeRun => ({ ok: false, source: VIDEO_GUIDE_URL, source_updated: null, error: null, rows: [], ...over });
  let page: { status: number; html: string };
  try {
    page = await deps.fetchGuide(VIDEO_GUIDE_URL);
  } catch (e) {
    return run({ error: `The video guide could not be fetched: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500) });
  }
  if (page.status !== 200) return run({ error: `The video guide answered ${page.status}.` });
  const updated = guideUpdated(page.html);
  const text = guideText(page.html);
  const parts = videoGuideParts(text, rows);
  if (text.length < MIN_GUIDE_CHARS || !parts.table.length || !parts.known) {
    return run({ source_updated: updated, error: `The page is not the video specs guide: ${text.length} characters, ${parts.table.length} table rows, ${parts.sections.size} sections.` });
  }
  return run({ ok: true, source_updated: updated, rows: rows.map((r) => decideVideo(r, parts.table, now)) });
}

/**
 * A run, with nothing written. First the rows whose size in use the image
 * model refuses: they go back to a drawn size or to none, whatever the
 * guide says and whether or not it can be read. Then the guide, for every
 * other row. The video rows are read from the video specs guide, as a run
 * of their own (null when the table has none).
 */
async function sizeRun(db: Db, deps: SizeDeps): Promise<SizeRun & { video: VideoSizeRun | null }> {
  const { stills: rows, videos } = await allRows(db);
  const word = await modelWords(db);
  const back = rows.map((r) => refusedRow(r, word)).filter((r): r is RowResult => !!r);
  const taken = new Set(back.map((r) => `${r.platform}/${r.format}`));
  const run = await readGuide(rows.filter((r) => !taken.has(`${r.platform}/${r.format}`)), deps, word);
  const video = videos.length ? await readVideoGuide(videos, deps) : null;
  return { ...run, rows: [...back, ...run.rows], video };
}

/** One recorded read (record_platform_size_read): how many rows it changed. */
async function record(db: Db, run: SizeRun | VideoSizeRun): Promise<number> {
  const { data, error } = await db.rpc("record_platform_size_read", { p_read: run });
  if (error) throw new Error(`Could not record the read of the sizes guide: ${error.message}`);
  return Number((data as { changed?: number } | null)?.changed) || 0;
}

/**
 * One run: read, then record each guide's read and apply what it changes
 * (record_platform_size_read), the video guide's on its own, so a failure
 * of either guide changes nothing the other read.
 */
export async function refreshPlatformSizes(db: Db, deps: SizeDeps): Promise<SizeRun & { changed: number; video: (VideoSizeRun & { changed: number }) | null }> {
  const { video, ...run } = await sizeRun(db, deps);
  const changed = await record(db, run);
  return { ...run, changed, video: video ? await recordVideo(db, video) : null };
}

/**
 * The video guide's read, recorded. A write that fails is logged and the
 * read counts as not made: it never fails the job, whose image read is
 * already recorded, so the queue never tries the job again for it the same
 * day. The video rows are read again the next day.
 */
async function recordVideo(db: Db, video: VideoSizeRun): Promise<VideoSizeRun & { changed: number }> {
  try {
    return { ...video, changed: await record(db, video) };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[platform-sizes] could not record the read of the video specs guide:", error);
    return { ...video, ok: false, error: error.slice(0, 500), changed: 0 };
  }
}

const count = (rows: RowResult[], ...outcomes: RowResult["outcome"][]) => rows.filter((r) => outcomes.includes(r.outcome)).length;

/** What the video guide's read came to, in the job's reason. */
function videoLine(video: VideoSizeRun | null): string {
  if (!video) return "";
  if (!video.ok) return ` The video specs guide could not be read (${video.error ?? "no reason given"}); the video sizes stand and it is read again tomorrow.`;
  const rows = video.rows as unknown as RowResult[];
  return ` Read the video specs guide: ${rows.length} sizes, ${count(rows, "same")} as they were, ${count(rows, "confirmed")} changed, ${count(rows, "held")} held for a read on a later day, ${count(rows, "refused")} refused.`;
}

/**
 * The job. A read of the image guide that worked is done, whatever it
 * changed or refused. A read that failed as a whole is recorded and thrown,
 * so the queue tries it again (its usual three tries) and the next morning
 * queues another. The video guide's read is recorded either way and never
 * fails the job: its rows stand until a later read, and a retry of the job
 * on the same day never confirms a size it held (videoSizeRead.ts).
 */
export async function runPlatformSizes(db: Db, _job: ScheduledJob, deps: SizeDeps): Promise<JobOutcome> {
  const run = await refreshPlatformSizes(db, deps);
  if (!run.ok) throw new Error(run.error ?? "The sizes guide could not be read.");
  return {
    status: "done",
    reason: `Read the sizes guide: ${run.rows.length} sizes, ${count(run.rows, "same")} as they were, ${count(run.rows, "changed", "confirmed")} changed, ${count(run.rows, "held")} held for a second read, ${count(run.rows, "refused")} refused, ${count(run.rows, "reverted", "unusable")} taken back, ${count(run.rows, "retried")} tried again.${videoLine(run.video)}`,
    result: { source_updated: run.source_updated, rows: run.rows, ...(run.video ? { video: { ok: run.video.ok, error: run.video.error, rows: run.video.rows } } : {}) } as unknown as Record<string, unknown>,
  };
}

/** What the job would do now, with nothing written: for a look before the first scheduled run. */
export async function platformSizesDryRun(db: Db, deps: SizeDeps): Promise<SizeRun & { video: VideoSizeRun | null }> {
  return sizeRun(db, deps);
}

/** The live services: a plain GET of the guide, and the planning model through anthropicMessages. */
export function liveSizeDeps(_env: (name: string) => string | undefined): SizeDeps {
  return {
    fetchGuide: async (url) => {
      const res = await fetch(url, { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; image-size-reader/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      return { status: res.status, html: await res.text() };
    },
    extract: async (prompt) => {
      if (!(await hasKey("anthropic"))) throw new Error("ANTHROPIC_API_KEY is not set.");
      // The size table is the same for every client: a shared cost.
      const cost = costCtx({ clientId: null, feature: "platform_sizes.refresh", actor: "schedule" });
      return extractAnswer(await anthropicMessages({ cost, body: extractRequest(prompt), signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) }));
    },
  };
}
