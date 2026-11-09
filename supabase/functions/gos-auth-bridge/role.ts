// The Hub (gOS) role a person signs in with, as one of Socialytics' three.
//
//   super_admin, admin, account_manager         → admin
//   client, viewer                              → client (their companies, read only)
//   user / staff / moburst_user at Moburst      → moburst_user: every client, with
//                                                  full staff features, whatever
//                                                  companies the Hub lists (Lital,
//                                                  9 Nov 2026; migration
//                                                  20261111110000)
//   user / staff in an outside organization     → client
//   anything else                               → null (refused with a clear message)
//
// "At Moburst" is what the Hub says about the person: no organization, or one
// that names Moburst. Until 9 Nov 2026 a user with companies became a client,
// so six Moburst people (Liran Gal among them) could not make designs.
// Because a Moburst user sees every client, this test is what keeps anyone
// outside Moburst a client: a Hub client or viewer, or a user the Hub places in
// an outside organization.

export type ToolRole = "admin" | "moburst_user" | "client" | null;

/** True when the Hub places the person at Moburst: no organization, or one naming Moburst. */
export function atMoburst(organization: string | null | undefined): boolean {
  const org = (organization ?? "").trim().toLowerCase();
  return org === "" || org.includes("moburst");
}

export function mapGosRole(role: string, organization: string | null | undefined): ToolRole {
  const r = (role || "").toLowerCase().trim();
  if (r === "super_admin" || r === "admin" || r === "account_manager") return "admin";
  if (r === "client" || r === "viewer") return "client";
  if (r === "user" || r === "moburst_user" || r === "staff") return atMoburst(organization) ? "moburst_user" : "client";
  return null;
}
