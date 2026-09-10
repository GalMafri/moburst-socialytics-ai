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
// Three ways in:
//   POST {action:"start"}   → admin only. Returns the URL to open.
//   GET  ?code=...&state=.. → the redirect back from Clerk. No auth header
//                             (a browser follows it), so `state` is the proof.
//   POST {action:"status"}  → staff. Whether it is linked, and to whom.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AuthzError, requireStaff } from "../_shared/auth/requireStaff.ts";
import {
  PROVIDER,
  authorizeUrl,
  exchangeCode,
  expiryFrom,
  makePkce,
  randomState,
  registerClient,
} from "../_shared/higgsfield/oauth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** The redirect Clerk sends the browser back to: this function itself. */
function redirectUri(): string {
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/higgsfield-auth`;
}

/** An authorisation left half-finished should not be usable for ever. */
const PENDING_TTL_MS = 15 * 60 * 1000;

/**
 * Where the callback sends the browser when it is done.
 *
 * This function cannot answer the callback with a page of its own: Supabase
 * serves every text/html body from *.supabase.co as text/plain with nosniff,
 * so the browser shows the markup as source. The result is therefore reported
 * by the app, which is also where someone would go to fix it.
 */
const APP_ORIGIN = Deno.env.get("APP_ORIGIN") || "https://socialytics.moburst.com";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const url = new URL(req.url);

    // ── The callback. A browser follows it, so there is no JWT; the state
    //    we generated and stored is what proves this is our redirect.
    if (req.method === "GET" && (url.searchParams.get("code") || url.searchParams.get("error"))) {
      const error = url.searchParams.get("error");
      if (error) return back("failed", "refused");

      const code = url.searchParams.get("code")!;
      const state = url.searchParams.get("state") || "";
      const { data: row } = await admin
        .from("integration_tokens")
        .select("client_id, pending_state, pending_verifier, pending_started_at")
        .eq("provider", PROVIDER)
        .maybeSingle();

      if (!row?.pending_state || !row.pending_verifier || !state || state !== row.pending_state) {
        return back("failed", "bad_state");
      }
      const startedAt = row.pending_started_at ? new Date(row.pending_started_at).getTime() : 0;
      if (!startedAt || Date.now() - startedAt > PENDING_TTL_MS) {
        return back("failed", "expired");
      }

      const grant = await exchangeCode({
        clientId: row.client_id!,
        code,
        verifier: row.pending_verifier,
        redirectUri: redirectUri(),
      });
      if (!grant.refresh_token) return back("failed", "no_refresh_token");

      // Who this is, so the screen can say which account is linked. The id
      // token is informational here; the refresh token is the credential.
      let email: string | null = null;
      try {
        const claims = JSON.parse(atob(String((grant as any).id_token || "").split(".")[1] || "")) as { email?: string };
        email = claims?.email || null;
      } catch {
        email = null;
      }

      await admin
        .from("integration_tokens")
        .update({
          refresh_token: grant.refresh_token,
          access_token: grant.access_token,
          expires_at: expiryFrom(grant.expires_in),
          account_email: email,
          pending_state: null,
          pending_verifier: null,
          pending_started_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("provider", PROVIDER);

      // The account is deliberately not put in the URL; the page asks for it.
      return back("linked");
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action || "status";

    if (action === "status") {
      await requireStaff(req);
      const { data: row } = await admin
        .from("integration_tokens")
        .select("account_email, expires_at, updated_at, refresh_token")
        .eq("provider", PROVIDER)
        .maybeSingle();
      return json({
        linked: !!row?.refresh_token,
        account_email: row?.account_email || null,
        linked_at: row?.updated_at || null,
      });
    }

    if (action === "start") {
      const { asCaller } = await requireStaff(req);
      const { data: isAdmin } = await asCaller.rpc("is_admin");
      if (!isAdmin) return json({ error: "Linking the team's Higgsfield account is an admin action." }, 403);

      // Reuse the registered client if we have one; Clerk issues a public
      // client per redirect URI and there is no reason to make more.
      const { data: existing } = await admin
        .from("integration_tokens")
        .select("client_id")
        .eq("provider", PROVIDER)
        .maybeSingle();
      const clientId = existing?.client_id || (await registerClient(redirectUri()));

      const { verifier, challenge } = await makePkce();
      const state = randomState();
      await admin.from("integration_tokens").upsert(
        {
          provider: PROVIDER,
          client_id: clientId,
          pending_state: state,
          pending_verifier: verifier,
          pending_started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "provider" },
      );

      return json({
        authorize_url: authorizeUrl({ clientId, redirectUri: redirectUri(), challenge, state }),
        expires_in_minutes: PENDING_TTL_MS / 60000,
        sign_in_as: "social-team@moburst.com",
      });
    }

    return json({ error: `Unknown action '${action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[higgsfield-auth]", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * The callback lands in a browser, so it hands the outcome back to the app
 * rather than rendering anything here. Only a short code travels in the URL:
 * the app turns it into a sentence, and the linked account is read from
 * `status` rather than passed as a query parameter.
 */
function back(status: "linked" | "failed", reason?: string): Response {
  const to = new URL("/settings", APP_ORIGIN);
  to.searchParams.set("higgsfield", status);
  if (reason) to.searchParams.set("reason", reason);
  return new Response(null, { status: 302, headers: { ...corsHeaders, Location: to.toString() } });
}
