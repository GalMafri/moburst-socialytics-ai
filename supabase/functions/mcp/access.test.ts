import { describe, expect, it } from "vitest";
import { admit, type AccessReads } from "./access";

const PERSON = "00000000-0000-4000-8000-0000000000aa";
const OAUTH = { sub: PERSON, email: "sinead@moburst.com", role: "authenticated", aud: "authenticated", client_id: "9b1f0c4e-3f8a-4c55-9d7e-2a6b1c0d4e5f" };

function reads(roles: string[], ids: string[]): AccessReads & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    roles: async (userId) => { calls.push(`roles:${userId}`); return roles; },
    clientIds: async () => { calls.push("clients"); return ids; },
  };
}

describe("admit", () => {
  it("admits a person signed in through Claude with a Socialytics role, scoped to the clients they can see", async () => {
    const r = reads(["moburst_user"], ["c-bader", "c-calm"]);
    const out = await admit(OAUTH, r);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.person).toMatchObject({ userId: PERSON, email: "sinead@moburst.com", oauthClientId: OAUTH.client_id, role: "moburst_user" });
    expect(out.person.scope.all).toBe(false);
    expect([...out.person.scope.ids]).toEqual(["c-bader", "c-calm"]);
    expect(out.person.scope.allows("c-bader")).toBe(true);
    expect(out.person.scope.allows("c-demo")).toBe(false);
    expect(r.calls).toEqual([`roles:${PERSON}`, "clients"]);
  });

  it("takes the highest role a person holds, as the app does", async () => {
    for (const [roles, role] of [[["client", "admin"], "admin"], [["client", "moburst_user"], "moburst_user"], [["client"], "client"]] as const) {
      const out = await admit(OAUTH, reads([...roles], []));
      expect(out.ok && out.person.role).toBe(role);
    }
  });

  it("refuses an app session token: only a sign-in made through Claude carries client_id", async () => {
    const { client_id: _c, ...app } = OAUTH;
    const r = reads(["admin"], ["c-bader"]);
    expect(await admit(app, r)).toEqual({ ok: false, status: 401, message: "Connect Socialytics from Claude to use this connector." });
    expect(await admit({ ...app, client_id: "" }, r)).toMatchObject({ ok: false, status: 401 });
    expect(r.calls).toEqual([]);
  });

  it("refuses no claims and a token that names no person", async () => {
    expect(await admit(null, reads(["admin"], []))).toMatchObject({ ok: false, status: 401 });
    expect(await admit({ ...OAUTH, sub: undefined }, reads(["admin"], []))).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a person with no Socialytics role, read at every call, and never reads their clients", async () => {
    const r = reads([], ["c-bader"]);
    expect(await admit(OAUTH, r)).toEqual({ ok: false, status: 403, message: "This account has no access to Socialytics." });
    expect(r.calls).toEqual([`roles:${PERSON}`]);
    expect(await admit(OAUTH, reads(["viewer"], []))).toMatchObject({ ok: false, status: 403 });
  });
});
