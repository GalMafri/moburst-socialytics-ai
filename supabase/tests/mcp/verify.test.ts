// @vitest-environment node
// The connector verifies a bearer token itself, as Supabase's JWT signing
// keys guide shows: jose against the project's JWKS, ES256 only, issuer the
// project's Auth URL, audience "authenticated". A token it cannot trust is
// refused (null); a key set it cannot reach is the server's fault (thrown).
import { describe, expect, it } from "vitest";
import { createLocalJWKSet } from "npm:jose@6.2.12";
import { issuerOf, jwksUrlOf, tokenVerifier } from "../../functions/mcp/verify";

const PROJECT = "https://rwouwxqggjjacbpbhqsn.supabase.co";
const ISSUER = `${PROJECT}/auth/v1`;
const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === "string" ? b : new Uint8Array(b)).toString("base64url");
const enc = (s: string) => new TextEncoder().encode(s);

async function es256() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
  return { pair, jwk: { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "es-key", alg: "ES256", use: "sig" } };
}
const now = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({ sub: "u1", role: "authenticated", aud: "authenticated", iss: ISSUER, iat: now(), exp: now() + 3600, client_id: "oc-1", ...over });
async function signEs(key: CryptoKey, body: Record<string, unknown>, kid = "es-key") {
  const input = `${b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid }))}.${b64u(JSON.stringify(body))}`;
  return `${input}.${b64u(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc(input)))}`;
}

describe("tokenVerifier", () => {
  it("names the project's issuer and key set", () => {
    expect(issuerOf(PROJECT)).toBe("https://rwouwxqggjjacbpbhqsn.supabase.co/auth/v1");
    expect(issuerOf(`${PROJECT}/`)).toBe(ISSUER);
    expect(jwksUrlOf(PROJECT).href).toBe("https://rwouwxqggjjacbpbhqsn.supabase.co/auth/v1/.well-known/jwks.json");
  });

  it("passes a valid ES256 token from the project's key and returns its claims", async () => {
    const { pair, jwk } = await es256();
    const verify = tokenVerifier({ issuer: ISSUER, keys: createLocalJWKSet({ keys: [jwk] }) });
    expect(await verify(await signEs(pair.privateKey, claims()))).toMatchObject({ sub: "u1", client_id: "oc-1", aud: "authenticated" });
    // client_id is the gate's to check (access.ts): a valid app session token verifies here.
    const { client_id: _c, ...app } = claims();
    expect(await verify(await signEs(pair.privateKey, app))).toMatchObject({ sub: "u1" });
  });

  it("refuses a wrong issuer, a wrong audience, an expired token, another key and anything malformed", async () => {
    const { pair, jwk } = await es256();
    const other = await es256();
    const verify = tokenVerifier({ issuer: ISSUER, keys: createLocalJWKSet({ keys: [jwk] }) });
    for (const [what, body] of [
      ["wrong issuer", claims({ iss: "https://otherproject.supabase.co/auth/v1" })],
      ["no issuer", claims({ iss: undefined })],
      ["wrong audience", claims({ aud: "anon" })],
      ["expired", claims({ iat: now() - 7200, exp: now() - 3600 })],
    ] as const) expect(await verify(await signEs(pair.privateKey, body)), what).toBeNull();
    expect(await verify(await signEs(other.pair.privateKey, claims())), "another key").toBeNull();
    expect(await verify(await signEs(pair.privateKey, claims(), "unknown-kid")), "unknown kid").toBeNull();
    for (const raw of ["", "abc", "abc.def.ghi"]) expect(await verify(raw), raw).toBeNull();
  });

  it("refuses HS256 and any algorithm but ES256, even with a matching key", async () => {
    const { jwk } = await es256();
    const hmac = await crypto.subtle.importKey("raw", enc("legacy-jwt-secret"), { name: "HMAC", hash: "SHA-256" }, true, ["sign"]);
    const hsInput = `${b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64u(JSON.stringify(claims()))}`;
    const hs256 = `${hsInput}.${b64u(await crypto.subtle.sign("HMAC", hmac, enc(hsInput)))}`;
    const rsa = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const rsJwk = { ...(await crypto.subtle.exportKey("jwk", rsa.publicKey)), kid: "rs-key", alg: "RS256", use: "sig" };
    const rsInput = `${b64u(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "rs-key" }))}.${b64u(JSON.stringify(claims()))}`;
    const rs256 = `${rsInput}.${b64u(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", rsa.privateKey, enc(rsInput)))}`;
    const verify = tokenVerifier({ issuer: ISSUER, keys: createLocalJWKSet({ keys: [jwk, rsJwk] }) });
    expect(await verify(hs256), "HS256").toBeNull();
    expect(await verify(rs256), "RS256").toBeNull();
  });

  it("throws when the key set cannot be read, so a JWKS outage never reads as a bad sign-in", async () => {
    const { pair } = await es256();
    const verify = tokenVerifier({ issuer: ISSUER, keys: async () => { throw new TypeError("fetch failed"); } });
    await expect(verify(await signEs(pair.privateKey, claims()))).rejects.toThrow("fetch failed");
  });
});
