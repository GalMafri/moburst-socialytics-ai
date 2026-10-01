import { describe, it, expect } from "vitest";
import { bearerFrom, generateKey, hashKey, hasScope, keyIsLive, resolveScope, scopeAll, scopeOf, type KeyRow } from "./keys";

const row = (over: Partial<KeyRow> = {}): KeyRow => ({
  id: "k1", name: "gOS", key_prefix: "adv_abcdefgh", scopes: ["read"], company_slugs: null, client_ids: null,
  rate_limit_per_minute: 120, expires_at: null, revoked_at: null, ...over,
});

describe("generateKey", () => {
  it("makes a prefixed key with 43 base64url characters and a 12-character display prefix", () => {
    const k = generateKey("adv");
    expect(k.key).toMatch(/^adv_[A-Za-z0-9_-]{43}$/);
    expect(k.key_prefix).toBe(k.key.slice(0, 12));
    expect(generateKey("adv").key).not.toBe(k.key);
    expect(generateKey("soc").key.startsWith("soc_")).toBe(true);
  });
});

describe("hashKey", () => {
  it("is SHA-256 hex", async () => {
    expect(await hashKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("bearerFrom", () => {
  it("reads the bearer or the X-Api-Key header and nothing else", () => {
    expect(bearerFrom(new Headers({ Authorization: "Bearer adv_x" }))).toBe("adv_x");
    expect(bearerFrom(new Headers({ "X-Api-Key": "adv_y" }))).toBe("adv_y");
    expect(bearerFrom(new Headers({ Authorization: "Basic zzz" }))).toBeNull();
    expect(bearerFrom(new Headers())).toBeNull();
  });
});

describe("keyIsLive and hasScope", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  it("refuses revoked and expired keys", () => {
    expect(keyIsLive(row(), now)).toBe(true);
    expect(keyIsLive(row({ revoked_at: "2026-09-29T00:00:00Z" }), now)).toBe(false);
    expect(keyIsLive(row({ expires_at: "2026-09-29T00:00:00Z" }), now)).toBe(false);
    expect(keyIsLive(row({ expires_at: "2026-10-29T00:00:00Z" }), now)).toBe(true);
  });
  it("checks scopes", () => {
    expect(hasScope(row(), "read")).toBe(true);
    expect(hasScope(row(), "demo")).toBe(false);
  });
});

describe("resolveScope", () => {
  const clients = [
    { id: "c-bader", company_slug: "bader-law" },
    { id: "c-nano", company_slug: null },
    { id: "c-tilt", company_slug: "tilt-app" },
  ];
  it("limits a company-scoped key to the clients with those slugs; a null slug never matches", () => {
    const s = resolveScope(row({ company_slugs: ["bader-law"] }), clients);
    expect(s.all).toBe(false);
    expect(s.allows("c-bader")).toBe(true);
    expect(s.allows("c-nano")).toBe(false);
    expect(s.allows("c-tilt")).toBe(false);
    expect(s.allows(undefined)).toBe(false);
  });
  it("prefers explicit client ids over slugs", () => {
    const s = resolveScope(row({ company_slugs: ["bader-law"], client_ids: ["c-nano"] }), clients);
    expect(s.allows("c-nano")).toBe(true);
    expect(s.allows("c-bader")).toBe(false);
  });
  it("allows everything when the key has no scope", () => {
    const s = resolveScope(row(), clients);
    expect(s.all).toBe(true);
    expect(s.allows("anything")).toBe(true);
    expect(s.allows(undefined)).toBe(true);
  });
  it("has helpers for the two ends", () => {
    expect(scopeAll().allows("x")).toBe(true);
    expect(scopeOf(["a"]).allows("b")).toBe(false);
  });
});
