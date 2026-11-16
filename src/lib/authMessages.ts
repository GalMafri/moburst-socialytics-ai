// Why a sign-in did not happen, and the one plain sentence the sign-in page
// shows for it. The bridges (supabase/functions/_shared/auth/session.ts) and
// useAuth hand over a reason code from this fixed list. Raw text from a
// bridge, the Hub or the database never reaches the screen: it goes to the
// console and the code is all the page keeps.

/** The codes the portal bridges answer with. The same list sits in _shared/auth/session.ts, and a test keeps the two equal. */
export const BRIDGE_ERROR_CODES = [
  "missing_token",
  "invalid_token",
  "no_email",
  "deactivated",
  "no_access",
  "unknown_role",
  "provision_failed",
  "session_failed",
  "portal_unreachable",
  "refused",
  "internal",
] as const;

/** Reasons only the browser can know. */
export const BROWSER_ERROR_CODES = ["expired", "unreachable", "not_configured", "restore_failed"] as const;

export const AUTH_ERROR_CODES = [...BRIDGE_ERROR_CODES, ...BROWSER_ERROR_CODES] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === "string" && (AUTH_ERROR_CODES as readonly string[]).includes(value);
}

/** True for a refusal that a stored sign-in must not override. */
export function isRefusal(code: AuthErrorCode): boolean {
  return !["unreachable", "not_configured", "internal", "provision_failed", "session_failed", "portal_unreachable", "expired", "restore_failed"].includes(code);
}

const TRY_AGAIN = "Sign-in did not finish just now. Open Socialytics again from the Moburst portal in a minute.";
const NO_ACCESS = "Your account does not have access to Socialytics yet. Please contact your Moburst team.";
const EXPIRED = "Your sign-in has expired. Open Socialytics again from the Moburst portal.";

const MESSAGES: Record<AuthErrorCode, string> = {
  missing_token: EXPIRED,
  invalid_token: EXPIRED,
  expired: EXPIRED,
  restore_failed: "Your sign-in was not restored. Open Socialytics again from the Moburst portal.",
  no_email: "Your Moburst account has no email address on file. Please contact your Moburst team.",
  deactivated: "Your Moburst account is not active. Please contact your Moburst team.",
  no_access: NO_ACCESS,
  unknown_role: NO_ACCESS,
  unreachable: "Socialytics is not reachable just now. Check your connection, then open it again.",
  not_configured: TRY_AGAIN,
  provision_failed: TRY_AGAIN,
  session_failed: TRY_AGAIN,
  portal_unreachable: TRY_AGAIN,
  refused: TRY_AGAIN,
  internal: TRY_AGAIN,
};

/** The sentence for a reason. Anything that is not on the list gets the general one. */
export function authMessage(code: unknown): string {
  return isAuthErrorCode(code) ? MESSAGES[code] : TRY_AGAIN;
}

// A failure that says nothing about whether the person is signed in: the
// network, the auth server or the database did not answer. Anything else the
// auth server says (a revoked or missing session) is a real sign-out.
export function isTransient(error: unknown): boolean {
  if (!error) return false;
  const e = error as { name?: string; status?: number; message?: string };
  if (e.name === "AuthRetryableFetchError") return true;
  if (typeof e.status === "number" && (e.status === 0 || e.status >= 500)) return true;
  return error instanceof TypeError || /failed to fetch|network|timeout/i.test(e.message || "");
}
