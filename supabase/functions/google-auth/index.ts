// supabase/functions/google-auth/index.ts
//
// Connects the Google account Socialytics makes strategy decks in
// (ai@moburst.com), once, from Settings. Spec: docs/superpowers/specs/
// 2026-11-03-strategy-v2-design.md, section 4; the setup steps are in
// docs/superpowers/specs/2026-11-03-strategy-v2-google-setup.md.
//
//   POST {action:"status"}   staff: whether Google is connected, and as whom.
//   POST {action:"start"}    admin: the Google sign-in link to open.
//   GET  ?code=..&state=..   Google sends the browser back here (no JWT, so
//                            the state is the proof); the browser is sent on
//                            to Settings with the outcome as a short word.
//
// The refresh token goes to Vault (google_token_save) and never leaves the
// server: no answer from this function carries a token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import { googleConfig } from "../_shared/google/oauth.ts";
import { finishSignIn, googleStatus, startSignIn } from "../_shared/google/connect.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Where Google sends the browser back: this function itself. */
const redirectUri = () => `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-auth`;
/** Supabase serves html from *.supabase.co as plain text, so the outcome is shown by the app. */
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://socialytics.moburst.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const config = googleConfig((k) => Deno.env.get(k));
  try {
    const url = new URL(req.url);
    if (req.method === "GET" && (url.searchParams.has("code") || url.searchParams.has("error"))) {
      // A browser is following a redirect: every exit is a redirect back to the app.
      if (!config) return back("refused");
      const outcome = await finishSignIn(admin, config, {
        code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error"), redirectUri: redirectUri(),
      }, new Date()).catch((e) => {
        console.warn("[google-auth] the sign-in did not finish", e instanceof Error ? e.message : String(e));
        return "not_saved" as const;
      });
      return back(outcome);
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action || "status";
    if (action === "status") {
      await requireStaff(req);
      return json(await googleStatus(admin, config));
    }
    if (action === "start") {
      const { asCaller } = await requireStaff(req);
      const { data: isAdmin } = await asCaller.rpc("is_admin");
      if (!isAdmin) return json({ error: "Connecting Google is an admin action." }, 403);
      if (!config) return json({ ready: false });
      return json({ ready: true, authorize_url: await startSignIn(admin, config, redirectUri(), new Date()) });
    }
    return json({ error: `Unknown action '${action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    console.error("[google-auth]", err instanceof Error ? err.message : String(err));
    return json({ error: "The Google connection could not be read." }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function back(outcome: string): Response {
  const to = new URL("/settings", APP_ORIGIN);
  to.searchParams.set("google", outcome === "connected" ? "connected" : "not_connected");
  if (outcome !== "connected") to.searchParams.set("reason", outcome);
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: to.toString() } });
}
