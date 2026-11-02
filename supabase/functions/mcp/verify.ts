/**
 * The connector's own check of a bearer token, the way Supabase's JWT
 * signing keys guide shows it: jose verifies the signature against the
 * project's published key set (ES256 only; the project signs with one ES256
 * key), the issuer (the project's Auth URL) and the audience
 * ("authenticated"), and the expiry. Nothing here depends on the project's
 * API keys. Whether the token came through Supabase's OAuth server
 * (client_id) is the gate's check (access.ts).
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "npm:jose@6.2.12";

export type Claims = Record<string, unknown>;

export const issuerOf = (projectUrl: string): string => `${projectUrl.replace(/\/+$/, "")}/auth/v1`;
export const jwksUrlOf = (projectUrl: string): URL => new URL(`${issuerOf(projectUrl)}/.well-known/jwks.json`);

/** The project's key set, fetched and cached by jose (refetched when a token names a key it does not hold). */
export const projectKeys = (projectUrl: string): JWTVerifyGetKey => createRemoteJWKSet(jwksUrlOf(projectUrl));

/** jose's codes for a token that cannot be trusted, as opposed to a key set that could not be read. */
const UNTRUSTED = new Set([
  "ERR_JWT_EXPIRED", "ERR_JWT_CLAIM_VALIDATION_FAILED", "ERR_JWT_INVALID", "ERR_JWS_INVALID", "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JOSE_ALG_NOT_ALLOWED", "ERR_JOSE_NOT_SUPPORTED", "ERR_JWKS_NO_MATCHING_KEY", "ERR_JWKS_MULTIPLE_MATCHING_KEYS",
]);

/**
 * The claims of a token signed by the project for a signed-in person, or
 * null. Throws when the key set cannot be read, so an outage answers as the
 * server's failure and not as a bad sign-in.
 */
export function tokenVerifier(opts: { issuer: string; keys: JWTVerifyGetKey }): (token: string) => Promise<Claims | null> {
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, opts.keys, { issuer: opts.issuer, audience: "authenticated", algorithms: ["ES256"] });
      return payload as Claims;
    } catch (e) {
      const code = (e as { code?: unknown })?.code;
      if (typeof code === "string" && UNTRUSTED.has(code)) return null;
      throw e;
    }
  };
}
