// supabase/functions/_shared/picture/client.ts
//
// The edge workers' side of the picture service (12 Nov 2026): one call per
// picture job, with signed storage URLs in and sizes back, so no worker
// decodes a picture again. Before every attempt the worker opens a call in
// the database (open_picture_call, service role only) and sends its id; the
// service claims the id once before it reads the request, so there is no
// shared secret to set or rotate and an id cannot be used twice (16 Nov
// 2026). A busy or unreachable service, one whose answer was cut off or timed
// out while it was read, one that is not there (a failure whose body is not
// the service's own JSON, as before the function's first deploy), or a
// database that could not open the call, is
// tried once more after PICTURE_RETRY_AFTER_MS with a new call; if it is
// still unavailable the job waits for a later pass without spending a try
// (canva/stepError.ts), and the reason kept is the service's own when its
// last answer gave one (storage that cannot serve a picture right now, say).
// A call the service refused, or a picture it could
// not work with, fails at once, so the step spends a try and keeps the
// reason; the two are told apart (PictureFailure), because only the second
// says anything about the picture. No message carries a call's id or a
// signed URL.

import {
  PICTURE_API_BASE,
  PICTURE_CALL_HEADER,
  PICTURE_CALL_TIMEOUT_MS,
  PICTURE_OPEN_TIMEOUT_MS,
  PICTURE_RETRY_AFTER_MS,
  PICTURE_SERVICE_URL,
  type PictureAnswer,
  type PictureRequests,
  type PictureResults,
  type PictureRoute,
} from "./contract.ts";

/**
 * Why a picture call failed:
 *   unavailable  the service was busy, down, slow or not there (the
 *                failure was not the service's own answer), or the database
 *                could not open or check the call: the job waits it out;
 *   refused      the service turned the call away (a 400, a 401 for a call
 *                it could not claim, an answer it should not give): nothing
 *                is known about the picture;
 *   unusable     the service ran and could not work with the picture it was
 *                given (its own `ok: false` reason): a picture kept for
 *                another try is of no use.
 */
export type PictureFailure = "unavailable" | "refused" | "unusable";

/** A picture call that failed, with why. */
export class PictureError extends Error {
  /** `status` is the service's own status for a call it refused (400, 401, 404), so a route the service does not have yet can be told from a call it turned away. */
  constructor(message: string, readonly route: PictureRoute, readonly why: PictureFailure, readonly status?: number) {
    super(message);
    this.name = "PictureError";
  }

  /** True when the service was unavailable, which the job waits out. */
  get transient(): boolean {
    return this.why === "unavailable";
  }
}

export type PictureDeps = { fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number; openTimeoutMs?: number; sleep?: (ms: number) => Promise<void> };

/** What one try came to: the service's answer read to its end (its body as JSON, null when it is not JSON), or a transient failure to try again: the service's status or how reaching it failed, with the service's own reason when its answer gave one, or NO_CALL when the database could not open the call and the service was never reached. */
type Attempt = { status: number; ok: boolean; body: unknown } | { transient: string; reason?: string };

const NO_CALL = "no call";
const UNOPENED = "The picture service was not called: the database could not open a call.";

/** The part of the worker's service-role client a picture call uses: the one database function that opens a call. */
export type CallOpener = { rpc(name: "open_picture_call"): PromiseLike<{ data: unknown; error: unknown }> };

/** Opens this attempt's call in the database and gives its id; null when the database could not, or did not within `timeoutMs`, so a database that hangs cannot hang the step. `admin` is the worker's service-role client: nobody else may open a call. */
async function openCall(admin: CallOpener, timeoutMs: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const opened = await Promise.race([Promise.resolve(admin.rpc("open_picture_call")), late]);
    return opened && !opened.error && typeof opened.data === "string" && opened.data ? opened.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** One call to the picture service. Transient failures (a call the database could not open, network error, timeout, an answer cut off while it is read, 429, 5xx, a failure that is not the service's own answer) are tried once more after PICTURE_RETRY_AFTER_MS, with a call of their own; everything else fails at once. */
export async function callPicture<R extends PictureRoute>(admin: CallOpener, route: R, body: PictureRequests[R], deps: PictureDeps = {}): Promise<{ result: PictureResults[R]; ms: number }> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const url = `${deps.baseUrl ?? PICTURE_SERVICE_URL}${PICTURE_API_BASE}/${route}`;
  const payload = JSON.stringify(body);

  const attempt = async (): Promise<Attempt> => {
    // The service claims an id once, so every attempt opens its own.
    const call = await openCall(admin, deps.openTimeoutMs ?? PICTURE_OPEN_TIMEOUT_MS);
    if (!call) return { transient: NO_CALL };
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", [PICTURE_CALL_HEADER]: call },
        body: payload,
        signal: AbortSignal.timeout(deps.timeoutMs ?? PICTURE_CALL_TIMEOUT_MS),
      });
      // The body is read here, inside the try and under the call's own timeout: an answer cut off or timed out while it is read never arrived, so it is tried again like any other failure to reach the service.
      const body = jsonOf(await response.text());
      // The service says why it cannot work right now when the answer is its own (storage unavailable, say); a platform error page says nothing.
      if (response.status === 429 || response.status >= 500) return { transient: String(response.status), reason: serviceReason(body) };
      // Every answer of the service is its own JSON. A failure that is not (the platform's page for a path with no function yet, or a sign-in page put in front of it) never reached the service, so it is unavailable, and the job waits.
      if (!response.ok && !fromService(body)) return { transient: String(response.status) };
      return { status: response.status, ok: response.ok, body };
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      return { transient: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
    }
  };

  let tried = await attempt();
  if ("transient" in tried) {
    await sleep(PICTURE_RETRY_AFTER_MS);
    tried = await attempt();
  }
  if ("transient" in tried) {
    if (tried.transient === NO_CALL) throw new PictureError(UNOPENED, route, "unavailable");
    throw new PictureError(`The picture service did not answer: ${tried.transient}${tried.reason ? ` (${tried.reason})` : ""}.`, route, "unavailable");
  }

  const answer = tried.body as PictureAnswer<R> | null;
  if (!tried.ok) {
    // A refusal is the service's own answer: it names its status and the service's reason.
    const reason = serviceReason(answer);
    throw new PictureError(`The picture service refused the call (${tried.status})${reason ? `: ${reason}` : ""}.`, route, "refused", tried.status);
  }
  // A body that was read to its end and is not the service's JSON is an answer the service should not give: no retry.
  if (!answer || typeof answer !== "object") throw new PictureError("The picture service answered something it should not have.", route, "refused");
  if (!answer.ok) throw new PictureError(withoutLinks(String(answer.reason)), route, "unusable");
  return { result: answer.result, ms: answer.ms };
}

/** A body's text as JSON; null when it is not JSON. */
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** True for a body that is the service's own JSON: an object that says `ok`. */
function fromService(answer: unknown): boolean {
  return !!answer && typeof answer === "object" && typeof (answer as { ok?: unknown }).ok === "boolean";
}

/** The service's own reason from a body that is its `ok: false` JSON, as a message carries it after a status: no link, no closing period. Empty for any other body. */
function serviceReason(answer: unknown): string {
  if (!answer || typeof answer !== "object") return "";
  const { ok, reason } = answer as { ok?: unknown; reason?: unknown };
  return !ok && typeof reason === "string" ? withoutLinks(reason).replace(/\.+$/, "") : "";
}

/** A reason as kept on a job: any link in it is named, never copied, since signed URLs carry tokens. */
function withoutLinks(reason: string): string {
  return reason.replace(/https?:\/\/\S+/g, "a link");
}

/**
 * A stored file storage will make no link for because it is not there:
 * storage answered and refused the path (a 4xx other than 408 and 429).
 * Storage that could not answer right now, or an error with no status, is
 * never this, so a file is not taken for missing on a bad moment.
 */
export class NotInStorage extends Error {}

/** A short-lived link the picture service reads a stored file from. Throws NotInStorage for a file that is not there. */
export async function signedRead(admin: any, bucket: string, path: string, seconds = 600): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, seconds);
  if (error || !data?.signedUrl) {
    const message = `Could not prepare ${path} for the picture service: ${error?.message ?? "no URL"}`;
    const status = Number((error as { status?: unknown } | null)?.status);
    throw status >= 400 && status < 500 && status !== 408 && status !== 429 ? new NotInStorage(message) : new Error(message);
  }
  return data.signedUrl;
}

/** A link the picture service stores a file at, replacing one already there. */
export async function signedWrite(admin: any, bucket: string, path: string): Promise<string> {
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
  if (error || !data?.signedUrl) throw new Error(`Could not prepare ${path} for the picture service: ${error?.message ?? "no URL"}`);
  return data.signedUrl;
}

/** Designs the design worker's picture_check action runs at once: 3 unless a count is given, then a whole number from 1 to 40. */
export function pictureCheckCount(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 3;
  const n = Number(raw);
  if (Number.isNaN(n)) return 3;
  return Math.min(40, Math.max(1, Math.trunc(n)));
}

/** The last time each picture route took for this job, kept on its state for review. */
export function notePicture(state: any, route: PictureRoute, ms: number): void {
  state.picture_ms = { ...(state.picture_ms ?? {}), [route]: ms };
}
