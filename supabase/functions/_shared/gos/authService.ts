/**
 * Which gOS Auth Service a call goes to. Moved here from gos-auth-bridge so the
 * bridge and gos-usage-push choose it the same way:
 *
 *   AUTH_SERVICE_URL, when set, wins.
 *   Otherwise the request's origin decides: the dev portal (mobtools.ai), the
 *   Lovable preview hosts and localhost use the dev Auth Service; everything
 *   else, including a call with no origin (pg_cron), uses production.
 *
 * Pure: the caller passes the AUTH_SERVICE_URL value it read.
 */
export const GOS_AUTH_DEV = "https://auth.dev-mobtools.com";
export const GOS_AUTH_PROD = "https://auth.prod-mobtools.com";

export function authServiceFor(origin: string, override?: string | null): string {
  if (override) return override.replace(/\/+$/, "");
  let host = "";
  try { host = new URL(origin).hostname.toLowerCase(); } catch { /* no origin */ }
  const isDev =
    host.endsWith(".mobtools.ai") ||
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovableproject.com") ||
    host === "localhost" ||
    host === "127.0.0.1";
  return isDev ? GOS_AUTH_DEV : GOS_AUTH_PROD;
}

/**
 * Exchanges a single-use sign-in handoff with the Auth Service (guide §7). Sends a User-Agent always,
 * and X-Tool-Token (MOBTOOLS_TOOL_TOKEN) when the call goes to production: the token is a production
 * token, and the dev Auth Service would refuse it. If the Auth Service refuses the tool token itself
 * (401 "tool token"), it checks that before it spends the handoff, so the call is retried once without
 * the token and sign-in keeps working while the token is replaced. A refusal of the handoff is returned as is.
 */
export async function exchangeHandoff(o: {
  authServiceUrl: string;
  handoffToken: string;
  toolId: string;
  toolToken?: string | null;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  log?: (line: string) => void;
}): Promise<Response> {
  const doFetch = o.fetch ?? ((u: string, i: RequestInit) => fetch(u, i));
  const base: Record<string, string> = { "Content-Type": "application/json", "User-Agent": `${o.toolId}/1.0 (gos-auth-bridge)` };
  const token = (o.toolToken ?? "").trim();
  const send = (withToken: boolean) =>
    doFetch(`${o.authServiceUrl}/auth/exchange-token`, {
      method: "POST",
      headers: withToken ? { ...base, "X-Tool-Token": token } : base,
      // tool_id is advisory; the Auth Service reads the tool from the token.
      body: JSON.stringify({ handoff_token: o.handoffToken, tool_id: o.toolId }),
    });
  if (!token || o.authServiceUrl.replace(/\/+$/, "") !== GOS_AUTH_PROD) return send(false);
  const res = await send(true);
  if (res.status === 401) {
    const detail = await res.clone().text().catch(() => "");
    if (/tool token/i.test(detail)) {
      o.log?.(`GOS_TOOL_TOKEN_REFUSED: the Auth Service refused MOBTOOLS_TOOL_TOKEN at sign-in (${detail.slice(0, 200)}); retried without it. Replace the token.`);
      return send(false);
    }
  }
  return res;
}
