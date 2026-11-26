// @vitest-environment node
// The team's Higgsfield session: its tokens live in Vault (never on the row),
// each refresh leaves its result on the row for Settings, a sign-in returns to
// the address it started from, and an unexpected failure never shows its cause.
import { describe, expect, it, vi } from "vitest";
import { fakeDb, type FakeDb } from "../../support/lifecycleFakeDb";
import { AuthzError } from "../../../functions/_shared/auth/authz";
import { accessTokenFor, handleAuthRequest, TokenRefused, UNEXPECTED_FAILURE, type AuthDeps } from "../../../functions/_shared/higgsfield/oauth";

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const NOW = new Date("2026-11-12T10:00:00.000Z");
const HOUR = 3_600_000;

/** A database with the Vault functions behind a plain object, so a test can see what went where. */
function world(vault: { refresh_token: string; access_token: string } | null, row: Row = {}): FakeDb & { vault: typeof vault } {
  const state = { vault };
  const db = fakeDb(
    { integration_tokens: [{ provider: "higgsfield", client_id: "cid", expires_at: new Date(NOW.getTime() - HOUR).toISOString(), ...row }] },
    {
      higgsfield_tokens_read: () => state.vault,
      // As the SQL function has it: both tokens to Vault, and the plain columns emptied in the same step.
      higgsfield_tokens_save: (a, d) => {
        state.vault = { refresh_token: String(a.p_refresh), access_token: String(a.p_access) };
        for (const r of d.tables.integration_tokens) if (r.provider === "higgsfield") Object.assign(r, { refresh_token: null, access_token: null });
        return null;
      },
    },
  ) as FakeDb & { vault: typeof vault };
  Object.defineProperty(db, "vault", { get: () => state.vault });
  return db;
}
const provider = (status: number, body: Row) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const grantOk = provider(200, { access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 });

describe("reading and saving the token", () => {
  it("goes through the Vault functions: a refresh keeps both tokens there and never on the row", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" });
    expect(await accessTokenFor(db, grantOk)).toBe("access-2");
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["higgsfield_tokens_read", "higgsfield_tokens_read", "higgsfield_tokens_save"]);
    expect(db.vault).toEqual({ refresh_token: "refresh-2", access_token: "access-2" });
    const row = db.tables.integration_tokens[0];
    expect(JSON.stringify(row)).not.toMatch(/refresh-|access-/);
    expect(typeof row.last_refresh_ok_at).toBe("string");
  });

  it("uses a live access token as it is, with no refresh", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" }, { expires_at: new Date(Date.now() + HOUR).toISOString() });
    const f = vi.fn() as unknown as typeof fetch;
    expect(await accessTokenFor(db, f)).toBe("access-1");
    expect(f).not.toHaveBeenCalled();
  });

  it("is not connected without a Vault token", async () => {
    await expect(accessTokenFor(world(null), grantOk)).rejects.toThrow(/not connected/);
  });
});

const MISSING = "Could not find the function public.higgsfield_tokens_read without parameters in the schema cache";

/** The release in either order: functions deployed before the migration (the Vault functions do not exist yet). */
function beforeMigration(row: Row = {}): FakeDb {
  const missing = () => { throw new Error(MISSING); };
  return fakeDb(
    { integration_tokens: [{ provider: "higgsfield", client_id: "cid", refresh_token: "refresh-1", access_token: "access-1", expires_at: new Date(NOW.getTime() - HOUR).toISOString(), ...row }] },
    { higgsfield_tokens_read: missing, higgsfield_tokens_save: missing },
  );
}

describe("keeping a rotated token", () => {
  it("tries again when keeping the new pair fails once, so the rotated refresh token is not lost", async () => {
    // QA 22 Nov 2026 (P53-09): the provider has already rotated the token when it is kept; one failed save lost it, and every video stopped until an admin linked Higgsfield again.
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" });
    const save = (db as unknown as { rpc: FakeDb["rpc"] }).rpc.bind(db);
    let fails = 1;
    db.rpc = async (name, args) => {
      if (name === "higgsfield_tokens_save" && fails-- > 0) { db.rpcCalls.push({ name, args }); return { data: null, error: { message: "connection reset" } }; }
      return save(name, args);
    };
    expect(await accessTokenFor(db, grantOk)).toBe("access-2");
    expect(db.vault).toEqual({ refresh_token: "refresh-2", access_token: "access-2" });
    expect(db.rpcCalls.filter((c) => c.name === "higgsfield_tokens_save")).toHaveLength(2);
  });

  it("says loudly in the log when the new pair could not be kept at all", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" });
    const save = db.rpc.bind(db);
    db.rpc = async (name, args) => (name === "higgsfield_tokens_save" ? { data: null, error: { message: "down" } } : save(name, args));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(accessTokenFor(db, grantOk)).rejects.toThrow("Could not keep the Higgsfield tokens");
    expect(logged.mock.calls.some((c) => String(c[0]).includes("rotated"))).toBe(true);
    logged.mockRestore();
  });
});

describe("a release in either order", () => {
  it("serves the token from the columns while the Vault functions do not exist yet", async () => {
    const db = beforeMigration({ expires_at: new Date(Date.now() + HOUR).toISOString() });
    expect(await accessTokenFor(db, vi.fn() as unknown as typeof fetch)).toBe("access-1");
  });

  it("keeps a refreshed pair on the columns while the Vault functions do not exist yet", async () => {
    const db = beforeMigration();
    expect(await accessTokenFor(db, grantOk)).toBe("access-2");
    expect(db.tables.integration_tokens[0]).toMatchObject({ refresh_token: "refresh-2", access_token: "access-2" });
  });

  it("moves a pair that is still on the columns into Vault, and empties the columns, with its first refresh", async () => {
    const db = world(null, { refresh_token: "refresh-1", access_token: "access-1" });
    expect(await accessTokenFor(db, grantOk)).toBe("access-2");
    expect(db.vault).toEqual({ refresh_token: "refresh-2", access_token: "access-2" });
    expect(db.tables.integration_tokens[0]).toMatchObject({ refresh_token: null, access_token: null });
  });

  it("reads the columns after the migration copied them, while the old code still runs", async () => {
    // The migration leaves the columns as they are; the old code keeps rotating them, so they are the newer pair.
    const db = world({ refresh_token: "refresh-copied", access_token: "access-copied" }, { refresh_token: "refresh-newer", access_token: "access-newer", expires_at: new Date(Date.now() + HOUR).toISOString() });
    expect(await accessTokenFor(db, vi.fn() as unknown as typeof fetch)).toBe("access-newer");
  });

  it("is not connected when neither place holds a token", async () => {
    await expect(accessTokenFor(beforeMigration({ refresh_token: null, access_token: null }), grantOk)).rejects.toThrow(/not connected/);
  });

  it("does not call a Vault that failed for another reason not connected", async () => {
    const db = fakeDb(
      { integration_tokens: [{ provider: "higgsfield", client_id: "cid", expires_at: null }] },
      { higgsfield_tokens_read: () => { throw new Error("connection reset"); } },
    );
    await expect(accessTokenFor(db, grantOk)).rejects.toThrow(/Could not read the Higgsfield tokens/);
  });
});

describe("one refresh at a time", () => {
  it("holds a lease while it refreshes and lets go after", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" });
    let held: unknown;
    const f = vi.fn(async () => {
      held = db.tables.integration_tokens[0].refreshing_until;
      return new Response(JSON.stringify({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }), { status: 200 });
    }) as unknown as typeof fetch;
    await accessTokenFor(db, f);
    expect(typeof held).toBe("string");
    expect(db.tables.integration_tokens[0].refreshing_until).toBeNull();
  });

  it("lets go of the lease when the provider refuses", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" });
    await expect(accessTokenFor(db, provider(400, {}))).rejects.toBeInstanceOf(TokenRefused);
    expect(db.tables.integration_tokens[0].refreshing_until).toBeNull();
  });

  it("waits for the holder and reads what it stored, instead of refreshing with the same token", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" }, { refreshing_until: new Date(Date.now() + 20_000).toISOString() });
    const f = vi.fn() as unknown as typeof fetch;
    const sleep = vi.fn(async () => {
      // The holder finishes while this call waits.
      await db.rpc("higgsfield_tokens_save", { p_refresh: "refresh-9", p_access: "access-9" });
      Object.assign(db.tables.integration_tokens[0], { expires_at: new Date(Date.now() + HOUR).toISOString(), refreshing_until: null });
    });
    expect(await accessTokenFor(db, f, sleep)).toBe("access-9");
    expect(f).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("takes over a lease that has run out", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" }, { refreshing_until: new Date(Date.now() - 5_000).toISOString() });
    expect(await accessTokenFor(db, grantOk, vi.fn())).toBe("access-2");
  });

  it("gives up with a plain error, not a refusal, when the holder never finishes", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" }, { refreshing_until: new Date(Date.now() + 600_000).toISOString() });
    await expect(accessTokenFor(db, grantOk, vi.fn())).rejects.toThrow(/held by another run/);
    expect(db.tables.integration_tokens[0].last_refresh_refused_at).toBeUndefined();
  });
});

describe("what a refresh leaves on the row", () => {
  it("stores the time the provider refused the token", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" });
    await expect(accessTokenFor(db, provider(400, { error: "invalid_grant" }))).rejects.toBeInstanceOf(TokenRefused);
    expect(typeof db.tables.integration_tokens[0].last_refresh_refused_at).toBe("string");
    expect(db.tables.integration_tokens[0].last_refresh_ok_at).toBeUndefined();
    // The stored tokens are untouched.
    expect(db.vault).toEqual({ refresh_token: "refresh-1", access_token: "access-1" });
  });

  it("does not call a busy provider a refusal", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" });
    await expect(accessTokenFor(db, provider(503, {}))).rejects.toThrow(/503/);
    expect(db.tables.integration_tokens[0].last_refresh_refused_at).toBeUndefined();
  });

  it("does not call it a refusal when another caller already rotated the token", async () => {
    const db = world({ refresh_token: "refresh-1", access_token: "access-1" });
    const f = vi.fn(async () => {
      // While this call was at the provider, another one rotated and stored a live pair.
      db.tables.integration_tokens[0].expires_at = new Date(Date.now() + HOUR).toISOString();
      await db.rpc("higgsfield_tokens_save", { p_refresh: "refresh-rotated", p_access: "access-rotated" });
      return new Response("{}", { status: 400 });
    }) as unknown as typeof fetch;
    expect(await accessTokenFor(db, f)).toBe("access-rotated");
    expect(db.tables.integration_tokens[0].last_refresh_refused_at).toBeUndefined();
  });
});

function deps(db: FakeDb, over: Partial<AuthDeps> = {}): AuthDeps {
  return {
    db,
    now: () => NOW,
    env: (k) => (k === "SUPABASE_URL" ? "https://x.supabase.co" : undefined),
    requireStaff: async () => ({ isAdmin: async () => true }),
    fetch: vi.fn(async (url: string | URL | Request) => String(url).endsWith("/oauth/token")
      ? new Response(JSON.stringify({ access_token: "access-new", refresh_token: "refresh-new", expires_in: 3600, id_token: `h.${btoa(JSON.stringify({ email: "social-team@moburst.com" }))}.s` }), { status: 200 })
      : new Response("{}", { status: 404 })) as unknown as typeof fetch,
    ...over,
  };
}
const post = (body: Row, origin?: string) => new Request("https://x.supabase.co/functions/v1/higgsfield-auth", { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });

describe("the way back from the sign-in", () => {
  async function startAndReturn(origin: string | undefined) {
    const db = world(null);
    const d = deps(db);
    const started = await (await handleAuthRequest(post({ action: "start" }, origin), d)).json();
    const state = new URL(started.authorize_url).searchParams.get("state")!;
    const back = await handleAuthRequest(new Request(`https://x.supabase.co/functions/v1/higgsfield-auth?code=c&state=${state}`), d);
    return { db, back };
  }

  it("lands on the address the sign-in was started from", async () => {
    const { db, back } = await startAndReturn("https://socialytics.moburst.ai");
    expect(back.status).toBe(302);
    expect(back.headers.get("location")).toBe("https://socialytics.moburst.ai/settings?higgsfield=linked");
    // Both tokens went to Vault, the account is read from the id token, and the pending sign-in is spent.
    expect(db.vault).toEqual({ refresh_token: "refresh-new", access_token: "access-new" });
    const row = db.tables.integration_tokens[0];
    expect(row).toMatchObject({ account_email: "social-team@moburst.com", pending_state: null, pending_return_origin: null });
    expect(JSON.stringify(row)).not.toMatch(/refresh-new|access-new/);
  });

  it("lands on the default address when the start came from anywhere else or said nothing", async () => {
    expect((await startAndReturn("https://evil.example")).back.headers.get("location")).toBe("https://socialytics.moburst.com/settings?higgsfield=linked");
    expect((await startAndReturn(undefined)).back.headers.get("location")).toBe("https://socialytics.moburst.com/settings?higgsfield=linked");
  });

  it("sends a refusal back to the same address with a short reason", async () => {
    const db = world(null);
    const d = deps(db);
    await handleAuthRequest(post({ action: "start" }, "https://socialytics.moburst.ai"), d);
    const back = await handleAuthRequest(new Request("https://x.supabase.co/functions/v1/higgsfield-auth?error=access_denied"), d);
    expect(back.headers.get("location")).toBe("https://socialytics.moburst.ai/settings?higgsfield=failed&reason=refused");
  });

  it("settles an earlier refusal: a new sign-in works as of now", async () => {
    const db = world({ refresh_token: "dead", access_token: "dead" }, { last_refresh_refused_at: new Date(NOW.getTime() - HOUR).toISOString() });
    const d = deps(db);
    const started = await (await handleAuthRequest(post({ action: "start" }), d)).json();
    await handleAuthRequest(new Request(`https://x.supabase.co/functions/v1/higgsfield-auth?code=c&state=${new URL(started.authorize_url).searchParams.get("state")}`), d);
    const row = db.tables.integration_tokens[0];
    expect(Date.parse(row.last_refresh_ok_at)).toBeGreaterThan(Date.parse(row.last_refresh_refused_at));
  });
});

describe("an unexpected failure", () => {
  it("answers with one fixed sentence and keeps the cause out of the body", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = world(null);
    db.rpc = async () => { throw new Error('relation "vault.secrets" password=hunter2'); };
    const res = await handleAuthRequest(post({ action: "status" }), deps(db));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: UNEXPECTED_FAILURE });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("still tells a person who may not what the rule is", async () => {
    const d = deps(world(null), { requireStaff: async () => { throw new AuthzError(403, "Moburst staff only."); } });
    const res = await handleAuthRequest(post({ action: "status" }), d);
    expect(res.status).toBe(403);
  });
});
