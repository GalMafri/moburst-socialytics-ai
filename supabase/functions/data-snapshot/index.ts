// Admin-only full database snapshot. Designed as a pre-migration safety net
// before the Hub-pure-pattern refactor: dumps every public table we care about
// and the auth.users summary so the data can be restored from JSON if a
// subsequent migration goes sideways.
//
// Call it like:
//   curl -H "Authorization: Bearer <admin-hub-token>" \
//        -X POST https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/data-snapshot \
//        > socialytics-snapshot-$(date +%Y%m%d-%H%M%S).json
//
// Auth: requires a Hub JWT belonging to a global-admin user. Rejects everything
// else. The bridge-style "always return 200" is intentionally NOT used here —
// real HTTP codes on error so the caller knows the dump failed.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const HUB_BACKEND_URL = "https://tools-server.moburst.com";
const TOOL_NAME = Deno.env.get("HUB_TOOL_NAME") || "Socialytics";

// Every table we want captured. Defensive — each is queried individually and
// failures (e.g. table not yet created in this project) don't abort the whole dump.
const TABLES = [
  "clients",
  "sprout_profiles",
  "reports",
  "report_schedules",
  "client_users",
  "user_roles",
  "profiles",
  "app_settings",
  "post_iterations",
  "brand_voice_learnings",
  "design_states",
];

const PAGE_SIZE = 1000;

async function dumpTable(supabase: SupabaseClient, table: string) {
  const rows: unknown[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { error: error.message, rows_collected: rows.length };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { rows, count: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const resp = (status: number, body: unknown) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return resp(401, { error: "Missing Hub bearer token" });

    const hubRes = await fetch(`${HUB_BACKEND_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!hubRes.ok) return resp(401, { error: "Invalid Hub token", hub_status: hubRes.status });
    const hubUser = await hubRes.json();
    if ((hubUser?.role || "").toLowerCase() !== "admin") {
      return resp(403, { error: "Admin only — data-snapshot requires a global-admin Hub user" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const snapshot: Record<string, unknown> = {};
    for (const t of TABLES) {
      snapshot[t] = await dumpTable(supabase, t);
    }

    // Capture auth.users too — identities the bridge provisioned. Password hashes
    // are never returned by listUsers(). Paginate defensively; default perPage=50
    // would silently truncate.
    const authUsers: Array<{ id: string; email: string | undefined; created_at: string; user_metadata: Record<string, unknown> }> = [];
    const perPage = 200;
    for (let page = 1; page <= 50; page++) {
      const { data: authList, error } = await supabase.auth.admin.listUsers({ page, perPage });
      if (error) break;
      const users = authList?.users || [];
      if (users.length === 0) break;
      for (const u of users) {
        authUsers.push({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
          user_metadata: (u.user_metadata || {}) as Record<string, unknown>,
        });
      }
      if (users.length < perPage) break;
    }
    snapshot["auth_users"] = { rows: authUsers, count: authUsers.length };

    return resp(200, {
      snapshotted_at: new Date().toISOString(),
      tool: TOOL_NAME,
      taken_by: { email: hubUser.email, name: hubUser.name, hub_user_id: hubUser._id },
      tables: snapshot,
    });
  } catch (err) {
    console.error("data-snapshot error:", err);
    return resp(500, {
      error: "Snapshot failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});
