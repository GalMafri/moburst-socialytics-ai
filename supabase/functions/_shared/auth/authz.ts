// The parts of the auth guard that are pure, so they can be tested.
//
// requireStaff.ts imports the Supabase client from esm.sh, which the frontend
// test runner cannot resolve, so nothing in it was covered. That matters more
// than usual here: 18 edge functions depend on this one guard for their only
// authentication, and the failure that would matter most is silent. If
// staffGate ever returned null on a failure instead of a Response, every one
// of those functions would quietly answer an unauthenticated caller again,
// which is exactly the hole they were gated to close.
//
// Everything here is free of Deno and of any network import. requireStaff.ts
// re-exports AuthzError so all 31 existing importers keep working unchanged.

export class AuthzError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The token out of an Authorization header, or "" when there isn't one.
 *
 * Case-insensitive on the scheme because callers are not consistent about it,
 * and tolerant of extra whitespace. Anything that is not a bearer token reads
 * as absent rather than being passed through as a credential.
 */
export function bearerToken(header: string | null | undefined): string {
  const raw = String(header ?? "").trim();
  if (!raw) return "";
  const m = raw.match(/^Bearer[ \t]+(.+)$/i);
  return m ? m[1].trim() : "";
}

/**
 * An authorization failure as the Response to return.
 *
 * Anything that is not an AuthzError is a 500: a bug in the check is a server
 * fault, not a sign-in problem, and it must never read as success.
 */
export function authzResponse(err: unknown, corsHeaders: Record<string, string>): Response {
  const status = err instanceof AuthzError ? err.status : 500;
  const message = err instanceof Error && err.message ? err.message : "Authentication failed.";
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
