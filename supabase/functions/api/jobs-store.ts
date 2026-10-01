/** demo_jobs over supabase-js: the JobStore the routes use plus lease and release for the worker. */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { JobRecord } from "../_shared/api/jobs.ts";
import type { ClientScope } from "../_shared/api/router.ts";
import type { JobStore } from "./routes-demo.ts";
import type { Page } from "./store.ts";

const COLUMNS = "id, tool, key_id, idempotency_key, status, input, requester, callback_url, callback_status, client_id, run_ids, steps, outputs, gaps, error, lease_until, next_check_at, created_at, started_at, completed_at, updated_at";

export interface WorkerJobStore extends JobStore {
  lease(limit: number, seconds: number): Promise<JobRecord[]>;
  /** Writes the job while it is still queued or running; false when it was cancelled or finished meanwhile. */
  save(job: JobRecord): Promise<boolean>;
  release(id: string): Promise<void>;
  demoStats(): Promise<{ running: number; stuck: number; failed_24h: number }>;
}

/** A scoped key sees jobs on its own clients, and its own jobs only while they have no client yet. */
export const jobVisible = (job: JobRecord, scope: ClientScope, keyId: string | null): boolean =>
  scope.all || (job.client_id ? scope.allows(job.client_id) : !!keyId && job.key_id === keyId);
const visible = jobVisible;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function makeJobStore(db: SupabaseClient): WorkerJobStore {
  const row = async (p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<JobRecord | null> => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return (data as JobRecord | null) ?? null;
  };
  return {
    async create(job) {
      const r = await row(db.from("demo_jobs").insert(job).select(COLUMNS).single());
      if (!r) throw new Error("demo job insert returned nothing");
      return r;
    },
    async byIdempotency(keyId, key) {
      return row(db.from("demo_jobs").select(COLUMNS).eq("key_id", keyId).eq("idempotency_key", key).maybeSingle());
    },
    async get(id, scope, keyId) {
      if (!UUID.test(id)) return null;
      const r = await row(db.from("demo_jobs").select(COLUMNS).eq("id", id).maybeSingle());
      return r && visible(r, scope, keyId) ? r : null;
    },
    async list(f, scope, page, keyId) {
      let q = db.from("demo_jobs").select(COLUMNS);
      if (f.client_id) {
        if (!UUID.test(f.client_id)) return [];
        q = q.eq("client_id", f.client_id);
      }
      if (f.status) q = q.eq("status", f.status);
      if (!scope.all) {
        const ids = [...scope.ids];
        const own = keyId ? `,and(key_id.eq.${keyId},client_id.is.null)` : "";
        q = ids.length ? q.or(`client_id.in.(${ids.join(",")})${own}`) : keyId ? q.is("client_id", null).eq("key_id", keyId) : q.eq("id", "00000000-0000-0000-0000-000000000000");
      }
      if (page.cursor) q = q.or(`created_at.lt.${page.cursor.c},and(created_at.eq.${page.cursor.c},id.lt.${page.cursor.i})`);
      const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(page.limit + 1);
      if (error) throw new Error(error.message);
      return (data ?? []) as JobRecord[];
    },
    async update(id, patch) {
      const r = await row(db.from("demo_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id).select(COLUMNS).single());
      if (!r) throw new Error("demo job update returned nothing");
      return r;
    },
    async runningCount() {
      const { count, error } = await db.from("demo_jobs").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
      if (error) throw new Error(error.message);
      return count ?? 0;
    },
    async lease(limit, seconds) {
      const { data, error } = await db.rpc("demo_jobs_lease", { p_limit: limit, p_lease_seconds: seconds });
      if (error) throw new Error(error.message);
      return (data ?? []) as JobRecord[];
    },
    async save(job) {
      const { data, error } = await db.from("demo_jobs").update({
        status: job.status, client_id: job.client_id, run_ids: job.run_ids, steps: job.steps, outputs: job.outputs, gaps: job.gaps, error: job.error, callback_status: job.callback_status ?? null,
        next_check_at: job.next_check_at, started_at: job.started_at, completed_at: job.completed_at, updated_at: new Date().toISOString(),
      }).eq("id", job.id).in("status", ["queued", "running"]).select("id");
      if (error) throw new Error(error.message);
      return (data ?? []).length > 0;
    },
    async release(id) {
      const { error } = await db.from("demo_jobs").update({ lease_until: null }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    async demoStats() {
      const now = Date.now();
      const { data, error } = await db.from("demo_jobs").select("status, updated_at, completed_at").gte("created_at", new Date(now - 14 * 86_400_000).toISOString());
      if (error) throw new Error(error.message);
      const rowsIn = (data ?? []) as Array<{ status: string; updated_at: string; completed_at: string | null }>;
      return {
        running: rowsIn.filter((j) => j.status === "queued" || j.status === "running").length,
        stuck: rowsIn.filter((j) => (j.status === "queued" || j.status === "running") && now - new Date(j.updated_at).getTime() > 3 * 3_600_000).length,
        failed_24h: rowsIn.filter((j) => j.status === "failed" && j.completed_at && now - new Date(j.completed_at).getTime() < 86_400_000).length,
      };
    },
  };
}
