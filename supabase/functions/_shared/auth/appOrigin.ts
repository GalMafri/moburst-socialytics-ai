// supabase/functions/_shared/auth/appOrigin.ts
//
// Where a third-party sign-in (Google for the strategy decks, Higgsfield for
// generation) sends the browser back to: the app address the person started
// it from. The app is served on more than one address and each address keeps
// its own session, so one fixed return address is wrong for the others.
//
// The address comes from the Origin header of the request that started the
// sign-in, and is used only when it is one of the app's own addresses; any
// other value (a forged header, a different site) falls back to the default.
// The start stores the answer beside the pending sign-in; the callback, which
// has no Origin of its own, reads it back.

type Env = (key: string) => string | undefined;

/** The address used when the start did not say, or said something that is not the app. */
export const DEFAULT_APP_ORIGIN = "https://socialytics.moburst.com";

/** The app's own addresses (the team's sessions live on the .ai one; the Lovable address serves the same bundle). */
const APP_ORIGINS = [
  "https://socialytics.moburst.com",
  "https://socialytics.moburst.ai",
  "https://moburst-socialytics-ai.lovable.app",
];

/** The default address, from the APP_ORIGIN setting when it is set. */
export function defaultAppOrigin(env: Env = () => undefined): string {
  return clean(env("APP_ORIGIN")) ?? DEFAULT_APP_ORIGIN;
}

/** An origin as the browser writes it (scheme and host only), or null when it is not one. */
function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** The address to send the browser back to for a sign-in started with this Origin header. */
export function returnOriginFor(requestOrigin: string | null | undefined, env: Env = () => undefined): string {
  const fallback = defaultAppOrigin(env);
  const origin = clean(requestOrigin);
  if (!origin) return fallback;
  const own = new Set([...APP_ORIGINS, fallback]);
  return own.has(origin) ? origin : fallback;
}

/** The app's settings page on a return address, with the outcome words on it. */
export function settingsUrl(origin: string | null | undefined, params: Record<string, string | undefined>, env: Env = () => undefined): string {
  const to = new URL("/settings", returnOriginFor(origin, env));
  for (const [k, v] of Object.entries(params)) if (v !== undefined) to.searchParams.set(k, v);
  return to.toString();
}
