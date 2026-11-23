// supabase/functions/_shared/paid/index.ts
//
// The paying desk as Socialytics' edge functions use it. Every paid call goes
// through here:
//
//   import { paid, costCtx } from "../_shared/paid/index.ts";
//   const ctx = costCtx({ clientId, feature: "calendar.week_copy", actor: "schedule", executionId: job.id });
//   const res = await paid.fetch(ctx, "anthropic", "/v1/messages", { method: "POST", body });
//
// It adds the provider's credentials (feature code never reads a provider key),
// records the cost to cost_events, and returns the provider's answer. Keys come
// from the function's secrets first, then from app_settings, as the app always
// allowed. See CLAUDE.md, "Paid calls and cost tracking".
//
// Deno is only touched inside functions, so tests can import this module.

import type { Actor, CostContext } from "../cost/context.ts";
import type { ApifyWebhookTarget } from "../cost/apify.ts";
import { createMeter, type FetchOptions, type Meter, type RecordOptions } from "../cost/meter.ts";
import { PRICES } from "../cost/pricing.ts";
import type { ProviderId } from "../cost/registry.ts";
import { costSink, intentSink, type Db } from "../cost/store.ts";
import type { Usage } from "../cost/usage.ts";
import { SHARED_FEATURES, TOOL } from "./config.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const env = (name: string): string | undefined => {
  const d = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  return d?.env.get(name);
};

export class ProviderKeyMissing extends Error {
  constructor(public provider: ProviderId, public key: string) {
    super(`FINAL: ${key} is not set, so ${provider} cannot be called`);
    this.name = "ProviderKeyMissing";
  }
}

let dbPromise: Promise<Db> | null = null;

/** The service-role client, loaded on first use so tests that replace the meter never fetch it. */
function database(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const url = env("SUPABASE_URL");
      if (!url) throw new Error("SUPABASE_URL is not set, so costs cannot be recorded");
      return createClient(url, env("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } }) as unknown as Db;
    })();
  }
  return dbPromise;
}

/** A secret from the function's environment, else the app_settings rows named, in order. */
async function secret(provider: ProviderId, envNames: string[], settingNames: string[] = []): Promise<string> {
  for (const n of envNames) {
    const v = env(n);
    if (v) return v;
  }
  if (settingNames.length) {
    const db = await database();
    for (const key of settingNames) {
      const { data, error } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
      // A read that did not get through says nothing about the key: a plain (retried) error.
      if (error) throw new Error(`The ${provider} key could not be read: ${error.message ?? "unknown error"}`);
      if (data?.value) return String(data.value);
    }
  }
  throw new ProviderKeyMissing(provider, envNames[0]);
}

/** The credentials each provider takes, from this app's secrets. */
export async function authHeaders(provider: ProviderId): Promise<Record<string, string>> {
  switch (provider) {
    case "anthropic": return { "x-api-key": await secret(provider, ["ANTHROPIC_API_KEY"], ["anthropic_api_key"]), "anthropic-version": "2023-06-01" };
    case "openai": return { Authorization: `Bearer ${await secret(provider, ["OPENAI_API_KEY"], ["openai_api_key"])}` };
    case "gemini": return { "x-goog-api-key": await secret(provider, ["GEMINI_API_KEY", "GOOGLE_AI_API_KEY"], ["gemini_api_key", "google_ai_api_key"]) };
    case "apify": return { Authorization: `Bearer ${await secret(provider, ["APIFY_API_TOKEN"])}` };
    case "firecrawl": return { Authorization: `Bearer ${await secret(provider, ["FIRECRAWL_API_KEY"])}` };
    case "higgsfield": {
      const id = await secret(provider, ["HIGGSFIELD_API_KEY_ID"]);
      const sec = await secret(provider, ["HIGGSFIELD_API_KEY_SECRET"]);
      return { Authorization: `Key ${id}:${sec}` };
    }
    case "gamma": return { "X-API-KEY": await secret(provider, ["GAMMA_API_KEY"]) };
    case "jina": {
      const k = env("JINA_API_KEY");
      return k ? { Authorization: `Bearer ${k}` } : {};
    }
    default: throw new Error(`Socialytics has no credentials for ${provider}`);
  }
}

/**
 * Billing-API credentials for the daily reconciliation (cost/reconcile.ts):
 * the headers, or the name of the missing secret. Admin keys live only in the
 * function's secrets, never in app_settings.
 */
export function billingCredentials(provider: ProviderId): { headers: Record<string, string> } | { missing: string } {
  const pick = (name: string) => env(name);
  switch (provider) {
    case "anthropic": {
      const k = pick("ANTHROPIC_ADMIN_KEY");
      return k ? { headers: { "x-api-key": k } } : { missing: "ANTHROPIC_ADMIN_KEY" };
    }
    case "openai": {
      const k = pick("OPENAI_ADMIN_KEY");
      return k ? { headers: { Authorization: `Bearer ${k}` } } : { missing: "OPENAI_ADMIN_KEY" };
    }
    case "apify": {
      const k = pick("APIFY_API_TOKEN");
      return k ? { headers: { Authorization: `Bearer ${k}` } } : { missing: "APIFY_API_TOKEN" };
    }
    default: throw new Error(`Socialytics reads no billing API for ${provider}`);
  }
}

/** Whether a provider's credentials are set, for features that skip a step when they are not. */
export async function hasKey(provider: ProviderId): Promise<boolean> {
  try {
    await authHeaders(provider);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where Apify reports a finished run: this app's cost-apify-webhook function,
 * authenticated by COST_WEBHOOK_SECRET. Without the secret no webhook is
 * attached (the daily audit still finds the run).
 */
export function apifyWebhookTarget(): ApifyWebhookTarget | null {
  const secret = env("COST_WEBHOOK_SECRET");
  const base = env("SUPABASE_URL");
  if (!secret || !base) return null;
  return { url: `${base.replace(/\/+$/, "")}/functions/v1/cost-apify-webhook`, secret };
}

let meter: Meter | null = null;

async function theMeter(): Promise<Meter> {
  if (meter) return meter;
  const db = await database();
  meter = createMeter({
    tool: TOOL,
    env: env("COST_ENV") ?? "prod",
    sink: costSink(db),
    intents: intentSink(db),
    apifyWebhook: apifyWebhookTarget,
    prices: PRICES,
    sharedFeatures: SHARED_FEATURES,
    getEnv: env,
    waitUntil: typeof EdgeRuntime !== "undefined" ? (p) => EdgeRuntime!.waitUntil(p) : undefined,
  });
  return meter;
}

/** Tests replace the meter with one over a fake sink (and may skip credentials). */
export function setMeterForTests(m: Meter | null, opts: { skipAuth?: boolean } = {}): void {
  meter = m;
  skipAuth = !!opts.skipAuth;
}
let skipAuth = false;

async function withAuth(provider: ProviderId, init?: RequestInit): Promise<RequestInit> {
  if (skipAuth) return init ?? {};
  const headers = new Headers(init?.headers);
  // A call that already carries its own Authorization (Higgsfield's MCP, with
  // the team's OAuth token from higgsfield/oauth.ts) keeps it: the desk adds
  // nothing and does not ask for a key that call does not use.
  if (headers.has("authorization")) return { ...init, headers };
  for (const [k, v] of Object.entries(await authHeaders(provider))) if (!headers.has(k)) headers.set(k, v);
  return { ...init, headers };
}

export const paid = {
  /** Calls a paid provider and records what it cost. `path` is under the provider's base URL, or a full URL on its own host. */
  async fetch(ctx: CostContext, provider: ProviderId, path: string, init?: RequestInit, opts?: FetchOptions): Promise<Response> {
    const auth = await withAuth(provider, init);
    return (await theMeter()).fetch(ctx, provider, path, auth, opts);
  },
  /** Records a cost the meter cannot read from an answer (a Higgsfield generation's quoted price). True when the row is written. */
  async record(ctx: CostContext, provider: ProviderId, usage: Usage, opts?: RecordOptions): Promise<boolean> {
    return (await theMeter()).record(ctx, provider, usage, opts);
  },
};

/** A CostContext for Socialytics. clientId is required: pass null only for a feature on SHARED_FEATURES. */
export function costCtx(c: { clientId: string | null; feature: string; actor: Actor; executionId?: string | null; userId?: string | null; apiKeyId?: string | null; qa?: boolean }): CostContext {
  return { tool: TOOL, ...c };
}
