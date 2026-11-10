/**
 * A person's own API keys: make one, list them, revoke one, from their
 * signed-in Socialytics session. Only Moburst staff (an admin or a Moburst
 * user) have them. A personal key is read only at 120 calls a minute and
 * lasts 90 days. Its row stores no client scope: api_key_touch works out what
 * it reaches from the owner's roles on every call.
 *
 * To the core these routes are auth "none", because the core checks API keys
 * and admin sessions only; each handler checks the person's session itself,
 * through the staff check in sessions.ts. The core's route context carries no
 * headers, so each request's own bearer comes in through sessionToken (see
 * socialyticsHandler in openapi.ts).
 */
import { ApiError, forbidden, invalid, notFound, unauthorized } from "../_shared/api/errors.ts";
import { generateKey, hashKey } from "../_shared/api/keys.ts";
import type { Route } from "../_shared/api/router.ts";
import type { KeyStore, StoredKey } from "./routes-admin.ts";
import type { StaffSession } from "./sessions.ts";

const LIFETIME_DAYS = 90;
const LIVE_LIMIT = 10;
const NAME_MAX = 80;
const DAY_MS = 86_400_000;

const SIGN_IN = "Sign in to Socialytics to manage your API keys.";
const STAFF_ONLY = "Personal API keys are for Moburst staff.";
const AT_LIMIT = `You have ${LIVE_LIMIT} active keys. Revoke one to make another.`;
const NAME_RULE = `Give the key a name of 1 to ${NAME_MAX} characters.`;
const NO_CONTROL = "A key name can't have line breaks or tabs.";
const VISIBLE = "Give the key a name with at least one visible character.";

// Control characters (Cc: line breaks, tabs, NUL, DEL and the C1 range) are refused anywhere in a name, ends included.
const CONTROL = /\p{Cc}/u;
// A name must show something: whitespace and default-ignorable characters (zero-width spaces and joiners, word joiner,
// byte order mark, Hangul fillers, variation selectors) show nothing on their own. They stay allowed beside visible ones,
// so a joined emoji keeps its joiner.
const VISIBLE_CHAR = /[^\p{White_Space}\p{Default_Ignorable_Code_Point}\p{Cc}]/u;

/** The key's name as stored: trimmed, 1 to 80 code points, no control character, at least one visible character. */
function keyName(raw: unknown): string {
  if (typeof raw !== "string") throw invalid(NAME_RULE, { field: "name" });
  if (CONTROL.test(raw)) throw invalid(NO_CONTROL, { field: "name" });
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > NAME_MAX) throw invalid(NAME_RULE, { field: "name" });
  if (!VISIBLE_CHAR.test(name)) throw invalid(VISIBLE, { field: "name" });
  return name;
}

export interface MeDeps {
  keys: KeyStore;
  /** The staff check from sessions.ts. Null when the token is not a person's app session (401); staff false when the person holds no staff role (403). */
  verifyStaffSession(token: string): Promise<StaffSession | null>;
  /** This request's bearer token, or null when it has none. */
  sessionToken(): string | null;
  now(): Date;
}

/** What a person sees of their own key: never the hash, the owner or the reach. */
const personalKey = (k: StoredKey) => ({
  id: k.id, name: k.name, key_prefix: k.key_prefix, scopes: k.scopes, created_at: k.created_at, expires_at: k.expires_at, last_used_at: k.last_used_at, revoked_at: k.revoked_at,
});

export function meRoutes(deps: MeDeps): Route[] {
  const staffUserId = async (): Promise<string> => {
    const token = deps.sessionToken();
    if (!token) throw unauthorized(SIGN_IN);
    const session = await deps.verifyStaffSession(token);
    if (!session) throw unauthorized(SIGN_IN);
    if (!session.staff) throw forbidden(STAFF_ONLY);
    return session.userId;
  };

  return [
    {
      method: "GET", path: "/v1/me/keys", auth: "none", doc: { summary: "List your personal API keys (needs your signed-in Socialytics session)", tag: "Personal keys", response: "PersonalKeyList" },
      handler: async () => {
        const userId = await staffUserId();
        return { status: 200, body: { data: (await deps.keys.listByOwner(userId)).map(personalKey), next_cursor: null } };
      },
    },
    {
      method: "POST", path: "/v1/me/keys", auth: "none", doc: { summary: "Make a personal API key, read only for 90 days (the key is returned once; needs your signed-in Socialytics session)", tag: "Personal keys", body: "PersonalKeyCreate", response: "PersonalKeyCreated", status: 201 },
      handler: async (ctx) => {
        const userId = await staffUserId();
        const b = (ctx.body && typeof ctx.body === "object" ? ctx.body : {}) as Record<string, unknown>;
        const name = keyName(b.name);
        const now = deps.now();
        // Counted here, not locked: two makes at the same moment could reach 11, still bounded by revoking and expiry.
        if ((await deps.keys.countLive(userId, now)) >= LIVE_LIMIT) throw new ApiError(409, "conflict", AT_LIMIT);
        const { key, key_prefix } = generateKey("soc");
        const row = await deps.keys.insert({
          name, key_prefix, key_hash: await hashKey(key), scopes: ["read"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120,
          created_by: userId, owner_user_id: userId, expires_at: new Date(now.getTime() + LIFETIME_DAYS * DAY_MS).toISOString(), note: null,
        });
        return { status: 201, body: { data: { ...personalKey(row), key } } };
      },
    },
    {
      method: "DELETE", path: "/v1/me/keys/:id", auth: "none", doc: { summary: "Revoke one of your personal API keys (needs your signed-in Socialytics session)", tag: "Personal keys", response: "PersonalKeyRevoked" },
      handler: async (ctx) => {
        const userId = await staffUserId();
        // Another person's key answers exactly as a missing one.
        const revoked = await deps.keys.revokeOwned(ctx.params.id, userId);
        if (!revoked) throw notFound("API key");
        return { status: 200, body: { data: revoked } };
      },
    },
  ];
}
