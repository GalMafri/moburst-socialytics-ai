// The Hub (gOS) role a person signs in with, as one of Socialytics' three.
//
//   super_admin, admin, account_manager         → admin
//   client, viewer                              → client (their companies, read only)
//   user / staff / moburst_user at Moburst      → moburst_user: with companies
//                                                  assigned, limited to them with
//                                                  full staff features (the database's
//                                                  company-scoped staff, migration
//                                                  20260720130000); with none, all
//   user / staff in an outside organization     → client
//   anything else                               → null (refused with a clear message)
//
// "At Moburst" is what the Hub says about the person: no organization, or one
// that names Moburst. Until 9 Nov 2026 a user with companies became a client,
// so six Moburst people (Liran Gal among them) could not make designs.
// The bridge writes profiles.hub_company_name as NULL for every Hub sign-in, so
// a Moburst user with companies is always limited to them (is_company_restricted).

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
