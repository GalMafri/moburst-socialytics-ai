// Remembering where someone was trying to go before they got sent to sign in.
//
// Both portals drop a user at the tool's root, not at the page they clicked:
// the gOS handoff ends in a redirect to "/", and the legacy hub opens the tool
// at "/" with a ?hubToken. So a shared link to a deep page like /admin/usage
// was a dead end for anyone not already signed in.
//
// Stored in localStorage rather than sessionStorage, because a portal may open
// the tool in a NEW TAB, and sessionStorage does not cross tabs. localStorage
// does, but it also outlives the trip, so entries carry a short expiry: without
// one, a path saved days ago would hijack an unrelated visit later.

const KEY = "mb_return_to";
const TTL_MS = 10 * 60 * 1000; // long enough to sign in, short enough not to linger

type Entry = { path: string; at: number };

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

/**
 * Query parameters that carry a sign-in credential. The legacy hub sends
 * ?hubToken and the gOS handoff sends ?token. hubAuth.ts strips hubToken from
 * the address bar on purpose, and the router can still report the address it
 * saw before that strip, so every stored path drops these here. No caller can
 * then keep a token in localStorage or put a used one back in the address bar.
 */
const SIGN_IN_PARAMS = ["hubToken", "token"];

function withoutSignInParams(path: string): string {
  const q = path.indexOf("?");
  if (q < 0) return path;
  const hash = path.indexOf("#", q);
  const raw = path.slice(q + 1, hash < 0 ? undefined : hash);
  const query = new URLSearchParams(raw);
  // Nothing to drop: hand the path back exactly as it came, so its query text
  // (%20, a bare ?flag) is not rewritten.
  if (!SIGN_IN_PARAMS.some((name) => query.has(name))) return path;
  for (const name of SIGN_IN_PARAMS) query.delete(name);
  const rest = query.toString();
  return path.slice(0, q) + (rest ? `?${rest}` : "") + (hash < 0 ? "" : path.slice(hash));
}

export function rememberReturnTo(path: string, now: number = Date.now()): void {
  try {
    if (!isSafeInAppPath(path)) return;
    const clean = withoutSignInParams(path);
    // The landing page is where every portal journey ends anyway, so there is
    // nothing to remember, and it must not replace a deep link stored a moment
    // earlier.
    if (clean === "/") return;
    localStorage.setItem(KEY, JSON.stringify({ path: clean, at: now } satisfies Entry));
  } catch {
    /* storage disabled; deep links just fall back to the dashboard */
  }
}

/** Read the stored path and clear it, so a stale one cannot fire twice. */
export function consumeReturnTo(now: number = Date.now()): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry;
    if (!entry || typeof entry.path !== "string" || typeof entry.at !== "number") return null;
    if (now - entry.at > TTL_MS) return null;
    return isSafeInAppPath(entry.path) ? entry.path : null;
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
