import { describe, expect, it } from "vitest";
import {
  compare,
  daysAgo,
  oursForDay,
  reconcileDay,
  reconcileProvider,
  RECONCILED,
  saveRows,
  thresholdFrom,
  clearOwnKeyCache,
  hintMatches,
  type Credentials,
  type ReconcileDeps,
} from "../../../functions/_shared/cost/reconcile";
import type { ProviderId } from "../../../functions/_shared/cost/registry";

/**
 * Fake billing answers in the shapes the providers document:
 *   Anthropic  https://platform.claude.com/docs/en/manage-claude/usage-cost-analytics-api (cost endpoint, amounts in cents)
 *   OpenAI     https://developers.openai.com/api/reference/resources/organization/subresources/audit_logs/subresources/usage ("Costs")
 *   Apify      https://docs.apify.com/api/v2/users-me-usage-monthly-get
 */
const DAY = "2026-11-22";

const anthropicAnswer = (cents: string, refreshed: string | null = "2026-11-23T05:00:00Z") => ({
  data: refreshed ? [{ starting_at: "2026-11-22T00:00:00Z", ending_at: "2026-11-23T00:00:00Z", group: { model: null, workspace_id: null }, cost: { currency: "USD", amount: cents, list_amount: cents, requests: 120 } }] : [],
  has_more: false,
  next_page: null,
  data_refreshed_at: refreshed,
});

const openaiAnswer = (values: number[]) => ({
  object: "page",
  data: [{
    object: "bucket",
    start_time: Date.UTC(2026, 10, 22) / 1000,
    end_time: Date.UTC(2026, 10, 23) / 1000,
    results: values.map((v) => ({ object: "organization.costs.result", amount: { value: v, currency: "usd" }, line_item: null, project_id: null, api_key_id: null, quantity: null, quantity_unit: null })),
  }],
  has_more: false,
  next_page: null,
});

const apifyAnswer = (usd: number) => ({
  data: {
    usageCycle: { startAt: "2026-11-02T00:00:00.000Z", endAt: "2026-12-01T23:59:59.999Z" },
    monthlyServiceUsage: {},
    dailyServiceUsages: [
      { date: "2026-11-21T00:00:00.000Z", serviceUsage: {}, totalUsageCreditsUsd: 99 },
      { date: "2026-11-22T00:00:00.000Z", serviceUsage: { ACTOR_COMPUTE_UNITS: { quantity: 60, baseAmountUsd: usd, baseUnitPriceUsd: 0.3, amountAfterVolumeDiscountUsd: usd, priceTiers: [] } }, totalUsageCreditsUsd: usd },
    ],
    totalUsageCreditsUsdBeforeVolumeDiscount: 99 + usd,
    totalUsageCreditsUsdAfterVolumeDiscount: 99 + usd,
  },
});

type Route = { status?: number; body: unknown } | Error;

function deps(routes: Record<string, Route>, missing: ProviderId[] = []) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const d: ReconcileDeps = {
    env: () => undefined,
    credentials: (p): Credentials => (missing.includes(p) ? { missing: `${p.toUpperCase()}_ADMIN_KEY` } : { headers: { "x-test-key": p } }),
    fetch: async (url, init) => {
      calls.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      const host = new URL(url).hostname;
      const r = routes[host];
      if (!r) throw new Error(`unexpected call to ${url}`);
      if (r instanceof Error) throw r;
      return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
    },
  };
  return { d, calls };
}

const ours = (usd: number, unpricedEvents = 0) => ({ usd, unpricedEvents });

describe("compare", () => {
  it("allows max(5% of theirs, $5)", () => {
    expect(compare(96, 100)).toBe("ok");
    expect(compare(10, 14.9)).toBe("ok"); // under $5 apart
    expect(compare(200, 212)).toBe("drift"); // $12 apart, 5% is $10.60
    expect(compare(0, 6)).toBe("drift");
  });

  it("takes the tolerance from env", () => {
    const t = thresholdFrom((n) => ({ COST_RECONCILE_DRIFT_PCT: "0.1", COST_RECONCILE_DRIFT_MIN_USD: "1" } as Record<string, string>)[n]);
    expect(t).toEqual({ pct: 0.1, minUsd: 1 });
    expect(compare(200, 212, t)).toBe("ok");
    expect(thresholdFrom(() => "nonsense")).toEqual({ pct: 0.05, minUsd: 5 });
  });
});

describe("reconcileProvider", () => {
  it("Anthropic: reads the cost analytics total in cents and is ok within tolerance", async () => {
    const { d, calls } = deps({ "api.anthropic.com": { body: anthropicAnswer("4128.000000") } });
    const row = await reconcileProvider(DAY, "anthropic", ours(40), d);
    expect(row).toMatchObject({ day: DAY, provider: "anthropic", ours_usd: 40, theirs_usd: 41.28, status: "ok" });
    expect(row.note).toMatch(/account-wide/);
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v1/organizations/analytics/cost");
    expect(u.searchParams.get("starting_at")).toBe("2026-11-22T00:00:00Z");
    expect(u.searchParams.get("ending_at")).toBe("2026-11-23T00:00:00Z");
    expect(calls[0].headers["anthropic-beta"]).toBe("analytics-usage-cost-2026-08-24");
    expect(calls[0].headers["x-test-key"]).toBe("anthropic");
  });

  it("Anthropic: drift when theirs is far above ours", async () => {
    const { d } = deps({ "api.anthropic.com": { body: anthropicAnswer("41280.000000") } });
    const row = await reconcileProvider(DAY, "anthropic", ours(300), d);
    expect(row).toMatchObject({ theirs_usd: 412.8, status: "drift" });
  });

  it("Anthropic: unreconciled while the day's data is not final", async () => {
    const { d } = deps({ "api.anthropic.com": { body: anthropicAnswer("100.000000", "2026-11-22T18:00:00Z") } });
    const row = await reconcileProvider(DAY, "anthropic", ours(1), d);
    expect(row).toMatchObject({ status: "unreconciled", theirs_usd: null });
    expect(row.note).toMatch(/not final/);
  });

  it("OpenAI: sums the day's bucket results in dollars", async () => {
    const { d, calls } = deps({ "api.openai.com": { body: openaiAnswer([3.5, 1.25, 0.25]) } });
    const row = await reconcileProvider(DAY, "openai", ours(5), d);
    expect(row).toMatchObject({ theirs_usd: 5, status: "ok" });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe("/v1/organization/costs");
    expect(u.searchParams.get("start_time")).toBe(String(Date.UTC(2026, 10, 22) / 1000));
    expect(u.searchParams.get("bucket_width")).toBe("1d");
  });

  it("OpenAI: drift", async () => {
    const { d } = deps({ "api.openai.com": { body: openaiAnswer([150]) } });
    expect((await reconcileProvider(DAY, "openai", ours(20), d)).status).toBe("drift");
  });

  it("Apify: takes only the asked day from the monthly usage", async () => {
    const { d, calls } = deps({ "api.apify.com": { body: apifyAnswer(12.5) } });
    const row = await reconcileProvider(DAY, "apify", ours(12), d);
    expect(row).toMatchObject({ theirs_usd: 12.5, status: "ok" });
    expect(calls[0].url).toBe("https://api.apify.com/v2/users/me/usage/monthly?date=2026-11-22");
  });

  it("a missing admin key is unreconciled, and no call is made", async () => {
    const { d, calls } = deps({}, ["anthropic", "openai"]);
    for (const p of ["anthropic", "openai"] as const) {
      const row = await reconcileProvider(DAY, p, ours(3), d);
      expect(row).toMatchObject({ status: "unreconciled", theirs_usd: null, ours_usd: 3 });
      expect(row.note).toMatch(/_ADMIN_KEY is not set/);
    }
    expect(calls).toEqual([]);
  });

  it("a provider error is an error, with the status in the note", async () => {
    const { d } = deps({ "api.openai.com": { status: 500, body: "upstream down" }, "api.anthropic.com": new Error("connect timeout"), "api.apify.com": { body: "<html>" } });
    const o = await reconcileProvider(DAY, "openai", ours(1), d);
    expect(o).toMatchObject({ status: "error", theirs_usd: null });
    expect(o.note).toMatch(/answered 500/);
    expect((await reconcileProvider(DAY, "anthropic", ours(1), d)).note).toMatch(/could not be reached: connect timeout/);
    expect((await reconcileProvider(DAY, "apify", ours(1), d)).status).toBe("error");
  });

  it("an answer in an undocumented shape is unreconciled, not guessed", async () => {
    const { d } = deps({ "api.openai.com": { body: { buckets: [] } } });
    expect((await reconcileProvider(DAY, "openai", ours(1), d)).status).toBe("unreconciled");
  });

  it("says when some of our events have no price", async () => {
    const { d } = deps({ "api.openai.com": { body: openaiAnswer([1]) } });
    expect((await reconcileProvider(DAY, "openai", ours(1, 3), d)).note).toMatch(/3 of our events/);
  });
});

describe("reconcileDay", () => {
  it("checks every provider with a billing API or credit balance, and marks credit-only ones unreconciled", async () => {
    const { d } = deps({
      "api.anthropic.com": { body: anthropicAnswer("1000.000000") },
      "api.openai.com": { body: openaiAnswer([2]) },
      "api.apify.com": { body: apifyAnswer(3) },
    });
    const rows = await reconcileDay(DAY, { anthropic: ours(10), openai: ours(2), apify: ours(3) }, d);
    expect(rows.map((r) => r.provider).sort()).toEqual([...RECONCILED].sort());
    expect(RECONCILED).not.toContain("gemini");
    expect(rows.find((r) => r.provider === "gamma")).toMatchObject({ status: "unreconciled", ours_usd: 0 });
    expect(rows.filter((r) => ["anthropic", "openai", "apify"].includes(r.provider)).every((r) => r.status === "ok")).toBe(true);
  });
});

describe("database side", () => {
  it("reads ours from cost_summary grouped by provider, and upserts on day+provider", async () => {
    const rpcCalls: unknown[] = [];
    let upserted: { rows: any[]; opts: unknown } | null = null;
    const db = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { data: [{ cost_summary: { provider: "openai", cost_usd: 1.5, unpriced_events: 2 } }, { provider: "apify", cost_usd: "0.25", unpriced_events: 0 }, { provider: "nobody", cost_usd: 9 }], error: null };
      },
      from: (t: string) => ({ upsert: async (rows: any[], opts: unknown) => { upserted = { rows, opts }; expect(t).toBe("cost_reconciliation"); return { error: null }; } }),
    };
    expect(await oursForDay(db, DAY)).toEqual({ openai: { usd: 1.5, unpricedEvents: 2, unattributedUsd: 0 }, apify: { usd: 0.25, unpricedEvents: 0, unattributedUsd: 0 } });
    expect(rpcCalls[0]).toEqual({ fn: "cost_summary", args: { p_from: "2026-11-22T00:00:00.000Z", p_to: "2026-11-23T00:00:00.000Z", p_group: ["provider"], p_filters: {} } });
    await saveRows(db, [{ day: DAY, provider: "openai", ours_usd: 1, theirs_usd: 1, status: "ok", note: "" }]);
    expect(upserted!.opts).toEqual({ onConflict: "day,provider" });
    expect(upserted!.rows[0]).toMatchObject({ day: DAY, provider: "openai", status: "ok" });
  });

  it("days are UTC", () => {
    expect(daysAgo(new Date("2026-11-23T00:30:00Z"), 1)).toBe("2026-11-22");
    expect(daysAgo(new Date("2026-03-01T23:59:00Z"), 1)).toBe("2026-02-28");
  });
});

describe("this tool's own share of a shared organization", () => {
  /** A fake routed by path, so key lists and cost reports on one host answer differently. */
  function pathDeps(routes: Record<string, unknown | ((u: URL) => { status?: number; body: unknown; headers?: Record<string, string> })>, own: Partial<Record<ProviderId, string | null>>) {
    const calls: URL[] = [];
    const slept: number[] = [];
    const d: ReconcileDeps = {
      env: () => undefined,
      credentials: (p): Credentials => ({ headers: { "x-test-key": p } }),
      ownKey: (p) => own[p] ?? null,
      sleep: async (ms) => { slept.push(ms); },
      fetch: async (url) => {
        const u = new URL(url);
        calls.push(u);
        const r = routes[u.pathname];
        if (r === undefined) throw new Error(`unexpected call to ${url}`);
        const a = typeof r === "function" ? (r as (u: URL) => { status?: number; body: unknown; headers?: Record<string, string> })(u) : { body: r };
        return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: a.headers });
      },
    };
    return { d, calls, slept };
  }

  it("matches a key to a provider's hint by its visible start and end only", () => {
    expect(hintMatches("sk-ant-api03-R2D...igAA", "sk-ant-api03-R2Dxxxxxxxxxxxxxxxxxxxxxxx-igAA")).toBe(true);
    expect(hintMatches("sk-ant-api03-R2D...igAA", "sk-ant-api03-ZZZxxxxxxxxxxxxxxxxxxxxxxx-igAA")).toBe(false);
    expect(hintMatches("sk-abc...def", "sk-abcXXXXXXXXdef")).toBe(true);
    expect(hintMatches("sk...", "sk-anything")).toBe(false);
    expect(hintMatches(null, "sk-anything")).toBe(false);
    // OpenAI hides the middle with a run of asterisks.
    const openaiKey = "sk-proj-" + "x".repeat(20) + "8aQA";
    expect(hintMatches("sk-proj-" + "*".repeat(20) + "8aQA", openaiKey)).toBe(true);
    expect(hintMatches("sk-proj-" + "*".repeat(150) + "8aQA", openaiKey)).toBe(true);
    expect(hintMatches("sk-proj-" + "*".repeat(20) + "vg4A", openaiKey)).toBe(false);
  });

  it("Anthropic: reads the bill of this tool's key only, found once in the organization's key list", async () => {
    clearOwnKeyCache();
    const key = "sk-ant-api03-MINExxxxxxxxxxxxxxxxxxxxxxxx-kEY1";
    const { d, calls } = pathDeps({
      "/v1/organizations/api_keys": (u: URL) => (u.searchParams.get("after_id")
        ? { body: { data: [{ id: "apikey_mine", partial_key_hint: "sk-ant-api03-MIN...kEY1" }], has_more: false, last_id: "apikey_mine" } }
        : { body: { data: [{ id: "apikey_other", partial_key_hint: "sk-ant-api03-OTH...zzzz" }], has_more: true, last_id: "apikey_other" } }),
      "/v1/organizations/analytics/cost": anthropicAnswer("1234.000000"),
    }, { anthropic: key });
    const row = await reconcileProvider(DAY, "anthropic", ours(12.34), d);
    expect(row).toMatchObject({ theirs_usd: 12.34, status: "ok" });
    expect(row.note).toMatch(/this tool's own API key only/);
    expect(row.note).not.toMatch(/account-wide/);
    const cost = calls.find((u) => u.pathname === "/v1/organizations/analytics/cost")!;
    expect(cost.searchParams.getAll("api_key_ids[]")).toEqual(["apikey_mine"]);
    // The key list is read once per process.
    await reconcileProvider("2026-11-21", "anthropic", ours(12.34), d);
    expect(calls.filter((u) => u.pathname === "/v1/organizations/api_keys")).toHaveLength(2);
    // The key itself never leaves the tool.
    expect(calls.map(String).join(" ")).not.toContain(key);
  });

  it("a tool with no key of its own for a provider is unreconciled, not compared with the whole bill", async () => {
    clearOwnKeyCache();
    const { d, calls } = pathDeps({}, { anthropic: null });
    const row = await reconcileProvider(DAY, "anthropic", ours(0), d);
    expect(row).toMatchObject({ status: "unreconciled", theirs_usd: null });
    expect(row.note).toMatch(/no Anthropic calls with a key of its own/);
    expect(calls).toHaveLength(0);
  });

  it("a key that is not in the admin key's organization is unreconciled", async () => {
    clearOwnKeyCache();
    const { d } = pathDeps({ "/v1/organizations/api_keys": { data: [{ id: "apikey_x", partial_key_hint: "sk-ant-api03-XXX...xxxx" }], has_more: false, last_id: "apikey_x" } }, { anthropic: "sk-ant-api03-MINExxxxxxxxxxxx-kEY1" });
    const row = await reconcileProvider(DAY, "anthropic", ours(1), d);
    expect(row).toMatchObject({ status: "unreconciled" });
    expect(row.note).toMatch(/not in the key list/);
    // It says what it looked through, in the provider's own masked forms only.
    expect(row.note).toMatch(/looked through 1 key\(s\); their masked forms look like sk-ant-api03-XXX\.\.\.xxxx/);
  });

  it("OpenAI: groups the day's costs by key and sums only this tool's keys, across projects", async () => {
    clearOwnKeyCache();
    const key = "sk-proj-MINExxxxxxxxxxxxxxxxxxxxQ9z";
    const bucket = (results: Array<[string, number]>) => ({ object: "page", data: [{ object: "bucket", start_time: Date.UTC(2026, 10, 22) / 1000, end_time: Date.UTC(2026, 10, 23) / 1000, results: results.map(([id, v]) => ({ object: "organization.costs.result", amount: { value: v, currency: "usd" }, api_key_id: id })) }], has_more: false, next_page: null });
    const { d, calls } = pathDeps({
      "/v1/organization/projects": { data: [{ id: "proj_a" }, { id: "proj_b" }], has_more: false, last_id: "proj_b" },
      "/v1/organization/projects/proj_a/api_keys": { data: [{ id: "key_other", redacted_value: "sk-oth...aaa" }], has_more: false, last_id: "key_other" },
      "/v1/organization/projects/proj_b/api_keys": { data: [{ id: "key_mine", redacted_value: "sk-proj-MIN...Q9z" }], has_more: false, last_id: "key_mine" },
      "/v1/organization/costs": bucket([["key_mine", 3.5], ["key_other", 40], ["key_mine", 0.5]]),
    }, { openai: key });
    const row = await reconcileProvider(DAY, "openai", ours(4), d);
    expect(row).toMatchObject({ theirs_usd: 4, status: "ok" });
    expect(calls.find((u) => u.pathname === "/v1/organization/costs")!.searchParams.get("group_by")).toBe("api_key_id");
  });

  it("waits and tries again when a billing API says too many requests", async () => {
    clearOwnKeyCache();
    let n = 0;
    const { d, slept } = pathDeps({
      "/v1/organization/costs": () => (++n < 3 ? { status: 429, body: { error: "slow down" }, headers: { "retry-after": "3" } } : { body: openaiAnswer([2]) }),
    }, {});
    d.ownKey = undefined;
    const row = await reconcileProvider(DAY, "openai", ours(2), d);
    expect(row).toMatchObject({ theirs_usd: 2, status: "ok" });
    expect(slept).toEqual([3000, 3000]);
  });

  it("waits long enough for a per-minute limit when the provider names no wait", async () => {
    clearOwnKeyCache();
    let n = 0;
    const { d, slept } = pathDeps({
      "/v1/organization/costs": () => (++n < 4 ? { status: 429, body: { error: "slow down" } } : { body: openaiAnswer([2]) }),
    }, {});
    d.ownKey = undefined;
    const row = await reconcileProvider(DAY, "openai", ours(2), d);
    expect(row).toMatchObject({ theirs_usd: 2, status: "ok" });
    expect(slept).toEqual([10_000, 20_000, 30_000]);
  });

  it("OpenAI: days checked at the same time read the organization's key list once", async () => {
    clearOwnKeyCache();
    const key = "sk-proj-MINExxxxxxxxxxxxxxxxxxxxQ9z";
    const { d, calls } = pathDeps({
      "/v1/organization/projects": { data: [{ id: "proj_a" }], has_more: false, last_id: "proj_a" },
      "/v1/organization/projects/proj_a/api_keys": { data: [{ id: "key_mine", redacted_value: "sk-proj-MIN...Q9z" }], has_more: false, last_id: "key_mine" },
      "/v1/organization/costs": openaiAnswer([1]),
    }, { openai: key });
    await Promise.all([reconcileProvider("2026-11-22", "openai", ours(1), d), reconcileProvider("2026-11-23", "openai", ours(1), d)]);
    expect(calls.filter((u) => u.pathname === "/v1/organization/projects")).toHaveLength(1);
    expect(calls.filter((u) => u.pathname === "/v1/organization/projects/proj_a/api_keys")).toHaveLength(1);
  });
});
