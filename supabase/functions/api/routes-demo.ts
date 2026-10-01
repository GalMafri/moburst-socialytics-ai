/**
 * The ad-hoc demo: one POST names a client and a website, a job onboards it
 * and runs every feature; GET returns live progress and the outputs. The
 * worker that advances jobs lives in worker.ts; this file owns the input
 * contract and the job routes.
 */
import { pageOf, parseLimit } from "../_shared/api/cursor.ts";
import { ApiError, invalid, notFound } from "../_shared/api/errors.ts";
import { initialSteps, type JobRecord, type StepDef } from "../_shared/api/jobs.ts";
import type { ClientScope, Route, RouteContext } from "../_shared/api/router.ts";
import { clientHost } from "../_shared/net/clientHost.ts";
import { pageFrom, type Page } from "./store.ts";

export interface DemoInput {
  client_name: string;
  website: string;
  industry?: string;
  competitors?: Array<{ name: string; website?: string }>;
  requester?: { id?: string; email?: string; name?: string };
  idempotency_key?: string;
  callback_url?: string;
  regions?: string[];
  force_run?: boolean;
}

export interface JobStore {
  create(job: Omit<JobRecord, "id">): Promise<JobRecord>;
  byIdempotency(keyId: string, key: string): Promise<JobRecord | null>;
  get(id: string, scope: ClientScope, keyId: string | null): Promise<JobRecord | null>;
  list(f: { client_id?: string; status?: string }, scope: ClientScope, page: Page, keyId: string | null): Promise<JobRecord[]>;
  update(id: string, patch: Partial<JobRecord>): Promise<JobRecord>;
  runningCount(): Promise<number>;
}

export interface DiscardResult {
  removed: { client: boolean; competitor_sets: number; reports: number; competitive_reports: number; posts: number; media_jobs: number };
}

export interface DemoDeps {
  jobs: JobStore;
  kickWorker(): Promise<void>;
  discard(job: JobRecord): Promise<DiscardResult>;
  capacity: number;
  stepNames: string[];
  /** Folds a report that landed after the job closed into its outputs; true when they changed. */
  refresh?(job: JobRecord): Promise<boolean>;
}

const MAX_COMPETITORS = 12;
const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function parseDemoInput(body: unknown): DemoInput {
  if (!body || typeof body !== "object") throw invalid("A JSON body with client_name and website is required");
  const b = body as Record<string, unknown>;
  const client_name = s(b.client_name);
  if (!client_name) throw invalid("client_name is required", { field: "client_name" });
  if (client_name.length > 120) throw invalid("client_name is too long", { field: "client_name" });
  const website = clientHost(s(b.website));
  if (!website) throw invalid("website must be a domain or URL", { field: "website" });
  const out: DemoInput = { client_name, website };
  if (b.industry != null) {
    const industry = s(b.industry);
    if (industry) out.industry = industry;
  }
  if (b.competitors != null) {
    if (!Array.isArray(b.competitors)) throw invalid("competitors must be a list", { field: "competitors" });
    if (b.competitors.length > MAX_COMPETITORS) throw invalid(`competitors can hold at most ${MAX_COMPETITORS} entries`, { field: "competitors" });
    out.competitors = b.competitors.map((c, i) => {
      const r = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      const name = s(r.name);
      if (!name) throw invalid(`competitors[${i}].name is required`, { field: "competitors" });
      const site = clientHost(s(r.website));
      return site ? { name, website: site } : { name };
    });
  }
  if (b.requester != null) {
    const r = (typeof b.requester === "object" ? b.requester : {}) as Record<string, unknown>;
    out.requester = {};
    if (s(r.id)) out.requester.id = s(r.id);
    if (s(r.email)) out.requester.email = s(r.email).toLowerCase();
    if (s(r.name)) out.requester.name = s(r.name);
  }
  if (b.idempotency_key != null) {
    const k = s(b.idempotency_key);
    if (k.length > 200) throw invalid("idempotency_key is too long", { field: "idempotency_key" });
    if (k) out.idempotency_key = k;
  }
  if (b.callback_url != null) {
    const u = s(b.callback_url);
    if (u) {
      if (!/^https:\/\/[^\s]+$/i.test(u)) throw invalid("callback_url must be an https URL", { field: "callback_url" });
      out.callback_url = u;
    }
  }
  if (b.regions != null) {
    if (!Array.isArray(b.regions)) throw invalid("regions must be a list of country codes", { field: "regions" });
    const regions = b.regions.map((r) => s(r).toUpperCase());
    if (regions.some((r) => !/^([A-Z]{2}|GLOBAL)$/.test(r))) throw invalid("regions must be two-letter country codes or GLOBAL", { field: "regions" });
    if (regions.length) out.regions = [...new Set(regions)];
  }
  if (b.force_run != null) out.force_run = b.force_run === true;
  return out;
}

const jobLinks = (job: JobRecord) => ({ self: `/v1/demo-jobs/${job.id}`, client: job.client_id ? `/v1/clients/${job.client_id}` : null });
export const jobOut = (job: JobRecord) => {
  const { lease_until: _lease, key_id: _key, ...rest } = job as JobRecord & { lease_until?: unknown; key_id?: unknown };
  return { ...rest, links: jobLinks(job) };
};

const terminal = (job: JobRecord) => job.status === "completed" || job.status === "partial" || job.status === "failed" || job.status === "cancelled";

export function demoRoutes(deps: DemoDeps): Route[] {
  const load = async (ctx: RouteContext) => {
    const job = await deps.jobs.get(ctx.params.id, ctx.auth.clients, ctx.auth.keyId);
    if (!job) throw notFound("Demo job");
    return job;
  };
  return [
    {
      method: "POST", path: "/v1/demo-jobs", auth: "key", scope: "demo",
      doc: { summary: "Onboard a client and run every feature for it", tag: "Demo", body: "DemoInput", response: "DemoJob", status: 202 },
      handler: async (ctx) => {
        const input = parseDemoInput(ctx.body);
        const keyId = ctx.auth.keyId ?? "internal";
        if (input.idempotency_key) {
          const existing = await deps.jobs.byIdempotency(keyId, input.idempotency_key);
          if (existing) return { status: 200, body: { data: jobOut(existing) } };
        }
        if ((await deps.jobs.runningCount()) >= deps.capacity) throw new ApiError(429, "demo_capacity", `At most ${deps.capacity} demo jobs run at once; try again when one completes`);
        const { requester, callback_url, idempotency_key, ...rest } = input;
        const job = await deps.jobs.create({
          tool: "socialytics", key_id: ctx.auth.keyId, idempotency_key: idempotency_key ?? null, status: "queued", input: rest as unknown as Record<string, unknown>, requester: requester ?? null,
          callback_url: callback_url ?? null, callback_status: null, client_id: null, run_ids: [], steps: initialSteps(deps.stepNames.map((name) => ({ name, run: async () => ({ status: "done" }) }) as StepDef<unknown>)),
          outputs: null, gaps: [], error: null, next_check_at: null, started_at: null, completed_at: null,
        });
        deps.kickWorker().catch((e) => console.error("worker kick failed:", e instanceof Error ? e.message : String(e)));
        return { status: 202, body: { data: jobOut(job) } };
      },
    },
    {
      method: "GET", path: "/v1/demo-jobs", auth: "key", scope: "demo", doc: { summary: "List demo jobs", tag: "Demo", query: { client_id: { type: "string" }, status: { type: "string" } }, response: "DemoJobList", list: true },
      handler: async (ctx) => {
        const page = pageFrom(parseLimit(ctx.query.get("limit")), ctx.query.get("cursor"));
        const rowsIn = await deps.jobs.list({ client_id: ctx.query.get("client_id") ?? undefined, status: ctx.query.get("status") ?? undefined }, ctx.auth.clients, page, ctx.auth.keyId);
        const p = pageOf(rowsIn as Array<JobRecord & { created_at: string }>, page.limit);
        return { status: 200, body: { data: p.data.map(jobOut), next_cursor: p.next_cursor } };
      },
    },
    {
      method: "GET", path: "/v1/demo-jobs/:id", auth: "key", scope: "demo", doc: { summary: "Progress and outputs of a demo job", tag: "Demo", response: "DemoJob" },
      handler: async (ctx) => {
        const job = await load(ctx);
        if (deps.refresh && (await deps.refresh(job))) await deps.jobs.update(job.id, { outputs: job.outputs });
        return { status: 200, body: { data: jobOut(job) } };
      },
    },
    {
      method: "POST", path: "/v1/demo-jobs/:id/cancel", auth: "key", scope: "demo", doc: { summary: "Cancel a queued or running demo job", tag: "Demo", response: "DemoJob" },
      handler: async (ctx) => {
        const job = await load(ctx);
        if (terminal(job)) throw new ApiError(409, "conflict", `The job is already ${job.status}`);
        const updated = await deps.jobs.update(job.id, { status: "cancelled", completed_at: new Date().toISOString(), next_check_at: null });
        return { status: 200, body: { data: jobOut(updated) } };
      },
    },
    {
      method: "POST", path: "/v1/demo-jobs/:id/discard", auth: "key", scope: "demo", doc: { summary: "Remove what a finished demo job created", tag: "Demo", response: "Discarded" },
      handler: async (ctx) => {
        const job = await load(ctx);
        if (!terminal(job)) throw new ApiError(409, "job_running", "The job is still running; cancel it first");
        const result = await deps.discard(job);
        return { status: 200, body: { data: { job_id: job.id, removed: result.removed } } };
      },
    },
  ];
}
