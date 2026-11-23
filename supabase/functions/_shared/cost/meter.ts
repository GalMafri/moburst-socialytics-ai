/**
 * The paying desk: the one way a Moburst tool calls a paid provider.
 *
 *   const res = await meter.fetch(ctx, "anthropic", "/v1/messages", init);
 *
 * It builds the provider URL from the registry, sends the request, reads the
 * usage from a copy of the answer, prices it, and records one cost event per
 * billable unit. The caller gets the provider's answer untouched.
 *
 * Recording never breaks the feature: a failed write is logged as
 * COST_EVENT_DROPPED with the whole event, so it can be replayed. A missing or
 * malformed CostContext does throw, before anything is sent: that is a code
 * mistake the tests should have caught, never a runtime condition.
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import { bucketOf, checkContext, type BucketHint, type CostContext, type Tool } from "./context.ts";
import { priceUsage, type PriceRow } from "./price.ts";
import { PROVIDERS, providerUrl, type ProviderId } from "./registry.ts";
import { READERS, readAnswer, requestResource, type Usage } from "./usage.ts";

export interface CostEventRow {
  occurred_at: string;
  tool: Tool;
  env: string;
  client_id: string | null;
  bucket_hint: BucketHint;
  unattributed: boolean;
  feature: string;
  execution_id: string | null;
  actor_kind: string;
  user_id: string | null;
  api_key_id: string | null;
  provider: ProviderId;
  resource: string;
  quantities: Record<string, number>;
  cost_usd: number | null;
  cost_source: "provider" | "priced" | "estimated" | "unpriced" | "backfill" | "backfill_estimate";
  price_ref: string | null;
  provider_ref: string | null;
  idempotency_key: string;
  duration_ms: number | null;
}

export interface CostSink {
  /** Inserts the rows, ignoring any whose idempotency_key is already recorded. */
  insert(rows: CostEventRow[]): Promise<void>;
}

export interface MeterDeps {
  tool: Tool;
  /** "prod", "dev" or "preview": where the function runs. */
  env: string;
  sink: CostSink;
  prices: readonly PriceRow[];
  sharedFeatures: ReadonlySet<string>;
  fetch?: typeof fetch;
  getEnv?(name: string): string | undefined;
  now?(): Date;
  /** Keeps the function alive for work after the answer (a streamed reply's usage). */
  waitUntil?(p: Promise<unknown>): void;
  log?(line: string): void;
  uuid?(): string;
}

export interface FetchOptions {
  /** What the answer cannot say: a resource name, or quantities such as audio_seconds. */
  hint?: { resource?: string; quantities?: Record<string, number> };
}

export interface Meter {
  fetch(ctx: CostContext, provider: ProviderId, path: string, init?: RequestInit, opts?: FetchOptions): Promise<Response>;
  /** For costs the meter cannot read from an answer (Higgsfield credits, a backfill). */
  record(ctx: CostContext, provider: ProviderId, usage: Usage, opts?: { occurredAt?: Date; durationMs?: number; costSource?: CostEventRow["cost_source"] }): Promise<void>;
}

export function createMeter(deps: MeterDeps): Meter {
  const send = deps.fetch ?? ((url: string, init?: RequestInit) => globalThis.fetch(url, init));
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((line: string) => console.warn(line));
  const uuid = deps.uuid ?? (() => crypto.randomUUID());
  const getEnv = deps.getEnv ?? (() => undefined);

  function row(ctx: CostContext, provider: ProviderId, usage: Usage, at: Date, durationMs: number | null, forced?: CostEventRow["cost_source"]): CostEventRow {
    const { hint, unattributed } = bucketOf(ctx, deps.sharedFeatures);
    const priced = priceUsage(deps.prices, provider, usage, at, PROVIDERS[provider].costSource === "estimated");
    return {
      occurred_at: at.toISOString(),
      tool: ctx.tool,
      env: deps.env,
      client_id: ctx.clientId ?? null,
      bucket_hint: hint,
      unattributed,
      feature: ctx.feature,
      execution_id: ctx.executionId ?? null,
      actor_kind: ctx.actor,
      user_id: ctx.userId ?? null,
      api_key_id: ctx.apiKeyId ?? null,
      provider,
      resource: usage.resource,
      quantities: usage.quantities,
      cost_usd: priced.costUsd,
      cost_source: forced ?? priced.costSource,
      price_ref: priced.priceRef,
      provider_ref: usage.providerRef ?? null,
      idempotency_key: usage.idempotencyKey ?? `${provider}:${uuid()}`,
      duration_ms: durationMs,
    };
  }

  async function write(rows: CostEventRow[]): Promise<void> {
    if (!rows.length) return;
    try {
      await deps.sink.insert(rows);
    } catch (e) {
      log(`COST_EVENT_DROPPED ${JSON.stringify({ error: e instanceof Error ? e.message : String(e), rows })}`);
    }
  }

  async function recordAnswer(ctx: CostContext, provider: ProviderId, path: string, method: string, reqResource: string | null, res: Response, started: number, opts?: FetchOptions): Promise<void> {
    try {
      const answer = await readAnswer(res);
      const durationMs = Date.now() - started;
      let usages = READERS[provider]({ method, path, requestResource: reqResource, durationMs }, answer);
      if (opts?.hint && usages.length) {
        usages = usages.map((u) => ({
          ...u,
          resource: u.resource === "unknown" && opts.hint?.resource ? opts.hint.resource : u.resource,
          quantities: { ...u.quantities, ...(opts.hint?.quantities ?? {}) },
        }));
      }
      const at = now();
      await write(usages.map((u) => row(ctx, provider, u, at, durationMs)));
    } catch (e) {
      log(`COST_READ_FAILED ${JSON.stringify({ provider, path, feature: ctx.feature, error: e instanceof Error ? e.message : String(e) })}`);
    }
  }

  return {
    async fetch(ctx, provider, path, init, opts) {
      checkContext(ctx);
      const url = providerUrl(provider, path, getEnv);
      const method = (init?.method ?? "GET").toUpperCase();
      const reqResource = opts?.hint?.resource ?? requestResource(provider, new URL(url).pathname, init?.body);
      const started = Date.now();
      const res = await send(url, init);
      const copy = res.clone();
      const streaming = (res.headers.get("content-type") ?? "").includes("text/event-stream");
      const pending = recordAnswer(ctx, provider, new URL(url).pathname, method, reqResource, copy, started, opts);
      if (streaming) {
        // The copy finishes when the stream does; the caller reads the original meanwhile.
        if (deps.waitUntil) deps.waitUntil(pending);
        else void pending;
      } else {
        await pending;
      }
      return res;
    },

    async record(ctx, provider, usage, opts) {
      checkContext(ctx);
      await write([row(ctx, provider, usage, opts?.occurredAt ?? now(), opts?.durationMs ?? null, opts?.costSource)]);
    },
  };
}
