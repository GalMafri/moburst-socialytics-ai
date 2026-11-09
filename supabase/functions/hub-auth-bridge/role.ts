// The tools.moburst.com Hub role a person signs in with, as one of Socialytics'
// three. The Hub's Socialytics tool entry decides ("Admin" → admin; "Moburst
// User", "Moburst", "moburst_user", "Staff" → moburst_user; "Client", "Viewer" →
// client); with no entry, a global Hub admin is an admin (lockout prevention)
// and anyone else is refused. Then any moburst.com address is raised to at
// least moburst_user (Lital, 9 Nov 2026: "make any @moburst email address
// automatically be granted a moburst user role, not client in both hubs";
// _shared/auth/moburstPeople.ts, shared with gos-auth-bridge). Pure: no Deno.

import { moburstAddress, withMoburstFloor, type ToolRole } from "../_shared/auth/moburstPeople.ts";

export type { ToolRole };

export type HubUser = {
  _id: string;
  name: string;
  email: string;
  role: string;
  company: string;
  isActive: boolean;
  tools: Array<{ tool: { _id: string; name: string; url?: string }; role: string }>;
};

export type RoleResolution = {
  role: ToolRole;
  source: "tool_entry" | "global_admin_fallback" | "moburst_address" | "none";
  tool_entry_name?: string;
  tool_entry_role?: string;
  tool_names_from_hub?: string[];
};

/** The role the Hub's own settings give, before the moburst.com rule. */
function hubSettingsRole(hubUser: HubUser, toolName: string): RoleResolution {
  const target = toolName.toLowerCase().trim();
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
    return { role, source: "tool_entry", tool_entry_name: toolEntry.tool?.name, tool_entry_role: rawRole, tool_names_from_hub: allNames };
  }

  // No tool entry: fall back to the global role so Moburst admins can reach tools
  // they haven't been assigned to yet (lockout prevention).
  if ((hubUser.role || "").toLowerCase() === "admin") {
    return { role: "admin", source: "global_admin_fallback", tool_names_from_hub: allNames };
  }
  return { role: null, source: "none", tool_names_from_hub: allNames };
}

export function resolveToolRole(hubUser: HubUser, toolName = "Socialytics"): RoleResolution {
  const fromHub = hubSettingsRole(hubUser, toolName);
  const role = withMoburstFloor(fromHub.role, hubUser.email);
  return role !== fromHub.role && moburstAddress(hubUser.email) ? { ...fromHub, role, source: "moburst_address" } : fromHub;
}
