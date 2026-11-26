// How both portal bridges (hub-auth-bridge for tools.moburst.com and
// gos-auth-bridge for moburst.ai) turn a verified portal person into a
// Supabase session.
//
// Until 12 Nov 2026 each bridge set the shadow user's password on every
// sign-in (updateUserById) and then signed in with it. A password change ends
// the person's other sessions, so every sign-in in one tab or portal signed
// the same person out of the rest, the Claude connector included. The
// password was also derived from the email and the service key.
//
// Now:
//   - A new user is created with a random password nobody holds. An existing
//     user's password is never touched again, except once: an account made by
//     the old scheme still has a derived password, so the first sign-in after
//     this change replaces it with a random one and marks the account
//     (app_metadata.bridge_password), which a person cannot edit.
//   - The session is minted with a magic link token (admin generateLink, then
//     verifyOtp with its token hash). Nothing about the account changes. The
//     token is verified on its own short-lived client (deps.mint), so the
//     admin client keeps the service role for every call after it.
//   - A page that already holds a session for the same person presents its
//     access token. The bridge still re-checks the portal, writes the role and
//     the client mapping, and then answers ok without minting another session.
//   - When the portal no longer grants access, revokeAccess removes the role
//     and the client mapping and ends the presented session.
//   - The role is written by one SQL function (set_user_role), and the client
//     mapping by another (set_client_access), each one transaction, so there
//     is no moment when the account has no role or no clients.
//   - A sign-in never takes admin away (Lital, 26 Nov 2026: signing in through
//     tools.moburst, which lists her as a regular user, removed the admin
//     moburst.ai gives her). The two portals keep their own role lists, so an
//     admin stays admin whichever portal is used; a portal can still make
//     someone admin, and revokeAccess (the portal no longer grants the tool)
//     still removes every role.
//   - A magic link token is one per user, so two sign-ins at once can replace
//     each other's token. A failed verify is retried with a fresh link.
//   - Every failure leaves as a code from AUTH_ERROR_CODES. The detail is
//     logged here and never sent to the browser.
//
// Nothing here imports from https: or npm: so the tests can run it as it is.

import { findAuthUserByEmail } from "./findUser.ts";
import { linkHubCompany } from "../lifecycle/portal.ts";
import type { ToolRole } from "./moburstPeople.ts";

/** The only error values a bridge answers with. src/lib/authMessages.ts has the sentence for each. */
export const AUTH_ERROR_CODES = [
  "missing_token",
  "invalid_token",
  "no_email",
  "deactivated",
  "no_access",
  "unknown_role",
  "provision_failed",
  "session_failed",
  "portal_unreachable",
  "refused",
  "internal",
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/**
 * What a portal's answer to a token check means. Only a 401 or 403 says the
 * token itself is no good. Any other status that is not ok (a 502, a 503, a
 * 429) says the portal could not answer, which says nothing about the person,
 * so it is never a refusal and a stored session is left alone.
 */
export function portalStatusCode(status: number): AuthErrorCode {
  return status === 401 || status === 403 ? "invalid_token" : "portal_unreachable";
}

export interface PortalPerson {
  email: string;
  name: string;
  hubUserId: string;
  toolRole: Exclude<ToolRole, null>;
  /** Which portal the person came through. */
  source: "hub" | "gos";
  /** Legacy portal: the person's company name, matched to clients exactly. */
  company?: string | null;
  /** moburst.ai: the allowed company slugs. */
  slugs?: string[];
}

export type SignInResult =
  | {
      ok: true;
      /** Null when the presented session already belongs to this person: nothing was minted. */
      access_token: string | null;
      refresh_token: string | null;
      user_id: string;
      mapped_clients: number;
      /** The role the account holds now: the portal's, or admin when the account already was one. */
      role: Exclude<ToolRole, null>;
    }
  | { ok: false; error: AuthErrorCode };

export interface SignInDeps {
  /** A fresh, short-lived auth client (persistSession false) used only to verify the magic link. */
  mint: Admin;
  /** The access token of the session the page already holds, if any. Never trusted as identity. */
  presentedAccessToken?: string | null;
}

// The admin client is the supabase-js client, which has no type this module
// can name without an https import. Each call below is checked by its tests.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

const LINK_ATTEMPTS = 3;

/** A password nobody knows: 32 random bytes as hex. */
export function randomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const sameText = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/** The shadow user's id: found by email, or created with a random password. */
async function ensureUser(admin: Admin, person: PortalPerson): Promise<{ id: string } | null> {
  const email = person.email.toLowerCase();
  const metadata: Record<string, unknown> = {
    full_name: person.name,
    hub_user_id: person.hubUserId,
    tool_role: person.toolRole,
    auth_source: person.source,
    hub_company_name: person.source === "hub" ? person.company || null : null,
    allowed_company_slugs: person.source === "gos" ? person.slugs ?? [] : null,
  };
  const existing = (await findAuthUserByEmail(admin, email)) as
    | { id: string; app_metadata?: Record<string, unknown> | null }
    | null;
  if (existing) {
    const rotated = existing.app_metadata?.bridge_password === "random";
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      email_confirm: true,
      user_metadata: metadata,
      ...(rotated ? {} : { password: randomPassword(), app_metadata: { bridge_password: "random" } }),
    });
    if (error) {
      console.error("Update user error:", error);
      return null;
    }
    return { id: existing.id };
  }
  const { data: created, error } = await admin.auth.admin.createUser({
    email: person.email,
    password: randomPassword(),
    email_confirm: true,
    user_metadata: metadata,
    app_metadata: { bridge_password: "random" },
  });
  if (error || !created?.user) {
    console.error("Create user error:", error);
    return null;
  }
  return { id: created.user.id as string };
}

/**
 * The clients whose hub company name is exactly this company (case and edge spaces aside). When none is, the client
 * of that name is linked to it once (lifecycle/portal.ts linkHubCompany), as moburst.ai's sign-in links by slug.
 */
export async function clientsForCompany(admin: Admin, company: string): Promise<string[]> {
  const { data, error } = await admin.from("clients").select("id, hub_company_name").not("hub_company_name", "is", null);
  if (error) throw error;
  const ids = ((data ?? []) as Array<{ id: string; hub_company_name: string }>)
    .filter((c) => sameText(c.hub_company_name, company))
    .map((c) => c.id);
  return ids.length ? ids : await linkHubCompany(admin, company);
}

/**
 * The role a sign-in writes: the portal's, except that an account that is already admin stays admin. When the
 * current roles cannot be read, the portal's role is written, as before.
 */
export async function roleToWrite(admin: Admin, userId: string, portalRole: Exclude<ToolRole, null>): Promise<Exclude<ToolRole, null>> {
  if (portalRole === "admin") return portalRole;
  const { data, error } = await admin.from("user_roles").select("role").eq("user_id", userId);
  if (error) {
    console.error("Role read error:", error);
    return portalRole;
  }
  const isAdmin = ((data ?? []) as Array<{ role: string }>).some((r) => r.role === "admin");
  if (isAdmin) console.log(`sign-in: kept admin for ${userId}; the portal said ${portalRole}`);
  return isAdmin ? "admin" : portalRole;
}

/** Provision the shadow user for a verified portal person and mint a session for it. */
export async function provisionAndSignIn(admin: Admin, person: PortalPerson, deps: SignInDeps): Promise<SignInResult> {
  try {
    const user = await ensureUser(admin, person);
    if (!user) return { ok: false, error: "provision_failed" };

    // hub_company_name is the per-session provenance signal is_client_member()
    // reads: NULL for moburst.ai (scope by slug), set for the legacy portal
    // (scope by client_users). Each sign-in writes both columns, so one
    // source is active per account whichever portal was used last.
    const { error: profileError } = await admin.from("profiles").upsert(
      {
        user_id: user.id,
        display_name: person.name,
        email: person.email,
        hub_user_id: person.hubUserId,
        hub_company_name: person.source === "hub" ? person.company || null : null,
        allowed_company_slugs: person.source === "gos" ? person.slugs ?? [] : null,
      },
      { onConflict: "user_id" },
    );
    if (profileError) {
      console.error("Profile upsert error:", profileError);
      return { ok: false, error: "provision_failed" };
    }

    const role = await roleToWrite(admin, user.id, person.toolRole);
    const { error: roleError } = await admin.rpc("set_user_role", { p_user_id: user.id, p_role: role });
    if (roleError) {
      console.error("Role write error:", roleError);
      return { ok: false, error: "provision_failed" };
    }

    // The mapping is written to match the portal exactly: stale rows from an
    // earlier stint or portal go, wanted rows are kept, in one transaction.
    const clientIds =
      person.source === "hub" && role === "client" && person.company
        ? await clientsForCompany(admin, person.company)
        : [];
    const { error: accessError } = await admin.rpc("set_client_access", { p_user_id: user.id, p_client_ids: clientIds });
    if (accessError) {
      console.error("Client access write error:", accessError);
      return { ok: false, error: "provision_failed" };
    }
    const mappedClients = clientIds.length;

    // The page already holds a session for this same person: everything above
    // has been reconciled with the portal, and no new session is needed.
    if (deps.presentedAccessToken) {
      const { data: presented } = await admin.auth.getUser(deps.presentedAccessToken);
      if (presented?.user?.id === user.id) {
        return { ok: true, access_token: null, refresh_token: null, user_id: user.id, mapped_clients: mappedClients, role };
      }
    }

    // The auth server keeps one magic link token per user, so a second
    // sign-in at the same moment (another tab, another portal) can replace
    // this one's token before it is verified. A fresh link settles it.
    let verified: { session?: { access_token: string; refresh_token: string } | null } | null = null;
    for (let attempt = 1; attempt <= LINK_ATTEMPTS; attempt++) {
      const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email: person.email });
      const tokenHash = link?.properties?.hashed_token;
      if (linkError || !tokenHash) {
        console.error("Generate link error:", linkError);
        return { ok: false, error: "session_failed" };
      }
      const { data, error: verifyError } = await deps.mint.auth.verifyOtp({ type: "magiclink", token_hash: tokenHash });
      if (!verifyError && data?.session) {
        verified = data;
        break;
      }
      console.error(`Verify link error (attempt ${attempt}):`, verifyError);
    }
    if (!verified?.session) return { ok: false, error: "session_failed" };
    return {
      ok: true,
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
      user_id: user.id,
      mapped_clients: mappedClients,
      role,
    };
  } catch (err) {
    console.error("Provision error:", err);
    return { ok: false, error: "provision_failed" };
  }
}

/**
 * The portal no longer grants this person the tool (deactivated, or the tool
 * was removed). Their role and client mapping go, so a stored session cannot
 * resume with the old access, and the session the page presented is ended
 * when it is theirs.
 * A person with no account here has nothing to revoke. Never throws.
 */
export async function revokeAccess(admin: Admin, email: string, presentedAccessToken?: string | null): Promise<void> {
  try {
    const user = (await findAuthUserByEmail(admin, email.toLowerCase())) as { id: string } | null;
    if (user) {
      const { error: roleError } = await admin.rpc("set_user_role", { p_user_id: user.id, p_role: null });
      if (roleError) console.error("Role removal error:", roleError);
      const { error: clearError } = await admin.rpc("set_client_access", { p_user_id: user.id, p_client_ids: [] });
      if (clearError) console.error("Client access removal error:", clearError);
      // QA 22 Nov 2026 (P24-01): is_client_member also matches on the
      // profile's company and slug allowlist, so they go too; a session that
      // was not presented here (another browser, a stored refresh token) is
      // left with nothing to match on. The next portal sign-in writes them again.
      const { error: profileError } = await admin.from("profiles").update({ hub_company_name: null, allowed_company_slugs: null }).eq("user_id", user.id);
      if (profileError) console.error("Profile company removal error:", profileError);
    }
    // Only the refused person's own session ends. A browser can hold someone
    // else's session next to this person's portal token, and that one stays.
    if (user && presentedAccessToken) {
      const { data: presented } = await admin.auth.getUser(presentedAccessToken);
      if (presented?.user?.id === user.id) {
        const { error } = await admin.auth.admin.signOut(presentedAccessToken, "global");
        if (error) console.error("Sign-out error:", error);
      }
    }
  } catch (err) {
    console.error("Revoke error:", err);
  }
}
