// @vitest-environment node
// The gOS usage push (guide §15). The logic file is the same text as AdVisor's
// _shared/gos-usage.ts, so these cases match AdVisor's tests, with the
// Socialytics mapping (content calendars) added below.
import { describe, expect, it } from "vitest";
import { authServiceFor, GOS_AUTH_DEV, GOS_AUTH_PROD } from "../../functions/_shared/gos/authService.ts";
import {
  eventIdFor,
  MAX_BATCH,
  pushUsage,
  readAnswer,
  toBatches,
  toUsageEvent,
  tokenFingerprint,
  type OutboxRow,
  type PushDeps,
  type PushState,
  type SourceRow,
  type UsageConfig,
  type UsageEvent,
} from "../../functions/gos-usage-push/usage.ts";

const CFG: UsageConfig = {
  tool: "advisor",
  outputKinds: { competitor_sweep: "competitor_report", ad_test: "ad_prediction" },
  quantityKeys: { competitor_sweep: "total_ads" },
  defaultMachineActor: "schedule",
  dropAttrs: ["error"],
};

const RUN = "7a0e9a56-1111-4222-8333-944455556666";
const TEST = "0b1c2d3e-aaaa-4bbb-8ccc-dddddddddddd";

function row(over: Partial<SourceRow> = {}): SourceRow {
  return {
    occurred_at: "2026-11-20 14:03:11.123+00",
    event: "execution-start",
    execution_id: RUN,
    user_email: "dana@moburst.com",
    company_slug: "nanobebe",
    duration_ms: null,
    ok: null,
    props: { kind: "competitor_sweep", report_type: "weekly" },
    via_api: false,
    via_schedule: null,
    ...over,
  };
}

describe("authServiceFor (shared with gos-auth-bridge)", () => {
  it("AUTH_SERVICE_URL wins, without a trailing slash", () => {
    expect(authServiceFor("https://advisor.moburst.ai", "https://auth.example.test/")).toBe("https://auth.example.test");
  });
  it("dev portal and Lovable hosts use dev; production and no origin use prod", () => {
    expect(authServiceFor("https://advisor.mobtools.ai")).toBe(GOS_AUTH_DEV);
    expect(authServiceFor("https://x.lovable.app")).toBe(GOS_AUTH_DEV);
    expect(authServiceFor("https://advisor.moburst.ai")).toBe(GOS_AUTH_PROD);
    expect(authServiceFor("")).toBe(GOS_AUTH_PROD);
  });
});

describe("mapping gos_events rows to §15 events", () => {
  it("execution-start: underscore name, stable id, client, person, kind, attrs", async () => {
    const ev = await toUsageEvent(row(), CFG);
    expect(ev).toEqual({
      event_id: `advisor-start-${RUN}`,
      event_name: "execution_start",
      occurred_at: "2026-11-20T14:03:11.123Z",
      execution_id: RUN,
      execution_kind: "competitor_sweep",
      company_slug: "nanobebe",
      user_email: "dana@moburst.com",
      actor_kind: "user",
      attrs: { report_type: "weekly" },
    });
  });

  it("execution-complete carries status and duration", async () => {
    const ok = await toUsageEvent(row({ event: "execution-complete", ok: true, duration_ms: 184213.4, props: { kind: "competitor_sweep", status: "completed", total_ads: 17 } }), CFG);
    expect(ok).toMatchObject({ event_name: "execution_complete", status: "success", duration_ms: 184213, event_id: `advisor-complete-${RUN}` });
    const failed = await toUsageEvent(row({ event: "execution-complete", ok: false, props: { kind: "competitor_sweep", status: "error" } }), CFG);
    expect(failed?.status).toBe("failed");
    const cancelled = await toUsageEvent(row({ event: "execution-complete", ok: false, props: { kind: "competitor_sweep", status: "cancelled" } }), CFG);
    expect(cancelled?.status).toBe("cancelled");
    const noDuration = await toUsageEvent(row({ event: "execution-complete", ok: true, duration_ms: null }), CFG);
    expect(noDuration).not.toHaveProperty("duration_ms");
  });

  it("output-delivered carries output kind, reference and quantity", async () => {
    const ev = await toUsageEvent(row({ event: "output-delivered", ok: true, props: { kind: "competitor_sweep", total_ads: 55, has_deck: true } }), CFG);
    expect(ev).toMatchObject({ event_name: "output_delivered", output_kind: "competitor_report", output_ref: RUN, quantity: 55, event_id: `advisor-output-${RUN}` });
    const test = await toUsageEvent(row({ event: "output-delivered", execution_id: TEST, ok: true, props: { kind: "ad_test", band: "high", score: 71 } }), CFG);
    expect(test).toMatchObject({ output_kind: "ad_prediction", attrs: { band: "high", score: 71 } });
    expect(test).not.toHaveProperty("quantity");
  });

  it("actor: a person is user; an API demo is api; a sweep with nobody is schedule; an ad test with nobody is system", async () => {
    expect((await toUsageEvent(row({ user_email: null, via_api: true }), CFG))?.actor_kind).toBe("api");
    expect((await toUsageEvent(row({ user_email: null }), CFG))?.actor_kind).toBe("schedule");
    expect((await toUsageEvent(row({ user_email: null, via_schedule: false, props: { kind: "ad_test" } }), CFG))?.actor_kind).toBe("system");
    const person = await toUsageEvent(row({ via_api: true }), CFG);
    expect(person?.actor_kind).toBe("user");
    expect(person?.user_email).toBe("dana@moburst.com");
  });

  it("a missing client key is omitted, never guessed; internal error text is not sent", async () => {
    const ev = await toUsageEvent(row({ company_slug: null, event: "execution-complete", ok: false, props: { kind: "ad_test", tribe_status: "failed", error: "TRIBE 500 at worker 3" } }), CFG);
    expect(ev).not.toHaveProperty("company_slug");
    expect(ev?.attrs).toEqual({ tribe_status: "failed" });
  });

  it("tool-open, unknown events and rows without an execution are not sent", async () => {
    expect(await toUsageEvent(row({ event: "tool-open" }), CFG)).toBeNull();
    expect(await toUsageEvent(row({ event: "something-else" }), CFG)).toBeNull();
    expect(await toUsageEvent(row({ execution_id: "" }), CFG)).toBeNull();
    expect(await toUsageEvent(row({ occurred_at: "not a date" }), CFG)).toBeNull();
  });

  it("event ids are stable, 8 to 64 characters, and hashed when the execution id is too long", async () => {
    const a = await eventIdFor("advisor", "execution_complete", RUN);
    expect(a).toBe(await eventIdFor("advisor", "execution_complete", RUN));
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(64);
    const long = await eventIdFor("socialytics", "output_delivered", `trends:${"x".repeat(80)}`);
    expect(long).toMatch(/^socialytics-output-[0-9a-f]{40}$/);
    expect(long).toBe(await eventIdFor("socialytics", "output_delivered", `trends:${"x".repeat(80)}`));
    expect(await eventIdFor("advisor", "execution_start", RUN)).not.toBe(a);
  });
});

describe("batching", () => {
  it("at most 500 per batch, in order, nothing lost", () => {
    const items = Array.from({ length: 1201 }, (_, i) => i);
    const b = toBatches(items);
    expect(b.map((x) => x.length)).toEqual([500, 500, 201]);
    expect(b.flat()).toEqual(items);
    expect(toBatches([])).toEqual([]);
    expect(toBatches(items, 10_000)[0].length).toBe(MAX_BATCH);
    expect(toBatches([1, 2, 3], 0).length).toBe(3);
  });
});

describe("reading the 202 answer", () => {
  const batch = [{ event_id: "advisor-start-a" }, { event_id: "advisor-start-b" }] as UsageEvent[];
  it("reads counts and rejected items given as ids, objects or indexes", () => {
    const a = readAnswer({ accepted: 0, duplicates: 0, rejected: ["advisor-start-a", { index: 1, detail: "bad status" }, { event_id: "elsewhere" }] }, batch);
    expect([...a.rejected]).toEqual([["advisor-start-a", "rejected"], ["advisor-start-b", "bad status"]]);
    expect(a.unmatched).toEqual([{ event_id: "elsewhere" }]);
    expect(readAnswer(null, batch)).toMatchObject({ accepted: 0, duplicates: 0 });
  });
});

/** An Auth Service and a database in memory. */
function harness(opts: { pending: SourceRow[]; answer?: (body: { events: UsageEvent[] }, call: number) => Response | Promise<Response>; token?: string | null; recordFails?: boolean }) {
  const outbox = new Map<string, OutboxRow>();
  let state: PushState | null = null;
  const calls: Array<{ url: string; headers: Record<string, string>; events: UsageEvent[] }> = [];
  const received = new Map<string, number>();
  const logs: Array<Record<string, unknown>> = [];
  let recordFails = !!opts.recordFails;
  const defaultAnswer = (body: { events: UsageEvent[] }) => {
    let accepted = 0, duplicates = 0;
    for (const e of body.events) {
      if (received.has(e.event_id)) duplicates++;
      else accepted++;
      received.set(e.event_id, (received.get(e.event_id) ?? 0) + 1);
    }
    return new Response(JSON.stringify({ accepted, duplicates, rejected: [], tool_id: "advisor" }), { status: 202 });
  };
  const deps: PushDeps = {
    cfg: CFG,
    token: opts.token === undefined ? "mbt_usg_test" : opts.token,
    authServiceUrl: "https://auth.example.test",
    userAgent: "advisor/1.0 (gos-usage-push)",
    fetch: async (url, init) => {
      const body = JSON.parse(String(init.body)) as { events: UsageEvent[] };
      calls.push({ url, headers: init.headers as Record<string, string>, events: body.events });
      return (opts.answer ?? defaultAnswer)(body, calls.length);
    },
    async loadPending(since, limit) {
      return opts.pending
        .filter((r) => !outbox.has(`${r.event}|${r.execution_id}`) && new Date(r.occurred_at) >= new Date(since))
        .slice(0, limit);
    },
    async record(rows) {
      if (recordFails) throw new Error("database unavailable");
      for (const r of rows) outbox.set(`${r.source_event}|${r.execution_id}`, r);
    },
    async readState() { return state; },
    async writeState(patch) { state = { ...(state ?? { blocked_token_fp: null, blocked_reason: null, blocked_at: null }), ...patch }; },
    now: () => new Date("2026-11-24T12:00:00Z"),
    log: (l) => logs.push(l),
  };
  return { deps, outbox, calls, received, logs, getState: () => state, setRecordFails: (v: boolean) => { recordFails = v; } };
}

function history(n: number): SourceRow[] {
  const out: SourceRow[] = [];
  for (let i = 0; i < n; i++) {
    const id = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const at = new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString();
    out.push(row({ execution_id: id, occurred_at: at }));
    out.push(row({ execution_id: id, occurred_at: at, event: "execution-complete", ok: true, duration_ms: 1000 }));
  }
  return out;
}

const SINCE = "2026-01-01T00:00:00.000Z";

describe("pushUsage", () => {
  it("posts batches of up to 500 with the token, User-Agent and JSON headers, and records them", async () => {
    const h = harness({ pending: history(600) });
    const r = await pushUsage(h.deps, { since: SINCE });
    expect(r).toMatchObject({ status: "sent", posted: 1200, accepted: 1200, duplicates: 0, batches: 3 });
    expect(h.calls.map((c) => c.events.length)).toEqual([500, 500, 200]);
    expect(h.calls[0].url).toBe("https://auth.example.test/usage/events");
    expect(h.calls[0].headers).toMatchObject({ "X-Tool-Token": "mbt_usg_test", "User-Agent": "advisor/1.0 (gos-usage-push)", "Content-Type": "application/json", Accept: "application/json" });
    expect(h.outbox.size).toBe(1200);
    expect(h.getState()?.last_result).toMatchObject({ status: "sent" });
  });

  it("a second run sends nothing: what was answered is in the outbox", async () => {
    const h = harness({ pending: history(3) });
    await pushUsage(h.deps, { since: SINCE });
    const again = await pushUsage(h.deps, { since: SINCE });
    expect(again).toMatchObject({ status: "nothing_to_send", posted: 0 });
    expect(h.calls.length).toBe(1);
  });

  it("pages through more than one read, and stops at maxPages", async () => {
    const h = harness({ pending: history(30) });
    const r = await pushUsage(h.deps, { since: SINCE, pageSize: 20, maxPages: 2 });
    expect(r).toMatchObject({ status: "more_pending", posted: 40 });
    const rest = await pushUsage(h.deps, { since: SINCE, pageSize: 20, maxPages: 2 });
    expect(rest).toMatchObject({ status: "sent", posted: 20 });
    expect(h.outbox.size).toBe(60);
  });

  it("backfill: only rows from the given day on", async () => {
    const h = harness({ pending: history(10) });
    const r = await pushUsage(h.deps, { since: new Date(Date.UTC(2026, 9, 1) + 5 * 60_000).toISOString() });
    expect(r.posted).toBe(10);
    expect([...h.received.keys()].every((id) => !id.endsWith("000000000004"))).toBe(true);
  });

  it("Auth Service down (network): nothing recorded, deferred, and the next run sends the same events", async () => {
    let down = true;
    const h = harness({
      pending: history(2),
      answer: (body) => {
        if (down) throw new TypeError("error sending request: connection refused");
        return new Response(JSON.stringify({ accepted: body.events.length, duplicates: 0, rejected: [] }), { status: 202 });
      },
    });
    const r = await pushUsage(h.deps, { since: SINCE });
    expect(r.status).toBe("deferred");
    expect(r.reason).toMatch(/connection refused/);
    expect(h.outbox.size).toBe(0);
    expect(h.logs.some((l) => l.event === "GOS_USAGE_PUSH_DEFERRED")).toBe(true);
    const firstIds = h.calls[0].events.map((e) => e.event_id);

    down = false;
    const next = await pushUsage(h.deps, { since: SINCE });
    expect(next).toMatchObject({ status: "sent", posted: 4 });
    expect(h.calls[1].events.map((e) => e.event_id)).toEqual(firstIds);
    expect(h.outbox.size).toBe(4);
  });

  it("a 5xx or 429 stops the run after the batches already answered", async () => {
    const h = harness({
      pending: history(300),
      answer: (body, call) => call === 1
        ? new Response(JSON.stringify({ accepted: body.events.length, duplicates: 0, rejected: [] }), { status: 202 })
        : new Response(JSON.stringify({ detail: "Service unavailable" }), { status: 503 }),
    });
    const r = await pushUsage(h.deps, { since: SINCE });
    expect(r).toMatchObject({ status: "deferred", posted: 500, batches: 1 });
    expect(r.reason).toMatch(/HTTP 503: Service unavailable/);
    expect(h.outbox.size).toBe(500);
  });

  it("401/403: stops, remembers the token was refused, does not retry it, and resumes with a new token or force", async () => {
    let status = 401;
    const h = harness({
      pending: history(1),
      answer: (body) => status === 202
        ? new Response(JSON.stringify({ accepted: body.events.length, duplicates: 0, rejected: [] }), { status: 202 })
        : new Response(JSON.stringify({ detail: "Invalid tool token" }), { status }),
    });
    const first = await pushUsage(h.deps, { since: SINCE });
    expect(first.status).toBe("blocked");
    expect(h.getState()?.blocked_token_fp).toBe(await tokenFingerprint("mbt_usg_test"));
    expect(h.outbox.size).toBe(0);

    const again = await pushUsage(h.deps, { since: SINCE });
    expect(again.status).toBe("blocked");
    expect(h.calls.length).toBe(1); // no call with the refused token

    status = 202;
    const forced = await pushUsage(h.deps, { since: SINCE, force: true });
    expect(forced.status).toBe("sent");
    expect(h.getState()?.blocked_token_fp).toBeNull();

    const h2 = harness({ pending: history(1), answer: () => new Response("{}", { status: 403 }) });
    await pushUsage(h2.deps, { since: SINCE });
    h2.deps.token = "mbt_usg_new";
    await pushUsage(h2.deps, { since: SINCE });
    expect(h2.calls.length).toBe(2); // a new token is tried
  });

  it("rejected events are recorded with the reason and logged, not resent", async () => {
    const h = harness({
      pending: history(1),
      answer: (body) => new Response(JSON.stringify({ accepted: 1, duplicates: 0, rejected: [{ event_id: body.events[1].event_id, detail: "status is required" }] }), { status: 202 }),
    });
    const r = await pushUsage(h.deps, { since: SINCE });
    expect(r).toMatchObject({ status: "sent", rejected: 1, accepted: 1 });
    const rows = [...h.outbox.values()];
    expect(rows.find((x) => x.status === "rejected")?.reject_reason).toBe("status is required");
    expect(h.logs.some((l) => l.event === "GOS_USAGE_PUSH_REJECTED")).toBe(true);
    expect((await pushUsage(h.deps, { since: SINCE })).posted).toBe(0);
  });

  it("sent but not recorded: the next run resends the same event ids and the service counts duplicates", async () => {
    const h = harness({ pending: history(2), recordFails: true });
    const r = await pushUsage(h.deps, { since: SINCE });
    expect(r.status).toBe("deferred");
    h.setRecordFails(false);
    const next = await pushUsage(h.deps, { since: SINCE });
    expect(next).toMatchObject({ status: "sent", accepted: 0, duplicates: 4 });
    expect([...h.received.values()].every((n) => n === 2)).toBe(true);
  });

  it("no token: sends nothing and says so", async () => {
    const h = harness({ pending: history(1), token: "" });
    expect((await pushUsage(h.deps, { since: SINCE })).status).toBe("not_configured");
    expect(h.calls.length).toBe(0);
  });

  it("dry run: maps and counts, posts and records nothing", async () => {
    const h = harness({ pending: [...history(2), row({ event: "tool-open" })] });
    const r = await pushUsage(h.deps, { since: SINCE, dryRun: true });
    expect(r).toMatchObject({ status: "dry_run", posted: 4, skipped: 1 });
    expect(r.sample?.[0].event_name).toBe("execution_start");
    expect(h.calls.length).toBe(0);
    expect(h.outbox.size).toBe(0);
    expect(h.getState()).toBeNull();
  });
});

describe("Socialytics content calendars", () => {
  const SOC: UsageConfig = { tool: "socialytics", outputKinds: { content_calendar: "content_calendar" }, quantityKeys: { content_calendar: "posts" }, defaultMachineActor: "schedule" };
  const REPORT = "5d0c3a1e-2222-4333-8444-555566667777";
  it("maps a report's three events, with posts as the delivered quantity", async () => {
    const base = { execution_id: REPORT, company_slug: "bader-law", user_email: null, via_api: false, via_schedule: null };
    const start = await toUsageEvent(row({ ...base, props: { kind: "content_calendar", report_type: "monthly" } }), SOC);
    expect(start).toMatchObject({ event_id: `socialytics-start-${REPORT}`, execution_kind: "content_calendar", actor_kind: "schedule", company_slug: "bader-law" });
    const done = await toUsageEvent(row({ ...base, event: "execution-complete", ok: true, duration_ms: 7 * 60000, props: { kind: "content_calendar", status: "completed" } }), SOC);
    expect(done).toMatchObject({ status: "success", duration_ms: 420000 });
    const failed = await toUsageEvent(row({ ...base, event: "execution-complete", ok: false, props: { kind: "content_calendar", status: "failed" } }), SOC);
    expect(failed?.status).toBe("failed");
    const out = await toUsageEvent(row({ ...base, event: "output-delivered", ok: true, props: { kind: "content_calendar", has_deck: true, posts: 24 } }), SOC);
    expect(out).toMatchObject({ output_kind: "content_calendar", quantity: 24, output_ref: REPORT, attrs: { has_deck: true, posts: 24 } });
  });
});

describe("client registration (POST /usage/clients)", () => {
  /** The harness, with a gOS that also answers /usage/clients and a client table in memory. */
  function withClients(opts: { pending: SourceRow[]; clients: Array<{ id: string; name: string }>; clientsAnswer?: () => Response }) {
    const h = harness({ pending: opts.pending });
    const slugs = new Map<string, string>();
    const registered: Array<{ external_id: string; name: string }> = [];
    const eventsFetch = h.deps.fetch;
    h.deps.fetch = async (url, init) => {
      if (!url.endsWith("/usage/clients")) return eventsFetch(url, init);
      const body = JSON.parse(String(init.body)) as { clients: Array<{ external_id: string; name: string }> };
      registered.push(...body.clients);
      if (opts.clientsAnswer) return opts.clientsAnswer();
      const resolved = Object.fromEntries(body.clients.map((c) => [c.external_id, c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")]));
      return new Response(JSON.stringify({ resolved, created: body.clients.length, already_known: 0, linked: body.clients.length, pending_review: Object.values(resolved) }), { status: 200 });
    };
    h.deps.unslugged = async () => opts.clients.filter((c) => !slugs.has(c.id)).map((c) => ({ external_id: c.id, name: c.name }));
    h.deps.saveSlugs = async (resolved) => {
      for (const [id, slug] of Object.entries(resolved)) slugs.set(id, slug);
      // The view reads the slug live, so the pending rows of that client now carry it.
      for (const r of opts.pending) if (!r.company_slug && r.props?.client_id && resolved[String(r.props.client_id)]) r.company_slug = resolved[String(r.props.client_id)];
      return Object.keys(resolved).length;
    };
    return { ...h, slugs, registered };
  }
  const recent = (id: string, clientId: string) => row({ execution_id: id, company_slug: null, occurred_at: "2026-11-24T11:00:00Z", props: { kind: "competitor_sweep", client_id: clientId } });

  it("registers clients without a slug first, saves the slugs, and this run's events carry them", async () => {
    const h = withClients({ pending: [recent(RUN, "c-1")], clients: [{ id: "c-1", name: "Nanobebe" }] });
    const r = await pushUsage(h.deps, { since: SINCE });
    expect(h.registered).toEqual([{ external_id: "c-1", name: "Nanobebe" }]);
    expect(r).toMatchObject({ clients_registered: 1, slugs_saved: 1, posted: 1, pending_review: ["nanobebe"] });
    expect(h.calls.find((c) => c.url.endsWith("/usage/events"))!.events[0].company_slug).toBe("nanobebe");
    // A second run has nobody left to register.
    const again = await pushUsage(h.deps, { since: SINCE });
    expect(again.clients_registered).toBe(0);
  });

  it("holds every event without a slug while registration fails, and sends the rest", async () => {
    const h = withClients({
      pending: [recent(RUN, "c-1"), row({ execution_id: TEST, occurred_at: "2026-10-01T00:00:00Z", company_slug: null }), row({ execution_id: "e-3", occurred_at: "2026-11-24T10:00:00Z" })],
      clients: [{ id: "c-1", name: "Nanobebe" }],
      clientsAnswer: () => new Response("upstream down", { status: 503 }),
    });
    const r = await pushUsage(h.deps, { since: SINCE });
    expect(r).toMatchObject({ held: 2, posted: 1 });
    expect(h.logs.some((l) => l.event === "GOS_USAGE_CLIENTS_REGISTER_FAILED")).toBe(true);
  });

  it("once registration works, an event still without a slug waits 3 days, then goes without one", async () => {
    const h = withClients({
      pending: [recent(RUN, "unknown"), row({ execution_id: TEST, occurred_at: "2026-11-01T00:00:00Z", company_slug: null })],
      clients: [],
    });
    const r = await pushUsage(h.deps, { since: SINCE });
    expect(r).toMatchObject({ held: 1, posted: 1 });
    const sent = h.calls.find((c) => c.url.endsWith("/usage/events"))!.events[0];
    expect(sent.execution_id).toBe(TEST);
    expect(sent.company_slug).toBeUndefined();
  });

  it("a refused token on registration blocks the run like a refused event batch", async () => {
    const h = withClients({ pending: [recent(RUN, "c-1")], clients: [{ id: "c-1", name: "Nanobebe" }], clientsAnswer: () => new Response(JSON.stringify({ detail: "revoked" }), { status: 401 }) });
    const r = await pushUsage(h.deps, { since: SINCE });
    expect(r).toMatchObject({ status: "blocked", posted: 0 });
    expect(h.getState()?.blocked_token_fp).toBeTruthy();
  });

  it("a dry run only counts the clients it would register", async () => {
    const h = withClients({ pending: [recent(RUN, "c-1")], clients: [{ id: "c-1", name: "Nanobebe" }] });
    const r = await pushUsage(h.deps, { since: SINCE, dryRun: true });
    expect(r).toMatchObject({ status: "dry_run", clients_registered: 1 });
    expect(h.registered).toEqual([]);
  });
});
