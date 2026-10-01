/**
 * Completion callbacks for demo jobs: an HTTPS POST signed with an HMAC the
 * receiver can verify with the key it holds (the key's SHA-256 is the HMAC
 * key), tried three times. A callback that never lands is recorded on the
 * job; it never changes the job's own outcome.
 */
export interface CallbackStatus {
  delivered: boolean;
  attempts: number;
  last_status: number | null;
  last_error: string | null;
  delivered_at: string | null;
}

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

export async function signBody(body: string, keyHash: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(keyHash), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `sha256=${hex(await crypto.subtle.sign("HMAC", key, enc.encode(body)))}`;
}

export const CALLBACK_DELAYS_MS = [0, 60_000, 300_000];
/** The same schedule in seconds, for a step that waits between attempts instead of sleeping. */
export const CALLBACK_DELAYS_S = [0, 60, 300];
export const CALLBACK_MAX_ATTEMPTS = CALLBACK_DELAYS_S.length;

/** One delivery attempt: the HTTP status, or null with the error when nothing answered. */
export async function deliverOnce(url: string, payload: unknown, keyHash: string | null, fetchImpl: typeof fetch = fetch): Promise<{ status: number | null; error: string | null }> {
  if (!/^https:\/\//i.test(url)) return { status: null, error: "callback_url must be https" };
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (keyHash) headers["X-Demo-Signature"] = await signBody(body, keyHash);
  try {
    const res = await fetchImpl(url, { method: "POST", headers, body });
    return { status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { status: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deliverCallback(
  url: string,
  payload: unknown,
  keyHash: string | null,
  opts: { fetchImpl?: typeof fetch; delaysMs?: number[]; sleep?: (ms: number) => Promise<void>; now?: () => Date } = {},
): Promise<CallbackStatus> {
  const status: CallbackStatus = { delivered: false, attempts: 0, last_status: null, last_error: null, delivered_at: null };
  if (!/^https:\/\//i.test(url)) return { ...status, last_error: "callback_url must be https" };
  const delays = opts.delaysMs ?? CALLBACK_DELAYS_MS;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => new Date());
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (keyHash) headers["X-Demo-Signature"] = await signBody(body, keyHash);
  for (let i = 0; i < delays.length; i++) {
    if (delays[i] > 0) await sleep(delays[i]);
    status.attempts += 1;
    try {
      const res = await doFetch(url, { method: "POST", headers, body });
      status.last_status = res.status;
      if (res.ok) {
        status.delivered = true;
        status.delivered_at = now().toISOString();
        return status;
      }
      status.last_error = `HTTP ${res.status}`;
    } catch (e) {
      status.last_error = e instanceof Error ? e.message : String(e);
    }
  }
  return status;
}
