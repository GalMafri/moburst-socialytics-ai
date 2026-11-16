// The decision for one request, apart from the server so a test can call it
// with fakes. It returns the JSON body; index.ts wraps it in the 200 envelope.
// Nothing here imports from https: or npm:, so the tests run it as it is.

import { portalStatusCode, provisionAndSignIn, revokeAccess } from "../_shared/auth/session.ts";
import { resolveToolRole, type HubUser } from "./role.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface HubSignInDeps {
  /** The Hub's /api/auth/me for this token. */
  fetchHub: (hubToken: string) => Promise<Response>;
  /** The service-role client. */
  admin: Admin;
  /** A fresh client used only to verify the magic link. */
  mint: Admin;
  toolName: string;
  origin: string;
}

export async function handleHubSignIn(
  deps: HubSignInDeps,
  body: { hubToken?: string; devEmail?: string; accessToken?: string },
): Promise<Record<string, unknown>> {
  const { admin, mint, toolName, origin } = deps;
  const { hubToken, devEmail, accessToken } = body;
  const presented = typeof accessToken === "string" && accessToken ? accessToken : null;

  // A Hub token is the only credential this function accepts. Anything else,
  // devEmail included, is refused before a session can be minted.
  if (devEmail) {
    console.log(`[bridge] Refused a devEmail sign-in from origin="${origin}"`);
    return { error: "refused", debug: { origin, tool_name: toolName } };
  }

  // ── Production path (Hub JWT) ──────────────────────────────────────────────
  if (!hubToken) return { error: "missing_token", debug: { origin, tool_name: toolName } };

  // A Hub that does not answer is not a Hub that refused the person: only a
  // 401 or 403 is invalid_token. The page keeps a stored session through the
  // other outcome.
  let hubRes: Response;
  try {
    hubRes = await deps.fetchHub(hubToken);
  } catch (err) {
    console.error("Hub request error:", err);
    return { error: "portal_unreachable", debug: { origin, tool_name: toolName } };
  }
  if (!hubRes.ok) {
    return { error: portalStatusCode(hubRes.status), debug: { origin, tool_name: toolName, hub_status: hubRes.status } };
  }

  let hubUser: HubUser;
  try {
    hubUser = (await hubRes.json()) as HubUser;
  } catch (err) {
    console.error("Hub answer was not readable:", err);
    return { error: "portal_unreachable", debug: { origin, tool_name: toolName } };
  }
  if (!hubUser?.email) {
    return { error: "no_email", debug: { origin, tool_name: toolName } };
  }
  if (hubUser.isActive === false) {
    await revokeAccess(admin, hubUser.email, presented);
    return { error: "deactivated", debug: { origin, tool_name: toolName } };
  }

  const resolution = resolveToolRole(hubUser, toolName);
  const debug = {
    origin,
    tool_name: toolName,
    hub_email: hubUser.email,
    hub_company: hubUser.company,
    hub_global_role: hubUser.role,
    resolved_role: resolution.role,
    resolution_source: resolution.source,
    tool_entry_name: resolution.tool_entry_name,
    tool_entry_role: resolution.tool_entry_role,
    tool_names_from_hub: resolution.tool_names_from_hub,
  };

  if (!resolution.role) {
    await revokeAccess(admin, hubUser.email, presented);
    return { error: "no_access", debug };
  }

  const result = await provisionAndSignIn(admin, {
    email: hubUser.email,
    name: hubUser.name,
    hubUserId: hubUser._id,
    toolRole: resolution.role,
    source: "hub",
    company: hubUser.company,
  }, { mint, presentedAccessToken: presented });
  if (!result.ok) return { error: result.error, debug };

  return {
    ...(result.access_token && result.refresh_token
      ? { access_token: result.access_token, refresh_token: result.refresh_token }
      : {}),
    tool_role: resolution.role,
    user_id: result.user_id,
    debug: { ...debug, mapped_clients: result.mapped_clients },
  };
}
