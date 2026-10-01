/**
 * What GET /v1/status reports about the pipelines: reports that have run too
 * long, schedules whose last run failed, media jobs that failed today, demo
 * jobs stuck or failed. The findings are pure (rows in, findings out); the
 * reads live beside them.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { APP_URL } from "./serializers.ts";

export interface Finding { kind: string; severity: "high" | "medium" | "low"; client_id: string | null; client: string | null; detail: string; link: string | null; report_id: string | null; job_id: string | null }
export interface HealthRows {
  reports: Array<{ id: string; client_id: string; status: string; created_at: string }>;
  competitive: Array<{ id: string; client_id: string; status: string; created_at: string }>;
  schedules: Array<{ id: string; client_id: string; report_kind: string | null; is_active: boolean; last_result: string | null; last_run_at: string | null }>;
  mediaJobs: Array<{ id: string; client_id: string; status: string; error: string | null; created_at: string }>;
  demoJobs: Array<{ id: string; status: string; client_id: string | null; updated_at: string; completed_at: string | null; error: string | null }>;
  clients: Array<{ id: string; name: string }>;
}

export const STUCK_AFTER_MIN = 90;
const minutes = (iso: string, now: Date) => (now.getTime() - new Date(iso).getTime()) / 60_000;
const FAILED = /fail|error|timed out|refused/i;

export function buildFindings(rows: HealthRows, now: Date): Finding[] {
  const name = new Map(rows.clients.map((c) => [c.id, c.name]));
  const out: Finding[] = [];
  const f = (kind: string, severity: Finding["severity"], clientId: string | null, detail: string, link: string | null, extra: { report_id?: string; job_id?: string } = {}) =>
    out.push({ kind, severity, client_id: clientId, client: clientId ? name.get(clientId) ?? null : null, detail, link, report_id: extra.report_id ?? null, job_id: extra.job_id ?? null });
  for (const r of rows.reports) if (r.status === "running" && minutes(r.created_at, now) > STUCK_AFTER_MIN) f("report_stuck", "high", r.client_id, `A social report has been running for ${Math.round(minutes(r.created_at, now))} minutes.`, `${APP_URL}/clients/${r.client_id}/reports/${r.id}`, { report_id: r.id });
  for (const r of rows.competitive) if (r.status === "running" && minutes(r.created_at, now) > STUCK_AFTER_MIN) f("competitive_report_stuck", "high", r.client_id, `A competitive report has been running for ${Math.round(minutes(r.created_at, now))} minutes.`, `${APP_URL}/clients/${r.client_id}/competitive/reports/${r.id}`, { report_id: r.id });
  for (const s of rows.schedules) if (s.is_active && s.last_result && FAILED.test(s.last_result)) f("schedule_failed", "medium", s.client_id, `The ${s.report_kind ?? "social"} schedule's last run did not start: ${s.last_result}`, `${APP_URL}/clients/${s.client_id}/setup`);
  const failedMedia = new Map<string, number>();
  for (const m of rows.mediaJobs) if (m.status === "failed" && minutes(m.created_at, now) <= 24 * 60) failedMedia.set(m.client_id, (failedMedia.get(m.client_id) ?? 0) + 1);
  for (const [clientId, n] of failedMedia) f("media_failed", "low", clientId, `${n} media generation${n === 1 ? "" : "s"} failed in the last 24 hours.`, `${APP_URL}/clients/${clientId}/reports`);
  for (const j of rows.demoJobs) {
    if ((j.status === "queued" || j.status === "running") && minutes(j.updated_at, now) > 180) f("demo_job_stuck", "medium", j.client_id, `Demo job ${j.id.slice(0, 8)} has not advanced for ${Math.round(minutes(j.updated_at, now) / 60)} hours.`, null, { job_id: j.id });
    if (j.status === "failed" && j.completed_at && minutes(j.completed_at, now) <= 24 * 60) f("demo_job_failed", "medium", j.client_id, `Demo job ${j.id.slice(0, 8)} failed: ${j.error ?? "no reason recorded"}.`, null, { job_id: j.id });
  }
  return out;
}

export async function loadHealthRows(db: SupabaseClient, now: Date): Promise<HealthRows> {
  const since = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const get = async <T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> => {
    const { data, error } = await p;
    if (error) throw new Error(error.message);
    return (data ?? []) as T[];
  };
  const [reports, competitive, schedules, mediaJobs, demoJobs] = await Promise.all([
    get<HealthRows["reports"][number]>(db.from("reports").select("id, client_id, status, created_at").eq("status", "running").lt("created_at", since(STUCK_AFTER_MIN / 60))),
    get<HealthRows["competitive"][number]>(db.from("competitive_reports").select("id, client_id, status, created_at").eq("status", "running").lt("created_at", since(STUCK_AFTER_MIN / 60))),
    get<HealthRows["schedules"][number]>(db.from("report_schedules").select("id, client_id, report_kind, is_active, last_result, last_run_at").eq("is_active", true).not("last_result", "is", null)),
    get<HealthRows["mediaJobs"][number]>(db.from("media_jobs").select("id, client_id, status, error, created_at").eq("status", "failed").gte("created_at", since(24))),
    get<HealthRows["demoJobs"][number]>(db.from("demo_jobs").select("id, status, client_id, updated_at, completed_at, error").gte("created_at", since(14 * 24))),
  ]);
  const ids = [...new Set([...reports, ...competitive, ...schedules, ...mediaJobs].map((r) => r.client_id).concat(demoJobs.map((j) => j.client_id).filter((x): x is string => !!x)))];
  const clients = ids.length ? await get<{ id: string; name: string }>(db.from("clients").select("id, name").in("id", ids)) : [];
  return { reports, competitive, schedules, mediaJobs, demoJobs, clients };
}
