/**
 * Reads what a provider says a call used, from the provider's own answer.
 * One reader per provider; each returns zero or more usage items (a batch
 * result holds many, a call that cost nothing holds none).
 *
 * Quantities use one vocabulary across providers, so the pricing table and
 * the API speak the same names:
 *   input_tokens        uncached input tokens
 *   cache_read_tokens   input tokens served from the prompt cache
 *   cache_write_tokens  input tokens written to the prompt cache
 *   output_tokens       output tokens (reasoning tokens included)
 *   web_searches        server-side web searches
 *   images              images returned
 *   audio_seconds       seconds of audio transcribed
 *   credits             provider credits deducted
 *   gpu_seconds, warehouse_seconds   time-billed compute (estimated)
 *   requests            calls made (for request-priced or free services)
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import type { ProviderId } from "./registry.ts";

export interface Usage {
  resource: string;
  quantities: Record<string, number>;
  /** Dollars as the provider reported them (Apify). Wins over pricing. */
  costUsd?: number | null;
  /** The provider's id for this call or run. */
  providerRef?: string | null;
  /** Unique per billable unit; a second event with the same key is ignored. */
  idempotencyKey?: string | null;
  /** A pricing modifier, e.g. "batch" (Anthropic Message Batches bill half). */
  modifier?: "batch" | null;
}

export interface CallInfo {
  method: string;
  path: string;
  /** The request's model or actor, when the body or path names one. */
  requestResource: string | null;
  /** How long the call took, for time-billed services. */
  durationMs: number;
}

export interface Answer {
  status: number;
  headers: Headers;
  /** The parsed body: a JSON value, a list of SSE events, or a list of JSONL records. */
  body: unknown;
  kind: "json" | "sse" | "jsonl" | "other";
}

type Reader = (call: CallInfo, answer: Answer) => Usage[];

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const clean = (q: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(q).filter(([, v]) => v > 0));
const requestId = (h: Headers): string | null => h.get("request-id") ?? h.get("x-request-id") ?? h.get("x-goog-request-id");

function anthropicUsage(u: Record<string, unknown>): Record<string, number> {
  const server = obj(u.server_tool_use);
  return clean({
    input_tokens: num(u.input_tokens),
    cache_write_tokens: num(u.cache_creation_input_tokens),
    cache_read_tokens: num(u.cache_read_input_tokens),
    output_tokens: num(u.output_tokens),
    web_searches: num(server.web_search_requests),
  });
}

const anthropic: Reader = (call, a) => {
  if (a.status >= 400) return [];
  if (a.kind === "json") {
    const b = obj(a.body);
    if (!b.usage) return [];
    const id = str(b.id) ?? requestId(a.headers);
    return [{ resource: str(b.model) ?? call.requestResource ?? "unknown", quantities: anthropicUsage(obj(b.usage)), providerRef: id, idempotencyKey: id ? `anthropic:${id}` : null }];
  }
  if (a.kind === "sse") {
    // message_start carries the input side and the model; each message_delta carries the running output count.
    let model = call.requestResource ?? "unknown";
    let id: string | null = null;
    let q: Record<string, number> = {};
    for (const ev of a.body as Array<{ event?: string; data?: unknown }>) {
      const d = obj(ev.data);
      if (d.type === "message_start") {
        const m = obj(d.message);
        model = str(m.model) ?? model;
        id = str(m.id) ?? id;
        q = { ...q, ...anthropicUsage(obj(m.usage)) };
      } else if (d.type === "message_delta" && d.usage) {
        const u = anthropicUsage(obj(d.usage));
        q = { ...q, ...u };
      }
    }
    return Object.keys(q).length ? [{ resource: model, quantities: clean(q), providerRef: id, idempotencyKey: id ? `anthropic:${id}` : null }] : [];
  }
  if (a.kind === "jsonl") {
    // Message Batches results: one record per request, billed at the batch rate.
    const batchId = /batches\/([^/]+)\/results/.exec(call.path)?.[1] ?? "batch";
    const out: Usage[] = [];
    for (const rec of a.body as unknown[]) {
      const r = obj(rec);
      const res = obj(r.result);
      if (res.type !== "succeeded") continue;
      const m = obj(res.message);
      out.push({
        resource: str(m.model) ?? "unknown",
        quantities: anthropicUsage(obj(m.usage)),
        providerRef: str(m.id),
        idempotencyKey: `anthropic-batch:${batchId}:${String(r.custom_id ?? m.id)}`,
        modifier: "batch",
      });
    }
    return out;
  }
  return [];
};

function openAiChatUsage(u: Record<string, unknown>): Record<string, number> {
  const cached = num(obj(u.prompt_tokens_details).cached_tokens) || num(obj(u.input_tokens_details).cached_tokens);
  const input = num(u.prompt_tokens) || num(u.input_tokens);
  const output = num(u.completion_tokens) || num(u.output_tokens);
  return clean({ input_tokens: Math.max(0, input - cached), cache_read_tokens: cached, output_tokens: output });
}

const openai: Reader = (call, a) => {
  if (a.status >= 400 || a.kind !== "json") return [];
  const b = obj(a.body);
  const id = str(b.id) ?? requestId(a.headers);
  const key = id ? `openai:${id}` : null;
  const model = call.requestResource ?? str(b.model) ?? "unknown";
  if (call.path.includes("/audio/transcriptions")) {
    // Billed per minute of audio. verbose_json carries the duration; otherwise the caller passes it as a hint.
    const seconds = num(b.duration) || num(obj(b.usage).seconds);
    return [{ resource: model, quantities: clean({ audio_seconds: seconds, requests: seconds ? 0 : 1 }), providerRef: id, idempotencyKey: key }];
  }
  if (call.path.includes("/images/")) {
    const u = obj(b.usage);
    const images = Array.isArray(b.data) ? b.data.length : 0;
    const det = obj(u.input_tokens_details);
    return [{
      resource: model,
      quantities: clean({
        input_tokens: num(det.text_tokens) || (num(u.input_tokens) - num(det.image_tokens)),
        image_input_tokens: num(det.image_tokens),
        output_tokens: num(u.output_tokens),
        images,
      }),
      providerRef: id, idempotencyKey: key,
    }];
  }
  if (!b.usage) return [];
  return [{ resource: model, quantities: openAiChatUsage(obj(b.usage)), providerRef: id, idempotencyKey: key }];
};

const gemini: Reader = (call, a) => {
  if (a.status >= 400 || a.kind !== "json") return [];
  const b = obj(a.body);
  const u = obj(b.usageMetadata);
  if (!b.usageMetadata) return [];
  const model = /models\/([^:/]+)/.exec(call.path)?.[1] ?? str(b.modelVersion) ?? call.requestResource ?? "unknown";
  const cached = num(u.cachedContentTokenCount);
  const images = (Array.isArray(b.candidates) ? b.candidates : [])
    .flatMap((c) => (Array.isArray(obj(obj(c).content).parts) ? (obj(obj(c).content).parts as unknown[]) : []))
    .filter((p) => obj(obj(p).inlineData).mimeType?.toString().startsWith("image/")).length;
  const id = str(b.responseId) ?? requestId(a.headers);
  return [{
    resource: model,
    quantities: clean({
      input_tokens: Math.max(0, num(u.promptTokenCount) - cached),
      cache_read_tokens: cached,
      output_tokens: num(u.candidatesTokenCount) + num(u.thoughtsTokenCount),
      images,
    }),
    providerRef: id, idempotencyKey: id ? `gemini:${id}` : null,
  }];
};

const lovableAi: Reader = (call, a) => {
  if (a.status >= 400 || a.kind !== "json") return [];
  const b = obj(a.body);
  if (!b.usage) return [];
  const id = str(b.id) ?? requestId(a.headers);
  return [{ resource: call.requestResource ?? str(b.model) ?? "unknown", quantities: openAiChatUsage(obj(b.usage)), providerRef: id, idempotencyKey: id ? `lovable_ai:${id}` : null }];
};

const APIFY_FINAL = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

/** A run is recorded once, the first time it is seen finished, with the dollars Apify reports. */
const apify: Reader = (call, a) => {
  if (a.status >= 400 || a.kind !== "json") return [];
  const run = obj(obj(a.body).data);
  if (!run.id || !APIFY_FINAL.has(String(run.status))) return [];
  const actor = str(run.actId) ?? call.requestResource ?? "unknown";
  return [{
    resource: actor,
    quantities: clean({ requests: 1 }),
    costUsd: num(run.usageTotalUsd),
    providerRef: String(run.id),
    idempotencyKey: `apify:${String(run.id)}`,
  }];
};

/** A Gamma generation is recorded once, when it is seen completed, with the credits Gamma reports. */
const gamma: Reader = (_call, a) => {
  if (a.status >= 400 || a.kind !== "json") return [];
  const b = obj(a.body);
  const id = str(b.generationId) ?? str(b.id);
  if (!id || String(b.status) !== "completed") return [];
  const credits = obj(b.credits);
  return [{ resource: "generation", quantities: clean({ credits: num(credits.deducted), requests: num(credits.deducted) ? 0 : 1 }), providerRef: id, idempotencyKey: `gamma:${id}` }];
};

const firecrawl: Reader = (call, a) => {
  if (a.status >= 400 || a.kind !== "json") return [];
  const b = obj(a.body);
  if (b.success === false) return [];
  const credits = num(b.creditsUsed) || num(obj(b.data).creditsUsed);
  const endpoint = /\/v\d+\/([a-z]+)/.exec(call.path)?.[1] ?? "request";
  return [{ resource: endpoint, quantities: clean({ credits, requests: credits ? 0 : 1 }), providerRef: str(b.id) ?? requestId(a.headers) }];
};

const jina: Reader = (_call, a) => {
  if (a.status >= 400) return [];
  const tokens = a.kind === "json" ? num(obj(obj(obj(a.body).data).usage).tokens) : 0;
  return [{ resource: "reader", quantities: clean({ requests: 1, input_tokens: tokens }) }];
};

/** GPU and warehouse time is not reported per call; the call's own duration stands in, and the event is marked estimated. */
const timed = (quantity: string, resource: string): Reader => (call, a) =>
  a.status >= 400 ? [] : [{ resource: call.requestResource ?? resource, quantities: { [quantity]: Math.max(1, Math.round(call.durationMs / 1000)) } }];

export const READERS: Record<ProviderId, Reader> = {
  anthropic,
  openai,
  gemini,
  lovable_ai: lovableAi,
  apify,
  gamma,
  firecrawl,
  jina,
  tribe: timed("gpu_seconds", "tribe-space"),
  snowflake: timed("warehouse_seconds", "warehouse"),
  // Higgsfield runs through its MCP transport; the app records its credits explicitly when a generation finishes.
  higgsfield: () => [],
};

/** Parses an answer once, by its content type, for the readers. Never throws. */
export async function readAnswer(res: Response): Promise<Answer> {
  const type = res.headers.get("content-type") ?? "";
  const base = { status: res.status, headers: res.headers };
  try {
    if (type.includes("text/event-stream")) {
      const text = await res.text();
      const events = text.split(/\n\n+/).map((chunk) => {
        const ev = /^event:\s*(.+)$/m.exec(chunk)?.[1]?.trim();
        const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
        try {
          return { event: ev, data: data ? JSON.parse(data) : null };
        } catch {
          return { event: ev, data: null };
        }
      });
      return { ...base, body: events, kind: "sse" };
    }
    const text = await res.text();
    if (type.includes("jsonl") || type.includes("ndjson") || (/^\s*\{.*\}\s*\n\s*\{/s.test(text) && !type.includes("application/json"))) {
      const lines = text.split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return { ...base, body: lines, kind: "jsonl" };
    }
    try {
      return { ...base, body: JSON.parse(text), kind: "json" };
    } catch {
      return { ...base, body: text, kind: "other" };
    }
  } catch {
    return { ...base, body: null, kind: "other" };
  }
}

/** The model or actor a request names, from its JSON or form body, or its path. */
export function requestResource(provider: ProviderId, path: string, body: unknown): string | null {
  if (provider === "apify") {
    const m = /\/(?:acts|actor-tasks)\/([^/]+)/.exec(path);
    if (m) return decodeURIComponent(m[1]).replace("~", "/");
  }
  if (provider === "gemini") {
    const m = /models\/([^:/]+)/.exec(path);
    if (m) return m[1];
  }
  if (typeof body === "string") {
    try {
      const m = (JSON.parse(body) as { model?: unknown }).model;
      return typeof m === "string" ? m : null;
    } catch {
      return null;
    }
  }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const m = body.get("model");
    return typeof m === "string" ? m : null;
  }
  return null;
}
