// @vitest-environment node
// The connector for machine clients and for work, end to end over HTTP with
// the real MCP SDK: a Socialytics API key as the bearer goes through the
// API's own key lookup (scopes, client reach, the per-minute limit); the key
// is offered the tools its scopes allow; the API tools list and call the read
// endpoints with the key's reach; every work tool answers an estimate and a
// confirm_token first and starts nothing, and starts the work, once, only
// when called again with that token and the same arguments; the cost summary
// needs the costs scope.
import { beforeEach, describe, expect, it } from "vitest";
import type { ActionClaim, ActionRunRecord, ActionRunStore } from "../../functions/_shared/api/actions";
import { hashKey } from "../../functions/_shared/api/keys";
import type { CostStore } from "../../functions/_shared/cost/routes";
import { CLIENT, REPORT } from "../_shared/socialytics-api/fixtures";
import { emptyData, makeFakeStore } from "../_shared/socialytics-api/store.fake";
import type { McpAuditRow } from "../../functions/mcp/audit";
import { connectorFetch, type ConnectorDeps } from "../../functions/mcp/server";

const PROJECT = "https://rwouwxqggjjacbpbhqsn.supabase.co";
const ENDPOINT = `${PROJECT}/mcp`;
const OWNER = "00000000-0000-4000-8000-0000000000aa";
const CALM = { ...CLIENT, id: "c-calm", name: "Calm", company_slug: "calm", created_at: "2026-09-01T00:00:00.000Z" };
const KEYS: Record<string, { id: string; scopes: string[]; client_ids: string[] | null; minute_count?: number }> = {
  soc_reader: { id: "k-read", scopes: ["read"], client_ids: ["c-bader"] },
  soc_worker: { id: "k-run", scopes: ["read", "run"], client_ids: ["c-bader"] },
  soc_finance: { id: "k-costs", scopes: ["costs"], client_ids: null },
  soc_busy: { id: "k-busy", scopes: ["read"], client_ids: null, minute_count: 121 },
};

let audit: McpAuditRow[] = [];
let calls: Array<{ name: string; body: unknown; actAs: string }> = [];
let fetchConnector: (req: Request) => Promise<Response>;

function memoryRuns(): ActionRunStore {
  const rows = new Map<string, ActionRunRecord>();
  const k = (c: ActionClaim) => `${c.owner}|${c.action}|${c.idempotency_key}`;
  return {
    async claim(c) { const e = rows.get(k(c)); if (e) return { claimed: false, existing: e }; rows.set(k(c), { status: "running", request_hash: c.request_hash, response_status: null, response: null }); return { claimed: true }; },
    async finish(c, res) { rows.set(k(c), { status: "done", request_hash: c.request_hash, response_status: res.status, response: res.body }); },
    async release(c) { rows.delete(k(c)); },
  };
}

const costs: CostStore = {
  summary: async (_f, _t, group) => (group.includes("feature")
    ? [{ feature: "post.ad_hoc", cost_usd: 0.5, events: 10, unattributed_usd: 0, unattributed_events: 0, estimated_usd: 0, unpriced_events: 0, quantities: {} }]
    : [{ cost_usd: 12.5, events: 40, unattributed_usd: 0, unattributed_events: 0, estimated_usd: 0, unpriced_events: 0, quantities: {} }]),
  events: async () => [],
};

beforeEach(async () => {
  audit = [];
  calls = [];
  const hashes = Object.fromEntries(await Promise.all(Object.keys(KEYS).map(async (k) => [await hashKey(k), k])));
  const store = makeFakeStore(emptyData({ clients: [CLIENT, CALM], reports: [REPORT] }));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("test-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const deps: ConnectorDeps = {
    projectUrl: PROJECT,
    verify: async () => null,
    reads: () => ({ roles: async () => [], clientIds: async () => [] }),
    tools: () => { throw new Error("no person here"); },
    personReads: () => { throw new Error("no person here"); },
    writes: () => { throw new Error("no person here"); },
    touch: async () => 1,
    audit: async (row) => { audit.push(row); },
    keys: {
      touchKey: async (h) => {
        const name = hashes[h];
        if (!name) return null;
        const k = KEYS[name];
        return { id: k.id, name, key_prefix: name, scopes: k.scopes, company_slugs: null, client_ids: k.client_ids, rate_limit_per_minute: 120, expires_at: null, revoked_at: null, minute_count: k.minute_count ?? 1 } as never;
      },
      clientsForScope: async () => [{ id: "c-bader", company_slug: "bader-law" }, { id: "c-calm", company_slug: "calm" }],
    },
    keyTools: () => ({ store, analytics: async () => ({ ok: true, status: 200, data: {} }), trendThemes: async () => ({ collected: false, themes: [] }), apiUrl: `${PROJECT}/functions/v1/api` }),
    work: {
      actions: {
        store, runs: memoryRuns(), actingUser: async () => OWNER, calendarPost: async () => null,
        call: async (name, body, actAs) => { calls.push({ name, body, actAs }); return { ok: true, status: 200, data: { post: { platform: "Instagram", caption_angle: "Know your rights.", CTA: "Call us", hashtags: ["#law"] } }, text: "" }; },
      },
      costs,
      sign: async (text) => Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))).toString("hex"),
    },
    now: () => new Date("2026-11-23T10:00:30.000Z"),
  };
  fetchConnector = connectorFetch(deps);
});

let nextId = 1;
async function rpc(method: string, params: Record<string, unknown>, auth?: string): Promise<{ status: number; message: any }> {
  const res = await fetchConnector(new Request(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18", ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  }));
  const text = await res.text();
  const data = text.split("\n").find((l) => l.startsWith("data: "));
  return { status: res.status, message: data ? JSON.parse(data.slice(6)) : text ? JSON.parse(text) : null };
}
const names = async (key: string) => ((await rpc("tools/list", {}, key)).message.result.tools as Array<{ name: string }>).map((t) => t.name);
const call = async (key: string, name: string, args: Record<string, unknown>) => (await rpc("tools/call", { name, arguments: args }, key)).message.result;
const json = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

const READS = ["socialytics_clients_list", "socialytics_client_get", "socialytics_reports_list", "socialytics_report_get", "socialytics_competitive_reports_list", "socialytics_competitive_report_get", "socialytics_client_analytics", "socialytics_trend_themes"];

describe("an API key as the bearer", () => {
  it("is offered the tools its scopes allow, never the person's own reads or the saves", async () => {
    expect(await names("soc_reader")).toEqual([...READS, "socialytics_api_schema", "socialytics_api"]);
    const worker = await names("soc_worker");
    expect(worker).toEqual(expect.arrayContaining(["socialytics_report_start", "socialytics_post_draft", "socialytics_calendar_week_plan"]));
    expect(worker).not.toContain("socialytics_note_save");
    expect(worker).not.toContain("socialytics_calendar_posts");
    expect(await names("soc_finance")).toEqual(["socialytics_cost_summary"]);
  });

  it("refuses an unknown key and a key over its minute, as the API does", async () => {
    expect((await rpc("tools/list", {}, "soc_nobody")).status).toBe(401);
    const busy = await rpc("tools/list", {}, "soc_busy");
    expect(busy.status).toBe(429);
  });

  it("reads with the key's reach, and records the key on the audit row", async () => {
    const r = json(await call("soc_reader", "socialytics_clients_list", {}));
    expect(r.data.map((c: { name: string }) => c.name)).toEqual(["Bader Law"]);
    expect(audit[0]).toMatchObject({ method: "MCP", path: "mcp/socialytics_clients_list", status: 200, key_id: "k-read", user_id: null, oauth_client_id: null });
    const out = await call("soc_reader", "socialytics_client_get", { client_id: "c-calm" });
    expect(out.isError).toBe(true);
  });
});

describe("the API tools", () => {
  it("list the read endpoints from the route table and call one with the key's reach", async () => {
    const schema = json(await call("soc_reader", "socialytics_api_schema", {}));
    const paths = schema.endpoints.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["/v1/clients", "/v1/clients/{id}/setup", "/v1/reports/{id}", "/v1/alerts"]));
    expect(paths).not.toContain("/v1/costs");
    expect(paths).not.toContain("/v1/status");
    expect(schema.endpoints.find((e: { path: string }) => e.path === "/v1/reports").query).toHaveProperty("limit");

    const one = json(await call("soc_reader", "socialytics_api", { path: "/v1/clients/c-bader/setup" }));
    expect(one.data).toHaveProperty("ready");
    const listed = json(await call("soc_reader", "socialytics_api", { path: "/v1/reports", query: { client_id: "c-bader", limit: 5 } }));
    expect(listed.data.map((r: { id: string }) => r.id)).toEqual(["rep-1"]);
    expect((await call("soc_reader", "socialytics_api", { path: "/v1/clients/c-calm" })).isError).toBe(true);
    expect((await call("soc_reader", "socialytics_api", { path: "/v1/costs" })).isError).toBe(true);
  });

  it("give the cost summary to a key with the costs scope, grouped by provider and client", async () => {
    const r = json(await call("soc_finance", "socialytics_cost_summary", {}));
    expect(r.totals.cost_usd).toBe(12.5);
    expect(r.group_by).toEqual(["provider", "client"]);
  });
});

describe("a work tool", () => {
  const args = { client_id: "c-bader", platform: "Instagram", topic: "Rights after a crash" };

  it("answers an estimate and a confirm_token first, and starts nothing", async () => {
    const first = json(await call("soc_worker", "socialytics_post_draft", args));
    expect(first).toMatchObject({ status: "needs_confirmation", action: "draft_post", client_id: "c-bader", estimate: { usd: 0.05 } });
    expect(first.confirm_token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(calls).toEqual([]);
  });

  it("starts the work once with the token, acting for the key's owner, and answers a repeat with the first answer", async () => {
    const { confirm_token } = json(await call("soc_worker", "socialytics_post_draft", args));
    const a = json(await call("soc_worker", "socialytics_post_draft", { ...args, confirm_token }));
    const b = json(await call("soc_worker", "socialytics_post_draft", { ...args, confirm_token }));
    expect(a).toMatchObject({ status: "started", action: "draft_post", result: { client_id: "c-bader", saved: false, post: { copy: "Know your rights." } } });
    expect(b).toEqual(a);
    expect(calls).toEqual([{ name: "generate-ad-hoc-post", body: { client_id: "c-bader", platform: "Instagram", topic: "Rights after a crash" }, actAs: OWNER }]);
  });

  it("refuses a token given for other arguments, and a client out of the key's reach", async () => {
    const { confirm_token } = json(await call("soc_worker", "socialytics_post_draft", args));
    const other = await call("soc_worker", "socialytics_post_draft", { ...args, topic: "Something else", confirm_token });
    expect(other.isError).toBe(true);
    expect(other.content[0].text).toMatch(/expired or was given for other arguments/);
    expect((await call("soc_worker", "socialytics_post_draft", { ...args, client_id: "c-calm" })).isError).toBe(true);
    expect(calls).toEqual([]);
  });
});
