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
// The refresh and access tokens live in Vault, through higgsfield_tokens_save
// and higgsfield_tokens_read (service role only), the way Google's do. What
// is not secret stays on the integration_tokens row (RLS on, no policies):
// the client id, the account, when the token expires, when a person linked
// it, and when a server refresh last worked and last was refused. It must
// never move to app_settings, which every staff session can read.

import { AuthzError } from "../auth/authz.ts";
import { returnOriginFor, settingsUrl } from "../auth/appOrigin.ts";
import { McpClient } from "./mcp.ts";

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

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the service-role client, typed loosely as the other shared helpers do
type Db = any;

/** The provider no longer accepts the refresh token: only signing in again helps. */
export class TokenRefused extends Error {}

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

/**
 * How long the token endpoint is given. QA 22 Nov 2026: the call had no limit,
 * so a slow answer outlived the 30-second refresh lease and a second caller
 * spent the same refresh token. Well inside the lease (LEASE_MS).
 */
export const TOKEN_TIMEOUT_MS = 15_000;

async function postToken(body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TOKEN_TIMEOUT_MS);
  let resp: Response;
  let text: string;
  try {
    resp = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
      signal: ctrl.signal,
    });
    text = await resp.text();
  } catch (e) {
    if (ctrl.signal.aborted) throw new Error("The Higgsfield token endpoint did not answer in time.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const message = `Token endpoint ${resp.status}: ${text.slice(0, 300)}`;
    // A refusal of the grant itself (400, 401, 403) is final; a busy or broken provider is not.
    throw [400, 401, 403].includes(resp.status) ? new TokenRefused(message) : new Error(message);
  }
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

/** The PostgREST answer for a function the database does not have (yet). */
function missingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|function .* does not exist/i.test(error.message ?? "");
}

/**
 * The tokens. A pair on the integration_tokens columns is the newer one (the
 * code that ran before the Vault move keeps rotating it there, and a save
 * through Vault empties the columns in the same transaction), so it is read
 * first; otherwise Vault. This lets either half of the release ship first.
 * Null when nothing was ever stored.
 */
export async function readTokens(db: Db): Promise<{ refresh_token: string | null; access_token: string | null } | null> {
  const { data: legacy } = await db.from("integration_tokens").select("refresh_token, access_token").eq("provider", PROVIDER).maybeSingle();
  if (legacy?.refresh_token) return { refresh_token: legacy.refresh_token, access_token: legacy.access_token ?? null };
  const { data, error } = await db.rpc("higgsfield_tokens_read");
  if (error) {
    // Functions deployed before the migration: nothing is in Vault yet, so nothing is stored.
    if (missingFunction(error)) return null;
    throw new Error(`Could not read the Higgsfield tokens: ${error.message}`);
  }
  if (!data) return null;
  return { refresh_token: data.refresh_token ?? null, access_token: data.access_token ?? null };
}

/**
 * Both tokens to Vault in one call, so a rotated refresh token and its access
 * token are never kept apart; the call empties the plain columns in the same
 * transaction. Before the migration has run there is no Vault function, and
 * the pair goes to the columns, which readTokens reads.
 */
export async function saveTokens(db: Db, tokens: { refresh_token: string; access_token: string }): Promise<void> {
  const { error } = await db.rpc("higgsfield_tokens_save", { p_refresh: tokens.refresh_token, p_access: tokens.access_token });
  if (!error) return;
  if (!missingFunction(error)) throw new Error(`Could not keep the Higgsfield tokens: ${error.message}`);
  const { error: columnsError } = await db.from("integration_tokens").update({ refresh_token: tokens.refresh_token, access_token: tokens.access_token }).eq("provider", PROVIDER);
  if (columnsError) throw new Error(`Could not keep the Higgsfield tokens: ${columnsError.message}`);
}

/** How long one caller may hold the refresh, and how often a waiting caller looks again. */
const LEASE_MS = 30_000;
const WAIT_MS = 1_500;
const WAIT_TRIES = 12;
/** Tries of keeping a rotated pair, and the pause between them. */
const SAVE_TRIES = 3;
const SAVE_PAUSE_MS = 500;

/**
 * Claim the right to refresh, the way the Canva path does with
 * refreshing_until: two simple claims (nobody holds it, or the hold ran out),
 * each one atomic in the database.
 */
async function claimRefresh(supabase: Db, now: Date): Promise<string | null> {
  const until = new Date(now.getTime() + LEASE_MS).toISOString();
  const free = await supabase.from("integration_tokens").update({ refreshing_until: until }).eq("provider", PROVIDER).is("refreshing_until", null).select("provider");
  if (free.data?.length) return until;
  const expired = await supabase.from("integration_tokens").update({ refreshing_until: until }).eq("provider", PROVIDER).lt("refreshing_until", now.toISOString()).select("provider");
  return expired.data?.length ? until : null;
}

/** The lease renewed for one more LEASE_MS, only while it is still the one this caller holds: the new value, or null when another caller holds it by now. */
async function keepRefresh(supabase: Db, until: string): Promise<string | null> {
  const next = new Date(Date.now() + LEASE_MS).toISOString();
  const kept = await supabase.from("integration_tokens").update({ refreshing_until: next }).eq("provider", PROVIDER).eq("refreshing_until", until).select("provider");
  // A write that did not get through says nothing about who holds the lease: this caller still keeps its rotated
  // pair, whose refresh token is the only live one (P53-09). Only a lease known to be another caller's is left to them.
  if (kept.error) return until;
  return kept.data?.length ? next : null;
}

/**
 * A usable access token, refreshing when needed.
 *
 * Refresh tokens rotate, and the provider may revoke the whole family when an
 * old one is spent, so one caller refreshes at a time: it claims
 * refreshing_until, and any other caller waits for it and reads what it
 * stored. The new refresh token is kept in Vault in the same call as the
 * access token, so a crash between the two cannot strand the session. Each
 * refresh leaves its result on the row (last_refresh_ok_at, or
 * last_refresh_refused_at when the provider refused the token), which is what
 * Settings reads to say whether the link still works.
 */
export async function accessTokenFor(
  supabase: Db,
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  /** An access token Higgsfield has just rejected (McpClient, on a 401): while the stored one is still it, it is refreshed whatever its expiry says. */
  rejected?: string,
): Promise<string> {
  const stale = (t: { access_token: string | null } | null | undefined, expires_at: string | null | undefined) =>
    !t?.access_token || needsRefresh({ access_token: t.access_token, expires_at: expires_at ?? null }) || (!!rejected && t.access_token === rejected);
  const read = async () => {
    const { data: row } = await supabase
      .from("integration_tokens")
      .select("provider, account_email, client_id, expires_at")
      .eq("provider", PROVIDER)
      .maybeSingle();
    return { row, tokens: await readTokens(supabase) };
  };
  for (let attempt = 0; attempt < WAIT_TRIES; attempt++) {
    const { row, tokens } = await read();
    if (!tokens?.refresh_token || !row?.client_id) {
      throw new Error("Higgsfield is not connected. An admin needs to link the team account in Settings.");
    }
    if (!stale(tokens, row.expires_at)) return tokens.access_token as string;

    let until = await claimRefresh(supabase, new Date());
    if (!until) {
      await sleep(WAIT_MS);
      continue;
    }
    // QA 22 Nov 2026: only this caller's own lease is let go; one that ran out and was taken by another caller is theirs.
    const release = () => (until ? supabase.from("integration_tokens").update({ refreshing_until: null }).eq("provider", PROVIDER).eq("refreshing_until", until) : Promise.resolve());
    try {
      // The holder before us may have finished between our read and our claim.
      const latest = await read();
      if (latest.tokens?.refresh_token && !stale(latest.tokens, latest.row?.expires_at)) {
        return latest.tokens.access_token as string;
      }
      const current = latest.tokens?.refresh_token ? latest.tokens : tokens;
      let grant: TokenResponse;
      try {
        grant = await refresh({ clientId: row.client_id, refreshToken: current.refresh_token as string }, fetchImpl);
      } catch (e) {
        if (e instanceof TokenRefused) {
          // A caller outside this lease (an older deploy) may have rotated the token a moment ago, which makes ours the old one; that is not a refusal.
          const again = await read();
          if (again.tokens?.refresh_token && again.tokens.refresh_token !== current.refresh_token && !stale(again.tokens, again.row?.expires_at)) {
            return again.tokens.access_token as string;
          }
          await supabase.from("integration_tokens").update({ last_refresh_refused_at: new Date().toISOString() }).eq("provider", PROVIDER);
        }
        throw e;
      }
      // The pair is kept only while the lease is still this caller's: a caller that took it over meanwhile keeps
      // the newer pair, and this one's older pair never lands over it (QA 22 Nov 2026). Its access token still works.
      until = await keepRefresh(supabase, until);
      if (!until) return grant.access_token;
      // The provider has already rotated the token: a save that fails once is
      // tried again, since the old token is spent and a lost new one stops
      // every video until an admin links Higgsfield again (QA 22 Nov 2026, P53-09).
      const pair = { refresh_token: grant.refresh_token ?? (current.refresh_token as string), access_token: grant.access_token };
      for (let save = 1; ; save++) {
        try {
          await saveTokens(supabase, pair);
          break;
        } catch (e) {
          if (save >= SAVE_TRIES) {
            console.error("[higgsfield] the rotated tokens could not be kept; the team account may need linking again:", e instanceof Error ? e.message : e);
            throw e;
          }
          await sleep(SAVE_PAUSE_MS);
        }
      }
      const now = new Date().toISOString();
      await supabase.from("integration_tokens").update({ expires_at: expiryFrom(grant.expires_in), last_refresh_ok_at: now, updated_at: now }).eq("provider", PROVIDER);
      return grant.access_token;
    } finally {
      await release();
    }
  }
  throw new Error("The Higgsfield token refresh is held by another run; try again shortly.");
}

/** What Settings shows: linked and working, linked but refused by Higgsfield (needs a new sign-in), or not linked. */
export interface LinkStatus {
  linked: boolean;
  needs_sign_in: boolean;
  account_email: string | null;
  linked_at: string | null;
}

const when = (v: unknown): number => (v ? Date.parse(String(v)) : NaN);

/** True when the last refresh was refused and nothing has worked since. */
export function refusedSinceLastWorked(row: { last_refresh_ok_at?: string | null; last_refresh_refused_at?: string | null } | null | undefined): boolean {
  const refused = when(row?.last_refresh_refused_at);
  if (!Number.isFinite(refused)) return false;
  const ok = when(row?.last_refresh_ok_at);
  return !Number.isFinite(ok) || refused > ok;
}

/**
 * Whether the link works, found by trying the token (accessTokenFor refreshes
 * only an expired one, and a refresh is free). A provider that is only busy
 * leaves the record as it was.
 */
export async function linkStatus(db: Db, fetchImpl: typeof fetch = fetch): Promise<LinkStatus> {
  const held = await readTokens(db);
  if (!held?.refresh_token) return { linked: false, needs_sign_in: false, account_email: null, linked_at: null };
  try {
    await accessTokenFor(db, fetchImpl);
  } catch (e) {
    if (!(e instanceof TokenRefused)) console.warn("[higgsfield-auth] the token was not tried", e instanceof Error ? e.message : String(e));
  }
  const { data: row } = await db
    .from("integration_tokens")
    .select("account_email, linked_at, last_refresh_ok_at, last_refresh_refused_at")
    .eq("provider", PROVIDER)
    .maybeSingle();
  const needsSignIn = refusedSinceLastWorked(row);
  return { linked: !needsSignIn, needs_sign_in: needsSignIn, account_email: row?.account_email || null, linked_at: row?.linked_at || null };
}

// ── The higgsfield-auth function's requests ────────────────────────────────
//
//   POST {action:"start"}   admin only. Returns the URL to open.
//   GET  ?code=...&state=.. the redirect back from Clerk. No auth header (a
//                           browser follows it), so `state` is the proof.
//   POST {action:"status"}  staff. Whether it is linked and working, and to whom.
//
// Here rather than in the function's index.ts so a test can drive it with a
// fake database and a fake provider.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** An authorisation left half-finished should not be usable for ever. */
export const PENDING_TTL_MS = 15 * 60 * 1000;

/** The one sentence any unexpected failure answers with; the cause goes to the log. */
export const UNEXPECTED_FAILURE = "The Higgsfield connection could not be read.";

export interface AuthDeps {
  db: Db;
  /** Throws AuthzError unless the caller is Moburst staff. */
  requireStaff: (req: Request) => Promise<{ isAdmin: () => Promise<boolean> }>;
  env: (key: string) => string | undefined;
  fetch?: typeof fetch;
  now?: () => Date;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export async function handleAuthRequest(req: Request, deps: AuthDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const { db, env } = deps;
  const f = deps.fetch ?? fetch;
  const now = () => (deps.now ? deps.now() : new Date());
  const redirectUri = `${env("SUPABASE_URL")}/functions/v1/higgsfield-auth`;

  try {
    const url = new URL(req.url);

    // ── The callback. A browser follows it, so there is no JWT; the state
    //    we generated and stored is what proves this is our redirect. Every
    //    exit is a redirect to the app, on the address the sign-in started from
    //    (Supabase serves html from *.supabase.co as plain text, so the app
    //    shows the outcome).
    if (req.method === "GET" && (url.searchParams.get("code") || url.searchParams.get("error"))) {
      const { data: row } = await db
        .from("integration_tokens")
        .select("client_id, pending_state, pending_verifier, pending_started_at, pending_return_origin")
        .eq("provider", PROVIDER)
        .maybeSingle();
      const origin = returnOriginFor(row?.pending_return_origin, env);
      const back = (status: "linked" | "failed", reason?: string) =>
        new Response(null, { status: 302, headers: { ...corsHeaders, Location: settingsUrl(origin, { higgsfield: status, reason }, env) } });

      if (url.searchParams.get("error")) return back("failed", "refused");
      const code = url.searchParams.get("code")!;
      const state = url.searchParams.get("state") || "";
      if (!row?.pending_state || !row.pending_verifier || !state || state !== row.pending_state) return back("failed", "bad_state");
      const startedAt = row.pending_started_at ? new Date(row.pending_started_at).getTime() : 0;
      if (!startedAt || now().getTime() - startedAt > PENDING_TTL_MS) return back("failed", "expired");

      let grant: TokenResponse & { id_token?: string };
      try {
        grant = await exchangeCode({ clientId: row.client_id, code, verifier: row.pending_verifier, redirectUri }, f);
      } catch (e) {
        console.error("[higgsfield-auth] token exchange failed:", e instanceof Error ? e.message : e);
        return back("failed", "exchange_failed");
      }
      if (!grant.refresh_token) return back("failed", "no_refresh_token");

      // Who this is, so the screen can say which account is linked. The id
      // token is informational here; the refresh token is the credential.
      let email: string | null = null;
      try {
        const claims = JSON.parse(atob(String(grant.id_token || "").split(".")[1] || "")) as { email?: string };
        email = claims?.email || null;
      } catch {
        email = null;
      }

      try {
        await saveTokens(db, { refresh_token: grant.refresh_token, access_token: grant.access_token });
      } catch (e) {
        console.error("[higgsfield-auth] could not store the grant:", e instanceof Error ? e.message : e);
        return back("failed", "not_saved");
      }
      const at = now().toISOString();
      const { error: saveErr } = await db
        .from("integration_tokens")
        .update({
          expires_at: expiryFrom(grant.expires_in, now().getTime()),
          account_email: email,
          // Distinct from updated_at, which every token refresh bumps: the
          // only column that records when a person actually signed in.
          linked_at: at,
          // A new sign-in works as of now, which settles any earlier refusal.
          last_refresh_ok_at: at,
          pending_state: null,
          pending_verifier: null,
          pending_started_at: null,
          pending_return_origin: null,
          updated_at: at,
        })
        .eq("provider", PROVIDER);
      if (saveErr) {
        console.error("[higgsfield-auth] could not store the grant:", saveErr.message);
        return back("failed", "not_saved");
      }
      // The account is deliberately not put in the URL; the page asks for it.
      return back("linked");
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = body?.action || "status";

    if (action === "status") {
      await deps.requireStaff(req);
      return json(await linkStatus(db, f));
    }

    if (action === "start") {
      const caller = await deps.requireStaff(req);
      if (!(await caller.isAdmin())) return json({ error: "Linking the team's Higgsfield account is an admin action." }, 403);

      // Reuse the registered client if we have one; Clerk issues a public
      // client per redirect URI and there is no reason to make more.
      const { data: existing } = await db.from("integration_tokens").select("client_id").eq("provider", PROVIDER).maybeSingle();
      const clientId = existing?.client_id || (await registerClient(redirectUri, f));

      const { verifier, challenge } = await makePkce();
      const state = randomState();
      const { error } = await db.from("integration_tokens").upsert(
        {
          provider: PROVIDER,
          client_id: clientId,
          pending_state: state,
          pending_verifier: verifier,
          pending_started_at: now().toISOString(),
          // The address the person started from; the callback goes back to it.
          pending_return_origin: returnOriginFor(req.headers.get("origin"), env),
          updated_at: now().toISOString(),
        },
        { onConflict: "provider" },
      );
      if (error) throw new Error(`Could not start the Higgsfield sign-in: ${error.message}`);

      return json({
        authorize_url: authorizeUrl({ clientId, redirectUri, challenge, state }),
        expires_in_minutes: PENDING_TTL_MS / 60000,
        sign_in_as: "social-team@moburst.com",
      });
    }

    return json({ error: `Unknown action '${action}'` }, 400);
  } catch (err) {
    if (err instanceof AuthzError) return json({ error: err.message }, err.status);
    console.error("[higgsfield-auth]", err instanceof Error ? err.message : String(err));
    return json({ error: UNEXPECTED_FAILURE }, 500);
  }
}

/**
 * A Higgsfield MCP client for the team's session. QA 22 Nov 2026: a caller
 * holds one client for a whole render (up to two minutes), longer than the
 * minute before expiry a token is refreshed at, so a token could run out
 * mid-render and the paid image was lost with an error asking for a new
 * sign-in. Higgsfield's 401 now gets one refresh of that token and the call
 * is sent again.
 */
export async function higgsfieldMcp(supabase: Db, timeoutMs = 30_000): Promise<McpClient> {
  return new McpClient({
    url: MCP_URL,
    accessToken: await accessTokenFor(supabase),
    timeoutMs,
    renewToken: (rejected) => accessTokenFor(supabase, undefined, undefined, rejected),
  });
}
