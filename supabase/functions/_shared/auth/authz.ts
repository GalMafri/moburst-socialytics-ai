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

/**
 * Server calls to staff-gated functions. The api worker (and any schedule
 * that runs on behalf of a person) presents the project's operational secret
 * and names the user it acts for; that user id becomes created_by on
 * whatever the call writes. For most functions the secret alone is not
 * enough: a server call without an actor is refused. The few paths that
 * automatic work calls accept it as the system (serverActor below).
 */
export const SERVER_SECRET_HEADER = "x-socialytics-secret";
export const SERVER_USER_HEADER = "x-socialytics-user";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The user a server call acts for: a UUID, or "" when the header is missing or malformed. */
export function serverActAsUser(header: string | null | undefined): string {
  const raw = String(header ?? "").trim();
  return UUID.test(raw) ? raw : "";
}

/**
 * Who a server call acts as: the person its user header names, or, with no
 * user header at all, the system itself. The system is accepted only where
 * the caller allows it (automatic designs, automatic video replans, the
 * workers), and what it writes names no person (requested_by null). A header
 * that is present but not a user id is refused, never read as the system.
 */
export type ServerActor = { kind: "user"; userId: string } | { kind: "system" };

export function serverActor(header: string | null | undefined, allowSystem: boolean): ServerActor | null {
  const userId = serverActAsUser(header);
  if (userId) return { kind: "user", userId };
  if (allowSystem && !String(header ?? "").trim()) return { kind: "system" };
  return null;
}
