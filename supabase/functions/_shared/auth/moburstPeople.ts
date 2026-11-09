// Who is a Moburst person, for both Hub sign-ins (gos-auth-bridge for
// moburst.ai, hub-auth-bridge for tools.moburst.com).
//
// Lital, 9 Nov 2026: "make any @moburst email address automatically be granted
// a moburst user role, not client in both hubs". A Moburst user works on every
// client (migration 20261111110000). Only the address decides: the part after
// the last "@" must be exactly moburst.com, any case. Admins stay admins.

export type ToolRole = "admin" | "moburst_user" | "client" | null;

/** True when the address is exactly at moburst.com (the part after the last "@", any case). */
export function moburstAddress(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at > 0 && e.slice(at + 1) === "moburst.com";
}

/** The role a Hub gave, raised to at least moburst_user for a moburst.com address; an admin stays an admin. */
export function withMoburstFloor(role: ToolRole, email: string | null | undefined): ToolRole {
  if (role === "admin") return "admin";
  return moburstAddress(email) ? "moburst_user" : role;
}
