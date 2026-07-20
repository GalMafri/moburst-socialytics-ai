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
