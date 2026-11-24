/**
 * The daily cost reconciliation (run through audit.ts runChecks, with the
 * intent, Apify and alert checks): for one UTC day, ask each provider that has
 * a billing API what it charged, and compare that with what our meter
 * recorded in cost_events. Code checks cannot see a provider changing its
 * prices or spend made outside the app; this can.
 *
 * Billing APIs are account-wide. The Moburst tools may share a provider
 * account or key, and this job only sees its own database, so a row holds
 * ours_usd for this tool and theirs_usd for the whole account. Its note says
 * so. A provider whose figure cannot be read (no admin key, data not final,
 * no per-day billing figure) gets status "unreconciled" with the reason; a
 * provider that answered with an error gets "error". Nothing here guesses.
 *
 * Pure: fetch, credentials and env are passed in, so tests run without Deno.
 * Provider addresses come from registry.ts.
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import { PROVIDERS, providerUrl, type ProviderId } from "./registry.ts";
import type { Db } from "./store.ts";

export type ReconcileStatus = "ok" | "drift" | "unreconciled" | "error";

export interface ReconcileRow {
  day: string; // YYYY-MM-DD, UTC
  provider: ProviderId;
  ours_usd: number;
  theirs_usd: number | null;
  status: ReconcileStatus;
  note: string;
}

/** A difference is drift when it exceeds both pct of their figure and minUsd. */
export interface Threshold {
  pct: number;
  minUsd: number;
}
export const DEFAULT_THRESHOLD: Threshold = { pct: 0.05, minUsd: 5 };

/** What a provider's billing API said for the day. */
export type Theirs =
  | { kind: "usd"; usd: number; note?: string }
  | { kind: "unreconciled"; reason: string }
  | { kind: "error"; reason: string };

/** Credentials for a provider's billing API, or the name of the secret that is missing. */
export type Credentials = { headers: Record<string, string> } | { missing: string };

export interface ReconcileDeps {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Reads a non-secret env var (a self-hosted provider's base URL). */
  env: (name: string) => string | undefined;
  /** Billing credentials, from _shared/paid (the only place keys are read). */
  credentials: (provider: ProviderId) => Credentials;
  /** Milliseconds before a billing call is abandoned. */
  timeoutMs?: number;
  /**
   * This tool's own API key for a provider (from _shared/paid), used only to find
   * that key's id in the organization's key list, so the bill check reads this
   * tool's share of a shared organization. Null when the tool has no key of its
   * own for that provider. Left out, the whole organization's bill is compared.
   */
  ownKey?: (provider: ProviderId) => Promise<string | null> | string | null;
  /** Waits between retries after a provider says "too many requests". Tests make it instant. */
  sleep?: (ms: number) => Promise<void>;
}

export type Adapter = (day: string, deps: ReconcileDeps) => Promise<Theirs>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_DAY = 86_400_000;

export function dayBounds(day: string): { start: Date; end: Date } {
  if (!DAY.test(day)) throw new Error(`${day} is not a YYYY-MM-DD day`);
  const start = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== day) throw new Error(`${day} is not a real day`);
  return { start, end: new Date(start.getTime() + MS_DAY) };
}

/** The UTC day `n` days before `now`. */
export function daysAgo(now: Date, n: number): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - n * MS_DAY).toISOString().slice(0, 10);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function compare(ours: number, theirs: number, t: Threshold = DEFAULT_THRESHOLD): "ok" | "drift" {
  return Math.abs(theirs - ours) <= Math.max(t.pct * Math.abs(theirs), t.minUsd) ? "ok" : "drift";
}

/** Reads COST_RECONCILE_DRIFT_PCT (0.05 = 5%) and COST_RECONCILE_DRIFT_MIN_USD, falling back to the defaults. */
export function thresholdFrom(env: (name: string) => string | undefined): Threshold {
  const num = (v: string | undefined, d: number) => {
    const n = v == null || v === "" ? NaN : Number(v);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  return { pct: num(env("COST_RECONCILE_DRIFT_PCT"), DEFAULT_THRESHOLD.pct), minUsd: num(env("COST_RECONCILE_DRIFT_MIN_USD"), DEFAULT_THRESHOLD.minUsd) };
}

/** Tries after a 429, waiting as the provider asks (Retry-After) or 2, 4, 8 s, at most 30 s each. */
const RATE_LIMIT_TRIES = 4;

async function getJson(deps: ReconcileDeps, provider: ProviderId, url: string, headers: Record<string, string>): Promise<{ ok: true; body: any; reason?: undefined } | { ok: false; body?: undefined; reason: string }> {
  let res!: Response;
  let text = "";
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(deps.timeoutMs ?? 30_000) : undefined;
      res = await deps.fetch(url, { method: "GET", headers, signal });
    } catch (e) {
      return { ok: false, reason: `${PROVIDERS[provider].label} billing API could not be reached: ${e instanceof Error ? e.message : String(e)}` };
    }
    text = await res.text().catch(() => "");
    if (res.status !== 429 || attempt >= RATE_LIMIT_TRIES) break;
    const asked = Number(res.headers.get("retry-after"));
    await sleep(Math.min(30_000, Number.isFinite(asked) && asked > 0 ? asked * 1000 : 2000 * 2 ** (attempt - 1)));
  }
  if (!res.ok) return { ok: false, reason: `${PROVIDERS[provider].label} billing API answered ${res.status}: ${text.slice(0, 300)}` };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, reason: `${PROVIDERS[provider].label} billing API answered with something that is not JSON` };
  }
}

const MAX_PAGES = 20;

/**
 * A provider's key hint ("sk-ant-api03-R2D...igAA", OpenAI's "sk-abc...def")
 * matches a key that starts and ends with its two visible parts.
 */
export function hintMatches(hint: unknown, key: string): boolean {
  if (typeof hint !== "string") return false;
  const i = hint.indexOf("...");
  if (i < 0) return false;
  const head = hint.slice(0, i);
  const tail = hint.slice(i + 3);
  return head.length + tail.length >= 6 && key.length > head.length + tail.length && key.startsWith(head) && key.endsWith(tail);
}

/** Which of the organization's keys are this tool's: all of them (no ownKey), some ids, none, or the lookup failed. */
type OwnKeys = { kind: "all" } | { kind: "ids"; ids: string[] } | { kind: "unreconciled"; reason: string } | { kind: "error"; reason: string };

const ownKeyCache = new Map<string, string[]>();
/** Tests reset the cache of key ids. */
export function clearOwnKeyCache(): void {
  ownKeyCache.clear();
}

/** Finds this tool's key ids once per process, from the organization's key list read with the admin key. */
async function ownKeyIds(provider: ProviderId, deps: ReconcileDeps, list: (key: string) => Promise<{ ids: string[] } | { error: string }>): Promise<OwnKeys> {
  if (!deps.ownKey) return { kind: "all" };
  let key: string | null;
  try {
    key = (await deps.ownKey(provider)) ?? null;
  } catch {
    key = null;
  }
  const label = PROVIDERS[provider].label;
  if (!key) return { kind: "unreconciled", reason: `this tool makes no ${label} calls with a key of its own, so no part of the organization's ${label} bill is its to compare` };
  const cacheKey = `${provider}:${key.slice(0, 12)}:${key.slice(-4)}`;
  const cached = ownKeyCache.get(cacheKey);
  if (cached) return { kind: "ids", ids: cached };
  const found = await list(key);
  if ("error" in found) return { kind: "error", reason: found.error };
  if (!found.ids.length) return { kind: "unreconciled", reason: `this tool's ${label} key is not in the key list of the organization the admin key belongs to, so its share of the bill cannot be read` };
  ownKeyCache.set(cacheKey, found.ids);
  return { kind: "ids", ids: found.ids };
}

/** Anthropic: GET /v1/organizations/api_keys (Admin API), paged with after_id; each key has partial_key_hint. */
async function anthropicKeyIds(deps: ReconcileDeps, headers: Record<string, string>): Promise<OwnKeys> {
  return ownKeyIds("anthropic", deps, async (key) => {
    const ids: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const q = new URLSearchParams({ limit: "100" });
      if (after) q.set("after_id", after);
      const r = await getJson(deps, "anthropic", providerUrl("anthropic", `/v1/organizations/api_keys?${q}`, deps.env), headers);
      if (!r.ok) return { error: r.reason };
      for (const k of Array.isArray(r.body?.data) ? r.body.data : []) if (hintMatches(k?.partial_key_hint, key) && typeof k?.id === "string") ids.push(k.id);
      if (!r.body?.has_more || !r.body?.last_id) return { ids };
      after = String(r.body.last_id);
    }
    return { ids };
  });
}

/** OpenAI: GET /v1/organization/projects, then each project's /api_keys, paged with after; each key has redacted_value. */
async function openaiKeyIds(deps: ReconcileDeps, headers: Record<string, string>): Promise<OwnKeys> {
  const pages = async (path: string, each: (item: any) => void): Promise<string | null> => {
    let after: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const q = new URLSearchParams({ limit: "100" });
      if (after) q.set("after", after);
      const r = await getJson(deps, "openai", providerUrl("openai", `${path}?${q}`, deps.env), headers);
      if (!r.ok) return r.reason;
      for (const item of Array.isArray(r.body?.data) ? r.body.data : []) each(item);
      if (!r.body?.has_more || !r.body?.last_id) return null;
      after = String(r.body.last_id);
    }
    return null;
  };
  return ownKeyIds("openai", deps, async (key) => {
    const projects: string[] = [];
    const err = await pages("/v1/organization/projects", (p) => { if (typeof p?.id === "string") projects.push(p.id); });
    if (err) return { error: err };
    const ids: string[] = [];
    for (const project of projects) {
      const e = await pages(`/v1/organization/projects/${encodeURIComponent(project)}/api_keys`, (k) => { if (hintMatches(k?.redacted_value, key) && typeof k?.id === "string") ids.push(k.id); });
      if (e) return { error: e };
    }
    return { ids };
  });
}

/**
 * Anthropic: the Usage and Cost Analytics API, cost endpoint.
 * Docs: https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api
 *   GET /v1/organizations/analytics/cost?starting_at=…&ending_at=…  (beta header analytics-usage-cost-2026-08-24)
 *   With no group_by[] and no time_bucket_width, one row totals the range:
 *   { data: [{ starting_at, ending_at, group: {…}, cost: { currency: "USD", amount: "41280.000000", list_amount, requests } }],
 *     has_more, next_page, data_refreshed_at }
 *   amount is the cost after discounts and before credits, a decimal string in CENTS.
 *   Usage after data_refreshed_at is missing or partial (refresh is usually within 4 hours, up to 24),
 *   and data_refreshed_at is null when nothing is available yet.
 * The legacy /v1/organizations/cost_report reads the same data; this one is the documented path for new integrations.
 */
export const anthropicCostAnalytics: Adapter = async (day, deps) => {
  const cred = deps.credentials("anthropic");
  if ("missing" in cred) return { kind: "unreconciled", reason: `${cred.missing} is not set, so Anthropic's cost report cannot be read` };
  const { start, end } = dayBounds(day);
  const headers = { ...cred.headers, "anthropic-version": "2026-10-21", "anthropic-beta": "analytics-usage-cost-2026-08-24" };
  // Only this tool's keys: the organization is shared with other Moburst work.
  const own = await anthropicKeyIds(deps, headers);
  if (own.kind === "unreconciled" || own.kind === "error") return { kind: own.kind, reason: own.reason };
  let cents = 0;
  let page: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ starting_at: start.toISOString().replace(".000Z", "Z"), ending_at: end.toISOString().replace(".000Z", "Z"), limit: "1000" });
    if (own.kind === "ids") for (const id of own.ids) q.append("api_key_ids[]", id);
    if (page) q.set("page", page);
    const r = await getJson(deps, "anthropic", providerUrl("anthropic", `/v1/organizations/analytics/cost?${q}`, deps.env), headers);
    if (!r.ok) return { kind: "error", reason: r.reason };
    const refreshed = r.body?.data_refreshed_at;
    if (refreshed == null) return { kind: "unreconciled", reason: "Anthropic has no cost data for this day yet" };
    if (new Date(refreshed).getTime() < end.getTime()) return { kind: "unreconciled", reason: `Anthropic's figures for this day are not final yet (data refreshed at ${refreshed})` };
    if (!Array.isArray(r.body?.data)) return { kind: "unreconciled", reason: "Anthropic's cost report did not have the documented shape (no data array)" };
    for (const row of r.body.data) {
      const amt = Number(row?.cost?.amount);
      if (row?.cost?.currency !== "USD" || !Number.isFinite(amt)) return { kind: "unreconciled", reason: `Anthropic's cost report had a row in an unexpected shape or currency (${row?.cost?.currency})` };
      cents += amt;
    }
    if (!r.body.has_more || !r.body.next_page) return { kind: "usd", usd: round6(cents / 100), ...(own.kind === "ids" ? { note: OWN_KEYS_NOTE } : {}) };
    page = String(r.body.next_page);
  }
  return { kind: "error", reason: `Anthropic's cost report had more than ${MAX_PAGES} pages for one day` };
};

/**
 * OpenAI: the organization Costs API.
 * Docs: https://developers.openai.com/api/reference/resources/organization/subresources/audit_logs/subresources/usage (section "Costs";
 *   formerly https://platform.openai.com/docs/api-reference/usage/costs)
 *   GET /v1/organization/costs?start_time=<unix s>&end_time=<unix s>&bucket_width=1d  (Authorization: Bearer <admin key>)
 *   { object: "page", data: [{ object: "bucket", start_time, end_time,
 *       results: [{ object: "organization.costs.result", amount: { value: 0.06, currency: "usd" }, line_item, project_id, … }] }],
 *     has_more, next_page }
 *   amount.value is in the currency named (dollars for "usd"; the docs' example is 0.06 usd).
 */
export const openaiCosts: Adapter = async (day, deps) => {
  const cred = deps.credentials("openai");
  if ("missing" in cred) return { kind: "unreconciled", reason: `${cred.missing} is not set, so OpenAI's cost report cannot be read` };
  const { start, end } = dayBounds(day);
  const s = start.getTime() / 1000;
  const e = end.getTime() / 1000;
  // Only this tool's keys: grouped by key, the results carry api_key_id.
  const own = await openaiKeyIds(deps, cred.headers);
  if (own.kind === "unreconciled" || own.kind === "error") return { kind: own.kind, reason: own.reason };
  const mine = own.kind === "ids" ? new Set(own.ids) : null;
  let usd = 0;
  let page: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const q = new URLSearchParams({ start_time: String(s), end_time: String(e), bucket_width: "1d", limit: "1" });
    if (mine) q.set("group_by", "api_key_id");
    if (page) q.set("page", page);
    const r = await getJson(deps, "openai", providerUrl("openai", `/v1/organization/costs?${q}`, deps.env), cred.headers);
    if (!r.ok) return { kind: "error", reason: r.reason };
    if (!Array.isArray(r.body?.data)) return { kind: "unreconciled", reason: "OpenAI's cost report did not have the documented shape (no data array)" };
    for (const bucket of r.body.data) {
      if (bucket?.start_time !== s) continue;
      for (const res of bucket.results ?? []) {
        if (mine && !mine.has(String(res?.api_key_id))) continue;
        const v = Number(res?.amount?.value);
        if (String(res?.amount?.currency).toLowerCase() !== "usd" || !Number.isFinite(v)) return { kind: "unreconciled", reason: `OpenAI's cost report had a result in an unexpected shape or currency (${res?.amount?.currency})` };
        usd += v;
      }
    }
    if (!r.body.has_more || !r.body.next_page) return { kind: "usd", usd: round6(usd), note: ["OpenAI does not say when a day's costs are final; a recent day can still grow.", ...(mine ? [OWN_KEYS_NOTE] : [])].join(" ") };
    page = String(r.body.next_page);
  }
  return { kind: "error", reason: `OpenAI's cost report had more than ${MAX_PAGES} pages for one day` };
};

/**
 * Apify: the account's monthly usage, with one entry per day.
 * Docs: https://docs.apify.com/api/v2/users-me-usage-monthly-get
 *   GET /v2/users/me/usage/monthly?date=YYYY-MM-DD  (the usage cycle that holds that date)
 *   { data: { usageCycle: { startAt, endAt }, monthlyServiceUsage: {…},
 *     dailyServiceUsages: [{ date: "2022-10-02T00:00:00.000Z", serviceUsage: {…}, totalUsageCreditsUsd: 0.047… }],
 *     totalUsageCreditsUsdBeforeVolumeDiscount, totalUsageCreditsUsdAfterVolumeDiscount } }
 *   The docs do not say whether a day's totalUsageCreditsUsd is before or after the volume discount.
 */
export const apifyMonthlyUsage: Adapter = async (day, deps) => {
  const cred = deps.credentials("apify");
  if ("missing" in cred) return { kind: "unreconciled", reason: `${cred.missing} is not set, so Apify's usage cannot be read` };
  dayBounds(day);
  const r = await getJson(deps, "apify", providerUrl("apify", `/v2/users/me/usage/monthly?date=${day}`, deps.env), cred.headers);
  if (!r.ok) return { kind: "error", reason: r.reason };
  const days = r.body?.data?.dailyServiceUsages;
  if (!Array.isArray(days)) return { kind: "unreconciled", reason: "Apify's usage report did not have the documented shape (no dailyServiceUsages)" };
  const entries = days.filter((d: any) => typeof d?.date === "string" && d.date.slice(0, 10) === day);
  let usd = 0;
  for (const d of entries) {
    const v = Number(d.totalUsageCreditsUsd);
    if (!Number.isFinite(v)) return { kind: "unreconciled", reason: "Apify's usage report had a day without a numeric totalUsageCreditsUsd" };
    usd += v;
  }
  // A day with no entry had no usage (Apify lists the days of the cycle that have usage).
  return { kind: "usd", usd: round6(usd), note: "Apify's daily total includes platform charges (storage, proxy) that no run reports; Apify does not say whether it is before or after the volume discount." };
};

/** For providers with only a credit balance: no per-day billing figure to compare with. */
export const creditBalanceOnly: Adapter = async () => ({
  kind: "unreconciled",
  reason: "this provider shows only a credit balance, with no per-day billing figure to compare with",
});

export const ADAPTERS: Partial<Record<ProviderId, Adapter>> = {
  anthropic: anthropicCostAnalytics,
  openai: openaiCosts,
  apify: apifyMonthlyUsage,
};

/** The providers the daily job checks: every one with a billing API or a credit balance. */
export const RECONCILED: ProviderId[] = (Object.keys(PROVIDERS) as ProviderId[]).filter((p) => PROVIDERS[p].reconcile !== "none");

const SHARED_NOTE = "Billing is account-wide: ours_usd is this tool's recorded spend only, so a provider account shared with another Moburst tool shows as theirs > ours.";
const OWN_KEYS_NOTE = "theirs_usd is the bill for this tool's own API key only (matched in the organization's key list), so other work in the same organization is left out.";

export interface Ours {
  usd: number;
  unpricedEvents: number;
  /** Recorded cost with no client that should have had one. */
  unattributedUsd?: number;
}

export async function reconcileProvider(day: string, provider: ProviderId, ours: Ours, deps: ReconcileDeps, threshold: Threshold = DEFAULT_THRESHOLD): Promise<ReconcileRow> {
  const adapter = ADAPTERS[provider] ?? creditBalanceOnly;
  let theirs: Theirs;
  try {
    theirs = await adapter(day, deps);
  } catch (e) {
    theirs = { kind: "error", reason: e instanceof Error ? e.message : String(e) };
  }
  const notes: string[] = [];
  if (ours.unpricedEvents > 0) notes.push(`${ours.unpricedEvents} of our events for this day have no price, so ours_usd is low by their cost.`);
  const base = { day, provider, ours_usd: round6(ours.usd) };
  if (theirs.kind !== "usd") return { ...base, theirs_usd: null, status: theirs.kind, note: [theirs.reason, ...notes].join(" ") };
  if (theirs.note) notes.unshift(theirs.note);
  const status = compare(ours.usd, theirs.usd, threshold);
  const head = `${status === "ok" ? "Within" : "Outside"} the tolerance of max(${Math.round(threshold.pct * 1000) / 10}% of theirs, $${threshold.minUsd}).`;
  const scoped = theirs.note?.includes(OWN_KEYS_NOTE) || provider === "apify";
  return { ...base, theirs_usd: theirs.usd, status, note: [head, ...(scoped ? [] : [SHARED_NOTE]), ...notes].join(" ") };
}

export async function reconcileDay(day: string, ours: Partial<Record<ProviderId, Ours>>, deps: ReconcileDeps, threshold: Threshold = DEFAULT_THRESHOLD, providers: ProviderId[] = RECONCILED): Promise<ReconcileRow[]> {
  return Promise.all(providers.map((p) => reconcileProvider(day, p, ours[p] ?? { usd: 0, unpricedEvents: 0 }, deps, threshold)));
}

/** Our recorded spend for the day, by provider, from cost_summary (migration 20261123130000_cost_events.sql). */
export async function oursForDay(db: Db, day: string): Promise<Partial<Record<ProviderId, Ours>>> {
  const { start, end } = dayBounds(day);
  const { data, error } = await db.rpc("cost_summary", { p_from: start.toISOString(), p_to: end.toISOString(), p_group: ["provider"], p_filters: {} });
  if (error) throw new Error(`cost_summary failed: ${error.message}`);
  const out: Partial<Record<ProviderId, Ours>> = {};
  for (const raw of (data ?? []) as unknown[]) {
    const r = (typeof raw === "object" && raw && "cost_summary" in raw ? (raw as { cost_summary: unknown }).cost_summary : raw) as { provider?: string; cost_usd?: number | string; unpriced_events?: number | string; unattributed_usd?: number | string };
    if (!r?.provider || !(r.provider in PROVIDERS)) continue;
    out[r.provider as ProviderId] = { usd: Number(r.cost_usd ?? 0), unpricedEvents: Number(r.unpriced_events ?? 0), unattributedUsd: Number(r.unattributed_usd ?? 0) };
  }
  return out;
}

/** Writes the day's rows; a re-run of the same day replaces them. */
export async function saveRows(db: Db, rows: ReconcileRow[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await db.from("cost_reconciliation").upsert(rows.map((r) => ({ ...r, checked_at: new Date().toISOString() })), { onConflict: "day,provider" });
  if (error) throw new Error(`cost_reconciliation write failed: ${error.message}`);
}
