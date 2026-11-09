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
// Response envelope: this function ALWAYS returns HTTP 200 with a JSON body. Success
// bodies have {access_token, refresh_token, tool_role, user_id, debug}; error bodies
// have {error, debug}. Returning 200 for errors avoids Lovable's runtime-error banner,
// which fires on any non-2xx response regardless of whether the frontend handles it.

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createClient } from "../_shared/supabase.ts";
import { findAuthUserByEmail } from "../_shared/auth/findUser.ts";
import { resolveToolRole, type HubUser, type ToolRole } from "./role.ts";

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

async function provisionAndSignIn(
  supabase: SupabaseClient,
  serviceRoleKey: string,
  hubUser: HubUser,
  toolRole: Exclude<ToolRole, null>,
): Promise<{ ok: true; access_token: string; refresh_token: string; user_id: string; mapped_clients: number }
  | { ok: false; error: string }> {
  const email = hubUser.email.toLowerCase();
  const password = `hub_bridge_${email}_${serviceRoleKey.slice(-16)}`;

  const existingUser = await findAuthUserByEmail(supabase, email);

  let supabaseUserId: string;
  if (existingUser) {
    await supabase.auth.admin.updateUserById(existingUser.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: hubUser.name, hub_user_id: hubUser._id },
    });
    supabaseUserId = existingUser.id;
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: hubUser.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: hubUser.name, hub_user_id: hubUser._id },
    });
    if (createErr || !created?.user) {
      console.error("Create user error:", createErr);
      return { ok: false, error: "Failed to provision user" };
    }
    supabaseUserId = created.user.id;
  }

  await supabase.from("profiles").upsert(
    {
      user_id: supabaseUserId,
      display_name: hubUser.name,
      email: hubUser.email,
      hub_user_id: hubUser._id,
      hub_company_name: hubUser.company || null,
    },
    { onConflict: "user_id" },
  );

  // Reconcile role: wipe then insert. Previous role (if any) is overwritten.
  await supabase.from("user_roles").delete().eq("user_id", supabaseUserId);
  const { error: roleErr } = await supabase
    .from("user_roles")
    .insert({ user_id: supabaseUserId, role: toolRole });
  // The delete above already ran, so a failed insert leaves this account with
  // no role at all. Logging and carrying on would hand back a working session
  // for a user that is_moburst_staff() now says no to: they sign in, see an
  // empty app, and have nothing to go on. Refuse instead. The next attempt
  // re-runs the whole reconcile from scratch, so a transient failure heals.
  if (roleErr) {
    console.error("Role insert error:", roleErr);
    return { ok: false, error: `Could not assign your role (${roleErr.message}). Try signing in again.` };
  }

  // Reconcile client_users mapping: wipe ALL existing rows for this user, then
  // auto-populate based on current hub company. This prevents stale mappings from
  // prior tests (e.g. user was once mapped to "Bader Law", now should map to
  // "Acme" but the old row persisted).
  let mappedClients = 0;
  if (toolRole === "client") {
    await supabase.from("client_users").delete().eq("user_id", supabaseUserId);

    if (hubUser.company) {
      const { data: matchingClients } = await supabase
        .from("clients")
        .select("id")
        .ilike("hub_company_name", hubUser.company);

      if (matchingClients && matchingClients.length > 0) {
        const rows = matchingClients.map((c: { id: string }) => ({
          user_id: supabaseUserId,
          client_id: c.id,
          role: "viewer",
        }));
        const { error: mapErr } = await supabase.from("client_users").insert(rows);
        if (mapErr) console.error("client_users insert error:", mapErr);
        else mappedClients = rows.length;
      }
    }
  } else {
    // Non-client roles don't need client_users mapping, and any existing rows
    // from a prior client stint should be cleared so is_client_member() doesn't
    // accidentally grant old scope.
    await supabase.from("client_users").delete().eq("user_id", supabaseUserId);
  }

  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
    email: hubUser.email,
    password,
  });
  if (signInErr || !signIn?.session) {
    console.error("Sign in error:", signInErr);
    return { ok: false, error: "Failed to create session" };
  }

  return {
    ok: true,
    access_token: signIn.session.access_token,
    refresh_token: signIn.session.refresh_token,
    user_id: supabaseUserId,
    mapped_clients: mappedClients,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { hubToken, devEmail } = body as { hubToken?: string; devEmail?: string };
    const origin = req.headers.get("origin") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // A Hub token is the only credential this function accepts. Anything else,
    // devEmail included, is refused before a session can be minted.
    if (devEmail) {
      console.log(`[bridge] Refused a devEmail sign-in from origin="${origin}"`);
      return json({
        error: "dev_sign_in_removed",
        debug: { origin, tool_name: TOOL_NAME },
      });
    }

    // ── Production path (Hub JWT) ──────────────────────────────────────────────
    if (!hubToken) return json({ error: "Missing hubToken", debug: { origin, tool_name: TOOL_NAME } });

    const hubRes = await fetch(`${HUB_BACKEND_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${hubToken}` },
    });
    if (!hubRes.ok) {
      return json({ error: "Invalid hub token", debug: { origin, tool_name: TOOL_NAME, hub_status: hubRes.status } });
    }

    const hubUser = (await hubRes.json()) as HubUser;
    if (!hubUser?.email) {
      return json({ error: "No email from Hub", debug: { origin, tool_name: TOOL_NAME } });
    }
    if (hubUser.isActive === false) {
      return json({ error: "User is deactivated in Hub", debug: { origin, tool_name: TOOL_NAME, hub_email: hubUser.email } });
    }

    const resolution = resolveToolRole(hubUser, TOOL_NAME);
    const debug = {
      origin,
      tool_name: TOOL_NAME,
      hub_email: hubUser.email,
      hub_company: hubUser.company,
      hub_global_role: hubUser.role,
      resolved_role: resolution.role,
      resolution_source: resolution.source,
      tool_entry_name: resolution.tool_entry_name,
      tool_entry_role: resolution.tool_entry_role,
      tool_names_from_hub: resolution.tool_names_from_hub,
    };

    if (!resolution.role) {
      return json({
        error: "User has no role for this tool. Contact a Hub admin to assign access.",
        debug,
      });
    }

    const result = await provisionAndSignIn(supabase, serviceRoleKey, hubUser, resolution.role);
    if (!result.ok) return json({ error: result.error, debug });

    return json({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      tool_role: resolution.role,
      user_id: result.user_id,
      debug: { ...debug, mapped_clients: result.mapped_clients },
    });
  } catch (err) {
    console.error("hub-auth-bridge error:", err);
    return json({ error: "Internal error", debug: { message: err instanceof Error ? err.message : String(err) } });
  }
});
