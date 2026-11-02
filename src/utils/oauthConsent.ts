// The consent step of the Claude connector's sign-in.
//
// Supabase Auth's OAuth server sends the browser to its Site URL plus
// /oauth/consent?authorization_id=... The Site URL is the Lovable origin, but
// the team's sessions live on socialytics.moburst.ai (reached from
// moburst.ai), so the page forwards there at once, carrying only the
// authorization id. There it approves only Claude's own callback, and only
// for a person with a Socialytics role (the page checks the role).

import type { OAuthAuthorizationDetails, OAuthRedirect } from "@supabase/supabase-js";

export const CONSENT_ORIGIN = "https://socialytics.moburst.ai";
export const CONSENT_PATH = "/oauth/consent";
/** Claude's OAuth callback. Supabase matches redirect URIs exactly, so any other one is refused. */
export const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";

/** Supabase Auth makes authorization ids as 32 characters of lowercase base32. */
export function isAuthorizationId(v: unknown): v is string {
  return typeof v === "string" && /^[a-z2-7]{32}$/.test(v);
}

export type ConsentEntry = { kind: "forward"; url: string } | { kind: "here"; authorizationId: string } | { kind: "invalid" };

/** Where a visit to the consent page goes: on to socialytics.moburst.ai, the consent itself, or nowhere. */
export function consentEntry(origin: string, search: string): ConsentEntry {
  const id = new URLSearchParams(search).get("authorization_id");
  if (!isAuthorizationId(id)) return { kind: "invalid" };
  if (origin !== CONSENT_ORIGIN) return { kind: "forward", url: `${CONSENT_ORIGIN}${CONSENT_PATH}?authorization_id=${id}` };
  return { kind: "here", authorizationId: id };
}

function isClaudeCallback(url: string): boolean {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}` === CLAUDE_CALLBACK;
  } catch {
    return false;
  }
}

export type ConsentStep = { kind: "ask"; host: string; email: string } | { kind: "go"; url: string } | { kind: "refuse" };

/** What to do with the request Supabase describes: ask the person, go straight back to Claude, or refuse. */
export function consentStep(details: OAuthAuthorizationDetails | OAuthRedirect): ConsentStep {
  if ("redirect_url" in details) return isClaudeCallback(details.redirect_url) ? { kind: "go", url: details.redirect_url } : { kind: "refuse" };
  if (details.redirect_uri !== CLAUDE_CALLBACK) return { kind: "refuse" };
  return { kind: "ask", host: new URL(details.redirect_uri).host, email: details.user.email };
}

/** The browser moves, behind one seam so tests can see where it would go. */
export const browser = {
  origin: (): string => window.location.origin,
  search: (): string => window.location.search,
  replace: (url: string): void => window.location.replace(url),
  assign: (url: string): void => window.location.assign(url),
};
