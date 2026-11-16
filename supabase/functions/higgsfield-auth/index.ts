// supabase/functions/higgsfield-auth/index.ts
//
// Links the team's Higgsfield account to Socialytics, once.
//
// Higgsfield's MCP has no machine credential, so a person signs in and the
// refresh token that comes back is what the server uses from then on. The
// account is deliberately a shared team login (social-team@moburst.com)
// rather than an individual's: every client's generation runs through it,
// and it should not stop working when one person changes their password.
//
// The requests (start, the callback from Clerk, status) are handled in
// _shared/higgsfield/oauth.ts; this file wires them to the project.

import { createClient } from "../_shared/supabase.ts";
import { requireStaff } from "../_shared/auth/requireStaff.ts";
import { handleAuthRequest } from "../_shared/higgsfield/oauth.ts";

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return handleAuthRequest(req, {
    db,
    env: (k) => Deno.env.get(k),
    requireStaff: async (r) => {
      const { asCaller } = await requireStaff(r);
      return { isAdmin: async () => !!(await asCaller.rpc("is_admin")).data };
    },
  });
});
