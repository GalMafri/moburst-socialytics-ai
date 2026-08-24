// Remembering where someone was trying to go before they got sent to sign in.
//
// Both portals drop a user at the tool's root, not at the page they clicked:
// the gOS handoff finishes with a redirect to "/", and the legacy hub opens the
// tool at "/" with a ?hubToken. So a shared link to a deep page like
// /admin/usage used to be a dead end for anyone not already signed in.
//
// The path is stashed in sessionStorage before we bounce to the portal. The
// user leaves this origin and comes back to it in the same tab, so the value
// survives, and it is scoped to that tab rather than leaking between windows.

const KEY = "mb_return_to";

/**
 * Only same-origin, in-app paths are ever stored. Anything else is an open
 * redirect waiting to happen: "//evil.com" is protocol-relative and would send
 * the user off-site, and a backslash is treated as a slash by some browsers.
 * Auth routes are excluded so we can never bounce someone into a loop.
 */
function isSafeInAppPath(path: string): boolean {
  if (!path || path[0] !== "/") return false;
  if (path.startsWith("//") || path.startsWith("/\\")) return false;
  if (path.includes("\\")) return false;
  if (/^\/(auth|login|logout|portal)(\/|$|\?)/.test(path)) return false;
  return true;
}

export function rememberReturnTo(path: string): void {
  try {
    if (isSafeInAppPath(path)) sessionStorage.setItem(KEY, path);
  } catch {
    /* storage disabled; deep links just fall back to the dashboard */
  }
}

/** Read the stored path and clear it, so a stale one cannot fire twice. */
export function consumeReturnTo(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return v && isSafeInAppPath(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Lets a portal, or any link, name the destination explicitly:
 *   https://advisor.moburst.ai/auth/handoff?token=...&next=/admin/usage
 * Falls back to the current path so a plain deep link works with no portal
 * changes at all.
 */
export function rememberIntendedDestination(): void {
  try {
    const next = new URLSearchParams(window.location.search).get("next");
    rememberReturnTo(next || window.location.pathname + window.location.search);
  } catch {
    /* ignore */
  }
}
