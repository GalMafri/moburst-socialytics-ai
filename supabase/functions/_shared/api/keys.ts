/**
 * API keys: generation, hashing, header parsing and the client scope a key
 * resolves to. The plaintext key exists only in the creation response; the
 * table holds its SHA-256, and requests are matched by that hash.
 */
import type { ClientScope, Scope } from "./router.ts";

export interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  company_slugs: string[] | null;
  client_ids: string[] | null;
  rate_limit_per_minute: number;
  expires_at: string | null;
  revoked_at: string | null;
  minute_count?: number;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function cryptoRandom(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function generateKey(prefix: "adv" | "soc", random: (n: number) => Uint8Array = cryptoRandom): { key: string; key_prefix: string } {
  const key = `${prefix}_${b64url(random(32))}`;
  return { key, key_prefix: key.slice(0, 12) };
}

export async function hashKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bearerFrom(headers: Headers): string | null {
  const auth = headers.get("Authorization") ?? "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (m) return m[1];
  const x = headers.get("X-Api-Key");
  return x && x.trim() ? x.trim() : null;
}

export function keyIsLive(row: Pick<KeyRow, "revoked_at" | "expires_at">, now: Date): boolean {
  if (row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) return false;
  return true;
}

export function hasScope(row: Pick<KeyRow, "scopes">, scope: Scope): boolean {
  return (row.scopes ?? []).includes(scope);
}

export function scopeAll(): ClientScope {
  return { all: true, ids: new Set(), allows: () => true };
}

export function scopeOf(ids: Iterable<string>): ClientScope {
  const set = new Set(ids);
  return { all: false, ids: set, allows: (id) => !!id && set.has(id) };
}

/**
 * Demo jobs never touch a production client: they create their own copy of a
 * brand, whose company slug carries this prefix. A key scoped to a company
 * therefore reaches that company's demo copy as well.
 */
export const DEMO_SLUG_PREFIX = "demo-";
export const demoSlug = (slug: string): string => `${DEMO_SLUG_PREFIX}${slug}`;
export const isDemoSlug = (slug: string | null | undefined): boolean => !!slug && slug.startsWith(DEMO_SLUG_PREFIX);
const baseSlug = (slug: string): string => (isDemoSlug(slug) ? slug.slice(DEMO_SLUG_PREFIX.length) : slug);

/** Explicit client ids win; otherwise company slugs (a company covers its demo copy); a null slug never matches; no scope at all means every client. */
export function resolveScope(row: Pick<KeyRow, "company_slugs" | "client_ids">, clients: Array<{ id: string; company_slug: string | null }>): ClientScope {
  if (row.client_ids && row.client_ids.length) return scopeOf(row.client_ids);
  if (row.company_slugs && row.company_slugs.length) {
    const slugs = new Set(row.company_slugs);
    return scopeOf(clients.filter((c) => c.company_slug && (slugs.has(c.company_slug) || slugs.has(baseSlug(c.company_slug)))).map((c) => c.id));
  }
  return scopeAll();
}
