import { beforeEach, describe, expect, it } from "vitest";
import { clearActorCache, type ApifyActors } from "../../../functions/_shared/cost/apify";
import { rangeDays, runChecks, unattributedPctFrom, type AlertKind, type AuditStore, type CheckDeps, type CostAlert, type UnclaimedRun } from "../../../functions/_shared/cost/audit";
import type { CostContext } from "../../../functions/_shared/cost/context";
import type { RecordOptions } from "../../../functions/_shared/cost/meter";
import { DEFAULT_THRESHOLD, type Ours, type ReconcileRow } from "../../../functions/_shared/cost/reconcile";
import type { Usage } from "../../../functions/_shared/cost/usage";

const ACTORS: ApifyActors = { owned: [{ name: "apify/facebook-ads-scraper", id: "METAid00000000000" }], shared: [{ name: "apify/website-content-crawler" }] };
const WCC = "WCCid000000000000";

const run = (id: string, actId: string, startedAt: string, usd: number, status = "SUCCEEDED") =>
  ({ id, actId, actorTaskId: null, status, startedAt, finishedAt: status === "RUNNING" ? null : startedAt.replace("T10", "T11"), usageTotalUsd: usd });

function setup(o: { runs?: unknown[]; recorded?: string[]; ours?: Record<string, Partial<Record<string, Ours>>>; intents?: Array<{ provider: string; started_at: string }>; apifyKey?: boolean; billed?: Record<string, number>; recordFails?: boolean } = {}) {
  const recorded: Array<{ ctx: CostContext; usage: Usage; opts?: RecordOptions }> = [];
  const saved = { recon: [] as ReconcileRow[], unclaimed: [] as UnclaimedRun[], alerts: null as null | { alerts: CostAlert[]; days: string[]; kinds: AlertKind[] }, pruned: null as string | null };
  const urls: string[] = [];
  const store: AuditStore = {
    ours: async (day) => (o.ours?.[day] ?? {}) as Partial<Record<never, Ours>>,
    saveReconciliation: async (rows) => { saved.recon.push(...rows); },
    openIntents: async (from, to, staleBefore) => (o.intents ?? []).filter((i) => i.started_at >= from && i.started_at < to && i.started_at < staleBefore),
    recordedApifyRuns: async (ids) => new Set(ids.filter((id) => (o.recorded ?? []).includes(id))),
    saveUnclaimed: async (rows) => { saved.unclaimed.push(...rows); },
    saveAlerts: async (alerts, days, kinds) => { saved.alerts = { alerts, days, kinds }; },
    pruneIntents: async (before) => { saved.pruned = before; },
  };
  const deps: CheckDeps = {
    tool: "advisor", store, actors: ACTORS, threshold: DEFAULT_THRESHOLD, unattributedPct: 0.1,
    now: () => new Date("2026-11-23T09:00:00Z"),
    env: () => undefined,
    credentials: (p) => (p === "apify" && o.apifyKey !== false ? { headers: { Authorization: "Bearer t" } } : { missing: p === "apify" ? "APIFY_TOKEN" : `${p.toUpperCase()}_ADMIN_KEY` }),
    fetch: async (url) => {
      urls.push(url);
      const u = new URL(url);
      if (u.pathname === "/v2/acts/apify~website-content-crawler") return new Response(JSON.stringify({ data: { id: WCC } }));
      if (u.pathname.startsWith("/v2/acts/")) return new Response("{}", { status: 404 });
      if (u.pathname === "/v2/actor-runs") {
        const offset = Number(u.searchParams.get("offset"));
        return new Response(JSON.stringify({ data: { items: offset ? [] : o.runs ?? [] } }));
      }
      if (u.pathname === "/v2/users/me/usage/monthly") {
        const day = u.searchParams.get("date")!;
        const usd = o.billed?.[day];
        return new Response(JSON.stringify({ data: { dailyServiceUsages: usd == null ? [] : [{ date: `${day}T00:00:00.000Z`, totalUsageCreditsUsd: usd }] } }));
      }
      return new Response("{}", { status: 500 });
    },
    record: async (ctx, _p, usage, opts) => { recorded.push({ ctx, usage, opts }); return !o.recordFails; },
  };
  return { deps, recorded, saved, urls };
}

beforeEach(() => clearActorCache());

describe("rangeDays", () => {
  it("lists every UTC day of a past range, both ends included", () => {
    expect(rangeDays("2026-10-30", "2026-11-02", "2026-11-23")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  });
  it("refuses a reversed range, a day not yet over, and more than 90 days", () => {
    expect(() => rangeDays("2026-11-05", "2026-11-01", "2026-11-23")).toThrow(/after/);
    expect(() => rangeDays("2026-11-20", "2026-11-23", "2026-11-23")).toThrow(/not ended/);
    expect(() => rangeDays("2026-07-01", "2026-11-01", "2026-11-23")).toThrow(/at most 90/);
    expect(rangeDays("2026-08-03", "2026-10-31", "2026-11-23")).toHaveLength(90);
  });
  it("reads the unattributed threshold from env", () => {
    expect(unattributedPctFrom(() => undefined)).toBe(0.1);
    expect(unattributedPctFrom(() => "0.25")).toBe(0.25);
    expect(unattributedPctFrom(() => "7")).toBe(0.1);
  });
});

describe("the Apify audit", () => {
  const runs = [
    run("RUNa0000000000001", "METAid00000000000", "2026-11-20T10:00:00.000Z", 0.5), // owned, missing: recorded
    run("RUNa0000000000002", "METAid00000000000", "2026-11-20T10:30:00.000Z", 0.2), // owned, already recorded
    run("RUNa0000000000003", WCC, "2026-11-21T10:00:00.000Z", 0.3), // shared, missing: review
    run("RUNa0000000000004", "OTHERid0000000000", "2026-11-21T10:00:00.000Z", 0.4), // unknown (Socialytics, n8n): review
    run("RUNa0000000000005", "METAid00000000000", "2026-11-21T10:00:00.000Z", 9, "RUNNING"), // not finished: skipped
  ];

  it("records a missed run of an owned actor, unattributed, and puts every other missed run up for review", async () => {
    const s = setup({ runs, recorded: ["RUNa0000000000002"] });
    const r = await runChecks({ days: ["2026-11-20", "2026-11-21"], dryRun: false, mode: "check" }, s.deps);
    expect(s.recorded).toHaveLength(1);
    expect(s.recorded[0].ctx).toMatchObject({ clientId: null, feature: "apify.unrecorded", tool: "advisor" });
    expect(s.recorded[0].usage).toMatchObject({ resource: "METAid00000000000", costUsd: 0.5, providerRef: "RUNa0000000000001", idempotencyKey: "apify:RUNa0000000000001" });
    expect(s.recorded[0].opts).toMatchObject({ costSource: "provider", occurredAt: new Date("2026-11-20T11:00:00.000Z") });
    expect(s.saved.unclaimed.map((u) => [u.run_id, u.actor_class])).toEqual([["RUNa0000000000003", "shared"], ["RUNa0000000000004", "unknown"]]);
    expect(r.apify.by_day["2026-11-20"]).toMatchObject({ runs: 2, recorded: 1, owned_missing: 1, owned_missing_usd: 0.5, unclaimed: 0 });
    expect(r.apify.by_day["2026-11-21"]).toMatchObject({ runs: 3, running: 1, unclaimed: 2, unclaimed_usd: 0.7 });
    expect(r.summary.apify).toMatchObject({ runs: 5, recorded_now: 1, recorded_now_usd: 0.5, unclaimed: 2, status: "ok" });
    // The run list is read with this app's key, for exactly the range.
    const list = new URL(s.urls.find((u) => u.includes("/v2/actor-runs"))!);
    expect(list.searchParams.get("startedAfter")).toBe("2026-11-20T00:00:00.000Z");
    expect(list.searchParams.get("startedBefore")).toBe("2026-11-22T00:00:00.000Z");
    expect(r.alerts.map((a) => a.dedupe_key)).toEqual(expect.arrayContaining(["apify_recorded:2026-11-20:apify", "apify_unclaimed:2026-11-21:apify"]));
  });

  it("a dry run writes nothing and says what it would do", async () => {
    const s = setup({ runs, recorded: ["RUNa0000000000002"] });
    const r = await runChecks({ days: ["2026-11-20", "2026-11-21"], dryRun: true, mode: "check" }, s.deps);
    expect(s.recorded).toEqual([]);
    expect(s.saved).toMatchObject({ recon: [], unclaimed: [], alerts: null, pruned: null });
    expect(r.apify.recorded_now).toBe(1);
    expect(r.apify.missing.map((m) => [m.run_id, m.class])).toEqual([["RUNa0000000000001", "owned"], ["RUNa0000000000003", "shared"], ["RUNa0000000000004", "unknown"]]);
  });

  it("history mode assigns each run to the clients given, splitting the cost and keying the first part as the run", async () => {
    const s = setup({ runs: runs.slice(0, 1) });
    s.deps.attribute = async (rs) => new Map([[rs[0].id, [{ clientId: "c2", executionId: null, share: 30, feature: "weekly_report.scrape" }, { clientId: "c1", executionId: "wr-1", share: 10, feature: "weekly_report.scrape" }]]]);
    await runChecks({ days: ["2026-11-20"], dryRun: false, mode: "history" }, s.deps);
    expect(s.recorded.map((x) => [x.ctx.clientId, x.ctx.executionId, x.usage.costUsd, x.usage.idempotencyKey, x.opts?.costSource])).toEqual([
      ["c1", "wr-1", 0.125, "apify:RUNa0000000000001", "backfill"],
      ["c2", null, 0.375, "apify:RUNa0000000000001:c2", "backfill"],
    ]);
  });

  it("history mode leaves a run with no attribution unattributed", async () => {
    const s = setup({ runs: runs.slice(0, 1) });
    s.deps.attribute = async () => new Map();
    await runChecks({ days: ["2026-11-20"], dryRun: false, mode: "history" }, s.deps);
    expect(s.recorded[0].ctx).toMatchObject({ clientId: null, feature: "apify.history" });
    expect(s.recorded[0].usage.idempotencyKey).toBe("apify:RUNa0000000000001");
  });

  it("a run an earlier backfill already counted is tallied as recorded and never written, in both modes", async () => {
    for (const mode of ["check", "history"] as const) {
      const s = setup({ runs: runs.slice(0, 1) });
      s.deps.covered = async (rs) => new Set(rs.map((r) => r.id));
      const r = await runChecks({ days: ["2026-11-20"], dryRun: false, mode }, s.deps);
      expect(s.recorded).toEqual([]);
      expect(r.apify.by_day["2026-11-20"]).toMatchObject({ runs: 1, recorded: 1, owned_missing: 0 });
    }
  });

  it("compares Apify's bill with every run on the account, not only this tool's", async () => {
    // 0.5 + 0.2 + 0.3 + 0.4 finished on the 20th and 21st; the running one is not counted.
    const s = setup({ runs, recorded: ["RUNa0000000000002"], billed: { "2026-11-20": 0.7, "2026-11-21": 0.7 }, ours: { "2026-11-20": { apify: { usd: 0.2, unpricedEvents: 0 } } } });
    const r = await runChecks({ days: ["2026-11-20", "2026-11-21"], dryRun: true, mode: "check" }, s.deps);
    expect(r.apify.by_day["2026-11-20"].account_usd).toBe(0.7);
    expect(r.apify.by_day["2026-11-21"].account_usd).toBe(0.7);
    const apifyRows = r.rows.filter((x) => x.provider === "apify");
    expect(apifyRows.map((x) => [x.day, x.ours_usd, x.status])).toEqual([["2026-11-20", 0.7, "ok"], ["2026-11-21", 0.7, "ok"]]);
  });

  it("without an Apify key the audit is unreconciled, and its alerts are not resolved", async () => {
    const s = setup({ runs, apifyKey: false });
    const r = await runChecks({ days: ["2026-11-20"], dryRun: false, mode: "check" }, s.deps);
    expect(r.apify).toMatchObject({ status: "unreconciled", note: expect.stringMatching(/APIFY_TOKEN/) });
    expect(s.saved.alerts!.kinds).not.toContain("apify_unclaimed");
    expect(s.saved.alerts!.kinds).toContain("drift");
  });
});

describe("the checks over a range", () => {
  it("answers a per-day table and a total per provider, with stale intents and alerts", async () => {
    const s = setup({
      runs: [],
      ours: {
        "2026-11-20": { apify: { usd: 10, unpricedEvents: 0, unattributedUsd: 0 }, openai: { usd: 2, unpricedEvents: 1, unattributedUsd: 2 } },
        "2026-11-21": { apify: { usd: 4, unpricedEvents: 0, unattributedUsd: 0 } },
      },
      billed: { "2026-11-20": 30, "2026-11-21": 4.5 },
      intents: [
        { provider: "anthropic", started_at: "2026-11-21T08:00:00.000Z" },
        { provider: "anthropic", started_at: "2026-11-21T09:00:00.000Z" },
        { provider: "openai", started_at: "2026-11-23T08:30:00.000Z" }, // outside the range
      ],
    });
    const r = await runChecks({ days: ["2026-11-21", "2026-11-20"], dryRun: false, mode: "check" }, s.deps);
    expect(r.days).toEqual(["2026-11-20", "2026-11-21"]);
    expect(r.daily.map((d) => [d.day, d.total_usd, d.unattributed_usd])).toEqual([["2026-11-20", 12, 2], ["2026-11-21", 4, 0]]);
    expect(r.daily[0].providers.apify).toMatchObject({ recorded_usd: 10, billed_usd: 30, status: "drift" });
    expect(r.daily[1].providers.anthropic).toMatchObject({ recorded_usd: 0, stale_intents: 2, status: "unreconciled" });
    // The bill is compared with every run on the account (none here), so the gap is the whole bill.
    expect(r.summary.providers.apify).toMatchObject({ recorded_usd: 14, billed_usd: 34.5, gap_usd: 34.5, billed_days: 2, ok: 1, drift: 1 });
    expect(r.summary.providers.anthropic).toMatchObject({ stale_intents: 2, unreconciled: 2, billed_usd: null });
    expect(r.summary).toMatchObject({ total_recorded_usd: 16, unattributed_usd: 2, stale_intents: 2 });
    expect(r.alerts.map((a) => a.dedupe_key).sort()).toEqual([
      "drift:2026-11-20:apify",
      "unattributed_share:2026-11-20:all",
      "unpriced:2026-11-20:openai",
      "unrecorded_calls:2026-11-21:anthropic",
    ]);
    expect(r.alerts.find((a) => a.kind === "unrecorded_calls")).toMatchObject({ count: 2, provider: "anthropic" });
    expect(s.saved.recon).toHaveLength(r.rows.length);
    expect(s.saved.alerts).toMatchObject({ days: ["2026-11-20", "2026-11-21"], kinds: ["unrecorded_calls", "unattributed_share", "unpriced", "drift", "apify_unclaimed"] });
    expect(s.saved.pruned).toBe("2026-10-24T09:00:00.000Z");
    // The cron's response keys are still there.
    expect(r).toMatchObject({ ok: 1, drift: 1, dry_run: false });
  });

  it("does not count an intent opened less than an hour ago", async () => {
    const s = setup({ intents: [{ provider: "openai", started_at: "2026-11-23T08:30:00.000Z" }] });
    s.deps.now = () => new Date("2026-11-24T09:00:00Z");
    const recent = await runChecks({ days: ["2026-11-23"], dryRun: true, mode: "check" }, s.deps);
    expect(recent.summary.stale_intents).toBe(1);
    s.deps.now = () => new Date("2026-11-23T09:00:00Z");
    expect((await runChecks({ days: ["2026-11-23"], dryRun: true, mode: "check" }, s.deps)).summary.stale_intents).toBe(0);
  });
});

describe("database side of the checks", () => {
  function fakeDb() {
    const ops: Array<[string, string, unknown[]]> = [];
    const db = {
      rpc: async () => ({ data: [], error: null }),
      from: (table: string) => {
        const q: any = {};
        for (const m of ["insert", "update", "upsert", "select", "eq", "is", "in", "not", "lt", "gte", "order", "range", "delete"]) {
          q[m] = (...args: unknown[]) => { ops.push([table, m, args]); return q; };
        }
        q.then = (res: (v: unknown) => void) => res({ data: [], error: null });
        return q;
      },
    };
    return { db, ops };
  }

  it("writes and completes intents by id", async () => {
    const { intentSink } = await import("../../../functions/_shared/cost/store");
    const { db, ops } = fakeDb();
    const sink = intentSink(db);
    await sink.start({ id: "i1", tool: "advisor", env: "prod", provider: "openai", feature: "x", client_id: null, execution_id: null, started_at: "t" });
    await sink.complete("i1", "t2", 3);
    expect(ops.map(([t, m]) => `${t}.${m}`)).toEqual(["cost_intents.insert", "cost_intents.update", "cost_intents.eq"]);
    expect(ops[1][2][0]).toEqual({ completed_at: "t2", events: 3 });
  });

  it("resolves the checked days' open alerts of the judged kinds, then upserts the ones raised again", async () => {
    const { auditStore } = await import("../../../functions/_shared/cost/store");
    const { db, ops } = fakeDb();
    const a: CostAlert = { dedupe_key: "drift:2026-11-20:apify", tool: "advisor", kind: "drift", day: "2026-11-20", provider: "apify", message: "m", count: null, usd: 1, details: {} };
    await auditStore(db).saveAlerts([a], ["2026-11-20"], ["drift"]);
    expect(ops.map(([t, m]) => `${t}.${m}`)).toEqual(["cost_alerts.update", "cost_alerts.is", "cost_alerts.in", "cost_alerts.in", "cost_alerts.upsert"]);
    expect(ops[4][2]).toEqual([[expect.objectContaining({ dedupe_key: a.dedupe_key, resolved_at: null })], { onConflict: "dedupe_key" }]);
  });
});
