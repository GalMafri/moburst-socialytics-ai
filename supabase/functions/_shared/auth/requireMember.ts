// A signed-in member of the client, or Moburst staff with write access to it.
// For actions a client's own users may take on their own posts (designs, copy
// edits), which go through functions because post_iterations writes are
// staff-only under RLS.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "./requireStaff.ts";
import { bearerToken } from "./authz.ts";

/** Returns the caller's user id. */
export async function requireMember(req: Request, clientId: string): Promise<string> {
  if (req.headers.get("x-socialytics-secret")) return (await requireStaff(req, { writeClientId: clientId })).userId;
  const jwt = bearerToken(req.headers.get("Authorization"));
  if (!jwt) throw new AuthzError(401, "Sign-in required.");
  const asCaller = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false },
  });
  const { data: user, error } = await asCaller.auth.getUser(jwt);
  if (error || !user?.user) throw new AuthzError(401, "Invalid or expired session.");
  const [{ data: canWrite }, { data: member }] = await Promise.all([
    asCaller.rpc("can_write_client", { _client_id: clientId }),
    asCaller.rpc("is_client_member", { _client_id: clientId }),
  ]);
  if (!canWrite && !member) throw new AuthzError(403, "You do not have access to this client.");
  return user.user.id;
}
