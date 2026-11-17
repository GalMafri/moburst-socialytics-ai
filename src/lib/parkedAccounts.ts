// Accounts Socialytics set aside for a client (staff only, on the setup page).
// A client has at most one own account on a network. When it held two, the
// account that an exact fact says is the brand's stays in use and the other
// is set aside, with the reason written on its row
// (sprout_profiles.parked_at and parked_reason; server:
// supabase/functions/_shared/lifecycle/accounts.ts). Nothing reads from or
// posts to an account that is set aside. This page says so, and a person can
// add it back.

/** A sprout_profiles row that was set aside, as the setup page reads it. */
export interface ParkedAccount {
  sprout_profile_id: number | string;
  profile_name: string | null;
  native_name: string | null;
  network_type: string | null;
  native_link: string | null;
  is_active: boolean | null;
  parked_at: string | null;
  parked_reason: string | null;
}

/** The rows that are set aside now: switched off, with the record of it on the row. */
export function parkedAccounts(rows: unknown): ParkedAccount[] {
  return (Array.isArray(rows) ? rows : []).filter((r): r is ParkedAccount => !!r && typeof r === "object" && (r as ParkedAccount).is_active === false && !!(r as ParkedAccount).parked_at);
}

/** Said when a row carries no reason of its own. */
export const PARKED_FALLBACK = "The brand's own account on this network is another one.";

/**
 * The one sentence under an account that is not used: why, and what a person
 * can do. The reason is the row's own ("The brand's own Facebook account is
 * ..."), written by the server in plain words.
 */
export function parkedLine(reason: string | null | undefined): string {
  const why = String(reason ?? "").trim() || PARKED_FALLBACK;
  const said = /[.!?]$/.test(why) ? why : `${why}.`;
  return `Not used: ${said.charAt(0).toLowerCase()}${said.slice(1)} Add it back to use this one instead.`;
}
