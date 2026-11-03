// supabase/functions/_shared/google/oauth.ts
//
// The one Google account strategy decks are made in (ai@moburst.com), signed
// in once with Google's documented OAuth 2.0 web server flow
// (https://developers.google.com/identity/protocols/oauth2/web-server): an
// authorization code with PKCE, offline access for a refresh token, and the
// limited per-file Drive scope (drive.file), which covers every file the app
// creates: the folder, the template and each copy.
//
// The refresh token lives in Supabase Vault and is read only through
// google_token_read, which only the service role may execute (migration
// 20261110130000_strategy_v2.sql). No response, log line or error text ever
// carries a token: errors are redacted here. An access token is minted for
// each piece of work and never stored.

// deno-lint-ignore no-explicit-any
type Db = any;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];
/** The account the decks are made in and shared from (Lital, 3 Nov 2026). */
export const DECK_ACCOUNT = "ai@moburst.com";
export const CLIENT_ID_ENV = "GOOGLE_OAUTH_CLIENT_ID";
export const CLIENT_SECRET_ENV = "GOOGLE_OAUTH_CLIENT_SECRET";

export interface GoogleConfig { clientId: string; clientSecret: string }

/** The OAuth client Lital adds as secrets; null until both are set. */
export function googleConfig(env: (k: string) => string | undefined): GoogleConfig | null {
  const clientId = String(env(CLIENT_ID_ENV) ?? "").trim();
  const clientSecret = String(env(CLIENT_SECRET_ENV) ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Google is not connected: no client, no stored sign-in, or a sign-in Google no longer accepts. */
export class GoogleNotConnected extends Error {
  constructor(message = "Google is not connected.") {
    super(message);
    this.name = "GoogleNotConnected";
  }
}

/** Every secret out of a piece of text. */
export function redact(text: string, secrets: Array<string | null | undefined>): string {
  let out = String(text ?? "");
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join("[redacted]");
  // Anything that looks like a Google token, whatever produced it.
  return out.replace(/\bya29\.[\w.-]+/g, "[redacted]").replace(/\b1\/\/[\w.-]+/g, "[redacted]");
}

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A PKCE verifier and its S256 challenge, and a state value. */
export async function makePkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)), state: b64url(crypto.getRandomValues(new Uint8Array(24))) };
}

export function authorizeUrl(a: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("client_id", a.clientId);
  u.searchParams.set("redirect_uri", a.redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  // A refresh token, every time someone connects, so connecting again always works.
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("login_hint", DECK_ACCOUNT);
  u.searchParams.set("state", a.state);
  u.searchParams.set("code_challenge", a.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export interface Grant { access_token: string; refresh_token?: string; expires_in?: number; id_token?: string; scope?: string }

async function postToken(body: Record<string, string>, secrets: string[], f: Fetch): Promise<Grant> {
  const res = await f(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString() });
  const text = await res.text();
  if (!res.ok) {
    let code = "";
    try { code = String(JSON.parse(text)?.error ?? ""); } catch { /* not JSON */ }
    if (code === "invalid_grant") throw new GoogleNotConnected("Google no longer accepts the stored sign-in.");
    throw new Error(`Google's token endpoint answered ${res.status}: ${redact(text, secrets).slice(0, 200)}`);
  }
  return JSON.parse(text) as Grant;
}

export function exchangeCode(c: GoogleConfig, a: { code: string; verifier: string; redirectUri: string }, f: Fetch = fetch): Promise<Grant> {
  return postToken({ code: a.code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: a.redirectUri, grant_type: "authorization_code", code_verifier: a.verifier }, [c.clientSecret, a.code], f);
}

export async function refreshAccess(c: GoogleConfig, refreshToken: string, f: Fetch = fetch): Promise<string> {
  const g = await postToken({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }, [c.clientSecret, refreshToken], f);
  if (!g.access_token) throw new Error("Google's token endpoint answered without an access token.");
  return g.access_token;
}

/**
 * Who signed in, from the ID token Google's token endpoint returned over TLS
 * (Google: a token received directly from it needs no signature check). Null
 * unless it is for this client and the email is verified.
 */
export function signedInEmail(idToken: string | undefined, clientId: string): string | null {
  try {
    const part = String(idToken ?? "").split(".")[1] ?? "";
    const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    if (claims?.aud !== clientId || claims?.email_verified !== true || !claims?.email) return null;
    return String(claims.email).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * An access token for one piece of work: the refresh token from Vault,
 * through the service-role-only function, exchanged at Google. Never stored.
 * A sign-in Google no longer accepts is taken away, so the screens say
 * plainly that Google is not connected.
 */
export async function googleAccessToken(db: Db, config: GoogleConfig | null, now: Date, f: Fetch = fetch): Promise<string> {
  if (!config) throw new GoogleNotConnected();
  const { data: refreshToken, error } = await db.rpc("google_token_read");
  if (error) throw new Error(`Could not read the Google sign-in: ${redact(error.message, [])}`);
  if (!refreshToken) throw new GoogleNotConnected();
  try {
    const token = await refreshAccess(config, String(refreshToken), f);
    await db.from("google_connection").update({ last_used_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", true);
    return token;
  } catch (e) {
    if (e instanceof GoogleNotConnected) {
      await db.rpc("google_token_clear");
      await db.from("google_connection").update({ connected_at: null, updated_at: now.toISOString() }).eq("id", true);
    }
    throw e instanceof Error ? Object.assign(e, { message: redact(e.message, [String(refreshToken), config.clientSecret]) }) : e;
  }
}

/** The weekly use that keeps the sign-in alive (Google drops a refresh token unused for six months). True when it ran. */
export async function keepAlive(db: Db, config: GoogleConfig | null, now: Date, f: Fetch = fetch): Promise<boolean> {
  if (!config) return false;
  const { data } = await db.from("google_connection").select("connected_at, last_used_at").eq("id", true).maybeSingle();
  if (!data?.connected_at) return false;
  const last = Date.parse(data.last_used_at ?? data.connected_at);
  if (Number.isFinite(last) && now.getTime() - last < 7 * 86_400_000) return false;
  await googleAccessToken(db, config, now, f);
  return true;
}
