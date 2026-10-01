/**
 * Key management: create (plaintext shown once), list, revoke. Reached by
 * an AdVisor admin's session from the Settings page, by the internal
 * secret, or by a key with the admin scope.
 */
import { invalid, notFound } from "../_shared/api/errors.ts";
import { generateKey, hashKey } from "../_shared/api/keys.ts";
import type { Route } from "../_shared/api/router.ts";

export interface StoredKey {
  id: string; name: string; key_prefix: string; key_hash: string; scopes: string[]; company_slugs: string[] | null; client_ids: string[] | null;
  rate_limit_per_minute: number; created_by: string | null; created_at: string; expires_at: string | null; last_used_at: string | null; revoked_at: string | null; note: string | null;
}

export interface KeyStore {
  insert(k: Omit<StoredKey, "id" | "created_at" | "last_used_at" | "revoked_at">): Promise<StoredKey>;
  list(): Promise<StoredKey[]>;
  revoke(id: string): Promise<boolean>;
}

const SCOPES = ["read", "demo", "admin"];
const publicKey = (k: StoredKey) => {
  const { key_hash: _h, ...rest } = k;
  return rest;
};

export function adminRoutes(deps: { keys: KeyStore; tool: "adv" | "soc" }): Route[] {
  return [
    {
      method: "POST", path: "/v1/admin/keys", auth: "admin", doc: { summary: "Create an API key (the key is returned once)", tag: "Admin", body: "ApiKeyCreate", response: "ApiKeyCreated", status: 201 },
      handler: async (ctx) => {
        const b = (ctx.body && typeof ctx.body === "object" ? ctx.body : {}) as Record<string, unknown>;
        const name = typeof b.name === "string" ? b.name.trim() : "";
        if (!name) throw invalid("name is required", { field: "name" });
        const scopes = Array.isArray(b.scopes) ? b.scopes.map(String) : [];
        if (!scopes.length || scopes.some((x) => !SCOPES.includes(x))) throw invalid("scopes must be a non-empty list of read, demo or admin", { field: "scopes" });
        const slugs = Array.isArray(b.company_slugs) ? b.company_slugs.map(String).map((x) => x.trim()).filter(Boolean) : [];
        const clientIds = Array.isArray(b.client_ids) ? b.client_ids.map(String).filter(Boolean) : [];
        const rate = b.rate_limit_per_minute == null ? 120 : Number(b.rate_limit_per_minute);
        if (!Number.isInteger(rate) || rate < 1 || rate > 10_000) throw invalid("rate_limit_per_minute must be a whole number between 1 and 10000", { field: "rate_limit_per_minute" });
        let expires: string | null = null;
        if (b.expires_at != null && b.expires_at !== "") {
          const d = new Date(String(b.expires_at));
          if (Number.isNaN(d.getTime())) throw invalid("expires_at must be an ISO date", { field: "expires_at" });
          expires = d.toISOString();
        }
        const { key, key_prefix } = generateKey(deps.tool);
        const row = await deps.keys.insert({
          name, key_prefix, key_hash: await hashKey(key), scopes: [...new Set(scopes)], company_slugs: slugs.length ? [...new Set(slugs)] : null, client_ids: clientIds.length ? [...new Set(clientIds)] : null,
          rate_limit_per_minute: rate, created_by: ctx.auth.userId ?? null, expires_at: expires, note: typeof b.note === "string" ? b.note.trim() || null : null,
        });
        return { status: 201, body: { data: { ...publicKey(row), key, warning: "Copy the key now; it is not shown again." } } };
      },
    },
    {
      method: "GET", path: "/v1/admin/keys", auth: "admin", doc: { summary: "List API keys", tag: "Admin", response: "ApiKeyList" },
      handler: async () => ({ status: 200, body: { data: (await deps.keys.list()).map(publicKey), next_cursor: null } }),
    },
    {
      method: "DELETE", path: "/v1/admin/keys/:id", auth: "admin", doc: { summary: "Revoke an API key", tag: "Admin", response: "Empty", status: 204 },
      handler: async (ctx) => {
        if (!(await deps.keys.revoke(ctx.params.id))) throw notFound("API key");
        return { status: 204, body: null };
      },
    },
  ];
}
