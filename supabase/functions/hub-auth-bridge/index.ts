// Hub → Supabase auth bridge for Socialytics.
//
// Flow:
//   1. Frontend receives ?hubToken=<JWT> from the Hub iframe.
//   2. Frontend POSTs { hubToken } to this function.
//   3. We validate the token by calling the Hub's /api/auth/me.
//   4. We find or create a Supabase user keyed by hubUser.email.
//   5. We resolve the user's tool-specific role (Admin / Moburst User / Client) from
//      hubUser.tools[] and upsert it into public.user_roles.
//   6. We sync hub_user_id, hub_company_name, and email into public.profiles.
//   7. For Client role users, we auto-insert public.client_users rows by matching
//      LOWER(clients.hub_company_name) = LOWER(hubUser.company).
//   8. We return a Supabase access_token + refresh_token so the frontend can set a
//      session. RLS then sees auth.uid() and enforces the correct scope.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HUB_BACKEND_URL = "https://tools-server.moburst.com";
// The name registered for THIS tool in the Hub admin panel.
const TOOL_NAME = Deno.env.get("HUB_TOOL_NAME") || "Socialytics";

type HubUser = {
  _id: string;
  name: string;
  email: string;
  role: string; // "user" | "admin"
  company: string;
  isActive: boolean;
  tools: Array<{ tool: { _id: string; name: string; url?: string }; role: string }>;
};

type ToolRole = "admin" | "moburst_user" | "client" | null;

// Map the Hub's free-text tool role to one of our three tiers.
function resolveToolRole(hubUser: HubUser): ToolRole {
  // 1) Global admin always wins — prevents accidental lockout while assigning roles.
  if ((hubUser.role || "").toLowerCase() === "admin") return "admin";

  const toolEntry = (hubUser.tools || []).find(
    (t) => (t?.tool?.name || "").toLowerCase() === TOOL_NAME.toLowerCase(),
  );
  if (!toolEntry) return null; // not assigned to this tool → blocked

  const r = (toolEntry.role || "").toLowerCase();
  if (r === "admin") return "admin";
  if (r === "moburst user" || r === "moburst" || r === "moburst_user" || r === "staff") {
    return "moburst_user";
  }
  if (r === "client" || r === "viewer") return "client";
  // Unknown tool role → treat as least-privilege (no access)
  return null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { hubToken } = await req.json().catch(() => ({}));
    if (!hubToken) return json({ error: "Missing hubToken" }, 400);

    // 1. Validate hub token by calling the Hub backend
    const hubRes = await fetch(`${HUB_BACKEND_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${hubToken}` },
    });
    if (!hubRes.ok) return json({ error: "Invalid hub token" }, 401);

    const hubUser = (await hubRes.json()) as HubUser;
    if (!hubUser?.email) return json({ error: "No email from Hub" }, 400);
    if (hubUser.isActive === false) return json({ error: "User is deactivated in Hub" }, 403);

    // 2. Resolve effective role. If null, the user isn't assigned to this tool.
    const toolRole = resolveToolRole(hubUser);
    if (!toolRole) {
      return json(
        { error: "User has no role for this tool. Contact a Hub admin to assign access." },
        403,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const email = hubUser.email.toLowerCase();
    // Deterministic password — we never expose it, only use it to mint a session.
    const password = `hub_bridge_${email}_${serviceRoleKey.slice(-16)}`;

    // 3. Find-or-create the Supabase user keyed by email
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
        return json({ error: "Failed to provision user" }, 500);
      }
      supabaseUserId = created.user.id;
    }

    // 4. Upsert profile with Hub linkage
    await supabase
      .from("profiles")
      .upsert(
        {
          user_id: supabaseUserId,
          display_name: hubUser.name,
          email: hubUser.email,
          hub_user_id: hubUser._id,
          hub_company_name: hubUser.company || null,
        },
        { onConflict: "user_id" },
      );

    // 5. Sync user_roles: wipe old rows for this user, insert the current role
    await supabase.from("user_roles").delete().eq("user_id", supabaseUserId);
    const { error: roleErr } = await supabase
      .from("user_roles")
      .insert({ user_id: supabaseUserId, role: toolRole });
    if (roleErr) {
      console.error("Role upsert error:", roleErr);
      // Not fatal — session can still mint and auth will fall back to anon-like access
    }

    // 6. For Client role, auto-map to clients whose hub_company_name matches
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
        // Upsert ignores existing (user_id, client_id) pairs due to UNIQUE constraint
        await supabase.from("client_users").upsert(rows, {
          onConflict: "user_id,client_id",
          ignoreDuplicates: true,
        });
      }
    }

    // 7. Mint a Supabase session
    const { data: signIn, error: signInErr } =
      await supabase.auth.signInWithPassword({ email: hubUser.email, password });
    if (signInErr || !signIn?.session) {
      console.error("Sign in error:", signInErr);
      return json({ error: "Failed to create session" }, 500);
    }

    return json({
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      tool_role: toolRole,
      user_id: supabaseUserId,
    });
  } catch (err) {
    console.error("hub-auth-bridge error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
