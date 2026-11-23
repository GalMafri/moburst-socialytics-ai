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
// Every request goes through the paying desk (_shared/paid), which adds the
// token, APIFY_API_TOKEN (the same account as n8n's "Apify account 2"), and
// records each run's cost once, the first time the run is seen finished,
// with the dollars Apify reports (usageTotalUsd, keyed by the run's id).
// While the token is not set, every call throws ApifyTokenMissing, which a step
// turns into a quiet wait and a line in its step log, never a failure. A
// token Apify refuses (401, or an account-level 402 or 403) is the same:
// ApifyTokenRefused. A 403 for one actor stays an ordinary ApifyError, so only
// that platform fails.

import type { CostContext } from "../cost/context.ts";
import { paid, ProviderKeyMissing } from "../paid/index.ts";

/** The API version every path is under, below the provider's base (cost/registry.ts). */
export const APIFY_API_PATH = "/v2";
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

/** Apify turned the account's token away (401 not accepted, or 402 out of usage and 403 not allowed for an account-level reason). Trying again cannot help until the account answers, so a step waits instead of failing. */
export class ApifyTokenRefused extends ApifyError {
  constructor(message: string, status: number) {
    super(message, status);
    this.name = "ApifyTokenRefused";
  }
}
/** 401 always means the token was not accepted. 402 and 403 can also be about one actor (not rented, not allowed to this token), so they count only with an account-level error type in the answer. */
const ACCOUNT_ERROR_TYPES: ReadonlySet<string> = new Set([
  "token-not-provided", "invalid-token", "user-or-token-not-found", "user-not-found", "not-enough-usage-to-run-paid-actor",
]);
const errorTypeOf = (body: string): string => {
  try {
    const type = (JSON.parse(body) as { error?: { type?: unknown } } | null)?.error?.type;
    return typeof type === "string" ? type : "";
  } catch {
    return "";
  }
};
const tokenRefused = (status: number, body: string) => status === 401 || ((status === 402 || status === 403) && ACCOUNT_ERROR_TYPES.has(errorTypeOf(body)));

export interface ApifyClientOptions {
  /** Who the runs are for: the paying desk records each finished run's cost against it. */
  cost: CostContext;
  /** Ends every request when it fires (a pipeline step's time running out). */
  signal?: AbortSignal;
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

export interface ApifyClient {
  /** POST /acts/{actor}/runs: starts a run and returns it at once (READY or RUNNING). A timeout or memory left out is the actor's own default. */
  startRun(actorId: string, input: unknown, opts: { timeoutSecs?: number; memoryMbytes?: number }): Promise<ApifyRun>;
  /** GET /actor-runs/{run}: the run, after Apify held the answer until it ended or waitSecs passed (at most 60). */
  getRun(runId: string, opts?: { waitSecs?: number }): Promise<ApifyRun>;
  /** One page of a dataset's items. */
  datasetPage(datasetId: string, opts: { offset: number; limit: number }): Promise<unknown[]>;
  /** Every item of a dataset, a page at a time; more than maxItems is an error rather than a silent cut. */
  datasetItems(datasetId: string, opts?: { pageSize?: number; maxItems?: number }): Promise<unknown[]>;
}

export function apifyClient(o: ApifyClientOptions): ApifyClient {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const retries = o.retries ?? 3;

  const request = async (method: "GET" | "POST", path: string, query: Record<string, string | number>, body?: unknown): Promise<unknown> => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) params.set(k, String(v));
    const qs = params.toString();
    const target = `${APIFY_API_PATH}${path}${qs ? `?${qs}` : ""}`;
    const starting = method === "POST";
    for (let attempt = 0; ; attempt++) {
      if (o.signal?.aborted) throw o.signal.reason ?? new Error("The Apify request was stopped.");
      let response: Response;
      try {
        response = await paid.fetch(o.cost, "apify", target, {
          method,
          headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          ...(o.signal ? { signal: o.signal } : {}),
        });
      } catch (e) {
        if (e instanceof ProviderKeyMissing) throw new ApifyTokenMissing();
        // A dropped read is tried again; a start whose answer was lost is not (it may be running).
        if (starting || o.signal?.aborted || attempt >= retries) throw e;
        await sleep(apifyRetryWaitMs(attempt, null));
        continue;
      }
      if (response.ok) return await response.json();
      const retryable = starting ? response.status === 429 || response.status === 503 : response.status === 429 || response.status >= 500;
      const answerText = await response.text().catch(() => "");
      // The client never holds the token, so one an answer echoes is recognized by its shape (apify_api_...).
      const detail = answerText.replace(/apify_api_[A-Za-z0-9]+/g, "[redacted]").slice(0, 300);
      if (tokenRefused(response.status, answerText)) throw new ApifyTokenRefused(`Apify ${method} ${path} answered ${response.status}: ${detail}`, response.status);
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
      const query: Record<string, number> = {};
      if (opts.timeoutSecs != null) query.timeout = opts.timeoutSecs;
      if (opts.memoryMbytes != null) query.memory = opts.memoryMbytes;
      return runOf(await request("POST", `/acts/${encodeURIComponent(actorId)}/runs`, query, input ?? {}), "the start");
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
