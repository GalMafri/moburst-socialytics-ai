// supabase/functions/role-preview/index.ts
//
// Preview as a client. A staff member chooses one client and from then on IS
// a client user of exactly that client, in the database's access rules as
// well as on the screens, until they choose Exit preview. Lital, 18 Nov
// 2026: "i need to be able to override the role to preview as a client".
// The sign-in rule of 9 Nov (a moburst.com address is always a Moburst
// user) is untouched: this is a switch inside the app, after sign-in.
//
//   POST {action:"start", client_id}  staff only; begins a preview of that client
//   POST {action:"stop"}              the person in a preview; puts them back
//   POST {action:"status"}            any signed-in person; their open preview, or none
//
// Each switch is one database function, so one transaction
// (role_preview_begin and role_preview_end, migration
// 20261118120000_role_previews.sql): who may start, what is written, and how
// a preview ends by itself after a sign-in or after 8 hours are decided
// there, under a lock on the person's role. preview.ts turns a request into
// those calls and their answers into replies. This file checks who is
// calling.
//
// Every function here runs with verify_jwt = false, so this one verifies the
// session itself: the bearer token is checked with the auth server and the
// person it names is the only person the request can act on. No request
// names another user. A connected app (an OAuth session, the Claude
// connector) is refused: it reads Socialytics and never changes anything.
// The project's own server secret is not accepted either, because a preview
// is something a person does to their own session.

import { createClient } from "../_shared/supabase.ts";
import { bearerToken, OAUTH_READ_ONLY, oauthClientOf } from "../_shared/auth/authz.ts";
import { handleRolePreview } from "./preview.ts";
import { previewStore } from "./store.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Use POST.", code: "method" }, 405);

  try {
    const jwt = bearerToken(req.headers.get("Authorization"));
    if (!jwt) return json({ error: "Sign-in required.", code: "signed_out" }, 401);
    if (oauthClientOf(jwt)) return json({ error: OAUTH_READ_ONLY, code: "read_only" }, 403);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: who, error: whoError } = await admin.auth.getUser(jwt);
    if (whoError || !who?.user?.id) return json({ error: "Invalid or expired session.", code: "signed_out" }, 401);

    const body = await req.json().catch(() => ({}));
    const reply = await handleRolePreview(previewStore(admin), who.user.id, body ?? {});
    return json(reply.body, reply.status);
  } catch (err) {
    console.error("[role-preview] error:", err);
    return json({ error: "This did not go through. Try again in a moment.", code: "unavailable" }, 500);
  }
});
