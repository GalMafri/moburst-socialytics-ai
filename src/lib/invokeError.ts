// What a person reads when one of their own requests to an edge function did
// not go through. supabase.functions.invoke() reports any non-2xx as "Edge
// Function returned a non-2xx status code" and leaves the server's body on
// error.context. That body is written for developers ("DB update failed",
// "could not parse JSON from Claude output"), so it goes to the console only:
// the screen gets one plain sentence chosen by the error code or the HTTP
// status. Work the product does on its own never reaches a person this way.

type InvokeContext = { json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> }; status?: number };

/** Sentences for the codes the functions send with a failure. */
const BY_CODE: Record<string, string> = {
  RIVALIQ_CLIENT_NOT_TRACKED: "Competitor tracking for this client is still starting. The feed fills in on its own once it is ready.",
  RIVALIQ_LANDSCAPE_MISSING: "Competitor tracking for this client is being connected again. The feed fills in on its own once it is ready.",
  RIVALIQ_BUSY: "The competitor data source is busy right now. This runs again on its own shortly.",
};

const OFFLINE = "This could not be sent. Check your internet connection, then try again.";
const UNKNOWN = "This did not go through, and nothing was changed. Try again in a minute.";

/** The plain sentence for an HTTP status. */
export function statusSentence(status: number | null | undefined): string {
  switch (status) {
    case 400: return "Some of the details were missing or not valid, so nothing was changed.";
    case 401: return "Your session has ended. Open Socialytics from the Moburst portal again.";
    case 403: return "Your account does not have access to this client.";
    case 404: return "This is no longer available.";
    case 409: return "This is already in progress or changed since the page loaded. Reload the page to see where it stands.";
    case 422: return "This cannot be done with what is on file for this client yet.";
    case 429: return "There were too many requests at once. Wait a minute, then try again.";
    case 504: return "This took longer than the server allows. It may still finish, so check back in a few minutes.";
    default: return UNKNOWN;
  }
}

async function readBody(ctx: InvokeContext | undefined): Promise<Record<string, unknown> | null> {
  if (!ctx || typeof ctx !== "object") return null;
  try {
    const res = typeof ctx.clone === "function" ? ctx.clone() : ctx;
    const body = typeof res.json === "function" ? await res.json() : null;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * One plain sentence for a failed request. The server's own text is logged
 * for the team and never shown.
 */
export async function describeInvokeError(error: unknown, data?: { error?: unknown; code?: unknown } | null): Promise<string> {
  const err = error as { message?: string; name?: string; context?: unknown } | null;
  const ctx = err?.context as InvokeContext | undefined;
  const body = (await readBody(ctx)) ?? (data && typeof data === "object" ? (data as Record<string, unknown>) : null);
  const status = typeof ctx?.status === "number" ? ctx.status : null;
  const code = typeof body?.code === "string" ? body.code : null;
  if (error || data?.error) console.error("[request failed]", { status, code, server: body?.error ?? body?.message ?? null, message: err?.message ?? null });
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (status != null) return statusSentence(status);
  // No response at all: the request never reached the server.
  if (err && (err.name === "FunctionsFetchError" || /fetch|network|load failed/i.test(String(err.message ?? "")))) return OFFLINE;
  return UNKNOWN;
}

/** True when the request clearly never reached the work, so sending it again cannot do the work twice. */
export function safeToResend(error: unknown): boolean {
  const err = error as { name?: string; message?: string; context?: InvokeContext } | null;
  if (!err) return false;
  const status = err.context?.status;
  if (typeof status === "number") return status === 429 || status === 502 || status === 503;
  return err.name === "FunctionsFetchError" || /fetch|network|load failed/i.test(String(err.message ?? ""));
}

/**
 * A person's own request, sent again quietly when it never reached the
 * server (no connection, a busy gateway, a rate limit) before anything is
 * said. Pass the call itself: `withQuietRetry(() => supabase.functions.invoke(...))`.
 */
export async function withQuietRetry<T extends { error: unknown }>(send: () => Promise<T>, opts: { attempts?: number; waitMs?: number } = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const wait = opts.waitMs ?? 1500;
  let result = await send();
  for (let i = 1; i < attempts && result.error && safeToResend(result.error); i++) {
    await new Promise((resolve) => setTimeout(resolve, wait * i));
    result = await send();
  }
  return result;
}
