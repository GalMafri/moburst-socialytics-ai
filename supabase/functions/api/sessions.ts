/**
 * The api function's two session checks, over one pair of lookups that
 * index.ts writes against the database:
 *
 *   admin  the session that may manage every API key (/v1/admin/*): a person
 *          with the admin role. The core calls it as verifyAdminJwt.
 *   staff  the session that manages a person's own keys (/v1/me/*): any
 *          signed-in person, with staff true for an admin or a Moburst user.
 *          routes-me.ts calls it as verifyStaffSession.
 *
 * Both refuse the same tokens, in the same order, before any lookup: a token
 * from Supabase's OAuth server (the Claude connector) only reads and never
 * manages keys, and an API key is never a session. A roles lookup that fails
 * throws, which the core answers with a 500 rather than a wrong refusal.
 */
import { oauthClientOf } from "../_shared/auth/authz.ts";

export interface SessionLookups {
  /** The user a session token belongs to; null when auth does not know the token. */
  userOf(token: string): Promise<string | null>;
  /** That user's roles; throws when they cannot be read. */
  rolesOf(userId: string): Promise<string[]>;
}

/** A signed-in person, and whether they hold a staff role (admin or moburst_user). */
export interface StaffSession {
  userId: string;
  staff: boolean;
}

export interface SessionChecks {
  admin(token: string): Promise<{ userId: string } | null>;
  staff(token: string): Promise<StaffSession | null>;
}

const API_KEY = /^(adv|soc)_/;
const STAFF_ROLES = ["admin", "moburst_user"];

export function makeSessionChecks(lookups: SessionLookups): SessionChecks {
  const signedIn = async (token: string): Promise<{ userId: string; roles: string[] } | null> => {
    if (oauthClientOf(token) || API_KEY.test(token)) return null;
    const userId = await lookups.userOf(token);
    if (!userId) return null;
    return { userId, roles: await lookups.rolesOf(userId) };
  };
  return {
    async admin(token) {
      const session = await signedIn(token);
      return session && session.roles.includes("admin") ? { userId: session.userId } : null;
    },
    async staff(token) {
      const session = await signedIn(token);
      return session ? { userId: session.userId, staff: session.roles.some((r) => STAFF_ROLES.includes(r)) } : null;
    },
  };
}
