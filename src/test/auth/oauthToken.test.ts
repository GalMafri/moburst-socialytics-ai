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
    for (const path of ["_shared/auth/requireStaff.ts", "_shared/auth/requireMember.ts", "post-preview/index.ts"]) {
      const src = fn(path);
      expect(src, path).toContain("oauthClientOf(");
      expect(src.indexOf("oauthClientOf("), path).toBeLessThan(src.indexOf("auth.getUser("));
    }
  });
});
