// Hub → Supabase auth bridge for Socialytics.
//
// One code path: {hubToken} → validate against Hub → mint a session with the
// resolved tool role. There is no devEmail path any more, and there must never
// be one again.
//
// What was here until 2026-09-17: a {devEmail} body with no hubToken minted a
// working admin session for any address, gated only by isDevOrigin(), which
// read the Origin request header. Origin is set by the caller on any direct
// HTTP call, so the gate stopped a browser and nothing else: one curl with
// `Origin: http://localhost` returned admin access and refresh tokens for an
// arbitrary email. gos-auth-bridge was written without this path for exactly
// that reason and says so in its own header. Two accounts in auth.users
// (x@x.com, dev@moburst.local) still carry the dev- hub ids it created.
//
// If a preview convenience is ever wanted again, gate it on a server-side
// secret the caller cannot see, never on a request header.
//
// Reconcile: the browser sends hubToken, and accessToken when it already holds
// a session. This function is the one place that decides access, so it runs on
// every load: a deactivated person or one whose tool was removed loses the
// role and the client mapping and the presented session ends; a role or
// company that changed is written again. When the presented session is the
// same person's, the answer is ok with no new session.
//
// The decision itself is in handler.ts (handleHubSignIn), which a test calls with fakes.
//
// Response envelope: this function ALWAYS returns HTTP 200 with a JSON body. Success
// bodies have {access_token, refresh_token, tool_role, user_id, debug}; error bodies
// have {error, debug}, where error is one of AUTH_ERROR_CODES (_shared/auth/session.ts) and
// never a sentence or a database message; the detail is logged here. Returning 200 for errors avoids Lovable's runtime-error banner,
// which fires on any non-2xx response regardless of whether the frontend handles it.

import { createClient } from "../_shared/supabase.ts";
import { handleHubSignIn } from "./handler.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HUB_BACKEND_URL = "https://tools-server.moburst.com";
const TOOL_NAME = Deno.env.get("HUB_TOOL_NAME") || "Socialytics";

// isDevOrigin and its allowlist lived here. They are gone on purpose: an
// Origin-based check cannot authenticate anything, because the caller writes
// that header. Origin is still read below, but only to log where a request
// came from.

// The role rule lives in role.ts (resolveToolRole).

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// A fresh client for verifying the magic link only. The admin client must not
// hold the person's session, or later calls on it would run as that person.
function createMintClient(supabaseUrl: string) {
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(supabaseUrl, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const origin = req.headers.get("origin") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    return json(await handleHubSignIn({
      fetchHub: (hubToken) => fetch(`${HUB_BACKEND_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${hubToken}` } }),
      admin: supabase,
      mint: createMintClient(supabaseUrl),
      toolName: TOOL_NAME,
      origin,
    }, body));
  } catch (err) {
    console.error("hub-auth-bridge error:", err);
    return json({ error: "internal", debug: { tool_name: TOOL_NAME } });
  }
});
