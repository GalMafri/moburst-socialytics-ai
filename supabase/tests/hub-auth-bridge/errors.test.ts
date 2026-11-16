// @vitest-environment node
// Every error the hub-auth-bridge answers with is one code from the fixed list
// (_shared/auth/session.ts), never a sentence, a role value or a database
// message (QA 12 Nov 2026, ACCESS-API-COPY-3). handleHubSignIn is called with
// fakes: the Hub's answer decides refusal, outage or access, and a person's
// access is removed before a refusal is answered (ACCESS-API-01, -02).
import { describe, expect, it, vi } from "vitest";
import { AUTH_ERROR_CODES } from "../../functions/_shared/auth/session.ts";
import { handleHubSignIn, type HubSignInDeps } from "../../functions/hub-auth-bridge/handler.ts";
import { errorValues } from "../_shared/auth/errorCodes.ts";
import { fakeAdmin } from "../_shared/auth/fakeAdmin.ts";

const ROTATED = { bridge_password: "random" };
const hubUser = (over: Record<string, unknown> = {}) => ({ _id: "h1", name: "O", email: "owner@example.com", role: "admin", company: "Acme", isActive: true, tools: [], ...over });
const reply = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status });

function setup(fetchHub: HubSignInDeps["fetchHub"], opts: Parameters<typeof fakeAdmin>[0] = { existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED }, tokens: { "tok-1": "u1" } }) {
  const fake = fakeAdmin(opts);
  const deps: HubSignInDeps = { fetchHub, admin: fake.admin, mint: fake.mint, toolName: "Socialytics", origin: "https://x.test" };
  return { ...fake, deps };
}

describe("hub-auth-bridge errors", () => {
  it("answers only with codes from the fixed list", () => {
    const values = errorValues("hub-auth-bridge");
    expect(values.length).toBeGreaterThan(3);
    for (const v of values) {
      if (v.kind === "literal") expect(AUTH_ERROR_CODES as readonly string[]).toContain(v.text.slice(1, -1));
      else expect(v.text).toMatch(/^(result\.error|portalStatusCode\(.*\))$/);
    }
  });
});

describe("handleHubSignIn", () => {
  it("a Hub 401 or 403 is invalid_token, and no access is changed", async () => {
    for (const status of [401, 403]) {
      const { deps, calls } = setup(reply(status));
      expect(await handleHubSignIn(deps, { hubToken: "t", accessToken: "tok-1" })).toMatchObject({ error: "invalid_token" });
      expect(calls.roles).toHaveLength(0);
      expect(calls.signOuts).toHaveLength(0);
    }
  });

  it("a Hub outage, a rate limit or a failed request is portal_unreachable, never a refusal, and changes no access", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fetchHub of [reply(502), reply(503), reply(429), async () => { throw new TypeError("fetch failed"); }]) {
      const { deps, calls } = setup(fetchHub);
      expect(await handleHubSignIn(deps, { hubToken: "t", accessToken: "tok-1" })).toMatchObject({ error: "portal_unreachable" });
      expect(calls.roles).toHaveLength(0);
      expect(calls.signOuts).toHaveLength(0);
    }
  });

  it("a deactivated person loses the role and the clients, and the presented session of theirs ends", async () => {
    const { deps, calls } = setup(reply(200, hubUser({ isActive: false })));
    expect(await handleHubSignIn(deps, { hubToken: "t", accessToken: "tok-1" })).toMatchObject({ error: "deactivated" });
    expect(calls.roles).toEqual([{ p_user_id: "u1", p_role: null }]);
    expect(calls.clientAccess).toEqual([{ p_user_id: "u1", p_client_ids: [] }]);
    expect(calls.signOuts).toEqual([{ jwt: "tok-1", scope: "global" }]);
  });

  it("a person whose tool was removed gets no_access with the same removal", async () => {
    const { deps, calls } = setup(reply(200, hubUser({ role: "user", tools: [] })));
    expect(await handleHubSignIn(deps, { hubToken: "t", accessToken: "tok-1" })).toMatchObject({ error: "no_access" });
    expect(calls.roles).toEqual([{ p_user_id: "u1", p_role: null }]);
    expect(calls.signOuts).toHaveLength(1);
  });

  it("a refusal never ends a session that belongs to someone else", async () => {
    const { deps, calls } = setup(reply(200, hubUser({ isActive: false })), { existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED }, tokens: { "tok-1": "u2" } });
    await handleHubSignIn(deps, { hubToken: "t", accessToken: "tok-1" });
    expect(calls.signOuts).toHaveLength(0);
  });

  it("an active person with the same person's session is answered ok and nothing is minted", async () => {
    const { deps, calls } = setup(reply(200, hubUser()));
    const out = await handleHubSignIn(deps, { hubToken: "t", accessToken: "tok-1" });
    expect(out).toMatchObject({ tool_role: "admin", user_id: "u1" });
    expect(out).not.toHaveProperty("access_token");
    expect(calls.links).toHaveLength(0);
  });

  it("an active person with no session gets one", async () => {
    const { deps } = setup(reply(200, hubUser()));
    expect(await handleHubSignIn(deps, { hubToken: "t" })).toMatchObject({ access_token: "a", refresh_token: "r" });
  });

  it("refuses a devEmail and a missing token without asking the Hub", async () => {
    const fetchHub = vi.fn();
    const { deps } = setup(fetchHub);
    expect(await handleHubSignIn(deps, { devEmail: "a@b.c" })).toMatchObject({ error: "refused" });
    expect(await handleHubSignIn(deps, {})).toMatchObject({ error: "missing_token" });
    expect(fetchHub).not.toHaveBeenCalled();
  });
});
