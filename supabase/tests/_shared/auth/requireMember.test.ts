// requireMember: a client's own user, or staff with write access to it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { revokeAccess } from "../../../functions/_shared/auth/session.ts";
import { fakeAdmin } from "./fakeAdmin.ts";

const rpc = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../../functions/_shared/supabase.ts", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } }, error: null }) },
    rpc: (name: string, args: { _client_id: string }) => rpc.fn(name, args),
  }),
}));

import { requireMember } from "../../../functions/_shared/auth/requireMember.ts";

const request = () => new Request("http://x", { headers: { Authorization: "Bearer a.eyJzdWIiOiJ1MSJ9.s" } });

beforeEach(() => {
  rpc.fn.mockReset();
  (globalThis as { Deno?: unknown }).Deno = { env: { get: (k: string) => ({ SUPABASE_URL: "http://x", SUPABASE_ANON_KEY: "anon" } as Record<string, string>)[k] } };
});

describe("requireMember", () => {
  it("admits a client's own user and refuses anyone else", async () => {
    rpc.fn.mockImplementation(async (name: string) => ({ data: name === "is_client_member", error: null }));
    await expect(requireMember(request(), "c1")).resolves.toBe("u1");
    rpc.fn.mockImplementation(async () => ({ data: false, error: null }));
    await expect(requireMember(request(), "c1")).rejects.toMatchObject({ status: 403 });
  });

  // QA 22 Nov 2026 (P24-04): a check the database did not answer read as "no access".
  it("reports a server fault, not a refusal, when the access check fails", async () => {
    rpc.fn.mockImplementation(async () => ({ data: null, error: { message: "canceling statement due to statement timeout" } }));
    const err = await requireMember(request(), "c1").then(() => null, (e) => e);
    expect(err?.status).toBe(500);
  });

  it("admits on the check that answered yes, though the other one failed", async () => {
    rpc.fn.mockImplementation(async (name: string) => (name === "is_client_member" ? { data: true, error: null } : { data: null, error: { message: "timeout" } }));
    await expect(requireMember(request(), "c1")).resolves.toBe("u1");
  });
});

// QA 22 Nov 2026 (P24-01): a person the Hub deactivated kept member access,
// since revokeAccess cleared the role and client_users and left the profile
// columns is_client_member matches on. is_client_member is modelled here as
// 20260720130000_company_scoped_staff.sql states it (branches A, B, C); the
// role gate of 20261122140200 is tested on PGlite (clientMemberNeedsRole).
describe("a revoked Hub user", () => {
  const db = {
    roles: new Map<string, string | null>([["u1", "client"]]),
    clientUsers: new Map<string, string[]>([["u1", ["c1"]]]),
    profiles: new Map<string, { hub_company_name: string | null; allowed_company_slugs: string[] | null }>([["u1", { hub_company_name: "Acme", allowed_company_slugs: null }]]),
    clients: [{ id: "c1", hub_company_name: "Acme", company_slug: "acme" }],
  };
  function isClientMember(userId: string, clientId: string): boolean {
    const p = db.profiles.get(userId);
    const c = db.clients.find((x) => x.id === clientId);
    if (!c) return false;
    const a = !!p?.hub_company_name && !!c.hub_company_name && p.hub_company_name.trim().toLowerCase() === c.hub_company_name.trim().toLowerCase();
    const b = (db.clientUsers.get(userId) ?? []).includes(clientId);
    const cc = p?.hub_company_name == null && !!p?.allowed_company_slugs && p.allowed_company_slugs.includes(c.company_slug);
    return a || b || cc;
  }

  it("can no longer act on their client once revokeAccess ran", async () => {
    rpc.fn.mockImplementation(async (name: string, args: { _client_id: string }) => {
      if (name === "can_write_client") return { data: false, error: null };
      return { data: isClientMember("u1", args._client_id), error: null };
    });
    await expect(requireMember(request(), "c1")).resolves.toBe("u1");

    const { admin, calls } = fakeAdmin({ existing: { id: "u1", email: "owner@acme.com", app_metadata: { bridge_password: "random" } } });
    await revokeAccess(admin, "owner@acme.com", null);
    for (const r of calls.roles) db.roles.set(r.p_user_id, r.p_role);
    for (const a of calls.clientAccess) db.clientUsers.set(a.p_user_id, a.p_client_ids);
    for (const p of calls.profiles) {
      const before = db.profiles.get(p.user_id);
      db.profiles.set(p.user_id, { hub_company_name: "hub_company_name" in p ? p.hub_company_name : before?.hub_company_name ?? null, allowed_company_slugs: "allowed_company_slugs" in p ? p.allowed_company_slugs : before?.allowed_company_slugs ?? null });
    }
    expect(db.roles.get("u1")).toBeNull();
    await expect(requireMember(request(), "c1")).rejects.toMatchObject({ status: 403 });
  });
});
