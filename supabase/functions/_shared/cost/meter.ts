/**
 * The paying desk: the one way a Moburst tool calls a paid provider.
 *
 *   const res = await meter.fetch(ctx, "anthropic", "/v1/messages", init);
 *
 * It builds the provider URL from the registry, sends the request, reads the
 * usage from a copy of the answer, prices it, and records one cost event per
 * billable unit. The caller gets the provider's answer untouched.
 *
 * Recording never breaks the feature: a failed write is retried, then logged
 * as COST_EVENT_DROPPED with the whole event, so it can be replayed. A missing
 * or malformed CostContext does throw, before anything is sent: that is a code
 * mistake the tests should have caught, never a runtime condition.
 *
 * Intents: when an IntentSink is given, the meter writes a cost_intents row
 * before the call (waiting at most intentWaitMs for it) and marks it complete
 * once the cost rows are written. An intent left open means a call whose cost
 * was never recorded (the function died, the write was dropped); the daily
 * reconciliation counts them. An intent that cannot be written never stops the
 * call: it is logged as COST_INTENT_FAILED. Apify calls write none: a run is
 * covered by its webhook and the daily audit of the account's runs.
 *
 * Apify: when apifyWebhook gives a target, every actor or task run the meter
 * starts carries an ad-hoc webhook (apify.ts) for the run's terminal events,
 * so the run is recorded even when nobody polls it to the end.
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import { bucketOf, checkContext, type BucketHint, type CostContext, type Tool } from "./context.ts";
import { priceUsage, type PriceRow } from "./price.ts";
import { apifyRunStart, withApifyWebhook, type ApifyWebhookTarget } from "./apify.ts";
import { PROVIDERS, providerUrl, type ProviderId } from "./registry.ts";
import { carriesNoUsage, READERS, readAnswer, requestResource, type Usage } from "./usage.ts";

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

/** One paid call about to be made (migration 20261123190000_cost_safeguards.sql). */
export interface IntentRow {
  id: string;
  tool: Tool;
  env: string;
  provider: ProviderId;
  feature: string;
  client_id: string | null;
  execution_id: string | null;
  started_at: string;
}

export interface IntentSink {
  start(row: IntentRow): Promise<void>;
  /** Marks the intent done: its cost rows (events of them, possibly none) are written. */
  complete(id: string, completedAt: string, events: number): Promise<void>;
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
  /** Where intents go; without one the meter records no intents. */
  intents?: IntentSink;
  /** The longest a call waits for its intent to be written. Default 250 ms. */
  intentWaitMs?: number;
  /** Attempts to insert cost rows before they are logged as dropped. Default 3. */
  writeAttempts?: number;
  /** Delay before the first retry, doubled for each next one. Default 200 ms. */
  retryDelayMs?: number;
  sleep?(ms: number): Promise<void>;
  /** Where Apify reports a finished run (cost-apify-webhook), or null when it is not configured. */
  apifyWebhook?(): ApifyWebhookTarget | null;
}

export interface FetchOptions {
  /** What the answer cannot say: a resource name, or quantities such as audio_seconds. */
  hint?: { resource?: string; quantities?: Record<string, number> };
}

export interface RecordOptions {
  occurredAt?: Date;
  durationMs?: number;
  costSource?: CostEventRow["cost_source"];
}

export interface Meter {
  fetch(ctx: CostContext, provider: ProviderId, path: string, init?: RequestInit, opts?: FetchOptions): Promise<Response>;
  /** For costs the meter cannot read from an answer (Higgsfield credits, a backfill). True when the row is written. */
  record(ctx: CostContext, provider: ProviderId, usage: Usage, opts?: RecordOptions): Promise<boolean>;
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

  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attempts = Math.max(1, deps.writeAttempts ?? 3);
  const retryDelay = deps.retryDelayMs ?? 200;

  /** Inserts the rows, retrying with backoff. True when they are written (or there were none). */
  async function write(rows: CostEventRow[]): Promise<boolean> {
    if (!rows.length) return true;
    let last: unknown = null;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(retryDelay * 2 ** (i - 1));
      try {
        await deps.sink.insert(rows);
        return true;
      } catch (e) {
        last = e;
      }
    }
    log(`COST_EVENT_DROPPED ${JSON.stringify({ error: last instanceof Error ? last.message : String(last), attempts, rows })}`);
    return false;
  }

  /** Writes the intent, waiting at most intentWaitMs. Resolves to whether it was written. */
  async function beginIntent(ctx: CostContext, provider: ProviderId): Promise<{ id: string; written: Promise<boolean> } | null> {
    if (!deps.intents) return null;
    const row: IntentRow = {
      id: uuid(), tool: ctx.tool, env: deps.env, provider, feature: ctx.feature,
      client_id: ctx.clientId ?? null, execution_id: ctx.executionId ?? null, started_at: now().toISOString(),
    };
    const written = deps.intents.start(row).then(
      () => true,
      (e) => {
        log(`COST_INTENT_FAILED ${JSON.stringify({ stage: "start", provider, feature: ctx.feature, client_id: row.client_id, error: e instanceof Error ? e.message : String(e) })}`);
        return false;
      },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([written, new Promise<void>((r) => { timer = setTimeout(r, deps.intentWaitMs ?? 250); })]);
    if (timer) clearTimeout(timer);
    return { id: row.id, written };
  }

  async function endIntent(intent: { id: string; written: Promise<boolean> } | null, events: number): Promise<void> {
    if (!intent || !deps.intents || !(await intent.written)) return;
    try {
      await deps.intents.complete(intent.id, now().toISOString(), events);
    } catch (e) {
      log(`COST_INTENT_FAILED ${JSON.stringify({ stage: "complete", id: intent.id, error: e instanceof Error ? e.message : String(e) })}`);
    }
  }

  /** Reads and records the answer's usage. The number of rows written, or null when they could not be. */
  async function recordAnswer(ctx: CostContext, provider: ProviderId, path: string, method: string, reqResource: string | null, res: Response, started: number, opts?: FetchOptions): Promise<number | null> {
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
      return (await write(usages.map((u) => row(ctx, provider, u, at, durationMs)))) ? usages.length : null;
    } catch (e) {
      log(`COST_READ_FAILED ${JSON.stringify({ provider, path, feature: ctx.feature, error: e instanceof Error ? e.message : String(e) })}`);
      return null;
    }
  }

  return {
    async fetch(ctx, provider, path, init, opts) {
      checkContext(ctx);
      let url = providerUrl(provider, path, getEnv);
      const method = (init?.method ?? "GET").toUpperCase();
      if (provider === "apify" && apifyRunStart(method, new URL(url).pathname)) {
        const target = deps.apifyWebhook?.() ?? null;
        if (target) url = withApifyWebhook(url, ctx, target);
      }
      const reqResource = opts?.hint?.resource ?? requestResource(provider, new URL(url).pathname, init?.body);
      if (carriesNoUsage(provider, new URL(url).pathname)) return send(url, init);
      // Apify is covered by its run webhook and the daily run audit, so its many status polls write no intents.
      const intent = provider === "apify" ? null : await beginIntent(ctx, provider);
      const started = Date.now();
      let res: Response;
      try {
        res = await send(url, init);
      } catch (e) {
        // The call never got an answer: there is nothing to read, so the intent is closed with no events.
        await endIntent(intent, 0);
        throw e;
      }
      const copy = res.clone();
      const streaming = (res.headers.get("content-type") ?? "").includes("text/event-stream");
      const pending = recordAnswer(ctx, provider, new URL(url).pathname, method, reqResource, copy, started, opts).then(async (events) => {
        if (events !== null) await endIntent(intent, events);
      });
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
      return write([row(ctx, provider, usage, opts?.occurredAt ?? now(), opts?.durationMs ?? null, opts?.costSource)]);
    },
  };
}
