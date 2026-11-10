import { describe, it, expect } from "vitest";
import { makeSessionChecks } from "../../functions/api/sessions";

// App sessions: token to user, user to roles.
const USERS: Record<string, string> = { "jwt-admin": "u-admin", "jwt-lital": "u-lital", "jwt-both": "u-both", "jwt-client": "u-client", "jwt-norole": "u-norole", "jwt-broken": "u-broken" };
const ROLES: Record<string, string[]> = { "u-admin": ["admin"], "u-lital": ["moburst_user"], "u-both": ["client", "moburst_user"], "u-client": ["client"], "u-norole": [] };

// A token Supabase's OAuth server issued to the Claude connector for the admin. Auth would answer with the admin's user,
// so only its client_id claim may refuse it.
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const OAUTH = `${b64url({ alg: "ES256", typ: "JWT" })}.${b64url({ sub: "u-admin", role: "authenticated", client_id: "claude-connector" })}.c2ln`;
USERS[OAUTH] = "u-admin";
const KEYS = [`soc_${"A".repeat(43)}`, `adv_${"B".repeat(43)}`];

function checks() {
  const asked: string[] = [];
  const rolesAsked: string[] = [];
  const sessions = makeSessionChecks({
    userOf: async (token) => { asked.push(token); return USERS[token] ?? null; },
    rolesOf: async (userId) => {
      rolesAsked.push(userId);
      if (userId === "u-broken") throw new Error("user_roles is unavailable");
      return ROLES[userId] ?? [];
    },
  });
  return { sessions, asked, rolesAsked };
}

describe("makeSessionChecks", () => {
  for (const kind of ["admin", "staff"] as const) {
    it(`${kind}: refuses the connector's OAuth token and any API key before any lookup`, async () => {
      const { sessions, asked, rolesAsked } = checks();
      for (const token of [OAUTH, ...KEYS]) expect(await sessions[kind](token), token.slice(0, 8)).toBeNull();
      expect(asked).toEqual([]);
      expect(rolesAsked).toEqual([]);
    });

    it(`${kind}: refuses a token auth does not know, without reading roles`, async () => {
      const { sessions, asked, rolesAsked } = checks();
      expect(await sessions[kind]("jwt-unknown")).toBeNull();
      expect(asked).toEqual(["jwt-unknown"]);
      expect(rolesAsked).toEqual([]);
    });

    it(`${kind}: throws when the roles cannot be read, so the request answers 500 rather than a wrong refusal`, async () => {
      const { sessions } = checks();
      await expect(sessions[kind]("jwt-broken")).rejects.toThrow(/user_roles is unavailable/);
    });
  }

  it("admin: an admin only", async () => {
    const { sessions, rolesAsked } = checks();
    expect(await sessions.admin("jwt-admin")).toEqual({ userId: "u-admin" });
    expect(rolesAsked).toEqual(["u-admin"]);
    for (const token of ["jwt-lital", "jwt-both", "jwt-client", "jwt-norole"]) expect(await sessions.admin(token), token).toBeNull();
  });

  it("staff: an admin or a Moburst user is staff; any other signed-in person is a session without staff", async () => {
    const { sessions } = checks();
    expect(await sessions.staff("jwt-admin")).toEqual({ userId: "u-admin", staff: true });
    expect(await sessions.staff("jwt-lital")).toEqual({ userId: "u-lital", staff: true });
    expect(await sessions.staff("jwt-both")).toEqual({ userId: "u-both", staff: true });
    expect(await sessions.staff("jwt-client")).toEqual({ userId: "u-client", staff: false });
    expect(await sessions.staff("jwt-norole")).toEqual({ userId: "u-norole", staff: false });
  });
});
