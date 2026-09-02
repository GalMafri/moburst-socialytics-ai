// supabase.functions.invoke() reports any non-2xx as the generic
// "Edge Function returned a non-2xx status code" and leaves the server's
// JSON body on error.context (a Response). Every function in this app answers
// failures with { error: "<human-readable reason>" }, so surface that instead.
export async function describeInvokeError(
  error: unknown,
  data?: { error?: unknown } | null,
): Promise<string> {
  if (data && typeof data === "object" && data.error) return String(data.error);
  const err = error as { message?: string; context?: unknown } | null;
  const ctx = err?.context as { json?: () => Promise<unknown>; clone?: () => { json: () => Promise<unknown> }; status?: number } | undefined;
  if (ctx && typeof ctx === "object") {
    try {
      const res = typeof ctx.clone === "function" ? ctx.clone() : ctx;
      const body = (await res.json()) as { error?: unknown; message?: unknown };
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
    } catch {
      // body wasn't JSON; fall through
    }
    if (typeof ctx.status === "number") {
      if (ctx.status === 504) return "The server took too long (over the 150s limit). Try again; large sites take longer to read.";
      if (ctx.status === 401) return "Your session has expired. Re-open the tool from the portal.";
      if (ctx.status === 403) return "You do not have access to this client.";
      return `Server error ${ctx.status}`;
    }
  }
  return err?.message || "Request failed";
}
