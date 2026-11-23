/**
 * The cost checks, over one day or a range of days (the apps are not used
 * every day, so a check must work over a long window):
 *
 *   bills     each provider's own bill against our recorded cost (reconcile.ts)
 *   intents   paid calls whose intent was never completed: calls made but
 *             never recorded (the function died, the write was dropped)
 *   apify     every run on the Apify account in the window. A finished run
 *             missing from cost_events is recorded when its actor is one only
 *             this app runs (unattributed, feature apify.unrecorded), and put
 *             up for review in cost_unclaimed_runs otherwise. Several Moburst
 *             tools share the account, so nothing is guessed across them.
 *   alerts    what needs a person, kept in cost_alerts and shown on
 *             GET /v1/costs. Nothing is posted anywhere else.
 *
 * History mode is the one-off load of past Apify runs: the same listing, but
 * an owned run is assigned to the client whose work was running at that time
 * (deps.attribute, app-side) and recorded with cost_source 'backfill'. Every
 * Apify row is keyed apify:<runId>, so live rows, audit rows and repeats never
 * count a run twice.
 *
 * Pure: fetch, credentials, the database and the recorder are passed in.
 *
 * Shared between the Moburst tools: written in AdVisor, copied by
 * scripts/sync-api-core.sh. Never edit the copy in another repo.
 */
import { APIFY_FINAL_STATUSES, classifyActor, resolveActors, type ActorClass, type ApifyActors } from "./apify.ts";
import type { CostContext, Tool } from "./context.ts";
import type { RecordOptions } from "./meter.ts";
import { dayBounds, reconcileDay, type Ours, type ReconcileDeps, type ReconcileRow, type Threshold } from "./reconcile.ts";
import { PROVIDERS, providerUrl, type ProviderId } from "./registry.ts";
import type { Usage } from "./usage.ts";

export const MAX_RANGE_DAYS = 90;
/** An intent still open this long after its call started is an unrecorded call. */
export const STALE_INTENT_MS = 60 * 60_000;
export const DEFAULT_UNATTRIBUTED_PCT = 0.1;

const MS_DAY = 86_400_000;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// ── Days ────────────────────────────────────────────────────────────────────

/** Every UTC day from `from` to `to`, both included. Throws on a bad, reversed, unfinished or too long range. */
export function rangeDays(from: string, to: string, today: string, max = MAX_RANGE_DAYS): string[] {
  const a = dayBounds(from).start.getTime();
  const b = dayBounds(to).start.getTime();
  if (a > b) throw new Error("from must not be after to");
  if (to >= today) throw new Error(`${to} has not ended yet (UTC); the range must end on a past day`);
  const n = Math.round((b - a) / MS_DAY) + 1;
  if (n > max) throw new Error(`The range can be at most ${max} days (asked for ${n})`);
  return Array.from({ length: n }, (_, i) => new Date(a + i * MS_DAY).toISOString().slice(0, 10));
}

/** Reads COST_ALERT_UNATTRIBUTED_PCT (0.1 = 10%), falling back to the default. */
export function unattributedPctFrom(env: (name: string) => string | undefined): number {
  const v = env("COST_ALERT_UNATTRIBUTED_PCT");
  const n = v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_UNATTRIBUTED_PCT;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

// ── Apify runs ──────────────────────────────────────────────────────────────

/** A run as GET /v2/actor-runs lists it (https://docs.apify.com/api/v2/actor-runs-get). */
export interface ApifyRunItem {
  id: string;
  actId: string;
  actorTaskId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  usageTotalUsd: number;
}

/** Who a past run is charged to (history mode). Shares add up to 1. */
export interface Attribution {
  clientId: string | null;
  executionId: string | null;
  share: number;
  feature?: string;
}

export interface UnclaimedRun {
  run_id: string;
  tool: Tool;
  actor_id: string;
  actor_task_id: string | null;
  actor_class: Exclude<ActorClass, "owned">;
  status: string;
  started_at: string;
  finished_at: string | null;
  usage_usd: number;
}

async function apifyGet(deps: ReconcileDeps, path: string): Promise<{ status: number; body: any }> {
  const cred = deps.credentials("apify");
  if ("missing" in cred) throw new Error(`${cred.missing} is not set, so Apify's runs cannot be read`);
  const signal = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(deps.timeoutMs ?? 30_000) : undefined;
  const res = await deps.fetch(providerUrl("apify", path, deps.env), { method: "GET", headers: cred.headers, signal });
  const text = await res.text().catch(() => "");
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: body ?? text.slice(0, 300) };
}

const PAGE = 1000;
const MAX_RUN_PAGES = 200;

/**
 * Every run on the account that started in [from, to), newest first, paged.
 * Filtered here too, in case the API ignores startedAfter/startedBefore.
 */
export async function listApifyRuns(from: Date, to: Date, deps: ReconcileDeps): Promise<ApifyRunItem[]> {
  const out: ApifyRunItem[] = [];
  for (let page = 0; page < MAX_RUN_PAGES; page++) {
    const q = new URLSearchParams({ limit: String(PAGE), offset: String(page * PAGE), desc: "1", startedAfter: from.toISOString(), startedBefore: to.toISOString() });
    const r = await apifyGet(deps, `/v2/actor-runs?${q}`);
    if (r.status >= 400) throw new Error(`Apify's run list answered ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    const items = r.body?.data?.items;
    if (!Array.isArray(items)) throw new Error("Apify's run list did not have the documented shape (no data.items)");
    let older = false;
    for (const it of items) {
      const started = Date.parse(String(it?.startedAt ?? ""));
      if (!it?.id || !Number.isFinite(started)) continue;
      if (started < from.getTime()) older = true;
      if (started < from.getTime() || started >= to.getTime()) continue;
      out.push({
        id: String(it.id), actId: String(it.actId ?? ""), actorTaskId: it.actorTaskId ? String(it.actorTaskId) : null,
        status: String(it.status ?? ""), startedAt: new Date(started).toISOString(), finishedAt: it.finishedAt ? String(it.finishedAt) : null,
        usageTotalUsd: Number.isFinite(Number(it.usageTotalUsd)) ? Number(it.usageTotalUsd) : 0,
      });
    }
    if (items.length < PAGE || older) return out;
  }
  throw new Error(`Apify listed more than ${MAX_RUN_PAGES * PAGE} runs for the range; check a shorter range`);
}

/** An actor name's Apify id (GET /v2/acts/user~name), or null when Apify does not know it. */
export function apifyActorLookup(deps: ReconcileDeps): (name: string) => Promise<string | null> {
  return async (name) => {
    const r = await apifyGet(deps, `/v2/acts/${encodeURIComponent(name)}`);
    return r.status < 400 && r.body?.data?.id ? String(r.body.data.id) : null;
  };
}

export interface ApifyDayCounts {
  runs: number;
  running: number;
  recorded: number;
  owned_missing: number;
  owned_missing_usd: number;
  unclaimed: number;
  unclaimed_usd: number;
}

export interface ApifyAudit {
  status: "ok" | "unreconciled" | "error";
  note: string | null;
  /** Owned runs recorded by this check (or that would be, in a dry run). */
  recorded_now: number;
  recorded_now_usd: number;
  totals: ApifyDayCounts;
  by_day: Record<string, ApifyDayCounts>;
  unresolved_actors: string[];
  /** The missed runs, at most 500, so a dry run shows what it would do. */
  missing: Array<{ run_id: string; day: string; actor_id: string; class: ActorClass; usd: number; attributed_to?: Array<{ client_id: string | null; share: number }> }>;
}

const zero = (): ApifyDayCounts => ({ runs: 0, running: 0, recorded: 0, owned_missing: 0, owned_missing_usd: 0, unclaimed: 0, unclaimed_usd: 0 });

export interface AuditStore {
  /** Our recorded spend for the day, by provider (cost_summary). */
  ours(day: string): Promise<Partial<Record<ProviderId, Ours>>>;
  saveReconciliation(rows: ReconcileRow[]): Promise<void>;
  /** Intents not completed, started in [from, to) and before staleBefore. */
  openIntents(from: string, to: string, staleBefore: string): Promise<Array<{ provider: string; started_at: string }>>;
  /** Which of these Apify run ids cost_events already holds. */
  recordedApifyRuns(ids: string[]): Promise<Set<string>>;
  saveUnclaimed(rows: UnclaimedRun[]): Promise<void>;
  /** Upserts the alerts, and resolves open alerts of these kinds on these days that were not raised again. */
  saveAlerts(alerts: CostAlert[], days: string[], kinds: AlertKind[]): Promise<void>;
  /** Drops completed intents older than this (they only ever matter while open). */
  pruneIntents?(before: string): Promise<void>;
}

export interface CheckDeps extends ReconcileDeps {
  tool: Tool;
  store: AuditStore;
  /** Records one cost row (the app's meter.record). */
  record(ctx: CostContext, provider: ProviderId, usage: Usage, opts?: RecordOptions): Promise<boolean>;
  actors: ApifyActors;
  threshold: Threshold;
  unattributedPct: number;
  now(): Date;
  /** History mode: who each past run is charged to. */
  attribute?(runs: ApifyRunItem[]): Promise<Map<string, Attribution[]>>;
  /**
   * Runs an earlier one-off backfill already counted without their run ids
   * (app-side). They are tallied as recorded and never written again, in
   * either mode, so a backfill and the audit cannot both count a run.
   */
  covered?(runs: ApifyRunItem[]): Promise<Set<string>>;
  /** Days checked at once. Default 4. */
  concurrency?: number;
  log?(line: string): void;
}

export interface CheckOptions {
  days: string[];
  dryRun: boolean;
  /** check: the daily checks. history: also loads past Apify runs, assigned to clients. */
  mode: "check" | "history";
  /** Compare bills (default true). History mode can skip them. */
  bills?: boolean;
}

export async function auditApify(days: string[], opts: CheckOptions, deps: CheckDeps): Promise<ApifyAudit> {
  const by_day: Record<string, ApifyDayCounts> = Object.fromEntries(days.map((d) => [d, zero()]));
  const empty = (status: ApifyAudit["status"], note: string): ApifyAudit => ({ status, note, recorded_now: 0, recorded_now_usd: 0, totals: zero(), by_day, unresolved_actors: [], missing: [] });
  const cred = deps.credentials("apify");
  if ("missing" in cred) return empty("unreconciled", `${cred.missing} is not set, so Apify's runs cannot be read`);
  let runs: ApifyRunItem[];
  let resolved;
  try {
    resolved = await resolveActors(deps.actors, apifyActorLookup(deps));
    runs = await listApifyRuns(dayBounds(days[0]).start, dayBounds(days[days.length - 1]).end, deps);
  } catch (e) {
    return empty("error", e instanceof Error ? e.message : String(e));
  }

  const finished = runs.filter((r) => APIFY_FINAL_STATUSES.has(r.status));
  const recorded = new Set<string>();
  for (let i = 0; i < finished.length; i += 200) {
    for (const id of await deps.store.recordedApifyRuns(finished.slice(i, i + 200).map((r) => r.id))) recorded.add(id);
  }
  const unseen = finished.filter((r) => !recorded.has(r.id));
  if (deps.covered && unseen.length) for (const id of await deps.covered(unseen)) recorded.add(id);
  const missing = finished.filter((r) => !recorded.has(r.id));
  const owned = missing.filter((r) => classifyActor(resolved, r.actId) === "owned");
  const attributions = opts.mode === "history" && deps.attribute && owned.length ? await deps.attribute(owned) : new Map<string, Attribution[]>();

  const out: ApifyAudit = { status: "ok", note: null, recorded_now: 0, recorded_now_usd: 0, totals: zero(), by_day, unresolved_actors: resolved.unresolved, missing: [] };
  const unclaimed: UnclaimedRun[] = [];
  for (const r of runs) {
    const day = r.startedAt.slice(0, 10);
    const c = (by_day[day] ??= zero());
    c.runs++;
    if (!APIFY_FINAL_STATUSES.has(r.status)) {
      c.running++;
      continue;
    }
    if (recorded.has(r.id)) {
      c.recorded++;
      continue;
    }
    const cls = classifyActor(resolved, r.actId);
    const usd = round6(r.usageTotalUsd);
    if (cls !== "owned") {
      c.unclaimed++;
      c.unclaimed_usd = round6(c.unclaimed_usd + usd);
      unclaimed.push({ run_id: r.id, tool: deps.tool, actor_id: r.actId, actor_task_id: r.actorTaskId, actor_class: cls, status: r.status, started_at: r.startedAt, finished_at: r.finishedAt, usage_usd: usd });
      if (out.missing.length < 500) out.missing.push({ run_id: r.id, day, actor_id: r.actId, class: cls, usd });
      continue;
    }
    c.owned_missing++;
    c.owned_missing_usd = round6(c.owned_missing_usd + usd);
    const parts = opts.mode === "history" ? normalise(attributions.get(r.id)) : [{ clientId: null, executionId: null, share: 1 }];
    if (out.missing.length < 500) out.missing.push({ run_id: r.id, day, actor_id: r.actId, class: cls, usd, ...(opts.mode === "history" ? { attributed_to: parts.map((p) => ({ client_id: p.clientId, share: p.share })) } : {}) });
    let ok = true;
    if (!opts.dryRun) {
      for (const [i, p] of parts.entries()) {
        const ctx: CostContext = {
          tool: deps.tool, clientId: p.clientId, actor: "system", executionId: p.executionId,
          feature: p.feature ?? (opts.mode === "history" ? "apify.history" : "apify.unrecorded"),
        };
        const usage: Usage = {
          resource: r.actId, quantities: { requests: 1 }, costUsd: round6(usd * p.share), providerRef: r.id,
          // The first part carries the run's own key, so a live row for the run and this one never both count.
          idempotencyKey: i === 0 ? `apify:${r.id}` : `apify:${r.id}:${p.clientId ?? "none"}`,
        };
        ok = (await deps.record(ctx, "apify", usage, { occurredAt: new Date(r.finishedAt ?? r.startedAt), costSource: opts.mode === "history" ? "backfill" : "provider" })) && ok;
      }
    }
    if (ok) {
      out.recorded_now++;
      out.recorded_now_usd = round6(out.recorded_now_usd + usd);
    }
  }
  if (!opts.dryRun && unclaimed.length) await deps.store.saveUnclaimed(unclaimed);
  for (const c of Object.values(by_day)) {
    for (const k of Object.keys(out.totals) as Array<keyof ApifyDayCounts>) out.totals[k] = round6(out.totals[k] + c[k]);
  }
  if (resolved.unresolved.length) out.note = `These listed actors could not be resolved to Apify ids, so their runs count as unknown: ${resolved.unresolved.join(", ")}`;
  return out;
}

/** One part with share 1 when nothing is known; parts sorted by client so the keys are stable across re-runs. */
function normalise(parts: Attribution[] | undefined): Attribution[] {
  const list = (parts ?? []).filter((p) => p.share > 0);
  const sum = list.reduce((s, p) => s + p.share, 0);
  if (!list.length || sum <= 0) return [{ clientId: null, executionId: null, share: 1 }];
  return list.map((p) => ({ ...p, share: p.share / sum })).sort((a, b) => String(a.clientId).localeCompare(String(b.clientId)));
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export const ALERT_KINDS = ["drift", "unrecorded_calls", "apify_unclaimed", "apify_recorded", "unattributed_share", "unpriced"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export interface CostAlert {
  dedupe_key: string;
  tool: Tool;
  kind: AlertKind;
  day: string;
  provider: string | null;
  message: string;
  count: number | null;
  usd: number | null;
  details: Record<string, unknown>;
}

const alert = (tool: Tool, kind: AlertKind, day: string, provider: string | null, message: string, count: number | null, usd: number | null, details: Record<string, unknown> = {}): CostAlert =>
  ({ dedupe_key: `${kind}:${day}:${provider ?? "all"}`, tool, kind, day, provider, message, count, usd: usd == null ? null : round6(usd), details });

// ── The whole check ─────────────────────────────────────────────────────────

export interface ProviderSummary {
  recorded_usd: number;
  billed_usd: number | null;
  /** Billed minus recorded, over the days the provider's bill could be read. */
  gap_usd: number | null;
  billed_days: number;
  ok: number;
  drift: number;
  unreconciled: number;
  error: number;
  stale_intents: number;
  unpriced_events: number;
}

export interface DayRow {
  day: string;
  total_usd: number;
  unattributed_usd: number;
  providers: Partial<Record<ProviderId, { recorded_usd: number; billed_usd: number | null; status: string | null; stale_intents: number; unpriced_events: number }>>;
  apify: ApifyDayCounts;
}

export interface CheckResult {
  from: string;
  to: string;
  days: string[];
  dry_run: boolean;
  mode: CheckOptions["mode"];
  threshold: Threshold;
  ok: number;
  drift: number;
  unreconciled: number;
  error: number;
  rows: ReconcileRow[];
  daily: DayRow[];
  summary: { providers: Partial<Record<ProviderId, ProviderSummary>>; total_recorded_usd: number; unattributed_usd: number; stale_intents: number; apify: ApifyAudit["totals"] & { recorded_now: number; recorded_now_usd: number; status: string; note: string | null } };
  apify: ApifyAudit;
  alerts: CostAlert[];
}

export async function runChecks(opts: CheckOptions, deps: CheckDeps): Promise<CheckResult> {
  const days = [...opts.days].sort();
  const from = dayBounds(days[0]).start.toISOString();
  const to = dayBounds(days[days.length - 1]).end.toISOString();
  const log = deps.log ?? ((l: string) => console.warn(l));

  // Apify first, so the runs it records count in the day's recorded cost below.
  const apify = await auditApify(days, opts, deps);

  const staleBefore = new Date(deps.now().getTime() - STALE_INTENT_MS).toISOString();
  const open = await deps.store.openIntents(from, to, staleBefore);
  const stale = new Map<string, number>();
  for (const i of open) {
    const k = `${String(i.started_at).slice(0, 10)}|${i.provider}`;
    stale.set(k, (stale.get(k) ?? 0) + 1);
  }

  const perDay = await mapLimit(days, deps.concurrency ?? 4, async (day) => {
    const ours = await deps.store.ours(day);
    const rows = opts.bills === false ? [] : await reconcileDay(day, ours, deps, deps.threshold);
    if (!opts.dryRun && rows.length) await deps.store.saveReconciliation(rows);
    return { day, ours, rows };
  });

  const alerts: CostAlert[] = [];
  const daily: DayRow[] = [];
  const providers: Partial<Record<ProviderId, ProviderSummary>> = {};
  const sum = (p: ProviderId) => (providers[p] ??= { recorded_usd: 0, billed_usd: null, gap_usd: null, billed_days: 0, ok: 0, drift: 0, unreconciled: 0, error: 0, stale_intents: 0, unpriced_events: 0 });
  let unattributedTotal = 0;
  let recordedTotal = 0;

  for (const { day, ours, rows } of perDay) {
    const row: DayRow = { day, total_usd: 0, unattributed_usd: 0, providers: {}, apify: apify.by_day[day] };
    const seen = new Set<ProviderId>([...(Object.keys(ours) as ProviderId[]), ...rows.map((r) => r.provider)]);
    for (const k of stale.keys()) if (k.startsWith(`${day}|`) && k.slice(11) in PROVIDERS) seen.add(k.slice(11) as ProviderId);
    for (const p of seen) {
      const o = ours[p] ?? { usd: 0, unpricedEvents: 0 };
      const r = rows.find((x) => x.provider === p) ?? null;
      const st = stale.get(`${day}|${p}`) ?? 0;
      row.providers[p] = { recorded_usd: round6(o.usd), billed_usd: r?.theirs_usd ?? null, status: r?.status ?? null, stale_intents: st, unpriced_events: o.unpricedEvents };
      row.total_usd = round6(row.total_usd + o.usd);
      row.unattributed_usd = round6(row.unattributed_usd + (o.unattributedUsd ?? 0));
      const s = sum(p);
      s.recorded_usd = round6(s.recorded_usd + o.usd);
      s.stale_intents += st;
      s.unpriced_events += o.unpricedEvents;
      if (r) {
        s[r.status]++;
        if (r.theirs_usd != null) {
          s.billed_usd = round6((s.billed_usd ?? 0) + r.theirs_usd);
          s.gap_usd = round6((s.gap_usd ?? 0) + r.theirs_usd - r.ours_usd);
          s.billed_days++;
        }
        if (r.status === "drift") alerts.push(alert(deps.tool, "drift", day, p, `${PROVIDERS[p].label} billed $${r.theirs_usd} on ${day}; ${deps.tool} recorded $${r.ours_usd} (outside the tolerance).`, null, (r.theirs_usd ?? 0) - r.ours_usd, { ours_usd: r.ours_usd, theirs_usd: r.theirs_usd, note: r.note }));
      }
      if (st > 0) alerts.push(alert(deps.tool, "unrecorded_calls", day, p, `${st} ${PROVIDERS[p].label} call(s) on ${day} were started but their cost was never recorded.`, st, null));
      if (o.unpricedEvents > 0) alerts.push(alert(deps.tool, "unpriced", day, p, `${o.unpricedEvents} ${PROVIDERS[p].label} event(s) on ${day} have no price; add a row to pricing.ts.`, o.unpricedEvents, null));
    }
    recordedTotal = round6(recordedTotal + row.total_usd);
    unattributedTotal = round6(unattributedTotal + row.unattributed_usd);
    if (row.total_usd > 0 && row.unattributed_usd / row.total_usd > deps.unattributedPct) {
      alerts.push(alert(deps.tool, "unattributed_share", day, null, `${Math.round((row.unattributed_usd / row.total_usd) * 1000) / 10}% of ${day}'s recorded cost has no client (threshold ${Math.round(deps.unattributedPct * 1000) / 10}%).`, null, row.unattributed_usd, { total_usd: row.total_usd }));
    }
    const a = apify.by_day[day];
    if (a?.unclaimed) alerts.push(alert(deps.tool, "apify_unclaimed", day, "apify", `${a.unclaimed} finished Apify run(s) on ${day} are in no tool's records and their actor is not owned by this tool; review cost_unclaimed_runs.`, a.unclaimed, a.unclaimed_usd));
    if (a?.owned_missing) alerts.push(alert(deps.tool, "apify_recorded", day, "apify", `${a.owned_missing} Apify run(s) on ${day} of this tool's own actors were missing from cost_events and ${opts.mode === "history" ? "were loaded from history" : "were recorded unattributed"}.`, a.owned_missing, a.owned_missing_usd));
    daily.push(row);
  }
  for (const s of Object.values(providers)) if (s) s.gap_usd = s.gap_usd == null ? null : round6(s.gap_usd);

  if (!opts.dryRun) {
    // Kinds this run could judge are resolved when not raised again; apify_recorded is an event, never resolved here.
    const kinds: AlertKind[] = ["unrecorded_calls", "unattributed_share", "unpriced"];
    if (opts.bills !== false) kinds.push("drift");
    if (apify.status === "ok") kinds.push("apify_unclaimed");
    await deps.store.saveAlerts(alerts, days, kinds);
    if (deps.store.pruneIntents) await deps.store.pruneIntents(new Date(deps.now().getTime() - 30 * MS_DAY).toISOString()).catch((e) => log(`COST_INTENT_PRUNE_FAILED ${String(e)}`));
  }

  const rows = perDay.flatMap((d) => d.rows);
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return {
    from, to, days, dry_run: opts.dryRun, mode: opts.mode, threshold: deps.threshold,
    ok: count("ok"), drift: count("drift"), unreconciled: count("unreconciled"), error: count("error"),
    rows, daily,
    summary: {
      providers, total_recorded_usd: recordedTotal, unattributed_usd: unattributedTotal, stale_intents: open.length,
      apify: { ...apify.totals, recorded_now: apify.recorded_now, recorded_now_usd: apify.recorded_now_usd, status: apify.status, note: apify.note },
    },
    apify, alerts,
  };
}
