// Hub → Supabase auth bridge for Socialytics.
//
// Two code paths:
//   1. Production: {hubToken} → validate against Hub → mint session with resolved tool role
//   2. Dev preview: {devEmail} → ONLY if the request originates from a Lovable preview
//      domain (id-preview-*.lovable.app / *.lovableproject.com / localhost). Provisions a
//      dev user and grants admin. Lets the Lovable editor preview show real data.
//
// On success either path returns { access_token, refresh_token, tool_role, user_id }
// which the frontend passes to supabase.auth.setSession(). RLS then enforces scope.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HUB_BACKEND_URL = "https://tools-server.moburst.com";
const TOOL_NAME = Deno.env.get("HUB_TOOL_NAME") || "Socialytics";

// Matches Lovable editor preview origins + localhost. Does NOT match the published
// Lovable URL (moburst-socialytics-ai.lovable.app) — production must go through Hub.
const DEV_ORIGIN_PATTERN =
  /^https?:\/\/(id-preview-[a-z0-9-]+--[a-z0-9-]+\.lovable\.app|[a-z0-9-]+\.lovableproject\.com|localhost(:\d+)?)$/i;

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

function resolveToolRole(hubUser: HubUser): ToolRole {
  if ((hubUser.role || "").toLowerCase() === "admin") return "admin";

  const toolEntry = (hubUser.tools || []).find(
    (t) => (t?.tool?.name || "").toLowerCase() === TOOL_NAME.toLowerCase(),
  );
  if (!toolEntry) return null;

  const r = (toolEntry.role || "").toLowerCase();
  if (r === "admin") return "admin";
  if (r === "moburst user" || r === "moburst" || r === "moburst_user" || r === "staff") {
    return "moburst_user";
  }
  if (r === "client" || r === "viewer") return "client";
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Provision/find Supabase user, sync profile + role + client_users, mint a session.
// Shared by production and dev paths — only the source of `hubUser` differs.
async function provisionAndSignIn(
  supabase: SupabaseClient,
  serviceRoleKey: string,
  hubUser: HubUser,
  toolRole: Exclude<ToolRole, null>,
): Promise<{
  access_token: string;
  refresh_token: string;
  tool_role: ToolRole;
  user_id: string;
} | { error: string; status: number }> {
  const email = hubUser.email.toLowerCase();
  const password = `hub_bridge_${email}_${serviceRoleKey.slice(-16)}`;

  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find(
    (u) => u.email?.toLowerCase() === email,
  );

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
      return { error: "Failed to provision user", status: 500 };
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

  await supabase.from("user_roles").delete().eq("user_id", supabaseUserId);
  const { error: roleErr } = await supabase
    .from("user_roles")
    .insert({ user_id: supabaseUserId, role: toolRole });
  if (roleErr) console.error("Role upsert error:", roleErr);

  if (toolRole === "client" && hubUser.company) {
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
      await supabase.from("client_users").upsert(rows, {
        onConflict: "user_id,client_id",
        ignoreDuplicates: true,
      });
    }
  }

  const { data: signIn, error: signInErr } =
    await supabase.auth.signInWithPassword({ email: hubUser.email, password });
  if (signInErr || !signIn?.session) {
    console.error("Sign in error:", signInErr);
    return { error: "Failed to create session", status: 500 };
  }

  return {
    access_token: signIn.session.access_token,
    refresh_token: signIn.session.refresh_token,
    tool_role: toolRole,
    user_id: supabaseUserId,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { hubToken, devEmail } = body as { hubToken?: string; devEmail?: string };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Dev-mode path ─────────────────────────────────────────────────────────
    // Used ONLY by Lovable editor preview (id-preview-*.lovable.app, *.lovableproject.com,
    // and localhost). Production Lovable URL (moburst-socialytics-ai.lovable.app) does NOT
    // match this pattern, so production must go through the Hub path below.
    if (devEmail && !hubToken) {
      const origin = req.headers.get("origin") || "";
      if (!DEV_ORIGIN_PATTERN.test(origin)) {
        return json(
          { error: "Dev-mode sign-in is only allowed from Lovable preview origins" },
          403,
        );
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
      if ("error" in result) return json({ error: result.error }, result.status);
      return json(result);
    }

    // ── Production path (Hub JWT) ─────────────────────────────────────────────
    if (!hubToken) return json({ error: "Missing hubToken" }, 400);

    const hubRes = await fetch(`${HUB_BACKEND_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${hubToken}` },
    });
    if (!hubRes.ok) return json({ error: "Invalid hub token" }, 401);

    const hubUser = (await hubRes.json()) as HubUser;
    if (!hubUser?.email) return json({ error: "No email from Hub" }, 400);
    if (hubUser.isActive === false) return json({ error: "User is deactivated in Hub" }, 403);

    const toolRole = resolveToolRole(hubUser);
    if (!toolRole) {
      return json(
        { error: "User has no role for this tool. Contact a Hub admin to assign access." },
        403,
      );
    }

    const result = await provisionAndSignIn(supabase, serviceRoleKey, hubUser, toolRole);
    if ("error" in result) return json({ error: result.error }, result.status);
    return json(result);
  } catch (err) {
    console.error("hub-auth-bridge error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
