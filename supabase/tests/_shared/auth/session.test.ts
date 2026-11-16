// @vitest-environment node
// How the portal bridges mint a session (_shared/auth/session.ts). A sign-in
// never changes an existing account's password, because a password change
// ended the person's other sessions: every sign-in in one tab or portal
// signed them out of the rest, the Claude connector included (QA 12 Nov
// 2026, ACCESS-API-01, LIVE-04, ACCESS-API-27).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { functionsDir } from "../../paths.ts";
import { BRIDGE_ERROR_CODES } from "../../../../src/lib/authMessages.ts";
import { AUTH_ERROR_CODES, portalStatusCode, provisionAndSignIn, randomPassword, revokeAccess, type PortalPerson } from "../../../functions/_shared/auth/session.ts";
import { fakeAdmin } from "./fakeAdmin.ts";

const person: PortalPerson = { email: "Owner@Example.com", name: "Owner", hubUserId: "h1", toolRole: "moburst_user", source: "hub", company: "Acme" };
const ROTATED = { bridge_password: "random" };

describe("provisionAndSignIn", () => {
  it("never sets a password on an account that already has a random one", async () => {
    const { admin, mint, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED } });
    const result = await provisionAndSignIn(admin, person, { mint });
    expect(result.ok).toBe(true);
    expect(calls.updateUser).toHaveLength(1);
    expect(calls.updateUser[0]).not.toHaveProperty("password");
  });

  it("replaces a derived password with a random one once, and marks the account", async () => {
    const { admin, mint, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@example.com", app_metadata: {} } });
    await provisionAndSignIn(admin, person, { mint });
    const attrs = calls.updateUser[0];
    expect(attrs.password).toMatch(/^[0-9a-f]{64}$/);
    expect(attrs.app_metadata).toEqual(ROTATED);
  });

  it("creates a new account with a random password, never one built from the email or the service key", async () => {
    const { admin, mint, calls } = fakeAdmin();
    await provisionAndSignIn(admin, person, { mint });
    const password = calls.createUser[0].password as string;
    expect(password).toMatch(/^[0-9a-f]{64}$/);
    expect(password.toLowerCase()).not.toContain("owner@example.com");
    expect(randomPassword()).not.toBe(randomPassword());
    expect(readFileSync(join(functionsDir, "_shared/auth/session.ts"), "utf8")).not.toMatch(/hub_bridge_|slice\(-16\)|signInWithPassword/);
  });

  it("mints the session from a magic link token, writes the role through one function and never signs in with a password", async () => {
    const { admin, mint, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED } });
    const result = await provisionAndSignIn(admin, person, { mint });
    expect(calls.links).toEqual([{ type: "magiclink", email: "Owner@Example.com" }]);
    expect(calls.otps).toEqual([{ type: "magiclink", token_hash: "hash-1" }]);
    expect(calls.roles).toEqual([{ p_user_id: "u1", p_role: "moburst_user" }]);
    expect(result).toMatchObject({ ok: true, access_token: "a", refresh_token: "r", user_id: "u1" });
  });

  it("verifies the link on the short-lived client, so the admin client never holds the person's session", async () => {
    const { admin, mint, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED } });
    await provisionAndSignIn(admin, person, { mint });
    expect(calls.otps).toHaveLength(1);
    expect(calls.adminOtps).toHaveLength(0);
  });

  it("reconciles without minting when the presented session is the same person's", async () => {
    const { admin, mint, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED }, tokens: { "tok-1": "u1" } });
    const result = await provisionAndSignIn(admin, person, { mint, presentedAccessToken: "tok-1" });
    expect(result).toEqual({ ok: true, access_token: null, refresh_token: null, user_id: "u1", mapped_clients: 0 });
    expect(calls.links).toHaveLength(0);
    expect(calls.otps).toHaveLength(0);
    // The role and the mapping are still written on every load.
    expect(calls.roles).toEqual([{ p_user_id: "u1", p_role: "moburst_user" }]);
    expect(calls.profiles).toHaveLength(1);
    expect(calls.clientAccess).toEqual([{ p_user_id: "u1", p_client_ids: [] }]);
  });

  it("mints a session when the presented one is someone else's or is not valid", async () => {
    for (const tokens of [{ "tok-1": "u2" }, {}]) {
      const { admin, mint, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED }, tokens });
      const result = await provisionAndSignIn(admin, person, { mint, presentedAccessToken: "tok-1" });
      expect(result).toMatchObject({ ok: true, access_token: "a" });
      expect(calls.otps).toHaveLength(1);
    }
  });

  it("settles a magic link that another sign-in replaced by trying a fresh link", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, mint, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED }, otpFailures: 1 });
    const result = await provisionAndSignIn(admin, person, { mint });
    expect(result).toMatchObject({ ok: true, access_token: "a", refresh_token: "r" });
    expect(calls.links).toHaveLength(2);
    expect(calls.otps).toHaveLength(2);
  });

  it("gives up after a few links, with a code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, mint, calls } = fakeAdmin({ otpFailures: 9 });
    expect(await provisionAndSignIn(admin, person, { mint })).toEqual({ ok: false, error: "session_failed" });
    expect(calls.links).toHaveLength(3);
  });

  it("writes the company mapping in one call, so it is never empty between a delete and an insert", async () => {
    const clients = [{ id: "c1", hub_company_name: "Acme" }, { id: "c2", hub_company_name: "Other" }];
    const { admin, mint, calls } = fakeAdmin({ clients });
    const result = await provisionAndSignIn(admin, { ...person, toolRole: "client" }, { mint });
    expect(calls.clientAccess).toEqual([{ p_user_id: "new-user", p_client_ids: ["c1"] }]);
    expect(result).toMatchObject({ ok: true, mapped_clients: 1 });
  });

  it("answers with a code, never the database text, when a step fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const [opts, code] of [[{ failProfile: true }, "provision_failed"], [{ failRole: true }, "provision_failed"], [{ failClientAccess: true }, "provision_failed"], [{ failLink: true }, "session_failed"], [{ otpFailures: 9 }, "session_failed"]] as const) {
      const { admin, mint } = fakeAdmin(opts);
      const result = await provisionAndSignIn(admin, person, { mint });
      expect(result).toEqual({ ok: false, error: code });
    }
  });
});

describe("revokeAccess", () => {
  it("removes the role and the client mapping and ends the presented session when it is the person's", async () => {
    const { admin, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED }, tokens: { "tok-1": "u1" } });
    await revokeAccess(admin, "Owner@Example.com", "tok-1");
    expect(calls.roles).toEqual([{ p_user_id: "u1", p_role: null }]);
    expect(calls.clientAccess).toEqual([{ p_user_id: "u1", p_client_ids: [] }]);
    expect(calls.signOuts).toEqual([{ jwt: "tok-1", scope: "global" }]);
  });

  it("leaves a presented session alone when it belongs to someone else or is not valid", async () => {
    for (const tokens of [{ "tok-1": "u2" }, {}]) {
      const { admin, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@example.com", app_metadata: ROTATED }, tokens });
      await revokeAccess(admin, "owner@example.com", "tok-1");
      expect(calls.roles).toEqual([{ p_user_id: "u1", p_role: null }]);
      expect(calls.signOuts).toHaveLength(0);
    }
  });

  it("ends no session for a person with no account here", async () => {
    const { admin, calls } = fakeAdmin({ tokens: { "tok-1": "u2" } });
    await revokeAccess(admin, "nobody@example.com", "tok-1");
    expect(calls.signOuts).toHaveLength(0);
  });

  it("does nothing for a person with no account and no session", async () => {
    const { admin, calls } = fakeAdmin();
    await revokeAccess(admin, "nobody@example.com");
    expect(calls.roles).toHaveLength(0);
    expect(calls.signOuts).toHaveLength(0);
  });
});

describe("portalStatusCode", () => {
  it("is a refusal for 401 and 403 only; an outage or a rate limit is not one", () => {
    expect(portalStatusCode(401)).toBe("invalid_token");
    expect(portalStatusCode(403)).toBe("invalid_token");
    for (const status of [429, 500, 502, 503, 504]) expect(portalStatusCode(status)).toBe("portal_unreachable");
  });
});

describe("the error codes", () => {
  it("are the same list the sign-in page has a sentence for", () => {
    expect([...AUTH_ERROR_CODES]).toEqual([...BRIDGE_ERROR_CODES]);
  });
});
