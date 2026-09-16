// The Sprout Social customer (account) the app talks to.
//
// The id was written out as a literal in four edge functions and two screens.
// It is not a secret, but it is a single account identity duplicated six ways:
// the day Moburst holds a second Sprout account, or moves this one, each copy
// is a separate silent failure pointing at the wrong customer's profiles.
//
// A client row may name its own; this is only the fallback, and the env var
// lets it move without a code change.
export const FALLBACK_SPROUT_CUSTOMER_ID = "1676448";

// Reached through globalThis so the module also typechecks in the app's
// tsconfig, which does not know about Deno and pulls this file in through the
// shared payload builder its tests import.
export function defaultSproutCustomerId(): string {
  const env = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
  const fromEnv = typeof env?.get === "function" ? env.get("SPROUT_CUSTOMER_ID") : undefined;
  return fromEnv || FALLBACK_SPROUT_CUSTOMER_ID;
}
