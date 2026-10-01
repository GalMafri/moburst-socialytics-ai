/**
 * api: Socialytics' public, key-authenticated API. One versioned router
 * (/functions/v1/api/v1/...) over the shared core in _shared/api, with the
 * Socialytics resources, the ad-hoc demo job, key management and the worker
 * route the api-demo-worker cron calls every minute.
 *
 * verify_jwt is off (machine callers hold API keys, not user sessions);
 * the core checks keys, scopes and rate limits itself. The project's own
 * functions are driven through the operational secret, acting for the user
 * the demo resolved (see _shared/invoke.ts and requireStaff).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleRequest, type CoreDeps } from "../_shared/api/core.ts";
import type { KeyRow } from "../_shared/api/keys.ts";
import { callEnvFromDeno, callFunction } from "../_shared/invoke.ts";
import { API_VERSION, TOOL, socialyticsRoutes } from "./openapi.ts";
import { makeJobStore } from "./jobs-store.ts";
import { makeKeyStore } from "./keys-store.ts";
import { makeStore } from "./store.ts";
import { schemaCheck, TABLE_COLUMNS } from "./schema-check.ts";
import { buildFindings, loadHealthRows } from "./health.ts";
import { DEMO_STEPS, makeDemoCtx, refreshOutputs } from "./demo/steps.ts";
import { discardJob, workerRoute } from "./worker.ts";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const store = makeStore(db);
const jobs = makeJobStore(db);
const keys = makeKeyStore(db);
const serverUrl = `${SUPABASE_URL}/functions/v1/api`;
const env = callEnvFromDeno();

async function health(): Promise<unknown> {
  const now = new Date();
  const [rows, demo, drift] = await Promise.all([loadHealthRows(db, now), jobs.demoStats(), schemaCheck(db)]);
  return { tool: TOOL, time: now.toISOString(), findings: [...buildFindings(rows, now), ...drift], demo_jobs: demo, counts: { stuck_reports: rows.reports.length + rows.competitive.length, failed_media_24h: rows.mediaJobs.length, schema_tables_checked: TABLE_COLUMNS.length } };
}

const ctx = makeDemoCtx(db, env);
const routes = socialyticsRoutes({
  store, health,
  analytics: async (clientId, start, end) => {
    const r = await callFunction("sprout-analytics", { client_id: clientId, start, end }, env);
    return { ok: r.ok, status: r.status, data: r.data };
  },
  jobs, kickWorker: async () => { await callFunction("api/internal/worker", { kick: true }, env); }, discard: (job) => discardJob(job, { db, call: (name, body, actAs) => callFunction(name, body, { ...env, actAs }) }),
  capacity: 3, stepNames: DEMO_STEPS.map((s) => s.name), keys, serverUrl, refresh: (job) => refreshOutputs(job, ctx),
  extraRoutes: [workerRoute({ jobs, ctx, steps: DEMO_STEPS })],
});

const deps: CoreDeps = {
  tool: TOOL, version: API_VERSION, routes,
  touchKey: async (hash) => {
    const { data, error } = await db.rpc("api_key_touch", { p_key_hash: hash });
    if (error) throw new Error(error.message);
    const rowsIn = (data ?? []) as KeyRow[];
    return rowsIn[0] ?? null;
  },
  clientsForScope: async () => {
    const { data } = await db.from("clients").select("id, company_slug").is("archived_at", null);
    return (data ?? []) as Array<{ id: string; company_slug: string | null }>;
  },
  verifyAdminJwt: async (token) => {
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return null;
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", data.user.id);
    return (roles ?? []).some((r: { role: string }) => r.role === "admin") ? { userId: data.user.id } : null;
  },
  cronSecret: Deno.env.get("SOCIALYTICS_N8N_SECRET") ?? null,
  serviceKey: SERVICE_KEY,
  audit: async (row) => {
    const { error } = await db.from("api_requests").insert(row);
    if (error) console.error("audit insert failed:", error.message);
  },
  waitUntil: (p) => { if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p); },
};

serve((req) => handleRequest(req, deps));
