import { describe, it, expect } from "vitest";
import { makeVerifyStaffSession } from "../../functions/api/routes-me";
import { API_VERSION, TOOL, socialyticsHandler } from "../../functions/api/openapi";
import type { KeyStore, StoredKey } from "../../functions/api/routes-admin";
import type { CoreDeps } from "../../functions/_shared/api/core";
import { hashKey, type KeyRow } from "../../functions/_shared/api/keys";
import { emptyData, makeFakeStore } from "../../functions/_shared/socialytics-api/store.fake";

const NOW = new Date("2026-11-10T09:00:00.000Z");
const DAY = 86_400_000;
const UNAUTHORIZED = "unauthorized";
const STAFF_ONLY = "Personal API keys are for Moburst staff.";
const AT_LIMIT = "You have 10 active keys. Revoke one to make another.";
const PERSONAL_FIELDS = ["created_at", "expires_at", "id", "key_prefix", "last_used_at", "name", "revoked_at", "scopes"];

// App sessions: token to user, user to roles, user to the email on their profile.
const USERS: Record<string, string> = { "jwt-lital": "u-lital", "jwt-admin": "u-admin", "jwt-client": "u-client", "jwt-norole": "u-norole", "jwt-both": "u-both" };
const ROLES: Record<string, string[]> = { "u-lital": ["moburst_user"], "u-admin": ["admin"], "u-client": ["client"], "u-norole": [], "u-both": ["client", "moburst_user"] };
const EMAILS: Record<string, string> = { "u-lital": "lital@moburst.com", "u-admin": "admin@moburst.com" };

// A token Supabase's OAuth server issued to the Claude connector for Lital. It is a valid session (auth would answer
// with her user), so only its client_id claim may refuse it.
const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const OAUTH = `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub: "u-lital", role: "authenticated", client_id: "claude-connector" })}.signature`;
USERS[OAUTH] = "u-lital";
// Live API keys with every scope: the core accepts them on /v1/admin/*, but they are never a person's session.
const TOOL_KEY = `soc_${"A".repeat(43)}`;
const ADV_KEY = `adv_${"B".repeat(43)}`;

const STUBS = {
  store: makeFakeStore(emptyData()), analytics: async () => ({ ok: true, status: 200, data: {} }), health: async () => ({}),
  jobs: { create: async (j: never) => ({ ...(j as object), id: "x" }) as never, byIdempotency: async () => null, get: async () => null, list: async () => [], update: async (_i: string, p: unknown) => p as never, runningCount: async () => 0 },
  kickWorker: async () => {}, discard: async () => ({ removed: { client: false, competitor_sets: 0, reports: 0, competitive_reports: 0, posts: 0, media_jobs: 0 } }), capacity: 3, stepNames: [] as string[],
};

type NewKey = Omit<StoredKey, "id" | "created_at" | "last_used_at" | "revoked_at" | "owner_email">;

/** api_keys in memory, keeping the KeyStore contract: newest first, owner_email from the owner's profile, owner-scoped revoke. */
function memoryKeys() {
  const rows: StoredKey[] = [];
  let n = 0;
  const withEmail = (r: StoredKey): StoredKey => ({ ...r, owner_email: r.owner_user_id ? EMAILS[r.owner_user_id] ?? null : null });
  const newest = (a: StoredKey, b: StoredKey) => b.created_at.localeCompare(a.created_at);
  const add = (k: NewKey, over: Partial<StoredKey> = {}): StoredKey => {
    n += 1;
    const row: StoredKey = { ...k, id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, created_at: new Date(NOW.getTime() - DAY + n * 1000).toISOString(), last_used_at: null, revoked_at: null, owner_email: null, ...over };
    rows.push(row);
    return row;
  };
  const store: KeyStore = {
    async insert(k) { return withEmail(add(k)); },
    async list() { return [...rows].sort(newest).map(withEmail); },
    async listByOwner(userId) { return rows.filter((r) => r.owner_user_id === userId).sort(newest).map(withEmail); },
    async revoke(id) { const r = rows.find((x) => x.id === id && !x.revoked_at); if (!r) return false; r.revoked_at = NOW.toISOString(); return true; },
    async revokeOwned(id, userId) {
      const r = rows.find((x) => x.id === id && x.owner_user_id === userId);
      if (!r) return null;
      r.revoked_at ??= NOW.toISOString();
      return { id: r.id, revoked_at: r.revoked_at };
    },
  };
  const personal = (owner: string, name: string, over: Partial<StoredKey> = {}) =>
    add({ name, key_prefix: "soc_seeded00", key_hash: "f".repeat(64), scopes: ["read"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, created_by: owner, owner_user_id: owner, expires_at: new Date(NOW.getTime() + 30 * DAY).toISOString(), note: null }, over);
  const tool = (name: string) => add({ name, key_prefix: "soc_toolkey0", key_hash: "e".repeat(64), scopes: ["read", "demo"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, created_by: "u-admin", owner_user_id: null, expires_at: null, note: null });
  return { rows, store, personal, tool };
}

/** The api function as index.ts serves it (socialyticsHandler), over the memory store and fake sessions. */
function app(opts: { userOf?: (token: string) => Promise<string | null> } = {}) {
  const keys = memoryKeys();
  const sessionLookups: string[] = [];
  const verifyStaffSession = makeVerifyStaffSession({
    userOf: async (token) => {
      sessionLookups.push(token);
      return opts.userOf ? opts.userOf(token) : USERS[token] ?? null;
    },
    rolesOf: async (userId) => ROLES[userId] ?? [],
  });
  const liveKey: KeyRow = { id: "k-tool", name: "gOS", key_prefix: TOOL_KEY.slice(0, 12), scopes: ["read", "demo", "admin"], company_slugs: null, client_ids: null, rate_limit_per_minute: 120, expires_at: null, revoked_at: null, minute_count: 1 };
  const core: Omit<CoreDeps, "routes"> = {
    tool: TOOL, version: API_VERSION, touchKey: async () => liveKey, clientsForScope: async () => [], verifyAdminJwt: async () => null,
    cronSecret: "cron-s", serviceKey: null, audit: async () => {}, requestId: () => "r", now: () => NOW,
  };
  const handle = socialyticsHandler(core, { ...STUBS, keys: keys.store, serverUrl: "https://x.supabase.co/functions/v1/api", verifyStaffSession, now: () => NOW });
  const call = async (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
    const res = await handle(new Request(`https://x.supabase.co/functions/v1/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { call, sessionLookups, ...keys };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const ME = "/v1/me/keys";

describe("personal key routes: who may call them", () => {
  it("answer 401 to no Authorization, an unknown session, an API key or the connector's OAuth token, on every route, and never make or revoke a key", async () => {
    const { call, rows, personal, sessionLookups } = app();
    const mine = personal("u-lital", "Lital laptop");
    const callers: Array<Record<string, string>> = [{}, as("jwt-unknown"), as(TOOL_KEY), as(ADV_KEY), { "X-Api-Key": TOOL_KEY }, as(OAUTH)];
    const routes: Array<[string, string, unknown]> = [["GET", ME, undefined], ["POST", ME, { name: "sneaky" }], ["DELETE", `${ME}/${mine.id}`, undefined]];
    for (const [method, path, body] of routes) {
      for (const headers of callers) {
        const r = await call(method, path, headers, body);
        expect(r.status, `${method} ${path} ${JSON.stringify(headers)}`).toBe(401);
        expect(r.body.error.code).toBe(UNAUTHORIZED);
        expect(r.body).not.toHaveProperty("data");
      }
    }
    expect(rows).toHaveLength(1);
    expect(mine.revoked_at).toBeNull();
    // Neither an API key nor the connector's token is ever sent to auth as a session: only the unknown session was looked up.
    expect(sessionLookups).toEqual(["jwt-unknown", "jwt-unknown", "jwt-unknown"]);
  });

  it("answer 403 to a signed-in person without a staff role, on every route", async () => {
    const { call, rows, personal } = app();
    const mine = personal("u-lital", "Lital laptop");
    for (const token of ["jwt-client", "jwt-norole"]) {
      for (const [method, path, body] of [["GET", ME, undefined], ["POST", ME, { name: "x" }], ["DELETE", `${ME}/${mine.id}`, undefined]] as Array<[string, string, unknown]>) {
        const r = await call(method, path, as(token), body);
        expect(r.status, `${token} ${method} ${path}`).toBe(403);
        expect(r.body.error).toEqual({ code: "forbidden", message: STAFF_ONLY });
      }
    }
    expect(rows).toHaveLength(1);
    expect(mine.revoked_at).toBeNull();
  });

  it("let an admin, a Moburst user, and a person with a client role beside a staff role in", async () => {
    const { call } = app();
    for (const token of ["jwt-lital", "jwt-admin", "jwt-both"]) expect((await call("GET", ME, as(token))).status, token).toBe(200);
  });
});

describe("POST /v1/me/keys", () => {
  it("makes a read-only key for exactly 90 days, owned by the person, returns it once and stores only its hash", async () => {
    const { call, rows } = app();
    const r = await call("POST", ME, as("jwt-lital"), { name: "  Lital laptop  " });
    expect(r.status).toBe(201);
    const d = r.body.data;
    expect(d.key).toMatch(/^soc_[A-Za-z0-9_-]{43}$/);
    expect(Object.keys(d).sort()).toEqual([...PERSONAL_FIELDS, "key"].sort());
    expect(d).toMatchObject({ name: "Lital laptop", key_prefix: d.key.slice(0, 12), scopes: ["read"], last_used_at: null, revoked_at: null });
    expect(d.expires_at).toBe(new Date(NOW.getTime() + 90 * DAY).toISOString());
    expect(d.expires_at).toBe("2027-02-08T09:00:00.000Z");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: d.id, name: "Lital laptop", scopes: ["read"], rate_limit_per_minute: 120, company_slugs: null, client_ids: null, owner_user_id: "u-lital", created_by: "u-lital", note: null, expires_at: d.expires_at });
    expect(rows[0].key_hash).toBe(await hashKey(d.key));
    expect(JSON.stringify(r.body)).not.toContain(rows[0].key_hash);
    expect(JSON.stringify(r.body)).not.toMatch(/key_hash|owner_user_id|owner_email|created_by|rate_limit/);
  });

  it("takes a name of 1 to 80 characters after trimming, and answers 400 otherwise", async () => {
    const { call, rows } = app();
    for (const body of [undefined, {}, { name: "" }, { name: "   " }, { name: 42 }, { name: ["x"] }, { name: "x".repeat(81) }, "Lital laptop"]) {
      const r = await call("POST", ME, as("jwt-lital"), body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error.code).toBe("invalid_request");
      expect(r.body.error.details).toEqual({ field: "name" });
    }
    expect(rows).toHaveLength(0);
    expect((await call("POST", ME, as("jwt-lital"), { name: "x".repeat(80) })).status).toBe(201);
    const padded = await call("POST", ME, as("jwt-lital"), { name: `  ${"y".repeat(80)}  ` });
    expect(padded.status).toBe(201);
    expect(padded.body.data.name).toBe("y".repeat(80));
  });

  it("stops at 10 live keys with 409, counting neither revoked, expired nor anyone else's keys", async () => {
    const { call, rows, personal } = app();
    for (let i = 0; i < 8; i++) personal("u-lital", `live ${i}`);
    personal("u-lital", "never expires", { expires_at: null });
    personal("u-lital", "revoked", { revoked_at: "2026-11-01T00:00:00.000Z" });
    personal("u-lital", "expired just now", { expires_at: NOW.toISOString() });
    for (let i = 0; i < 10; i++) personal("u-admin", `admin ${i}`);
    // Nine live keys: the tenth can be made.
    const tenth = await call("POST", ME, as("jwt-lital"), { name: "tenth" });
    expect(tenth.status).toBe(201);
    const eleventh = await call("POST", ME, as("jwt-lital"), { name: "eleventh" });
    expect(eleventh.status).toBe(409);
    expect(eleventh.body.error).toEqual({ code: "conflict", message: AT_LIMIT });
    expect(rows.some((r) => r.name === "eleventh")).toBe(false);
    // Revoking one frees a place.
    expect((await call("DELETE", `${ME}/${tenth.body.data.id}`, as("jwt-lital"))).status).toBe(200);
    expect((await call("POST", ME, as("jwt-lital"), { name: "eleventh" })).status).toBe(201);
  });
});

describe("GET /v1/me/keys", () => {
  it("lists only the person's own keys, newest first, without the hash, the key or the owner", async () => {
    const { call, personal, tool } = app();
    personal("u-lital", "first");
    personal("u-admin", "admin laptop");
    tool("gOS");
    const made = await call("POST", ME, as("jwt-lital"), { name: "second" });
    const l = await call("GET", ME, as("jwt-lital"));
    expect(l.status).toBe(200);
    expect(l.body.next_cursor).toBeNull();
    expect(l.body.data.map((k: { name: string }) => k.name)).toEqual(["second", "first"]);
    for (const k of l.body.data) expect(Object.keys(k).sort()).toEqual(PERSONAL_FIELDS);
    const text = JSON.stringify(l.body);
    expect(text).not.toContain(made.body.data.key);
    expect(text).not.toContain("f".repeat(64));
    expect(text).not.toMatch(/key_hash|"key"|owner|created_by|company_slugs|client_ids/);
  });
});

describe("DELETE /v1/me/keys/:id", () => {
  it("revokes the person's own key and answers the same time when asked again", async () => {
    const { call, personal } = app();
    const mine = personal("u-lital", "laptop");
    const r = await call("DELETE", `${ME}/${mine.id}`, as("jwt-lital"));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ data: { id: mine.id, revoked_at: NOW.toISOString() } });
    const again = await call("DELETE", `${ME}/${mine.id}`, as("jwt-lital"));
    expect(again.status).toBe(200);
    expect(again.body).toEqual(r.body);
  });

  it("answers a key revoked earlier with the time it was revoked", async () => {
    const { call, personal } = app();
    const old = personal("u-lital", "old", { revoked_at: "2026-11-01T08:00:00.000Z" });
    const r = await call("DELETE", `${ME}/${old.id}`, as("jwt-lital"));
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ id: old.id, revoked_at: "2026-11-01T08:00:00.000Z" });
  });

  it("answers 404 for another person's key, a tool key or a missing id, all alike, and leaves those keys alone", async () => {
    const { call, personal, tool } = app();
    const theirs = personal("u-admin", "admin laptop");
    const gos = tool("gOS");
    const answers = [];
    for (const id of [theirs.id, gos.id, "00000000-0000-4000-8000-999999999999", "not-a-uuid"]) {
      const r = await call("DELETE", `${ME}/${id}`, as("jwt-lital"));
      expect(r.status, id).toBe(404);
      answers.push(r.body);
    }
    expect(answers[0].error.code).toBe("not_found");
    for (const a of answers) expect(a).toEqual(answers[0]);
    expect(theirs.revoked_at).toBeNull();
    expect(gos.revoked_at).toBeNull();
  });
});

describe("the admin key list", () => {
  it("shows the owner's email for a personal key and null for a tool key, and the admin create route still makes a tool key", async () => {
    const { call, rows } = app();
    const admin = { "X-Cron-Secret": "cron-s" };
    expect((await call("POST", "/v1/admin/keys", admin, { name: "gOS", scopes: ["read"] })).status).toBe(201);
    expect(rows[0].owner_user_id).toBeNull();
    await call("POST", ME, as("jwt-lital"), { name: "Lital laptop" });
    const l = await call("GET", "/v1/admin/keys", admin);
    expect(l.status).toBe(200);
    const byName = Object.fromEntries(l.body.data.map((k: { name: string }) => [k.name, k]));
    expect(byName["Lital laptop"]).toMatchObject({ owner_user_id: "u-lital", owner_email: "lital@moburst.com", scopes: ["read"] });
    expect(byName.gOS).toMatchObject({ owner_user_id: null, owner_email: null });
    expect(JSON.stringify(l.body)).not.toMatch(/key_hash|"key"/);
  });
});

describe("the request wiring", () => {
  it("reads each request's own session token, even while another request is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    // Lital's session lookup waits until the admin's whole request has finished.
    const { call, personal } = app({ userOf: async (token) => { if (token === "jwt-lital") await gate; return USERS[token] ?? null; } });
    personal("u-lital", "Lital laptop");
    personal("u-admin", "Admin laptop");
    const lital = call("GET", ME, as("jwt-lital"));
    const admin = await call("GET", ME, as("jwt-admin"));
    release();
    const mine = await lital;
    expect(admin.body.data.map((k: { name: string }) => k.name)).toEqual(["Admin laptop"]);
    expect(mine.body.data.map((k: { name: string }) => k.name)).toEqual(["Lital laptop"]);
  });

  it("lists the personal key routes in the OpenAPI document", async () => {
    const { call } = app();
    const doc = (await call("GET", "/v1/openapi.json")).body as { paths: Record<string, Record<string, { requestBody?: unknown }>> };
    expect(Object.keys(doc.paths["/v1/me/keys"]).sort()).toEqual(["get", "post"]);
    expect(doc.paths["/v1/me/keys"].post.requestBody).toBeDefined();
    expect(Object.keys(doc.paths["/v1/me/keys/{id}"])).toEqual(["delete"]);
  });
});

describe("makeVerifyStaffSession", () => {
  it("refuses an API key and the connector's token before asking auth, and reads staff from the roles", async () => {
    const asked: string[] = [];
    const verify = makeVerifyStaffSession({ userOf: async (t) => { asked.push(t); return USERS[t] ?? null; }, rolesOf: async (id) => ROLES[id] ?? [] });
    expect(await verify(TOOL_KEY)).toBeNull();
    expect(await verify(ADV_KEY)).toBeNull();
    expect(await verify(OAUTH)).toBeNull();
    expect(asked).toEqual([]);
    expect(await verify("jwt-unknown")).toBeNull();
    expect(await verify("jwt-lital")).toEqual({ userId: "u-lital", staff: true });
    expect(await verify("jwt-admin")).toEqual({ userId: "u-admin", staff: true });
    expect(await verify("jwt-both")).toEqual({ userId: "u-both", staff: true });
    expect(await verify("jwt-client")).toEqual({ userId: "u-client", staff: false });
    expect(await verify("jwt-norole")).toEqual({ userId: "u-norole", staff: false });
  });
});

describe("what the person reads", () => {
  it("every error message is plain American English with no dashes", async () => {
    const { call, personal } = app();
    for (let i = 0; i < 10; i++) personal("u-lital", `k${i}`);
    const messages = [
      (await call("GET", ME)).body.error.message,
      (await call("GET", ME, as("jwt-client"))).body.error.message,
      (await call("POST", ME, as("jwt-lital"), { name: "" })).body.error.message,
      (await call("POST", ME, as("jwt-lital"), { name: "x" })).body.error.message,
      (await call("DELETE", `${ME}/00000000-0000-4000-8000-999999999999`, as("jwt-lital"))).body.error.message,
    ];
    for (const m of messages) {
      expect(m, m).toMatch(/^[A-Z][^–—]*\.?$/);
      expect(m).not.toMatch(/ - |\bnull\b|\bundefined\b|[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });
});
