// supabase/functions/_shared/canva/oauth.ts
//
// The team's Canva session, held by the server.
//
// Socialytics talks to Canva through its own Canva developer app: the REST
// API for uploads, Magic Layers and exports, and Canva MCP for layer edits.
// Both accept the same user token, so one sign-in covers both. A person
// signs in once (canva-finish {action:"connect"}); the refresh token that
// comes back keeps the server going.
//
// Canva's app is a confidential client: the token endpoint takes the app's
// client id and secret (CANVA_CLIENT_ID, CANVA_CLIENT_SECRET) as Basic auth.
// The grant lives in integration_tokens, which has RLS on and no policies,
// so only the service role reaches it.
//
// Canva rotates refresh tokens on every use. Two invocations refreshing with
// the same token at once would leave one of them holding a dead token, so a
// refresh first claims `refreshing_until`; whoever loses the claim waits and
// reads the token the winner wrote.

export const AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
export const TOKEN_URL = "https://api.canva.com/rest/v1/oauth/token";
export const SCOPES = [
  "asset:read", "asset:write", "brandtemplate:content:read", "brandtemplate:meta:read",
  "design:content:read", "design:content:write", "design:meta:read", "profile:read",
].join(" ");
export const PROVIDER = "canva";

const EXPIRY_SKEW_MS = 120_000;
const CLAIM_MS = 30_000;

export function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get("CANVA_CLIENT_ID");
  const clientSecret = Deno.env.get("CANVA_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Canva is not configured: CANVA_CLIENT_ID and CANVA_CLIENT_SECRET must be set.");
  return { clientId, clientSecret };
}

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export async function makePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

export function randomState(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(24)));
}

export function authorizeUrl(args: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", args.clientId);
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", SCOPES);
  u.searchParams.set("state", args.state);
  u.searchParams.set("code_challenge", args.challenge);
  u.searchParams.set("code_challenge_method", "s256");
  return u.toString();
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`Canva token endpoint ${resp.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as TokenResponse;
}

export function exchangeCode(args: { code: string; verifier: string; redirectUri: string }) {
  return postToken({ grant_type: "authorization_code", code: args.code, code_verifier: args.verifier, redirect_uri: args.redirectUri });
}

export function expiryFrom(expiresIn: number | undefined, now = Date.now()): string {
  const seconds = Number.isFinite(expiresIn) && (expiresIn as number) > 0 ? (expiresIn as number) : 3600;
  return new Date(now + seconds * 1000).toISOString();
}

function fresh(row: { access_token?: string | null; expires_at?: string | null }, now = Date.now()): boolean {
  if (!row.access_token || !row.expires_at) return false;
  const expiry = new Date(row.expires_at).getTime();
  return Number.isFinite(expiry) && expiry - EXPIRY_SKEW_MS > now;
}

/** A usable Canva access token, refreshing (once, across invocations) when needed. */
export async function accessTokenFor(supabase: any): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: row } = await supabase
      .from("integration_tokens")
      .select("refresh_token, access_token, expires_at, refreshing_until")
      .eq("provider", PROVIDER)
      .maybeSingle();
    if (!row?.refresh_token) throw new Error("Canva is not connected. An admin needs to link the team's Canva account.");
    if (fresh(row)) return row.access_token as string;

    const now = new Date();
    const { data: claimed } = await supabase
      .from("integration_tokens")
      .update({ refreshing_until: new Date(now.getTime() + CLAIM_MS).toISOString() })
      .eq("provider", PROVIDER)
      .eq("refresh_token", row.refresh_token)
      .or(`refreshing_until.is.null,refreshing_until.lt.${now.toISOString()}`)
      .select("provider");
    if (!claimed?.length) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    try {
      const grant = await postToken({ grant_type: "refresh_token", refresh_token: row.refresh_token });
      await supabase.from("integration_tokens").update({
        access_token: grant.access_token,
        refresh_token: grant.refresh_token || row.refresh_token,
        expires_at: expiryFrom(grant.expires_in),
        refreshing_until: null,
        updated_at: new Date().toISOString(),
      }).eq("provider", PROVIDER);
      return grant.access_token;
    } catch (e) {
      await supabase.from("integration_tokens").update({ refreshing_until: null }).eq("provider", PROVIDER);
      throw e;
    }
  }
  throw new Error("Canva token refresh is held by another run; try again shortly.");
}
