// server/src/call.ts
//
// How the service knows a call is ours, with no shared secret (16 Nov 2026).
// The worker opens a call in the database before each attempt and sends its
// id; the service asks the database to claim that id (claim_picture_call,
// migration 20261116100000). A claim is true once, and only within 120
// seconds of the call being opened, so an id cannot be replayed, nobody types
// a secret in anywhere and there is nothing to rotate.
//
// The claim goes through the project's public REST endpoint with the public
// anon key. Both are public values the app already ships to every browser,
// and they are imported from the repository's one public values file, so the
// service has no environment variable and holds nothing to keep.

import { PUBLIC_DEFAULTS } from "../../public-env.ts";

/** How long the service waits for the database's answer. A claim is one indexed update; a database slower than this is treated as not answering, and the worker waits. */
export const CLAIM_TIMEOUT_MS = 5_000;

const CLAIM_URL = `${PUBLIC_DEFAULTS.VITE_SUPABASE_URL}/rest/v1/rpc/claim_picture_call`;
const ANON_KEY = PUBLIC_DEFAULTS.VITE_SUPABASE_PUBLISHABLE_KEY;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a value shaped like a call's id. Anything else is refused without a database call. */
export function isCallId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Asks the database to claim a call: true or false as it answered. Throws when it did not answer with one of the two. */
export type ClaimCall = (id: string) => Promise<boolean>;

/** The claim against the product's database. Its errors name a status or a kind of failure, never the id or the key. */
export function databaseClaim(fetchImpl: typeof fetch = fetch, timeoutMs = CLAIM_TIMEOUT_MS): ClaimCall {
  return async (id) => {
    let res: Response;
    try {
      res = await fetchImpl(CLAIM_URL, {
        method: "POST",
        headers: { apikey: ANON_KEY, authorization: `Bearer ${ANON_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ p_call: id }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      const how = name === "TimeoutError" || name === "AbortError" ? "timeout" : err instanceof Error ? err.message.replace(/\.+$/, "") : "unknown";
      throw new Error(`The database could not be reached: ${how}.`);
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`The database answered ${res.status}.`);
    }
    const answer: unknown = await res.json().catch(() => undefined);
    if (typeof answer !== "boolean") throw new Error("The database gave an answer that is not true or false.");
    return answer;
  };
}
