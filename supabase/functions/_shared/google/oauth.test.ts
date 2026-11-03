// @vitest-environment node
// The Google sign-in (spec: docs/superpowers/specs/2026-11-03-strategy-v2-
// design.md, section 4; Lital's answer of 3 Nov 2026): Google's documented web
// server flow with PKCE, offline access and the per-file Drive scope; the
// refresh token read only through the service-role function, exchanged for an
// access token each time, never stored or shown in an error or a log.
import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeUrl, DECK_ACCOUNT, googleAccessToken, googleConfig, GoogleNotConnected, keepAlive, makePkce, redact, SCOPES, signedInEmail } from "./oauth";
import { fakeDb } from "../lifecycle/fakeDb";

const REFRESH = "1//0refresh-token-value-abcdef";
const ACCESS = "ya29.a0access-token-value";
const config = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "GOCSPX-secret-value" };
const NOW = new Date("2026-11-03T10:00:00.000Z");
afterEach(() => vi.restoreAllMocks());

const tokenFetch = (answer: { status: number; body: unknown }) => {
  const calls: Array<{ url: string; body: string }> = [];
  const f = async (url: string, init?: RequestInit) => {
    calls.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };
  return { f, calls };
};

describe("connecting", () => {
  it("asks Google for offline access to the files the app makes, with PKCE, as ai@moburst.com", async () => {
    const p = await makePkce();
    const u = new URL(authorizeUrl({ clientId: config.clientId, redirectUri: "https://x.supabase.co/functions/v1/google-auth", state: p.state, challenge: p.challenge }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: "code", access_type: "offline", prompt: "consent", login_hint: "ai@moburst.com", code_challenge_method: "S256",
      scope: "https://www.googleapis.com/auth/drive.file openid email",
    });
    expect(SCOPES).not.toContain("https://www.googleapis.com/auth/drive");
    expect(DECK_ACCOUNT).toBe("ai@moburst.com");
  });

  it("needs both secrets Lital adds", () => {
    expect(googleConfig(() => undefined)).toBeNull();
    expect(googleConfig((k) => (k === "GOOGLE_OAUTH_CLIENT_ID" ? "id" : undefined))).toBeNull();
    expect(googleConfig((k) => ({ GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "s" } as Record<string, string>)[k])).toEqual({ clientId: "id", clientSecret: "s" });
  });

  it("reads who signed in only from an ID token for this client with a verified email", () => {
    const token = (claims: Record<string, unknown>) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
    expect(signedInEmail(token({ aud: config.clientId, email: "AI@moburst.com", email_verified: true }), config.clientId)).toBe("ai@moburst.com");
    expect(signedInEmail(token({ aud: "other", email: "ai@moburst.com", email_verified: true }), config.clientId)).toBeNull();
    expect(signedInEmail(token({ aud: config.clientId, email: "ai@moburst.com", email_verified: false }), config.clientId)).toBeNull();
    expect(signedInEmail(undefined, config.clientId)).toBeNull();
  });
});

describe("an access token for one piece of work", () => {
  it("reads the refresh token only through the service-role function and exchanges it, storing nothing", async () => {
    const db = fakeDb({ google_connection: [{ id: true, connected_at: "2026-11-01T00:00:00Z", last_used_at: null }] }, { google_token_read: () => REFRESH });
    const t = tokenFetch({ status: 200, body: { access_token: ACCESS, expires_in: 3599 } });
    expect(await googleAccessToken(db, config, NOW, t.f)).toBe(ACCESS);
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["google_token_read"]);
    expect(t.calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(new URLSearchParams(t.calls[0].body))).toEqual({ client_id: config.clientId, client_secret: config.clientSecret, refresh_token: REFRESH, grant_type: "refresh_token" });
    expect(JSON.stringify(db.tables)).not.toContain(ACCESS);
    expect(JSON.stringify(db.tables)).not.toContain(REFRESH);
    expect(db.tables.google_connection[0].last_used_at).toBe(NOW.toISOString());
  });

  it("never puts a token in an error or a log line", async () => {
    const logs: string[] = [];
    for (const m of ["log", "warn", "error"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); });
    const db = fakeDb({ google_connection: [{ id: true, connected_at: "x" }] }, { google_token_read: () => REFRESH });
    const t = tokenFetch({ status: 500, body: { error: "server_error", error_description: `could not use ${REFRESH} with ${config.clientSecret}` } });
    const err = await googleAccessToken(db, config, NOW, t.f).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toContain(REFRESH);
    expect((err as Error).message).not.toContain(config.clientSecret);
    expect(logs.join("\n")).not.toContain(REFRESH);
    expect(redact(`Bearer ${ACCESS} and ${REFRESH}`, [])).toBe("Bearer [redacted] and [redacted]");
  });

  it("takes away a sign-in Google no longer accepts, so the screens say Google is not connected", async () => {
    const db = fakeDb({ google_connection: [{ id: true, connected_at: "2026-11-01T00:00:00Z" }] }, { google_token_read: () => REFRESH, google_token_clear: () => null });
    const t = tokenFetch({ status: 400, body: { error: "invalid_grant" } });
    await expect(googleAccessToken(db, config, NOW, t.f)).rejects.toBeInstanceOf(GoogleNotConnected);
    expect(db.rpcCalls.map((c) => c.name)).toEqual(["google_token_read", "google_token_clear"]);
    expect(db.tables.google_connection[0].connected_at).toBeNull();
  });

  it("is not connected with no secrets or no stored sign-in", async () => {
    await expect(googleAccessToken(fakeDb({}), null, NOW)).rejects.toBeInstanceOf(GoogleNotConnected);
    await expect(googleAccessToken(fakeDb({}, { google_token_read: () => null }), config, NOW)).rejects.toBeInstanceOf(GoogleNotConnected);
  });

  it("uses the sign-in once a week so Google keeps it", async () => {
    const t = tokenFetch({ status: 200, body: { access_token: ACCESS } });
    const db = (last: string) => fakeDb({ google_connection: [{ id: true, connected_at: "2026-10-01T00:00:00Z", last_used_at: last }] }, { google_token_read: () => REFRESH });
    expect(await keepAlive(db("2026-11-01T00:00:00Z"), config, NOW, t.f)).toBe(false);
    expect(await keepAlive(db("2026-10-20T00:00:00Z"), config, NOW, t.f)).toBe(true);
    expect(await keepAlive(fakeDb({ google_connection: [{ id: true, connected_at: null }] }), config, NOW, t.f)).toBe(false);
  });
});
