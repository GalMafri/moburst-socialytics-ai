// supabase/functions/_shared/higgsfield/oauth.ts
//
// The team's Higgsfield session, held by the server.
//
// Higgsfield's MCP has no machine credential: its authorization server
// (Clerk) offers authorization_code and refresh_token, and no
// client_credentials grant. What it does offer is `offline_access`, so one
// person signs in once and the refresh token that comes back keeps the
// server going indefinitely.
//
// The credential lives in integration_tokens, which has RLS on and no
// policies, so only the service role can read it. It must never move to
// app_settings — that table is readable by every staff session.

export const CLERK_ISSUER = "https://clerk.higgsfield.ai";
export const AUTHORIZE_URL = `${CLERK_ISSUER}/oauth/authorize`;
export const TOKEN_URL = `${CLERK_ISSUER}/oauth/token`;
export const REGISTER_URL = `${CLERK_ISSUER}/oauth/register`;
export const MCP_URL = "https://mcp.higgsfield.ai/mcp";
export const SCOPES = "openid email offline_access";
export const PROVIDER = "higgsfield";

/** Refresh a little early, so a call never races the expiry. */
const EXPIRY_SKEW_MS = 60_000;

export interface StoredToken {
  provider: string;
  account_email: string | null;
  client_id: string | null;
  refresh_token: string | null;
  access_token: string | null;
  expires_at: string | null;
}

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A PKCE verifier and its S256 challenge. */
export async function makePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export function randomState(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

/** Register a public OAuth client for this deployment, once. */
export async function registerClient(redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const resp = await fetchImpl(REGISTER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Socialytics (Moburst)",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPES,
    }),
  });
  if (!resp.ok) throw new Error(`Client registration failed (${resp.status}): ${(await resp.text()).slice(0, 200)}`);
  const body = await resp.json();
  if (!body?.client_id) throw new Error("Client registration returned no client_id");
  return String(body.client_id);
}

export function authorizeUrl(args: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

async function postToken(body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const resp = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Token endpoint ${resp.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as TokenResponse;
}

export function exchangeCode(args: { clientId: string; code: string; verifier: string; redirectUri: string }, fetchImpl: typeof fetch = fetch) {
  return postToken({
    grant_type: "authorization_code",
    client_id: args.clientId,
    code: args.code,
    code_verifier: args.verifier,
    redirect_uri: args.redirectUri,
  }, fetchImpl);
}

export function refresh(args: { clientId: string; refreshToken: string }, fetchImpl: typeof fetch = fetch) {
  return postToken({
    grant_type: "refresh_token",
    client_id: args.clientId,
    refresh_token: args.refreshToken,
  }, fetchImpl);
}

/** True when the stored access token is missing or about to expire. */
export function needsRefresh(token: Pick<StoredToken, "access_token" | "expires_at">, now = Date.now()): boolean {
  if (!token.access_token) return true;
  if (!token.expires_at) return true;
  const expiry = new Date(token.expires_at).getTime();
  if (!Number.isFinite(expiry)) return true;
  return expiry - EXPIRY_SKEW_MS <= now;
}

/** When a refreshed token expires, from the grant's expires_in. */
export function expiryFrom(expiresIn: number | undefined, now = Date.now()): string {
  const seconds = Number.isFinite(expiresIn) && (expiresIn as number) > 0 ? (expiresIn as number) : 3600;
  return new Date(now + seconds * 1000).toISOString();
}

/**
 * A usable access token, refreshing when needed.
 *
 * Refresh tokens rotate: the new one is written back in the same update as
 * the access token, so a crash between the two cannot strand the session.
 */
export async function accessTokenFor(supabase: any, fetchImpl: typeof fetch = fetch): Promise<string> {
  const { data: row } = await supabase
    .from("integration_tokens")
    .select("provider, account_email, client_id, refresh_token, access_token, expires_at")
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (!row?.refresh_token || !row?.client_id) {
    throw new Error("Higgsfield is not connected. An admin needs to link the team account in Settings.");
  }
  if (!needsRefresh(row)) return row.access_token as string;

  const grant = await refresh({ clientId: row.client_id, refreshToken: row.refresh_token }, fetchImpl);
  const update: Record<string, unknown> = {
    access_token: grant.access_token,
    expires_at: expiryFrom(grant.expires_in),
    updated_at: new Date().toISOString(),
  };
  if (grant.refresh_token) update.refresh_token = grant.refresh_token;
  await supabase.from("integration_tokens").update(update).eq("provider", PROVIDER);
  return grant.access_token;
}
