/**
 * Who may use the connector, and which clients they reach. The token was
 * verified against the project's JWKS before this runs (verify.ts); this
 * is the connector's own gate on its claims and on two reads made through
 * the person's own client, so RLS answers both:
 *   * the token must carry client_id, meaning it came through Supabase's
 *     OAuth server; an app session token is refused;
 *   * the person must hold a Socialytics role in user_roles, read at every
 *     call, so removing a role cuts access at the next one;
 *   * client users are refused: the API and the connector are for Moburst
 *     staff only;
 *   * the client scope is the set of ids the person can select from clients:
 *     admins see all clients, Moburst users every non-demo client.
 */
import type { ClientScope } from "../_shared/api/router.ts";
import { scopeOf } from "../_shared/api/keys.ts";

export type Role = "admin" | "moburst_user" | "client";

export interface Person {
  userId: string;
  email: string | null;
  oauthClientId: string;
  role: Role;
  /** Where an API key's reach would be. */
  scope: ClientScope;
}

/** The two reads the gate makes, through the person's own client. */
export interface AccessReads {
  roles(userId: string): Promise<string[]>;
  clientIds(): Promise<string[]>;
}

export type Admission = { ok: true; person: Person } | { ok: false; status: 401 | 403; message: string };

export const RANK: Role[] = ["admin", "moburst_user", "client"];
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export async function admit(claims: Record<string, unknown> | null, reads: AccessReads): Promise<Admission> {
  const userId = str(claims?.sub);
  const oauthClientId = str(claims?.client_id);
  if (!userId || !oauthClientId) return { ok: false, status: 401, message: "Connect Socialytics from Claude to use this connector." };
  const held = await reads.roles(userId);
  const role = RANK.find((r) => held.includes(r));
  if (!role) return { ok: false, status: 403, message: "This account has no access to Socialytics." };
  if (role === "client") return { ok: false, status: 403, message: "The Socialytics connector is for Moburst staff only." };
  return { ok: true, person: { userId, email: str(claims?.email), oauthClientId, role, scope: scopeOf(await reads.clientIds()) } };
}
