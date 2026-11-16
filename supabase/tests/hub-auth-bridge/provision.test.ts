// @vitest-environment node
// What the legacy bridge writes for a person (QA 12 Nov 2026, ACCESS-API-14,
// ACCESS-API-20): one portal is active per account, a company maps to a
// client by exact name only, and a profile that cannot be written refuses the
// sign-in with no session.
import { describe, expect, it, vi } from "vitest";
import { provisionAndSignIn, type PortalPerson } from "../../functions/_shared/auth/session.ts";
import { fakeAdmin } from "../_shared/auth/fakeAdmin.ts";

const ROTATED = { bridge_password: "random" };
const hub = (over: Partial<PortalPerson> = {}): PortalPerson => ({ email: "o@example.com", name: "O", hubUserId: "h1", toolRole: "client", source: "hub", company: "Acme", ...over });

describe("legacy portal sign-in", () => {
  it("after a moburst.ai sign-in, a legacy sign-in leaves no slugs and marks the account as legacy", async () => {
    const { admin, mint, calls } = fakeAdmin({ existing: { id: "u1", email: "o@example.com", app_metadata: ROTATED } });
    await provisionAndSignIn(admin, { ...hub(), source: "gos", slugs: ["acme"], company: null }, { mint });
    await provisionAndSignIn(admin, hub({ company: null }), { mint });
    expect(calls.profiles[0].allowed_company_slugs).toEqual(["acme"]);
    expect(calls.profiles[1].allowed_company_slugs).toBeNull();
    expect(calls.profiles[1].hub_company_name).toBeNull();
    expect(calls.updateUser[0].user_metadata.auth_source).toBe("gos");
    expect(calls.updateUser[1].user_metadata).toMatchObject({ auth_source: "hub", allowed_company_slugs: null });
  });

  it("maps a company to clients by exact name, so an underscore is not a wildcard", async () => {
    const clients = [{ id: "c1", hub_company_name: "AxB" }, { id: "c2", hub_company_name: " a_b " }, { id: "c3", hub_company_name: "Other" }];
    const { admin, mint, calls } = fakeAdmin({ clients });
    await provisionAndSignIn(admin, hub({ company: "A_B" }), { mint });
    expect(calls.clientAccess).toEqual([{ p_user_id: "new-user", p_client_ids: ["c2"] }]);
  });

  it("refuses the sign-in, with no session, when the company mapping cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, mint, calls } = fakeAdmin({ failClientAccess: true, clients: [{ id: "c1", hub_company_name: "Acme" }] });
    const result = await provisionAndSignIn(admin, hub(), { mint });
    expect(result).toEqual({ ok: false, error: "provision_failed" });
    expect(calls.links).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("foreign key");
  });

  it("refuses the sign-in, with no session, when the profile cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { admin, mint, calls } = fakeAdmin({ failProfile: true });
    const result = await provisionAndSignIn(admin, hub(), { mint });
    expect(result).toEqual({ ok: false, error: "provision_failed" });
    expect(calls.links).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("duplicate key");
  });
});
