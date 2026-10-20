// The Apify API as the in-app report pipelines use it: start an actor run
// with its input, a timeout and its memory; look at the run; read its
// dataset a page at a time. One client for every actor the pipelines run
// (today the LinkedIn company-posts actor, later the TikTok and Instagram
// trend scrapers of the social report).
//
// It never sleeps to wait for a run: looking at a run asks Apify to hold the
// answer until the run ends or up to a minute passes (waitForFinish), and a
// pipeline step that still has to wait asks the step runner to call it back
// later (a poll), so no worker is held open.
//
// Quiet retries: a read that meets a rate limit, a server error or a dropped
// connection is tried again a few times with a short, growing wait. Starting
// a run is retried only when Apify refused it outright (429 or 503), because
// a start whose answer was lost may already be running and would be paid for
// twice. Anything still failing is thrown for the step runner, which tries
// the step again later.
//
// The token is APIFY_API_TOKEN (the same account as n8n's "Apify account 2").
// While it is not set, every call throws ApifyTokenMissing, which a step
// turns into a quiet wait and a line in its step log, never a failure.

export const APIFY_API = "https://api.apify.com/v2";
export const APIFY_TOKEN_ENV = "APIFY_API_TOKEN";

/** The run states Apify reports. The last four are final. */
export type ApifyRunStatus = "READY" | "RUNNING" | "TIMING-OUT" | "ABORTING" | "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED";
const FINAL: ReadonlySet<string> = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);
export const isFinalRunStatus = (status: unknown) => FINAL.has(String(status));

export interface ApifyRun {
  id: string;
  status: ApifyRunStatus;
  defaultDatasetId: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  usageTotalUsd?: number | null;
  [key: string]: unknown;
}

export class ApifyTokenMissing extends Error {
  constructor() {
    super(`${APIFY_TOKEN_ENV} is not set, so the Apify actor cannot run yet.`);
    this.name = "ApifyTokenMissing";
  }
}

export class ApifyError extends Error {
  status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ApifyError";
    this.status = status;
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ApifyClientOptions {
  token: string | null | undefined;
  /** Ends every request when it fires (a pipeline step's time running out). */
  signal?: AbortSignal;
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Tries of one request after the first (default 3). */
  retries?: number;
}

/** The waits between tries: 1 s, 2 s, 4 s, never longer than a Retry-After of up to 10 s asks for. */
export function apifyRetryWaitMs(attempt: number, retryAfter: string | null): number {
  const base = 1000 * 2 ** attempt;
  const asked = retryAfter != null && retryAfter.trim() !== "" && Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1000 : 0;
  return Math.min(10_000, Math.max(base, asked));
}

/** The token never appears in an error message or a log. */
const redact = (text: string, token: string) => (token ? text.split(token).join("[redacted]") : text);

export interface ApifyClient {
  /** POST /acts/{actor}/runs: starts a run and returns it at once (READY or RUNNING). */
  startRun(actorId: string, input: unknown, opts: { timeoutSecs: number; memoryMbytes: number }): Promise<ApifyRun>;
  /** GET /actor-runs/{run}: the run, after Apify held the answer until it ended or waitSecs passed (at most 60). */
  getRun(runId: string, opts?: { waitSecs?: number }): Promise<ApifyRun>;
  /** One page of a dataset's items. */
  datasetPage(datasetId: string, opts: { offset: number; limit: number }): Promise<unknown[]>;
  /** Every item of a dataset, a page at a time; more than maxItems is an error rather than a silent cut. */
  datasetItems(datasetId: string, opts?: { pageSize?: number; maxItems?: number }): Promise<unknown[]>;
}

export function apifyClient(o: ApifyClientOptions): ApifyClient {
  const token = String(o.token ?? "").trim();
  const f: Fetch = o.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retries = o.retries ?? 3;

  const request = async (method: "GET" | "POST", path: string, query: Record<string, string | number>, body?: unknown): Promise<unknown> => {
    if (!token) throw new ApifyTokenMissing();
    const url = new URL(`${APIFY_API}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const starting = method === "POST";
    for (let attempt = 0; ; attempt++) {
      if (o.signal?.aborted) throw o.signal.reason ?? new Error("The Apify request was stopped.");
      let response: Response;
      try {
        response = await f(url.href, {
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          ...(o.signal ? { signal: o.signal } : {}),
        });
      } catch (e) {
        // A dropped read is tried again; a start whose answer was lost is not (it may be running).
        if (starting || o.signal?.aborted || attempt >= retries) throw e;
        await sleep(apifyRetryWaitMs(attempt, null));
        continue;
      }
      if (response.ok) return await response.json();
      const retryable = starting ? response.status === 429 || response.status === 503 : response.status === 429 || response.status >= 500;
      const detail = redact(await response.text().catch(() => ""), token).slice(0, 300);
      if (!retryable || attempt >= retries) throw new ApifyError(`Apify ${method} ${path} answered ${response.status}: ${detail}`, response.status);
      await sleep(apifyRetryWaitMs(attempt, response.headers.get("retry-after")));
    }
  };

  const runOf = (answer: unknown, what: string): ApifyRun => {
    const run = (answer as { data?: ApifyRun } | null)?.data;
    if (!run || typeof run.id !== "string" || typeof run.status !== "string") throw new ApifyError(`Apify answered ${what} without a run.`, null);
    return run;
  };

  const datasetPage = async (datasetId: string, opts: { offset: number; limit: number }): Promise<unknown[]> => {
    const items = await request("GET", `/datasets/${encodeURIComponent(datasetId)}/items`, { format: "json", offset: opts.offset, limit: opts.limit });
    if (!Array.isArray(items)) throw new ApifyError("Apify answered a dataset page that is not a list.", null);
    return items;
  };

  return {
    async startRun(actorId, input, opts) {
      return runOf(await request("POST", `/acts/${encodeURIComponent(actorId)}/runs`, { timeout: opts.timeoutSecs, memory: opts.memoryMbytes }, input ?? {}), "the start");
    },
    async getRun(runId, opts = {}) {
      const wait = Math.max(0, Math.min(60, Math.floor(opts.waitSecs ?? 0)));
      return runOf(await request("GET", `/actor-runs/${encodeURIComponent(runId)}`, wait ? { waitForFinish: wait } : {}), "the run");
    },
    datasetPage,
    async datasetItems(datasetId, opts = {}) {
      const pageSize = opts.pageSize ?? 1000;
      const maxItems = opts.maxItems ?? 20_000;
      const all: unknown[] = [];
      for (let offset = 0; ; offset += pageSize) {
        const page = await datasetPage(datasetId, { offset, limit: pageSize });
        all.push(...page);
        if (all.length > maxItems) throw new ApifyError(`The Apify dataset has more than ${maxItems} items.`, null);
        if (page.length < pageSize) return all;
      }
    },
  };
}
