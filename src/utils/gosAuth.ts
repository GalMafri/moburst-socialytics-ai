// gOS (moburst.ai) handoff-token utilities.
//
// The gOS portal opens this tool top-level at
//   https://<slug>.moburst.ai/auth/handoff?token=<single-use handoff token>
// The token is single-use and expires in 30s, so — unlike the legacy hub_token —
// it is NEVER cached or reused. It is read once, handed to the gos-auth-bridge
// edge function for the server-side exchange, then discarded.

export const GOS_HANDOFF_PATH = "/auth/handoff";

// The branded portal to bounce unauthenticated users to (and back to on logout).
// Dev: https://mobtools.ai · Prod: https://moburst.ai
//
// Resolved from the RUNTIME hostname, not import.meta.env.DEV — the latter is false in
// every `vite build` output (including the dev-deployed tool under *.mobtools.ai and
// the Lovable preview), which would wrongly send the dev tool to the prod portal.
// VITE_PORTAL_URL, if set at build time, overrides this.
function resolvePortalUrl(): string {
  if (import.meta.env.VITE_PORTAL_URL) return import.meta.env.VITE_PORTAL_URL as string;
  const host = window.location.hostname.toLowerCase();
  const isDev =
    host.endsWith(".mobtools.ai") ||
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovableproject.com") ||
    host.startsWith("id-preview-") ||
    host === "localhost" ||
    host === "127.0.0.1";
  return isDev ? "https://mobtools.ai" : "https://moburst.ai";
}

export const PORTAL_URL: string = resolvePortalUrl();

// Returns the handoff token IF we are currently on the /auth/handoff route with a
// ?token= param. Returns null otherwise. Does not persist anything.
export const getGosHandoffToken = (): string | null => {
  if (window.location.pathname !== GOS_HANDOFF_PATH) return null;
  const token = new URLSearchParams(window.location.search).get("token");
  return token && token.trim() ? token : null;
};

// The legacy portal (tools.moburst.com), for people who sign in there.
export const LEGACY_PORTAL_URL: string =
  (import.meta.env.VITE_LEGACY_PORTAL_URL as string | undefined) || "https://tools.moburst.com";

export type PortalSource = "hub" | "gos";

const LAST_PORTAL_KEY = "socialytics.lastPortal";

// Which portal a person last signed in from. Written at every successful
// sign-in and at every load that resumes a session (from the session's own
// auth_source), so a link back to "the portal" goes to the one they use. It is
// kept in memory for the life of the page and in localStorage for the next
// one. With both empty the moburst.ai portal is used.
let portalInMemory: PortalSource | null = null;

export const rememberPortal = (source: PortalSource): void => {
  portalInMemory = source;
  try {
    window.localStorage.setItem(LAST_PORTAL_KEY, source);
  } catch {
    /* storage blocked: the page still knows it from memory */
  }
};

export const lastPortal = (): PortalSource | null => {
  if (portalInMemory) return portalInMemory;
  try {
    const value = window.localStorage.getItem(LAST_PORTAL_KEY);
    return value === "hub" || value === "gos" ? value : null;
  } catch {
    return null;
  }
};

// The one place a portal link comes from.
export const portalUrl = (): string => (lastPortal() === "hub" ? LEGACY_PORTAL_URL : PORTAL_URL);

/**
 * Where "sign in" sends someone: the portal's own launch of this tool, which
 * asks for the moburst.ai sign-in when needed (/login?next=/tool/socialytics)
 * and then hands the person straight back to Socialytics, where ReturnTo takes
 * them on to the page they were trying to reach (the Claude connector's
 * consent page among them). The portal home asked them to find the tool
 * themselves after signing in, so the journey stopped there.
 * People last signed in from the legacy portal keep its address.
 */
export const GOS_TOOL_SLUG = "socialytics";
export const signInUrl = (): string =>
  lastPortal() === "hub" ? LEGACY_PORTAL_URL : `${PORTAL_URL.replace(/\/+$/, "")}/tool/${GOS_TOOL_SLUG}`;
