// gOS (moburst.ai) → Supabase auth bridge for Socialytics.
//
// This is the NEW, moburst.ai-facing counterpart of hub-auth-bridge (which serves
// the legacy tools.moburst.com hub). The two run side by side and both converge on
// the SAME Supabase session model (shadow user + user_roles + profiles), so every
// downstream concern — RLS, role gates, company scoping — is identical regardless of
// which hub the user came from. The legacy bridge is not modified.
//
// gOS specifics handled here:
//   • Token: a single-use, 30-second handoff token exchanged SERVER-SIDE against the
//     gOS Auth Service. There is NO devEmail/dev-origin path — the only credential is
//     the handoff token, so this function cannot mint a session without one.
//   • Roles: gOS sends ONE account-wide role from 5 values; we map it to Socialytics' 3.
//   • Companies: gOS sends allowed_company_slugs (an allowlist of canonical slugs).
//     We persist them to profiles.allowed_company_slugs AND set profiles.hub_company_name
//     to NULL. That NULL is the per-session provenance signal is_client_member() uses:
//     the slug branch fires only when hub_company_name IS NULL (a gOS session), so a
//     later legacy login — which always sets hub_company_name — makes the slug branch
//     inert again. No cross-hub company-scope leakage, and the legacy bridge is untouched.
//
// Response envelope: ALWAYS HTTP 200 with a JSON body. Success bodies have
// {access_token, refresh_token, tool_role, user_id, debug}; error bodies have
// {error, debug}. Mirrors hub-auth-bridge to avoid Lovable's runtime-error banner.
// The debug object is intentionally minimal (no email / org / slug allowlist).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOOL_ID = Deno.env.get("TOOL_ID") || "socialytics";

// Choose the gOS Auth Service by request origin so a single deployment serves both
// portals correctly: dev-portal (mobtools.ai / lovable) handoffs exchange against the
// dev auth service, prod (moburst.ai / .com) against prod. AUTH_SERVICE_URL, if set,
// forces a specific endpoint and overrides the origin heuristic.
function pickAuthService(origin: string): string {
  const override = Deno.env.get("AUTH_SERVICE_URL");
  if (override) return override;
  let host = "";
  try { host = new URL(origin).hostname.toLowerCase(); } catch { /* no origin */ }
  const isDev =
    host.endsWith(".mobtools.ai") ||
    host.endsWith(".lovable.app") ||
    host.endsWith(".lovableproject.com") ||
    host === "localhost" ||
    host === "127.0.0.1";
  return isDev ? "https://auth.dev-mobtools.com" : "https://auth.prod-mobtools.com";
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

// Map gOS roles onto the tool's 3 internal roles. A plain "user" is distinguished
// by whether the portal assigned them any company:
//   super_admin, admin, account_manager        → admin
//   user / staff WITHOUT a company assignment   → moburst_user (internal, sees all)
//   user / staff WITH a company assignment      → client (scoped to that company)
//   client                                      → client (scoped)
// Anything unrecognized → null (access denied with a clear message).
function mapGosRole(role: string, slugs: string[]): ToolRole {
  const r = (role || "").toLowerCase().trim();
  if (r === "super_admin" || r === "admin" || r === "account_manager") return "admin";
  if (r === "client" || r === "viewer") return "client";
  if (r === "user" || r === "moburst_user" || r === "staff") {
    return slugs.length > 0 ? "client" : "moburst_user";
  }
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
    hub_company_name: org, // display only; NOT the RLS scoping column
    allowed_company_slugs: slugs,
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

  // Socialytics profiles. hub_company_name is set to NULL on purpose: it is the
  // per-session provenance signal (see is_client_member). gOS company scope lives
  // in allowed_company_slugs; the org name is kept for display in metadata only
  // (this table has no company_name column).
  await supabase.from("profiles").upsert(
    {
      user_id: supabaseUserId,
      display_name: gosUser.name,
      email: gosUser.email,
      hub_user_id: hubUserId,
      hub_company_name: null,
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

  // gOS scoping is by allowed_company_slugs, NOT client_users. Clear any legacy
  // client_users rows so the name/cache branch can't bleed into a gOS session.
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
    const { handoffToken } = body as { handoffToken?: string };
    const origin = req.headers.get("origin") || "";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // The single-use handoff token is the ONLY credential. No dev/origin bypass.
    if (!handoffToken) return json({ error: "Missing handoffToken", debug: { tool_id: TOOL_ID } });

    const authServiceUrl = pickAuthService(origin);
    const exchRes = await fetch(`${authServiceUrl}/auth/exchange-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // tool_id is advisory — lets the auth service bind the token to this tool if
      // it chooses to; harmless if ignored.
      body: JSON.stringify({ handoff_token: handoffToken, tool_id: TOOL_ID }),
    });
    if (!exchRes.ok) {
      return json({
        error: "Invalid or expired handoff token",
        debug: { tool_id: TOOL_ID, exchange_status: exchRes.status },
      });
    }

    const gosUser = (await exchRes.json()) as GosUser;
    if (!gosUser?.email) {
      return json({ error: "No email from gOS", debug: { tool_id: TOOL_ID } });
    }

    const slugs = Array.isArray(gosUser.allowed_company_slugs) ? gosUser.allowed_company_slugs : [];
    const toolRole = mapGosRole(gosUser.role, slugs);
    const roleLc = (gosUser.role || "").toLowerCase().trim();
    // Policy: a company-assigned USER should have exactly ONE company. Flag more
    // than one as a config error (still scoped to all assigned, as a Client).
    const multiCompanyConfigError =
      (roleLc === "user" || roleLc === "moburst_user" || roleLc === "staff") && slugs.length > 1;
    // Detailed context stays server-side only.
    console.log("[gos-bridge]", JSON.stringify({
      tool_id: TOOL_ID, gos_email: gosUser.email, gos_role: gosUser.role,
      gos_org: gosUser.organization, slugs, resolved_role: toolRole,
      multi_company_config_error: multiCompanyConfigError,
    }));
    if (multiCompanyConfigError) {
      console.warn(`[gos-bridge] CONFIG ERROR: gOS user ${gosUser.email} has ${slugs.length} companies assigned; a company-assigned USER should have exactly one. Scoped to all assigned as a Client — please fix in the portal.`);
    }

    if (!toolRole) {
      return json({
        error: `User role "${gosUser.role}" is not recognized for this tool. Contact a portal admin.`,
        debug: { tool_id: TOOL_ID, resolved_role: null },
      });
    }

    const result = await provisionAndSignIn(supabase, serviceRoleKey, gosUser, toolRole);
    if (!result.ok) return json({ error: result.error, debug: { tool_id: TOOL_ID } });

    return json({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      tool_role: toolRole,
      user_id: result.user_id,
      debug: { tool_id: TOOL_ID, resolved_role: toolRole, multi_company_config_error: multiCompanyConfigError },
    });
  } catch (err) {
    console.error("gos-auth-bridge error:", err);
    return json({ error: "Internal error", debug: { tool_id: TOOL_ID } });
  }
});
