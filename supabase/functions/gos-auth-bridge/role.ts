// The Hub (gOS) role a person signs in with, as one of Socialytics' three.
//
//   super_admin, admin, account_manager           → admin
//   client, viewer                                → client (their companies, read only)
//   user / staff / moburst_user, moburst.com      → moburst_user: every client, with
//     address and no outside organization            full staff features, whatever
//                                                    companies the Hub lists (Lital,
//                                                    9 Nov 2026; migration 20261111110000)
//   user / staff / moburst_user, anyone else      → client
//   anything else                                 → null (refused with a clear message)
//
// A Moburst user sees every client, so only the address grants it: the part
// after the last "@" must be exactly moburst.com. The Hub's organization can
// only take it away (one that isn't Moburst makes the person a client); an
// empty organization proves nothing, since the Hub sends none for Moburst
// people and nothing shows it sends one for outside people. A Moburst person
// on another address lands as a client, which they notice and the Hub fixes.
// Until 9 Nov 2026 a user with companies became a client, so six Moburst
// people (Liran Gal among them) could not make designs.

export type ToolRole = "admin" | "moburst_user" | "client" | null;

/** True when the address is exactly at moburst.com (the part after the last "@", any case). */
export function moburstAddress(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  return at > 0 && e.slice(at + 1) === "moburst.com";
}

/** True when the Hub names no organization, or names Moburst itself ("Moburst" or "moburst.com"). */
export function moburstOrganization(organization: string | null | undefined): boolean {
  const org = (organization ?? "").trim().toLowerCase();
  return org === "" || org === "moburst" || org === "moburst.com";
}

export function mapGosRole(role: string, email: string | null | undefined, organization: string | null | undefined): ToolRole {
  const r = (role || "").toLowerCase().trim();
  if (r === "super_admin" || r === "admin" || r === "account_manager") return "admin";
  if (r === "client" || r === "viewer") return "client";
  if (r === "user" || r === "moburst_user" || r === "staff") {
    return moburstAddress(email) && moburstOrganization(organization) ? "moburst_user" : "client";
  }
  return null;
}
