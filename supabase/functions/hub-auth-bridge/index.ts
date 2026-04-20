// Hub → Supabase auth bridge for Socialytics.
//
// Two code paths:
//   1. Production: {hubToken} → validate against Hub → mint session with resolved tool role
//   2. Dev preview: {devEmail} → ONLY if the request originates from a Lovable preview
//      domain. Provisions a dev user and grants admin.
//
// Response envelope: this function ALWAYS returns HTTP 200 with a JSON body. Success
// bodies have {access_token, refresh_token, tool_role, user_id, debug}; error bodies
// have {error, debug}. Returning 200 for errors avoids Lovable's runtime-error banner,
// which fires on any non-2xx response regardless of whether the frontend handles it.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HUB_BACKEND_URL = "https://tools-server.moburst.com";
const TOOL_NAME = Deno.env.get("HUB_TOOL_NAME") || "Socialytics";

// Production hostnames MUST use the Hub token path — never dev sign-in.
const PRODUCTION_HOSTNAMES = new Set([
  "moburst-socialytics-ai.lovable.app",
  "socialytics.moburst.com",
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
  if (host === "localhost" || host === "127.0.0.1") return true;
  return false;
}

type HubUser = {
  _id: string;
  name: string;
  email: string;
  role: string;
  company: string;
  isActive: boolean;
  tools: Array<{ tool: { _id: string; name: string; url?: string }; role: string }>;
};

type ToolRole = "admin" | "moburst_user" | "client" | null;
type RoleResolution = {
  role: ToolRole;
  source: "tool_entry" | "global_admin_fallback" | "none";
  tool_entry_name?: string;
  tool_entry_role?: string;
  tool_names_from_hub?: string[];
};

function resolveToolRole(hubUser: HubUser): RoleResolution {
  const target = TOOL_NAME.toLowerCase().trim();
  const allNames = (hubUser.tools || []).map((t) => t?.tool?.name || "");

  // Permissive match: exact OR starts-with (e.g. "Socialytics AI" or "Socialytics by Moburst")
  const toolEntry = (hubUser.tools || []).find((t) => {
    const n = (t?.tool?.name || "").toLowerCase().trim();
    return n === target || n.startsWith(target + " ") || n.startsWith(target + "-") || n.startsWith(target);
  });

  if (toolEntry) {
    const rawRole = toolEntry.role || "";
    const r = rawRole.toLowerCase().trim();
    let role: ToolRole = null;
    if (r === "admin") role = "admin";
    else if (r === "moburst user" || r === "moburst" || r === "moburst_user" || r === "staff") role = "moburst_user";
    else if (r === "client" || r === "viewer") role = "client";
    return {
      role,
      source: "tool_entry",
      tool_entry_name: toolEntry.tool?.name,
      tool_entry_role: rawRole,
      tool_names_from_hub: allNames,
    };
  }

  // No tool entry — fall back to global role so Moburst admins can access tools they
  // haven't been explicitly assigned to yet (lockout prevention).
  if ((hubUser.role || "").toLowerCase() === "admin") {
    return { role: "admin", source: "global_admin_fallback", tool_names_from_hub: allNames };
  }
  return { role: null, source: "none", tool_names_from_hub: allNames };
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
  hubUser: HubUser,
  toolRole: Exclude<ToolRole, null>,
): Promise<{ ok: true; access_token: string; refresh_token: string; user_id: string; mapped_clients: number }
  | { ok: false; error: string }> {
  const email = hubUser.email.toLowerCase();
  const password = `hub_bridge_${email}_${serviceRoleKey.slice(-16)}`;

  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find((u) => u.email?.toLowerCase() === email);

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
  if (roleErr) console.error("Role insert error:", roleErr);

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

    // ── Dev path (Lovable preview only) ────────────────────────────────────────
    if (devEmail && !hubToken) {
      if (!isDevOrigin(origin)) {
        console.log(`[bridge] Rejected dev sign-in from origin="${origin}"`);
        return json({
          error: "dev_origin_not_allowed",
          debug: { origin, tool_name: TOOL_NAME },
        });
      }

      const synthHubUser: HubUser = {
        _id: `dev-${devEmail}`,
        name: "Dev User",
        email: devEmail,
        role: "admin",
        company: "Moburst",
        isActive: true,
        tools: [],
      };

      const result = await provisionAndSignIn(supabase, serviceRoleKey, synthHubUser, "admin");
      if (!result.ok) return json({ error: result.error, debug: { origin, tool_name: TOOL_NAME } });
      return json({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        tool_role: "admin",
        user_id: result.user_id,
        debug: { source: "dev", origin, tool_name: TOOL_NAME, mapped_clients: result.mapped_clients },
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

    const resolution = resolveToolRole(hubUser);
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
