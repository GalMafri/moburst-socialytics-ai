/**
 * A person's own API keys: make one, list them, revoke one, from their
 * signed-in Socialytics session (the API page's Tokens tab). Only Moburst
 * staff (an admin or a Moburst user) have them. A personal key is read only
 * ({read}) or read and write ({read,run}, which starts work through the
 * public actions, acting as its owner), at 120 calls a minute, and lasts at
 * most 90 days (90 unless the person picks an earlier end). It may name the
 * companies it is for; api_key_touch works out what it reaches from the
 * owner's roles on every call and narrows that to those companies' clients
 * (migration 20261123160000).
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
const ACCESS_RULE = "Choose read only or read and write for the key.";
const COMPANY_RULE = "Choose companies from the list, or all companies.";
const UNKNOWN_COMPANY = "One of the companies chosen is not in Socialytics. Choose from the list.";
const EXPIRY_RULE = `Choose an end date in the next ${LIFETIME_DAYS} days.`;
const COMPANIES_MAX = 50;
const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** The access a person chose: read only, or read and write. */
function accessOf(raw: unknown): string[] {
  if (raw == null) return ["read"];
  if (!Array.isArray(raw) || raw.some((s) => typeof s !== "string")) throw invalid(ACCESS_RULE, { field: "scopes" });
  const set = new Set(raw as string[]);
  if (set.size === 1 && set.has("read")) return ["read"];
  if (set.size === 2 && set.has("read") && set.has("run")) return ["read", "run"];
  throw invalid(ACCESS_RULE, { field: "scopes" });
}

/** The companies a key is for, or null for all of them. */
function companiesOf(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw) || raw.length > COMPANIES_MAX || raw.some((s) => typeof s !== "string" || !SLUG.test(s.trim()))) throw invalid(COMPANY_RULE, { field: "company_slugs" });
  const slugs = [...new Set((raw as string[]).map((s) => s.trim()))].sort();
  return slugs.length ? slugs : null;
}

/** When a key ends: the date the person picked, at most 90 days ahead, or 90 days from now. */
function expiryOf(raw: unknown, now: Date): string {
  const latest = now.getTime() + LIFETIME_DAYS * DAY_MS;
  if (raw == null || raw === "") return new Date(latest).toISOString();
  const at = typeof raw === "string" ? Date.parse(raw) : NaN;
  if (Number.isNaN(at) || at <= now.getTime() || at > latest + 60_000) throw invalid(EXPIRY_RULE, { field: "expires_at" });
  return new Date(Math.min(at, latest)).toISOString();
}

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
  /** Every company slug in Socialytics, to refuse a key for a company that does not exist; without it any well-formed slug is taken (the key then reaches nothing there). */
  companySlugs?(): Promise<string[]>;
}

/** What a person sees of their own key: never the hash, the owner or the reach. */
const personalKey = (k: StoredKey) => ({
  id: k.id, name: k.name, key_prefix: k.key_prefix, scopes: k.scopes, company_slugs: k.company_slugs?.length ? k.company_slugs : null, created_at: k.created_at, expires_at: k.expires_at, last_used_at: k.last_used_at, revoked_at: k.revoked_at,
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
      method: "POST", path: "/v1/me/keys", auth: "none", doc: { summary: "Make a personal API key, read only or read and write, for all your companies or some, for up to 90 days (the key is returned once; needs your signed-in Socialytics session)", tag: "Personal keys", body: "PersonalKeyCreate", response: "PersonalKeyCreated", status: 201 },
      handler: async (ctx) => {
        const userId = await staffUserId();
        const b = (ctx.body && typeof ctx.body === "object" ? ctx.body : {}) as Record<string, unknown>;
        const name = keyName(b.name);
        const scopes = accessOf(b.scopes);
        const companies = companiesOf(b.company_slugs);
        const now = deps.now();
        const expires = expiryOf(b.expires_at, now);
        if (companies && deps.companySlugs) {
          const known = new Set(await deps.companySlugs());
          if (companies.some((c) => !known.has(c))) throw invalid(UNKNOWN_COMPANY, { field: "company_slugs" });
        }
        // Counted here, not locked: two makes at the same moment could reach 11, still bounded by revoking and expiry.
        if ((await deps.keys.countLive(userId, now)) >= LIVE_LIMIT) throw new ApiError(409, "conflict", AT_LIMIT);
        const { key, key_prefix } = generateKey("soc");
        const row = await deps.keys.insert({
          name, key_prefix, key_hash: await hashKey(key), scopes, company_slugs: companies, client_ids: null, rate_limit_per_minute: 120,
          created_by: userId, owner_user_id: userId, expires_at: expires, note: null,
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
