// @vitest-environment node
// What Settings is told about the Higgsfield link: found by trying the stored
// token, not by whether one is stored.
import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../support/lifecycleFakeDb";
import { handleAuthRequest, type AuthDeps } from "../../functions/_shared/higgsfield/oauth";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const HOUR = 3_600_000;

function world(vault: Row | null, row: Row = {}): FakeDb {
  return fakeDb(
    { integration_tokens: [{ provider: "higgsfield", client_id: "cid", account_email: "social-team@moburst.com", linked_at: "2026-11-01T08:00:00.000Z", expires_at: new Date(Date.now() - HOUR).toISOString(), ...row }] },
    { higgsfield_tokens_read: () => vault, higgsfield_tokens_save: () => null },
  );
}
const provider = (status: number, body: Row = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const status = (db: FakeDb, f: typeof fetch) => {
  const deps: AuthDeps = { db, env: () => "x", fetch: f, requireStaff: async () => ({ isAdmin: async () => false }) };
  return handleAuthRequest(new Request("https://x.supabase.co/functions/v1/higgsfield-auth", { method: "POST", body: JSON.stringify({ action: "status" }) }), deps);
};

describe("status", () => {
  it("answers linked false, and that it needs a sign-in, when the provider rejects the refresh token", async () => {
    const res = await status(world({ refresh_token: "r", access_token: "a" }), provider(400, { error: "invalid_grant" }));
    expect(await res.json()).toEqual({ linked: false, needs_sign_in: true, account_email: "social-team@moburst.com", linked_at: "2026-11-01T08:00:00.000Z" });
  });

  it("answers linked when the token refreshes, and shows nothing secret", async () => {
    const res = await status(world({ refresh_token: "r", access_token: "a" }), provider(200, { access_token: "a2", refresh_token: "r2", expires_in: 3600 }));
    const body = await res.json();
    expect(body).toEqual({ linked: true, needs_sign_in: false, account_email: "social-team@moburst.com", linked_at: "2026-11-01T08:00:00.000Z" });
    expect(JSON.stringify(body)).not.toMatch(/a2|r2/);
  });

  it("does not try the provider while the access token is still good", async () => {
    const f = provider(500);
    const res = await status(world({ refresh_token: "r", access_token: "a" }, { expires_at: new Date(Date.now() + HOUR).toISOString() }), f);
    expect((await res.json()).linked).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("keeps what the last refresh found when the provider is only busy", async () => {
    const worked = world({ refresh_token: "r", access_token: "a" }, { last_refresh_ok_at: "2026-11-11T08:00:00.000Z" });
    expect((await (await status(worked, provider(503))).json()).linked).toBe(true);
    const refused = world({ refresh_token: "r", access_token: "a" }, { last_refresh_refused_at: "2026-11-11T08:00:00.000Z" });
    expect((await (await status(refused, provider(503))).json()).needs_sign_in).toBe(true);
  });

  it("is not linked when nothing is stored, and needs no sign-in word for it", async () => {
    const res = await status(world(null, { account_email: null, linked_at: null }), provider(500));
    expect(await res.json()).toEqual({ linked: false, needs_sign_in: false, account_email: null, linked_at: null });
  });
});
