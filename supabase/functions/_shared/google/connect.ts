// supabase/functions/_shared/google/connect.ts
//
// Connecting the Google account the strategy decks are made in, once, from
// Settings (the google-auth edge function): start a sign-in, finish it when
// Google sends the browser back, and say whether it is connected. Nothing
// here returns a token; the refresh token goes straight to Vault.

import { authorizeUrl, DECK_ACCOUNT, exchangeCode, makePkce, signedInEmail, type GoogleConfig } from "./oauth.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A sign-in left half-finished is not usable for ever. */
export const PENDING_TTL_MS = 15 * 60_000;

export interface GoogleStatus {
  /** The OAuth client is set up (Lital's one-time Google Cloud steps). */
  ready: boolean;
  connected: boolean;
  account_email: string | null;
  connected_at: string | null;
}

export async function googleStatus(db: Db, config: GoogleConfig | null): Promise<GoogleStatus> {
  const { data, error } = await db.from("google_connection").select("account_email, connected_at").eq("id", true).maybeSingle();
  if (error) throw new Error(`Could not read the Google connection: ${error.message}`);
  const connected = !!config && !!data?.connected_at;
  return { ready: !!config, connected, account_email: connected ? data.account_email ?? null : null, connected_at: connected ? data.connected_at : null };
}

/** A new sign-in: its state and verifier kept on the connection row, and the link to open. */
export async function startSignIn(db: Db, config: GoogleConfig, redirectUri: string, now: Date): Promise<string> {
  const p = await makePkce();
  const { error } = await db.from("google_connection").upsert({
    id: true, pending_state: p.state, pending_verifier: p.verifier, pending_started_at: now.toISOString(), updated_at: now.toISOString(),
  }, { onConflict: "id" });
  if (error) throw new Error(`Could not start the Google sign-in: ${error.message}`);
  return authorizeUrl({ clientId: config.clientId, redirectUri, state: p.state, challenge: p.challenge });
}

export type SignInOutcome = "connected" | "refused" | "bad_state" | "expired" | "exchange_failed" | "no_refresh_token" | "wrong_account" | "not_saved";

/** Google sent the browser back: check the state, exchange the code, keep the refresh token in Vault. */
export async function finishSignIn(db: Db, config: GoogleConfig, a: { code: string | null; state: string | null; error: string | null; redirectUri: string }, now: Date, f: Fetch = fetch): Promise<SignInOutcome> {
  if (a.error || !a.code) return "refused";
  const { data: row } = await db.from("google_connection").select("pending_state, pending_verifier, pending_started_at").eq("id", true).maybeSingle();
  if (!row?.pending_state || !row.pending_verifier || !a.state || a.state !== row.pending_state) return "bad_state";
  const started = Date.parse(row.pending_started_at ?? "");
  if (!Number.isFinite(started) || now.getTime() - started > PENDING_TTL_MS) return "expired";
  // The state is spent whatever happens next.
  await db.from("google_connection").update({ pending_state: null, pending_verifier: null, pending_started_at: null, updated_at: now.toISOString() }).eq("id", true);
  let grant;
  try {
    grant = await exchangeCode(config, { code: a.code, verifier: row.pending_verifier, redirectUri: a.redirectUri }, f);
  } catch (e) {
    console.warn("[google-auth] the code was not exchanged", e instanceof Error ? e.message : String(e));
    return "exchange_failed";
  }
  if (!grant.refresh_token) return "no_refresh_token";
  const email = signedInEmail(grant.id_token, config.clientId);
  if (email !== DECK_ACCOUNT) return "wrong_account";
  const { error: saveError } = await db.rpc("google_token_save", { p_token: grant.refresh_token });
  if (saveError) {
    console.warn("[google-auth] the sign-in was not kept", saveError.message);
    return "not_saved";
  }
  const { error } = await db.from("google_connection").update({ account_email: email, connected_at: now.toISOString(), last_used_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", true);
  if (error) return "not_saved";
  return "connected";
}
