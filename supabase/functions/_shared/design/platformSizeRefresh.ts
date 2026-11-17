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

import { anthropicMessages } from "../anthropic.ts";
import type { JobOutcome, ScheduledJob } from "../scheduled-jobs/types.ts";
import {
  EXTRACT_TOOL, GUIDE_URL, MIN_GUIDE_CHARS,
  NO_WORD, decide, extractPrompt, guideParts, guideText, guideUpdated, jsonIn, modelWord, parseExtract, refusedRow, sizesIn,
  type Key, type ModelWord, type RowResult, type SizeOutcomeRow, type SizeRow,
} from "./platformSizeRead.ts";
import { UPLOAD_FORMATS, type UploadFormat } from "./platformSize.ts";

/** The planning model (design-request's PLANNER_MODEL). */
export const SIZES_MODEL = "claude-opus-5-5";
const FETCH_TIMEOUT_MS = 20_000;
const MODEL_TIMEOUT_MS = 120_000;

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

/** The table's rows, in a fixed order. */
async function sizeRows(db: Db): Promise<SizeRow[]> {
  const { data, error } = await db.from("platform_sizes").select("platform, format, width, height, pending_width, pending_height, previous_width, previous_height, usable").order("platform").order("format");
  if (error) throw new Error(`Could not read the sizes: ${error.message}`);
  return ((data ?? []) as SizeRow[]).filter((r) => UPLOAD_FORMATS.includes(r.format as UploadFormat));
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
export async function readGuide(rows: SizeRow[], deps: SizeDeps, word: ModelWord = NO_WORD): Promise<SizeRun> {
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
  return run({ ok: true, source_updated: updated, rows: rows.map((r) => decide(r, read.get(`${r.platform}/${r.format}`), parts, word)) });
}

/**
 * A run, with nothing written. First the rows whose size in use the image
 * model refuses: they go back to a drawn size or to none, whatever the
 * guide says and whether or not it can be read. Then the guide, for every
 * other row.
 */
async function sizeRun(db: Db, deps: SizeDeps): Promise<SizeRun> {
  const rows = await sizeRows(db);
  const word = await modelWords(db);
  const back = rows.map((r) => refusedRow(r, word)).filter((r): r is RowResult => !!r);
  const taken = new Set(back.map((r) => `${r.platform}/${r.format}`));
  const run = await readGuide(rows.filter((r) => !taken.has(`${r.platform}/${r.format}`)), deps, word);
  return { ...run, rows: [...back, ...run.rows] };
}

/** One run: read, then record the run and apply what it changes (record_platform_size_read). */
export async function refreshPlatformSizes(db: Db, deps: SizeDeps): Promise<SizeRun & { changed: number }> {
  const run = await sizeRun(db, deps);
  const { data, error } = await db.rpc("record_platform_size_read", { p_read: run });
  if (error) throw new Error(`Could not record the read of the sizes guide: ${error.message}`);
  return { ...run, changed: Number((data as { changed?: number } | null)?.changed) || 0 };
}

const count = (rows: RowResult[], ...outcomes: RowResult["outcome"][]) => rows.filter((r) => outcomes.includes(r.outcome)).length;

/**
 * The job. A read that worked is done, whatever it changed or refused. A
 * read that failed as a whole is recorded and thrown, so the queue tries it
 * again (its usual three tries) and the next morning queues another.
 */
export async function runPlatformSizes(db: Db, _job: ScheduledJob, deps: SizeDeps): Promise<JobOutcome> {
  const run = await refreshPlatformSizes(db, deps);
  if (!run.ok) throw new Error(run.error ?? "The sizes guide could not be read.");
  return {
    status: "done",
    reason: `Read the sizes guide: ${run.rows.length} sizes, ${count(run.rows, "same")} as they were, ${count(run.rows, "changed", "confirmed")} changed, ${count(run.rows, "held")} held for a second read, ${count(run.rows, "refused")} refused, ${count(run.rows, "reverted", "unusable")} taken back, ${count(run.rows, "retried")} tried again.`,
    result: { source_updated: run.source_updated, rows: run.rows } as unknown as Record<string, unknown>,
  };
}

/** What the job would do now, with nothing written: for a look before the first scheduled run. */
export async function platformSizesDryRun(db: Db, deps: SizeDeps): Promise<SizeRun> {
  return sizeRun(db, deps);
}

/** The live services: a plain GET of the guide, and the planning model through anthropicMessages. */
export function liveSizeDeps(env: (name: string) => string | undefined): SizeDeps {
  return {
    fetchGuide: async (url) => {
      const res = await fetch(url, { headers: { Accept: "text/html", "User-Agent": "Mozilla/5.0 (compatible; image-size-reader/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      return { status: res.status, html: await res.text() };
    },
    extract: async (prompt) => {
      const apiKey = env("ANTHROPIC_API_KEY");
      if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
      const result = await anthropicMessages({
        apiKey,
        body: {
          model: SIZES_MODEL,
          max_tokens: 4000,
          tools: [EXTRACT_TOOL],
          tool_choice: { type: "tool", name: EXTRACT_TOOL.name },
          messages: [{ role: "user", content: prompt }],
        },
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      const blocks = (result.raw as { content?: Array<{ type?: string; name?: string; input?: unknown }> } | null)?.content ?? [];
      const call = blocks.find((b) => b?.type === "tool_use" && b.name === EXTRACT_TOOL.name);
      return call?.input ?? jsonIn(result.text);
    },
  };
}
