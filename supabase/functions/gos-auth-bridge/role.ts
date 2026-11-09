// The moburst.ai Hub (gOS) role a person signs in with, as one of Socialytics' three.
//
//   super_admin, admin, account_manager     → admin
//   anyone else with a moburst.com address  → moburst_user (every client, full
//                                             staff features; migration 20261111110000)
//   user, staff, moburst_user, client, viewer, any other address → client
//   anything else                           → null (refused with a clear message)
//
// Lital, 9 Nov 2026: "make any @moburst email address automatically be granted a
// moburst user role, not client in both hubs" (_shared/auth/moburstPeople.ts,
// shared with hub-auth-bridge for tools.moburst.com). Until 9 Nov a Hub user with
// companies became a client, so six Moburst people could not make designs.

import { withMoburstFloor, type ToolRole } from "../_shared/auth/moburstPeople.ts";

export type { ToolRole };

export function mapGosRole(role: string, email: string | null | undefined): ToolRole {
  const r = (role || "").toLowerCase().trim();
  if (r === "super_admin" || r === "admin" || r === "account_manager") return "admin";
  const known = r === "user" || r === "staff" || r === "moburst_user" || r === "client" || r === "viewer";
  return withMoburstFloor(known ? "client" : null, email);
}
