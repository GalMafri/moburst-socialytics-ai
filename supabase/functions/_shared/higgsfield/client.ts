// Higgsfield REST client.
//
// Replaces the direct Gemini / Veo calls that generate-post-image and
// generate-post-video used to make. Higgsfield is ASYNCHRONOUS ONLY: every
// generation is submitted, returns a request_id immediately, and then either
// reaches us via webhook or has to be polled. There is no synchronous mode, so
// callers must always deal with a two-phase flow.
//
// Note on why this is the REST API and not the MCP: the hosted MCP at
// mcp.higgsfield.ai authenticates interactively against a personal Higgsfield
// account and issues no service credential, so an edge function cannot hold
// that session. The REST API exposes the same model catalog with a key.
//
// Deliberately dependency-free and Deno-global-free at module scope: the unit
// tests import this file through vitest (Node), so `Deno` is only touched
// inside resolveCredentials(), and fetch/sleep are injectable.

export type HiggsfieldStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "nsfw"
  | "canceled";

/** The four states that end a request. Everything else means "keep waiting". */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "nsfw",
  "canceled",
]);

export function isTerminal(status: string | undefined | null): boolean {
  return !!status && TERMINAL_STATUSES.has(status);
}

export interface HiggsfieldSubmission {
  status: HiggsfieldStatus;
  request_id: string;
  status_url: string;
  cancel_url: string;
}

/**
 * A terminal status response. Which output field is populated depends on the
 * model's output type, so all of them are optional and callers pick the one
 * they asked for. Some video/3D operations also return zip/mov/jsx/fbx/ply,
 * which we do not use and therefore do not model.
 */
export interface HiggsfieldResult {
  status: HiggsfieldStatus;
  request_id: string;
  error?: string | null;
  images?: Array<{ url: string; content_type?: string }>;
  video?: { url: string; content_type?: string };
  audio?: { url: string; content_type?: string };
}

export type HiggsfieldErrorCode =
  /** 400 with the "Maximum number of concurrent requests" detail. Retryable later. */
  | "concurrency_exhausted"
  /** 401. The key is wrong or missing; retrying will not help. */
  | "unauthorized"
  /** 404 on a status poll. Wrong request id or wrong account. */
  | "not_found"
  /** Terminal status `nsfw`. Input or output was rejected by moderation. */
  | "moderated"
  /** Terminal status `failed`. */
  | "generation_failed"
  /** Our own application-level timeout while polling. */
  | "timeout"
  /** Credentials are not configured in this environment at all. */
  | "not_configured"
  /** Anything else, including 5xx and transport failures. */
  | "upstream_error";

export class HiggsfieldError extends Error {
  readonly code: HiggsfieldErrorCode;
  readonly httpStatus?: number;
  readonly requestId?: string;

  constructor(
    code: HiggsfieldErrorCode,
    message: string,
    opts?: { httpStatus?: number; requestId?: string },
  ) {
    super(message);
    this.name = "HiggsfieldError";
    this.code = code;
    this.httpStatus = opts?.httpStatus;
    this.requestId = opts?.requestId;
  }

  /**
   * Message safe to show a user. The raw upstream text can leak model paths and
   * internal detail, and "Bad Request" on its own tells a designer nothing.
   */
  get userMessage(): string {
    switch (this.code) {
      case "concurrency_exhausted":
        return "Higgsfield is at its concurrent-generation limit. Wait for the running generations to finish and try again.";
      case "unauthorized":
        return "Higgsfield rejected our credentials. An admin needs to check the Higgsfield API key.";
      case "moderated":
        return "Higgsfield's content filter rejected this generation. Try rewording the brief.";
      case "generation_failed":
        return "Higgsfield could not generate this. Try again, or adjust the brief.";
      case "timeout":
        return "The generation is taking longer than expected. It may still finish — check back shortly.";
      case "not_configured":
        return "Higgsfield is not configured on this environment yet.";
      case "not_found":
        return "That generation could not be found on Higgsfield.";
      default:
        return "Higgsfield returned an unexpected error. Try again shortly.";
    }
  }
}

export const HIGGSFIELD_BASE_URL = "https://api.higgsfield.ai";

export interface HiggsfieldCredentials {
  keyId: string;
  keySecret: string;
}

/**
 * Read credentials from the environment.
 *
 * Env ONLY, on purpose. The obvious symmetry would be to fall back to
 * app_settings the way generate-post-image does for gemini_api_key, but
 * app_settings is SELECT-able by every is_moburst_staff() session and
 * Settings.tsx pulls the whole table into the browser, so a key stored there is
 * readable client-side by all staff. Do not add that fallback.
 */
export function resolveCredentials(): HiggsfieldCredentials {
  const env = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env;
  const keyId = env?.get("HIGGSFIELD_API_KEY_ID");
  const keySecret = env?.get("HIGGSFIELD_API_KEY_SECRET");
  if (!keyId || !keySecret) {
    throw new HiggsfieldError(
      "not_configured",
      "HIGGSFIELD_API_KEY_ID and HIGGSFIELD_API_KEY_SECRET must be set as Supabase edge secrets.",
    );
  }
  return { keyId, keySecret };
}

export function authHeader(creds: HiggsfieldCredentials): string {
  return `Key ${creds.keyId}:${creds.keySecret}`;
}

// ── Polling policy ───────────────────────────────────────────────────────────
//
// Higgsfield's documented recommendation: start at 2s, widen gradually to 10s,
// add jitter when several workers poll at once. These are pure so they can be
// tested without a network or a clock.

export const POLL_INITIAL_DELAY_MS = 2_000;
export const POLL_MAX_DELAY_MS = 10_000;
const POLL_GROWTH = 1.5;

export function nextPollDelay(currentMs: number): number {
  return Math.min(currentMs * POLL_GROWTH, POLL_MAX_DELAY_MS);
}

/** Jitter spreads concurrent pollers so they don't beat on the API in lockstep. */
export function jitterMs(random: () => number = Math.random): number {
  return random() * 500;
}

export type PollAction = "done" | "continue" | "abort";

/**
 * What to do with a status-poll HTTP response, per the documented retry table.
 * A 5xx or transport failure is transient and keeps polling; 401 and 404 are
 * permanent and abort.
 */
export function classifyPollResponse(httpStatus: number): PollAction {
  if (httpStatus === 200) return "done"; // caller then inspects the body status
  if (httpStatus === 401 || httpStatus === 404) return "abort";
  return "continue"; // 5xx and anything else: transient, keep trying
}

// ── HTTP surface ─────────────────────────────────────────────────────────────

export interface HiggsfieldClientOptions {
  credentials?: HiggsfieldCredentials;
  /** Injectable for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. Defaults to a real setTimeout sleep. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable for tests, so jitter is deterministic. */
  randomImpl?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Turn a non-OK submission response into a typed error. The concurrency limit
 * arrives as a 400 whose body carries the detail, not as a 429, and no
 * Retry-After header is sent — so string-matching the detail is the only way to
 * tell "slow down" apart from "your request was malformed".
 */
async function submissionError(resp: Response): Promise<HiggsfieldError> {
  const text = await resp.text().catch(() => "");
  if (resp.status === 401) {
    return new HiggsfieldError("unauthorized", "Higgsfield rejected the API key.", {
      httpStatus: 401,
    });
  }
  if (resp.status === 400 && /concurrent requests/i.test(text)) {
    return new HiggsfieldError("concurrency_exhausted", text.slice(0, 300), {
      httpStatus: 400,
    });
  }
  return new HiggsfieldError(
    "upstream_error",
    `Higgsfield ${resp.status}: ${text.slice(0, 300)}`,
    { httpStatus: resp.status },
  );
}

/**
 * Submit a generation.
 *
 * `modelPath` is the account-specific model route, e.g.
 * "/higgsfield-ai/soul/v2/standard". Which routes are enabled varies by
 * account, so it is passed in rather than hardcoded here.
 *
 * When `webhookUrl` is given, Higgsfield POSTs the terminal result there and
 * polling becomes a recovery path rather than the primary mechanism.
 */
export async function submit(
  modelPath: string,
  body: Record<string, unknown>,
  opts: HiggsfieldClientOptions & { webhookUrl?: string } = {},
): Promise<HiggsfieldSubmission> {
  const creds = opts.credentials ?? resolveCredentials();
  const doFetch = opts.fetchImpl ?? fetch;

  let url = `${HIGGSFIELD_BASE_URL}${modelPath}`;
  if (opts.webhookUrl) {
    url += `?hf_webhook=${encodeURIComponent(opts.webhookUrl)}`;
  }

  const resp = await doFetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeader(creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw await submissionError(resp);

  const json = (await resp.json()) as HiggsfieldSubmission;
  if (!json?.request_id || !json?.status_url) {
    throw new HiggsfieldError(
      "upstream_error",
      "Higgsfield accepted the request but returned no request_id/status_url.",
    );
  }
  return json;
}

/**
 * Poll a status_url until the request reaches a terminal state.
 *
 * Always use the status_url from the submission response rather than building
 * it, as the docs instruct. Returns the terminal body for `completed`; throws a
 * typed error for `failed`, `nsfw`, `canceled`, and for our own timeout.
 */
export async function pollUntilTerminal(
  statusUrl: string,
  opts: HiggsfieldClientOptions & { timeoutMs: number },
): Promise<HiggsfieldResult> {
  const creds = opts.credentials ?? resolveCredentials();
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleepImpl ?? defaultSleep;
  const random = opts.randomImpl ?? Math.random;

  let delay = POLL_INITIAL_DELAY_MS;
  let waited = 0;

  while (waited < opts.timeoutMs) {
    const pause = delay + jitterMs(random);
    await sleep(pause);
    waited += pause;

    let resp: Response;
    try {
      resp = await doFetch(statusUrl, { headers: { Authorization: authHeader(creds) } });
    } catch {
      // Transport failure is transient; widen and retry.
      delay = nextPollDelay(delay);
      continue;
    }

    const action = classifyPollResponse(resp.status);
    if (action === "abort") {
      throw resp.status === 401
        ? new HiggsfieldError("unauthorized", "Higgsfield rejected the API key while polling.", {
            httpStatus: 401,
          })
        : new HiggsfieldError("not_found", "Higgsfield does not know that request id.", {
            httpStatus: 404,
          });
    }
    if (action === "continue") {
      delay = nextPollDelay(delay);
      continue;
    }

    const result = (await resp.json()) as HiggsfieldResult;
    if (!isTerminal(result?.status)) {
      delay = nextPollDelay(delay);
      continue;
    }

    if (result.status === "completed") return result;
    if (result.status === "nsfw") {
      throw new HiggsfieldError("moderated", "Rejected by Higgsfield content moderation.", {
        requestId: result.request_id,
      });
    }
    throw new HiggsfieldError(
      "generation_failed",
      result.error || `Higgsfield generation ${result.status}.`,
      { requestId: result.request_id },
    );
  }

  throw new HiggsfieldError(
    "timeout",
    `Higgsfield did not finish within ${Math.round(opts.timeoutMs / 1000)}s.`,
  );
}

/**
 * Upload a local file and get back a public HTTPS URL usable as model input.
 *
 * Needed because Higgsfield only accepts input media by URL. Design references
 * living in a Supabase bucket can usually be handed over as signed URLs
 * instead, which is cheaper — see context.ts. This is the fallback for bytes we
 * hold in memory.
 *
 * Presigned upload URLs expire after one hour, and the credentials must NOT be
 * sent to the storage host.
 */
export async function uploadInput(
  bytes: Uint8Array | ArrayBuffer | Blob,
  contentType: string,
  opts: HiggsfieldClientOptions = {},
): Promise<string> {
  const creds = opts.credentials ?? resolveCredentials();
  const doFetch = opts.fetchImpl ?? fetch;

  const ticketResp = await doFetch(`${HIGGSFIELD_BASE_URL}/files/generate-upload-url`, {
    method: "POST",
    headers: { Authorization: authHeader(creds), "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType }),
  });
  if (!ticketResp.ok) throw await submissionError(ticketResp);

  const ticket = (await ticketResp.json()) as {
    public_url: string;
    upload_url: string;
    upload_headers?: Record<string, string>;
  };

  // Every header the ticket returned has to be replayed, including
  // x-amz-tagging. Sending the Higgsfield credential here would leak it to the
  // storage host, so the auth header is deliberately absent.
  const putResp = await doFetch(ticket.upload_url, {
    method: "PUT",
    headers: ticket.upload_headers ?? { "Content-Type": contentType },
    body: bytes as BodyInit,
  });
  if (!putResp.ok) {
    const t = await putResp.text().catch(() => "");
    throw new HiggsfieldError(
      "upstream_error",
      `Presigned upload failed (${putResp.status}): ${t.slice(0, 200)}`,
      { httpStatus: putResp.status },
    );
  }

  return ticket.public_url;
}

/** Cost estimate for a submission, before committing to it. */
export async function estimate(
  modelPath: string,
  body: Record<string, unknown>,
  opts: HiggsfieldClientOptions = {},
): Promise<unknown> {
  const creds = opts.credentials ?? resolveCredentials();
  const doFetch = opts.fetchImpl ?? fetch;
  const resp = await doFetch(`${HIGGSFIELD_BASE_URL}/estimate${modelPath}`, {
    method: "POST",
    headers: { Authorization: authHeader(creds), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw await submissionError(resp);
  return await resp.json();
}

/**
 * Cancel a request. Only possible while every job in it is still queued; once
 * processing starts Higgsfield answers 400, which we treat as "too late"
 * rather than an error worth propagating.
 */
export async function cancel(
  cancelUrl: string,
  opts: HiggsfieldClientOptions = {},
): Promise<boolean> {
  const creds = opts.credentials ?? resolveCredentials();
  const doFetch = opts.fetchImpl ?? fetch;
  const resp = await doFetch(cancelUrl, {
    method: "POST",
    headers: { Authorization: authHeader(creds) },
  });
  return resp.status === 202;
}
