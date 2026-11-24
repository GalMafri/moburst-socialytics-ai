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
// {error, debug}, where error is one of AUTH_ERROR_CODES (_shared/auth/session.ts), never a
// sentence, a role value or a database message. Mirrors hub-auth-bridge to avoid Lovable's runtime-error banner.
// The debug object is intentionally minimal (no email / org / slug allowlist).

import { createClient } from "../_shared/supabase.ts";
import { portalStatusCode, provisionAndSignIn } from "../_shared/auth/session.ts";
import { linkPortalCompanies } from "../_shared/lifecycle/portal.ts";
import { mapGosRole, type ToolRole } from "./role.ts";
import { authServiceFor, exchangeHandoff } from "../_shared/gos/authService.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOOL_ID = Deno.env.get("TOOL_ID") || "socialytics";

// Choose the gOS Auth Service by request origin so a single deployment serves both
// portals correctly: dev-portal (mobtools.ai / lovable) handoffs exchange against the
// dev auth service, prod (moburst.ai / .com) against prod. AUTH_SERVICE_URL, if set,
// forces a specific endpoint and overrides the origin heuristic. The rule lives in
// _shared/gos/authService.ts so gos-usage-push picks the same service.
function pickAuthService(origin: string): string {
  return authServiceFor(origin, Deno.env.get("AUTH_SERVICE_URL"));
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

// The role mapping lives in role.ts (mapGosRole).

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    if (!handoffToken) return json({ error: "missing_token", debug: { tool_id: TOOL_ID } });

    const authServiceUrl = pickAuthService(origin);
    let exchRes: Response;
    try {
      exchRes = await exchangeHandoff({ authServiceUrl, handoffToken, toolId: TOOL_ID, toolToken: Deno.env.get("MOBTOOLS_TOOL_TOKEN"), log: (l) => console.error(l) });
    } catch (err) {
      console.error("gOS exchange request error:", err);
      return json({ error: "portal_unreachable", debug: { tool_id: TOOL_ID } });
    }
    if (!exchRes.ok) {
      // Only a 401 or 403 says the token is no good; an outage is not a refusal.
      return json({
        error: portalStatusCode(exchRes.status),
        debug: { tool_id: TOOL_ID, exchange_status: exchRes.status },
      });
    }

    const gosUser = (await exchRes.json()) as GosUser;
    if (!gosUser?.email) {
      return json({ error: "no_email", debug: { tool_id: TOOL_ID } });
    }

    const slugs = Array.isArray(gosUser.allowed_company_slugs) ? gosUser.allowed_company_slugs : [];
    const toolRole = mapGosRole(gosUser.role, gosUser.email);
    // Detailed context stays server-side only.
    console.log("[gos-bridge]", JSON.stringify({
      tool_id: TOOL_ID, gos_email: gosUser.email, gos_role: gosUser.role,
      gos_org: gosUser.organization, slugs, resolved_role: toolRole,
    }));

    if (!toolRole) {
      return json({
        error: "unknown_role",
        debug: { tool_id: TOOL_ID, resolved_role: null },
      });
    }

    const mintClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const result = await provisionAndSignIn(supabase, {
      email: gosUser.email,
      name: gosUser.name,
      hubUserId: String(gosUser.user_id),
      toolRole,
      source: "gos",
      slugs,
    }, { mint: mintClient });
    if (!result.ok) return json({ error: result.error, debug: { tool_id: TOOL_ID } });

    // A portal company that matches no client yet is linked to its client by
    // exact name, and the client takes the portal's organization name as its
    // hub company name when it has none (_shared/lifecycle/portal.ts). This
    // never stops a sign-in.
    // Every sign-in links its companies by slug; only a client's organization
    // matches or names a client, so a staff sign-in never stamps "Moburst" on one.
    await linkPortalCompanies(supabase, slugs, toolRole === "client" ? gosUser.organization ?? null : null);

    if (!result.access_token || !result.refresh_token) return json({ error: "session_failed", debug: { tool_id: TOOL_ID } });
    return json({
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      tool_role: toolRole,
      user_id: result.user_id,
      debug: { tool_id: TOOL_ID, resolved_role: toolRole },
    });
  } catch (err) {
    console.error("gos-auth-bridge error:", err);
    return json({ error: "internal", debug: { tool_id: TOOL_ID } });
  }
});
