// Caller authentication for edge functions that must not be world-invokable.
//
// Context: this project runs every function with verify_jwt = false because
// two of its entry points (gOS bridge, hub bridge) legitimately have no
// Supabase JWT. The side effect is that NOTHING verifies the caller unless the
// function does it itself — update-report shipped without such a check and is
// flagged as a pre-existing hole. New functions use this guard instead.
//
// supabase.functions.invoke() always forwards the signed-in user's JWT in the
// Authorization header, for both portals (legacy hub bridge and gOS both mint
// real Supabase sessions), so requiring it here costs the frontend nothing.
//
// The role check runs through the SQL helpers (is_moburst_staff /
// can_write_client) with the CALLER's token, so RLS semantics — including
// company-scoped staff — apply exactly as they do to direct table access.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface StaffCaller {
  userId: string;
  /** Client bound to the caller's JWT — queries through it hit RLS as them. */
  asCaller: SupabaseClient;
}

export class AuthzError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Require a signed-in Moburst staff member. Optionally require write access to
 * one client (company-scoped staff fail this for companies outside their
 * allowlist).
 */
export async function requireStaff(
  req: Request,
  opts: { writeClientId?: string } = {},
): Promise<StaffCaller> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) throw new AuthzError(401, "Sign-in required.");

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await asCaller.auth.getUser(jwt);
  if (userErr || !userData?.user) throw new AuthzError(401, "Invalid or expired session.");

  const { data: isStaff, error: staffErr } = await asCaller.rpc("is_moburst_staff");
  if (staffErr) throw new AuthzError(500, `Role check failed: ${staffErr.message}`);
  if (!isStaff) throw new AuthzError(403, "Moburst staff only.");

  if (opts.writeClientId) {
    const { data: canWrite, error: writeErr } = await asCaller.rpc("can_write_client", {
      _client_id: opts.writeClientId,
    });
    if (writeErr) throw new AuthzError(500, `Access check failed: ${writeErr.message}`);
    if (!canWrite) throw new AuthzError(403, "You do not have access to this client.");
  }

  return { userId: userData.user.id, asCaller };
}

/**
 * The same guard, as a Response to return rather than an error to catch.
 *
 * Nearly every function in this project wraps its whole body in one broad
 * `catch` that turns anything into a 500. A thrown AuthzError lands there and
 * gets reported as a server fault, so the caller cannot tell "you are signed
 * out" from "the Sprout API is down". Calling this at the top of the handler,
 * before that try block, keeps the status code honest without threading an
 * AuthzError branch through every catch in the codebase.
 *
 * Returns null when the caller is staff. Otherwise returns the Response.
 */
export async function staffGate(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  try {
    await requireStaff(req);
    return null;
  } catch (err) {
    const status = err instanceof AuthzError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Authentication failed.";
    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
