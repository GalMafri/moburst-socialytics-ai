// @vitest-environment node
// A token Supabase's OAuth server issued (to the Claude connector) carries a
// client_id claim. It is valid wherever an app session is, so the guards that
// let a session act refuse it: the connector reads, it never changes anything.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { oauthClientOf } from "../../../supabase/functions/_shared/auth/authz";

const b64u = (s: string) => Buffer.from(s).toString("base64url");
const token = (claims: Record<string, unknown>) => `${b64u(JSON.stringify({ alg: "ES256", typ: "JWT", kid: "k" }))}.${b64u(JSON.stringify(claims))}.c2ln`;
const functions = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "supabase", "functions");
const fn = (path: string) => readFileSync(join(functions, path), "utf8");

describe("oauthClientOf", () => {
  it("names the OAuth client of a token Supabase's OAuth server issued", () => {
    expect(oauthClientOf(token({ sub: "u1", role: "authenticated", client_id: "9b1f0c4e-3f8a-4c55-9d7e-2a6b1c0d4e5f" }))).toBe("9b1f0c4e-3f8a-4c55-9d7e-2a6b1c0d4e5f");
  });

  it("is null for an app session, the service role and anything that is not a token", () => {
    expect(oauthClientOf(token({ sub: "u1", role: "authenticated", session_id: "s" }))).toBeNull();
    expect(oauthClientOf(token({ role: "service_role" }))).toBeNull();
    expect(oauthClientOf(token({ sub: "u1", client_id: "" }))).toBeNull();
    expect(oauthClientOf(token({ sub: "u1", client_id: 42 }))).toBeNull();
    for (const raw of ["", "abc", "a.b", "a.%%%.c", `${b64u("{}")}.${b64u("not json")}.x`, `${b64u("{}")}.${b64u("[1]")}.x`]) expect(oauthClientOf(raw)).toBeNull();
  });
});

describe("the guards that let a session act", () => {
  it("refuse an OAuth token before anything else is checked", () => {
    // Each guard with the call that first looks the token up. api/sessions.ts holds the api function's two session checks:
    // the admin session that may manage every API key, and the staff session that manages a person's own keys.
    const guards: Array<[path: string, lookup: string]> = [
      ["_shared/auth/requireStaff.ts", "auth.getUser("], ["_shared/auth/requireMember.ts", "auth.getUser("], ["post-preview/index.ts", "auth.getUser("],
      ["api/sessions.ts", "lookups.userOf("], ["api/sessions.ts", "lookups.rolesOf("],
    ];
    for (const [path, lookup] of guards) {
      const src = fn(path);
      expect(src, path).toContain("oauthClientOf(");
      expect(src, `${path} ${lookup}`).toContain(lookup);
      expect(src.indexOf("oauthClientOf("), `${path} ${lookup}`).toBeLessThan(src.indexOf(lookup));
    }
  });

  it("look a session up in the api function only through the checks in api/sessions.ts", () => {
    // api/index.ts writes the lookups once, inside the object it hands to makeSessionChecks, so no other path in the
    // function can reach auth with a token that sessions.ts has not refused first.
    const src = fn("api/index.ts");
    expect(src.split("auth.getUser(")).toHaveLength(2);
    const call = src.indexOf("makeSessionChecks(");
    expect(call, "api/index.ts calls makeSessionChecks").toBeGreaterThanOrEqual(0);
    let depth = 0;
    let end = -1;
    for (let i = call + "makeSessionChecks".length; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")" && --depth === 0) { end = i; break; }
    }
    const lookup = src.indexOf("auth.getUser(");
    expect(lookup).toBeGreaterThan(call);
    expect(lookup).toBeLessThan(end);
    expect(src).toMatch(/verifyAdminJwt: sessions\.admin\b/);
    expect(src).toMatch(/verifyStaffSession: sessions\.staff\b/);
  });
});
