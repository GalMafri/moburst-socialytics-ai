// The paying desk in tests: a meter over an in-memory sink, credentials
// skipped (the code under test no longer holds a key), so a test that stubs
// fetch sees the provider request as the feature sent it.
//
// supabase/tests/paid/setup.ts installs one before every test file, sending
// through the global fetch at call time (vi.stubGlobal("fetch", ...) works as
// it always did). A test that wants its own fetch, or the rows recorded,
// calls useTestMeter itself.
import { createMeter, type CostEventRow } from "../../functions/_shared/cost/meter";
import { PRICES } from "../../functions/_shared/cost/pricing";
import { SHARED_FEATURES } from "../../functions/_shared/paid/config";
import { costCtx, setMeterForTests } from "../../functions/_shared/paid/index";

import { ApifyTokenMissing } from "../../functions/_shared/apify/client";
import type { ApifyFactory } from "../../functions/_shared/pipelines/apifyStep";

type Send = (url: string, init?: RequestInit) => Promise<Response>;

/** A fake answer that is not a Response gets a clone the meter can read (as nothing), so the feature still sees its fake. */
function readable(r: Response): Response {
  if (r && typeof (r as { clone?: unknown }).clone !== "function") {
    try {
      (r as unknown as { clone: () => Response }).clone = () => new Response(null, { status: 204 });
    } catch {
      /* a frozen fake: the meter's read fails, is logged, and the answer still goes back */
    }
  }
  return r;
}

/**
 * Installs a test meter. Calls go to `send`, else to the global fetch as it is
 * when the call is made. Returns the rows it records. With `auth: true` the
 * desk reads credentials as in production (from a stubbed Deno.env), so a
 * test can see a missing key: ProviderKeyMissing for a provider with no
 * app_settings fallback (Apify, Firecrawl, Gamma, Higgsfield); for the
 * others use hasKey, which reads false where no key is stubbed.
 */
export function useTestMeter(send?: Send, opts: { auth?: boolean } = {}): CostEventRow[] {
  const rows: CostEventRow[] = [];
  setMeterForTests(createMeter({
    tool: "socialytics",
    env: "test",
    sink: { insert: async (r) => { rows.push(...r); } },
    prices: PRICES,
    sharedFeatures: SHARED_FEATURES,
    fetch: async (url: string, init?: RequestInit) => readable(await (send ?? globalThis.fetch)(url, init)),
    log: () => {},
  }), { skipAuth: !opts.auth });
  return rows;
}

/** A context for tests that call a paid helper directly and do not look at attribution. */
export const TEST_COST = costCtx({ clientId: "test-client", feature: "test.call", actor: "system" });

/** For a test that used to hand a pipeline its own fetch for Claude: the desk sends there instead. Spread into the deps (it adds nothing). */
export function viaTestMeter(send: Send): Record<string, never> {
  useTestMeter(send);
  return {};
}

/**
 * A fake Apify factory that, like the real client behind the desk, has no run
 * to offer while the token is not set (env says so): every call throws
 * ApifyTokenMissing, which a step turns into its quiet wait.
 */
export function apifyWhenToken(env: (name: string) => string | undefined, factory: ApifyFactory): ApifyFactory {
  const missing = async (): Promise<never> => { throw new ApifyTokenMissing(); };
  return (o) => (env("APIFY_API_TOKEN") ? factory(o) : { startRun: missing, getRun: missing, datasetPage: missing, datasetItems: missing });
}
