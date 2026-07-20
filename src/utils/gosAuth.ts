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
export const PORTAL_URL: string =
  import.meta.env.VITE_PORTAL_URL ||
  (import.meta.env.DEV ? "https://mobtools.ai" : "https://moburst.ai");

// Returns the handoff token IF we are currently on the /auth/handoff route with a
// ?token= param. Returns null otherwise. Does not persist anything.
export const getGosHandoffToken = (): string | null => {
  if (window.location.pathname !== GOS_HANDOFF_PATH) return null;
  const token = new URLSearchParams(window.location.search).get("token");
  return token && token.trim() ? token : null;
};
