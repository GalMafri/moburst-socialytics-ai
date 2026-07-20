// gOS (moburst.ai) → Supabase auth bridge for Socialytics.
//
// This is the NEW, moburst.ai-facing counterpart of hub-auth-bridge (which serves
// the legacy tools.moburst.com hub). The two run side by side and both converge on
// the SAME Supabase session model (shadow user + user_roles + profiles), so every
// downstream concern — RLS, role gates, company scoping — is identical regardless of
// which hub the user came from. The legacy bridge is not modified.
//
// gOS differences handled here:
//   • Token: a single-use, 30-second handoff token exchanged SERVER-SIDE against the
//     gOS Auth Service (never re-validated client-side, never reused).
//   • Roles: gOS sends ONE account-wide role from 5 values; we map it to Socialytics' 3.
//   • Companies: gOS sends allowed_company_slugs (an allowlist ARRAY of canonical
//     slugs). We persist it to profiles.allowed_company_slugs, which the slug branch
//     of is_client_member() reads. Legacy name/client_users scoping is left untouched.
//
// Two code paths:
//   1. Production: {handoffToken} → POST {AUTH_SERVICE_URL}/auth/exchange-token → session
//   2. Dev preview: {devEmail} → ONLY from a Lovable/localhost origin → synthetic admin
//
// Response envelope: ALWAYS HTTP 200 with a JSON body. Success bodies have
// {access_token, refresh_token, tool_role, user_id, debug}; error bodies have
// {error, debug}. Mirrors hub-auth-bridge to avoid Lovable's runtime-error banner.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// gOS Auth Service. Dev: https://auth.dev-mobtools.com · Prod: https://auth.prod-mobtools.com
const AUTH_SERVICE_URL = Deno.env.get("AUTH_SERVICE_URL") || "https://auth.prod-mobtools.com";
const TOOL_ID = Deno.env.get("TOOL_ID") || "socialytics";

// Production hostnames MUST use the handoff-token path — never dev sign-in.
const PRODUCTION_HOSTNAMES = new Set([
  "moburst-socialytics-ai.lovable.app",
  "socialytics.moburst.com",
  "socialytics.moburst.ai",
]);

function isDevOrigin(origin: string): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (PRODUCTION_HOSTNAMES.has(host)) return false;
  if (host.endsWith(".lovable.app")) return true;
  if (host.endsWith(".lovableproject.com")) return true;
  if (host.endsWith(".mobtools.ai")) return true; // dev portal branded URLs
  if (host === "localhost" || host === "127.0.0.1") return true;
  return false;
}

// The gOS exchange-token response (see the gOS Auth integration guide, §6/§8).
type GosUser = {
  user_id: number | string;
  email: string;
  name: string;
  role: string; // super_admin | admin | account_manager | user | client
  organization?: string | null;
  permissions?: string[];
  allowed_company_slugs?: string[];
};

type ToolRole = "admin" | "moburst_user" | "client" | null;

// Map the 5 gOS roles onto Socialytics' 3 internal roles.
//   super_admin, admin        → admin
//   account_manager, user     → moburst_user (internal Moburst staff)
//   client                    → client
// Anything unrecognized → null (access denied with a clear message).
function mapGosRole(role: string): ToolRole {
  const r = (role || "").toLowerCase().trim();
  if (r === "super_admin" || r === "admin") return "admin";
  if (r === "account_manager" || r === "user" || r === "moburst_user" || r === "staff") return "moburst_user";
  if (r === "client" || r === "viewer") return "client";
  return null;
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function provisionAndSignIn(
  supabase: SupabaseClient,
  serviceRoleKey: string,
  gosUser: GosUser,
  toolRole: Exclude<ToolRole, null>,
): Promise<{ ok: true; access_token: string; refresh_token: string; user_id: string }
  | { ok: false; error: string }> {
  const email = gosUser.email.toLowerCase();
  // Same derived-password scheme as hub-auth-bridge so a user who arrives via BOTH
  // hubs maps to the same Supabase shadow user and password.
  const password = `hub_bridge_${email}_${serviceRoleKey.slice(-16)}`;
  const hubUserId = String(gosUser.user_id);
  const org = gosUser.organization || null;
  const slugs = Array.isArray(gosUser.allowed_company_slugs) ? gosUser.allowed_company_slugs : [];
  const meta = {
    full_name: gosUser.name,
    hub_user_id: hubUserId,
    tool_role: toolRole,
    hub_company_name: org,
    auth_source: "gos",
  };

  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find((u) => u.email?.toLowerCase() === email);

  let supabaseUserId: string;
  if (existingUser) {
    await supabase.auth.admin.updateUserById(existingUser.id, {
      password,
      email_confirm: true,
      user_metadata: meta,
    });
    supabaseUserId = existingUser.id;
  } else {
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: gosUser.email,
      password,
      email_confirm: true,
      user_metadata: meta,
    });
    if (createErr || !created?.user) {
      console.error("Create user error:", createErr);
      return { ok: false, error: "Failed to provision user" };
    }
    supabaseUserId = created.user.id;
  }

  // Socialytics profiles: user_id, display_name, email + hub_* cols.
  // allowed_company_slugs drives the gOS slug branch of is_client_member().
  await supabase.from("profiles").upsert(
    {
      user_id: supabaseUserId,
      display_name: gosUser.name,
      email: gosUser.email,
      hub_user_id: hubUserId,
      hub_company_name: org,
      allowed_company_slugs: slugs,
    },
    { onConflict: "user_id" },
  );

  // Reconcile role: wipe then insert exactly one row (matches hub-auth-bridge).
  await supabase.from("user_roles").delete().eq("user_id", supabaseUserId);
  const { error: roleErr } = await supabase
    .from("user_roles")
    .insert({ user_id: supabaseUserId, role: toolRole });
  if (roleErr) console.error("Role insert error:", roleErr);

  // gOS scoping is by allowed_company_slugs (persisted above), NOT client_users.
  // Clear any legacy client_users rows so the name/cache branch of is_client_member
  // can't leak stale scope into a gOS session.
  await supabase.from("client_users").delete().eq("user_id", supabaseUserId);

  const { data: signIn, error: signInErr } = await supabase.auth.signInWithPassword({
    email: gosUser.email,
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
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { handoffToken, devEmail } = body as { handoffToken?: string; devEmail?: string };
    const origin = req.headers.get("origin") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Dev path (Lovable/localhost preview only) ──────────────────────────────
    if (devEmail && !handoffToken) {
      if (!isDevOrigin(origin)) {
        console.log(`[gos-bridge] Rejected dev sign-in from origin="${origin}"`);
        return json({ error: "dev_origin_not_allowed", debug: { origin, tool_id: TOOL_ID } });
      }
      const synthUser: GosUser = {
        user_id: `dev-${devEmail}`,
        name: "Dev User",
        email: devEmail,
        role: "admin",
        organization: "Moburst",
        permissions: ["*"],
        allowed_company_slugs: [],
      };
      const result = await provisionAndSignIn(supabase, serviceRoleKey, synthUser, "admin");
      if (!result.ok) return json({ error: result.error, debug: { origin, tool_id: TOOL_ID } });
      return json({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        tool_role: "admin",
        user_id: result.user_id,
        debug: { source: "dev", origin, tool_id: TOOL_ID },
      });
    }

    // ── Production path (gOS single-use handoff token) ─────────────────────────
    if (!handoffToken) return json({ error: "Missing handoffToken", debug: { origin, tool_id: TOOL_ID } });

    const exchRes = await fetch(`${AUTH_SERVICE_URL}/auth/exchange-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handoff_token: handoffToken }),
    });
    if (!exchRes.ok) {
      return json({
        error: "Invalid or expired handoff token",
        debug: { origin, tool_id: TOOL_ID, exchange_status: exchRes.status },
      });
    }

    const gosUser = (await exchRes.json()) as GosUser;
    if (!gosUser?.email) {
      return json({ error: "No email from gOS", debug: { origin, tool_id: TOOL_ID } });
    }

    const toolRole = mapGosRole(gosUser.role);
    const debug = {
      origin,
      tool_id: TOOL_ID,
      gos_email: gosUser.email,
      gos_role: gosUser.role,
      gos_organization: gosUser.organization,
      allowed_company_slugs: gosUser.allowed_company_slugs,
      resolved_role: toolRole,
    };

    if (!toolRole) {
      return json({
        error: `User role "${gosUser.role}" is not recognized for this tool. Contact a portal admin.`,
        debug,
      });
    }

    const result = await provisionAndSignIn(supabase, serviceRoleKey, gosUser, toolRole);
    if (!result.ok) return json({ error: result.error, debug });

    return json({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      tool_role: toolRole,
      user_id: result.user_id,
      debug,
    });
  } catch (err) {
    console.error("gos-auth-bridge error:", err);
    return json({ error: "Internal error", debug: { message: err instanceof Error ? err.message : String(err) } });
  }
});
