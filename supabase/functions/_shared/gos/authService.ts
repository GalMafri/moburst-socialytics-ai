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
