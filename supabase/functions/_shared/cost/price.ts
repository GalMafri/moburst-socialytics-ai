/**
 * Turns usage into dollars with the pricing table (pricing.ts).
 *
 * A price row applies from its effectiveFrom date until a newer row for the
 * same provider and resource starts. Each recorded event stores the dollars and
 * the row it was priced with, so adding a new price never changes history.
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import type { ProviderId } from "./registry.ts";
import type { Usage } from "./usage.ts";

export interface Rate {
  usd: number;
  /** How many units the usd buys, e.g. 1_000_000 for a per-million-token price. */
  per: number;
}

export interface PriceRow {
  provider: ProviderId;
  /** Exact model or actor id, or a prefix ending in "*" (gpt-4o* also prices gpt-4o-2024-08-06). */
  resource: string;
  /** ISO date the price starts applying. */
  effectiveFrom: string;
  /** Rate per quantity name (see usage.ts for the vocabulary). Quantities with no rate cost nothing. */
  rates: Record<string, Rate>;
  /** Multipliers for pricing modifiers, e.g. { batch: 0.5 }. */
  modifiers?: Record<string, number>;
  /** Where the price was read. */
  source: string;
  /** False until someone checked it against the provider page or the Moburst plan. */
  verified: boolean;
  note?: string;
}

export interface Priced {
  costUsd: number | null;
  costSource: "provider" | "priced" | "estimated" | "unpriced";
  priceRef: string | null;
}

export const priceRef = (r: PriceRow): string => `${r.provider}:${r.resource}@${r.effectiveFrom}`;

function matches(row: PriceRow, provider: ProviderId, resource: string): boolean {
  if (row.provider !== provider) return false;
  if (row.resource.endsWith("*")) return resource.startsWith(row.resource.slice(0, -1));
  return row.resource === resource;
}

/** The row in force at `at`: an exact resource match beats a prefix, then the latest effectiveFrom on or before `at`. */
export function findPrice(table: readonly PriceRow[], provider: ProviderId, resource: string, at: Date): PriceRow | null {
  const day = at.toISOString().slice(0, 10);
  const candidates = table.filter((r) => matches(r, provider, resource) && r.effectiveFrom <= day);
  if (!candidates.length) return null;
  const exact = candidates.filter((r) => !r.resource.endsWith("*"));
  const pool = exact.length ? exact : candidates.sort((a, b) => b.resource.length - a.resource.length).filter((r, _, all) => r.resource.length === all[0].resource.length);
  return pool.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}

export function priceUsage(table: readonly PriceRow[], provider: ProviderId, usage: Usage, at: Date, estimated: boolean): Priced {
  if (typeof usage.costUsd === "number") {
    return { costUsd: round(usage.costUsd), costSource: "provider", priceRef: null };
  }
  const row = findPrice(table, provider, usage.resource, at);
  if (!row) return { costUsd: null, costSource: "unpriced", priceRef: null };
  let usd = 0;
  for (const [q, n] of Object.entries(usage.quantities)) {
    const rate = row.rates[q];
    if (rate) usd += (n / rate.per) * rate.usd;
  }
  if (usage.modifier && row.modifiers?.[usage.modifier] != null) usd *= row.modifiers[usage.modifier];
  return { costUsd: round(usd), costSource: estimated ? "estimated" : "priced", priceRef: priceRef(row) };
}

const round = (n: number): number => Math.round(n * 1e6) / 1e6;

/** Problems with a pricing table: overlapping rows, negative or zero divisors, rows for unknown quantities. */
export function lintPrices(table: readonly PriceRow[], knownQuantities: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of table) {
    const key = priceRef(r);
    if (seen.has(key)) problems.push(`${key} appears twice`);
    seen.add(key);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.effectiveFrom)) problems.push(`${key}: effectiveFrom must be YYYY-MM-DD`);
    if (!r.source) problems.push(`${key}: no source`);
    for (const [q, rate] of Object.entries(r.rates)) {
      if (!knownQuantities.has(q)) problems.push(`${key}: unknown quantity "${q}"`);
      if (!(rate.usd >= 0)) problems.push(`${key}: ${q} has a negative price`);
      if (!(rate.per > 0)) problems.push(`${key}: ${q} has no positive "per"`);
    }
  }
  return problems;
}

export const QUANTITIES: ReadonlySet<string> = new Set([
  "input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens", "image_input_tokens",
  "web_searches", "images", "audio_seconds", "credits", "gpu_seconds", "warehouse_seconds", "requests",
]);
