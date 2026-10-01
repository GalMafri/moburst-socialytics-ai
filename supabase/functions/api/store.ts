/**
 * The reads the API makes, behind one interface so the routes are tested
 * with an in-memory store and run against supabase-js in production. Every
 * query is scoped: a list adds the key's client ids, a single read checks
 * the row's client against the scope and reports "not found" otherwise.
 * Lists read light columns (JSON sub-fields of report_data by alias); a
 * single report reads the whole row.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeCursor, type Cursor } from "../_shared/api/cursor.ts";
import type { ClientScope } from "../_shared/api/router.ts";
import type { AlertRow, ClientRow, CompetitiveReportRow, CompetitorRow, CompetitorSetRow, DesignSystemRow, HandleRow, MediaJobRow, PostRow, ReportRow, ScheduledPostRow, ScheduleRow, SetWithCompetitors, SproutProfileRow } from "./serializers.ts";

export interface Page { limit: number; cursor: Cursor | null }
export interface ClientFilters { q?: string; company_slug?: string; include_archived?: boolean }
export interface ReportFilters { client_id?: string; status?: string; from?: string; to?: string }
export interface PostFilters { client_id?: string; report_id?: string; source?: string; approved?: boolean; include_archived?: boolean }
export interface ClientExtras { sproutProfiles: SproutProfileRow[]; sets: SetWithCompetitors[]; designSystems: DesignSystemRow[]; counts: { reports: number; competitive_reports: number; posts: number; schedules: number }; lastReport: ReportRow | null }

export interface Store {
  listClients(scope: ClientScope, f: ClientFilters, page: Page): Promise<ClientRow[]>;
  getClient(id: string, scope: ClientScope): Promise<ClientRow | null>;
  clientExtras(clientIds: string[]): Promise<Record<string, ClientExtras>>;
  schedulesOf(clientId: string): Promise<ScheduleRow[]>;
  listReports(scope: ClientScope, f: ReportFilters, page: Page): Promise<ReportRow[]>;
  getReport(id: string, scope: ClientScope): Promise<ReportRow | null>;
  listCompetitiveReports(scope: ClientScope, f: { client_id?: string; status?: string }, page: Page): Promise<CompetitiveReportRow[]>;
  getCompetitiveReport(id: string, scope: ClientScope): Promise<CompetitiveReportRow | null>;
  listSets(scope: ClientScope, f: { client_id?: string; status?: string }, page: Page): Promise<SetWithCompetitors[]>;
  getSet(id: string, scope: ClientScope): Promise<SetWithCompetitors | null>;
  listPosts(scope: ClientScope, f: PostFilters, page: Page): Promise<PostRow[]>;
  getPost(id: string, scope: ClientScope): Promise<PostRow | null>;
  listMediaJobs(scope: ClientScope, f: { client_id?: string; status?: string }, page: Page): Promise<MediaJobRow[]>;
  listSchedules(scope: ClientScope, f: { client_id?: string }, page: Page): Promise<ScheduleRow[]>;
  listScheduledPosts(scope: ClientScope, f: { client_id?: string; status?: string }, page: Page): Promise<ScheduledPostRow[]>;
  listAlerts(scope: ClientScope, f: { client_id?: string; status?: string }, page: Page): Promise<AlertRow[]>;
  listDesignSystems(scope: ClientScope, f: { client_id?: string }, page: Page): Promise<DesignSystemRow[]>;
}

export const CLIENT_COLUMNS = "id, name, website_url, company_slug, primary_platforms, geo, language, timezone, content_pillars, social_keywords, trends_keywords, brand_identity, brand_notes, brief_text, logo_url, design_style_synthesis, harvested_design_references, design_references, sprout_customer_id, hub_company_name, media_backend, archived_at, created_at, updated_at, created_by, demo_job_id, pillars_source, pillars_derived_at";
export const SPROUT_PROFILE_COLUMNS = "id, client_id, sprout_profile_id, profile_name, native_name, network_type, native_link, is_active";
export const SET_COLUMNS = "id, client_id, status, notes, source, rivaliq_landscape_id, confirmed_by, confirmed_at, created_at, updated_at, demo_job_id";
export const COMPETITOR_COLUMNS = "id, set_id, client_id, name, website_url, rationale, similarity_score, source, is_selected, selected_rank, rivaliq_company_id, profile_detection, created_at";
export const HANDLE_COLUMNS = "id, competitor_id, client_id, platform, handle, profile_url, is_active, followers, detection_confidence, source, detected_at";
export const REPORT_COLUMNS = "id, client_id, report_type, status, date_range_start, date_range_end, gamma_url, duration_minutes, report_data, created_at, created_by, demo_job_id";
/** The same row without the heavy blocks: the summary's sub-fields come out of report_data by alias. */
export const REPORT_LIST_COLUMNS = "id, client_id, report_type, status, date_range_start, date_range_end, gamma_url, duration_minutes, created_at, created_by, demo_job_id, rd_period:report_data->report_period, rd_counts:report_data->data_counts, rd_metrics:report_data->metrics_summary, rd_warnings:report_data->warnings, rd_trend:report_data->>trend_status, rd_gamma_status:report_data->>gamma_status, rd_gamma_url:report_data->>gamma_url, rd_completed:report_data->>completed_at, rd_error:report_data->>error, rd_duration:report_data->duration_minutes";
export const COMPETITIVE_COLUMNS = "id, client_id, set_id, report_data, status, gamma_url, duration_minutes, date_range_start, date_range_end, created_by, created_at, demo_job_id";
export const COMPETITIVE_LIST_COLUMNS = "id, client_id, set_id, status, gamma_url, duration_minutes, date_range_start, date_range_end, created_by, created_at, demo_job_id, rd_period:report_data->period, rd_totals:report_data->totals, rd_quality:report_data->quality_check, rd_provider:report_data->>provider_status, rd_generated:report_data->>generated_at, rd_gamma_url:report_data->>gamma_url";
export const POST_COLUMNS = "id, client_id, report_id, recommendation_index, version, platform, post_copy, hashtags, cta, concept, visual_direction, format, source, created_at, created_by, media_urls, variant_group_id, is_selected, variant_angle, is_approved, approved_at, approved_by, rejected_at, rejection_reason, rejection_note, archived_at, calendar_post_key, finishing, demo_job_id";
export const MEDIA_JOB_COLUMNS = "id, client_id, post_iteration_id, kind, provider, status, output_url, seed_image_url, error, created_by, created_at, updated_at, review, reviewed_at, demo_job_id";
export const SCHEDULE_COLUMNS = "id, client_id, frequency, is_active, next_run_at, last_run_at, trends_date_range_days, analysis_date_range_days, created_by, created_at, updated_at, report_kind, run_day_of_month, range_mode, last_result, pending_competitive_report_id, dispatch_claimed_at";
export const SCHEDULED_POST_COLUMNS = "id, client_id, report_id, platform, scheduled_time, status, post_content, media_url, created_at, created_by";
export const ALERT_COLUMNS = "id, client_id, window_start, window_end, topic, topic_key, summary, companies, platforms, post_urls, post_count, confidence, status, created_at";
export const DESIGN_SYSTEM_COLUMNS = "id, client_id, version, status, system, previews, built_from, approved_by, approved_at, created_by, created_at, updated_at";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A filter value that is not an id matches nothing (Postgres would answer with an error otherwise). */
export const isId = (v: string | undefined): v is string => !!v && UUID.test(v);

export function pageFrom(limit: number, cursor: string | null): Page {
  return { limit, cursor: decodeCursor(cursor) };
}

interface KeysetQuery {
  in(column: string, values: string[]): KeysetQuery;
  or(filters: string): KeysetQuery;
  order(column: string, opts: { ascending: boolean }): KeysetQuery;
  limit(n: number): KeysetQuery;
}
function keyset<Q extends KeysetQuery>(q: Q, page: Page, clientColumn = "client_id", scope?: ClientScope): Q {
  let x: KeysetQuery = q;
  if (scope && !scope.all) x = x.in(clientColumn, [...scope.ids]);
  if (page.cursor) x = x.or(`created_at.lt.${page.cursor.c},and(created_at.eq.${page.cursor.c},id.lt.${page.cursor.i})`);
  return x.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(page.limit + 1) as Q;
}
async function rows<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}
async function one<T>(p: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data as T | null) ?? null;
}

type LightReport = Omit<ReportRow, "report_data"> & { rd_period?: unknown; rd_counts?: unknown; rd_metrics?: unknown; rd_warnings?: unknown; rd_trend?: string | null; rd_gamma_status?: string | null; rd_gamma_url?: string | null; rd_completed?: string | null; rd_error?: string | null; rd_duration?: unknown };
/** The light list row back into the row shape the serializer reads. */
export function reportFromLight(r: LightReport): ReportRow {
  const { rd_period, rd_counts, rd_metrics, rd_warnings, rd_trend, rd_gamma_status, rd_gamma_url, rd_completed, rd_error, rd_duration, ...rest } = r;
  return { ...rest, report_data: { report_period: rd_period ?? undefined, data_counts: rd_counts ?? undefined, metrics_summary: rd_metrics ?? undefined, warnings: rd_warnings ?? undefined, trend_status: rd_trend ?? undefined, gamma_status: rd_gamma_status ?? undefined, gamma_url: rd_gamma_url ?? undefined, completed_at: rd_completed ?? undefined, error: rd_error ?? undefined, duration_minutes: rd_duration ?? undefined } };
}
type LightCompetitive = Omit<CompetitiveReportRow, "report_data"> & { rd_period?: unknown; rd_totals?: unknown; rd_quality?: unknown; rd_provider?: string | null; rd_generated?: string | null; rd_gamma_url?: string | null };
export function competitiveFromLight(r: LightCompetitive): CompetitiveReportRow {
  const { rd_period, rd_totals, rd_quality, rd_provider, rd_generated, rd_gamma_url, ...rest } = r;
  return { ...rest, report_data: { period: rd_period ?? undefined, totals: rd_totals ?? undefined, quality_check: rd_quality ?? undefined, provider_status: rd_provider ?? undefined, generated_at: rd_generated ?? undefined, gamma_url: rd_gamma_url ?? undefined } };
}

/** Sets with their competitors and handles, from the three tables. */
export async function setsWithCompetitors(db: SupabaseClient, sets: CompetitorSetRow[]): Promise<SetWithCompetitors[]> {
  if (!sets.length) return [];
  const setIds = sets.map((s) => s.id);
  const competitors = await rows<CompetitorRow>(db.from("competitors").select(COMPETITOR_COLUMNS).in("set_id", setIds).order("created_at", { ascending: true }));
  const handles = competitors.length ? await rows<HandleRow>(db.from("competitor_handles").select(HANDLE_COLUMNS).in("competitor_id", competitors.map((c) => c.id))) : [];
  return sets.map((s) => ({ ...s, competitors: competitors.filter((c) => c.set_id === s.id).map((c) => ({ ...c, handles: handles.filter((h) => h.competitor_id === c.id) })) }));
}

export function makeStore(db: SupabaseClient): Store {
  const scoped = <T extends { client_id: string }>(row: T | null, scope: ClientScope): T | null => (row && scope.allows(row.client_id) ? row : null);
  return {
    async listClients(scope, f, page) {
      let q = db.from("clients").select(CLIENT_COLUMNS);
      if (!f.include_archived) q = q.is("archived_at", null);
      if (f.q) q = q.ilike("name", `%${f.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      if (f.company_slug) q = q.eq("company_slug", f.company_slug);
      return rows<ClientRow>(keyset(q, page, "id", scope));
    },
    async getClient(id, scope) {
      if (!isId(id) || !scope.allows(id)) return null;
      return one<ClientRow>(db.from("clients").select(CLIENT_COLUMNS).eq("id", id).maybeSingle());
    },
    async clientExtras(ids) {
      const out: Record<string, ClientExtras> = {};
      if (!ids.length) return out;
      for (const id of ids) out[id] = { sproutProfiles: [], sets: [], designSystems: [], counts: { reports: 0, competitive_reports: 0, posts: 0, schedules: 0 }, lastReport: null };
      const [profiles, sets, designs, reports, competitive, posts, schedules] = await Promise.all([
        rows<SproutProfileRow>(db.from("sprout_profiles").select(SPROUT_PROFILE_COLUMNS).in("client_id", ids)),
        rows<CompetitorSetRow>(db.from("competitor_sets").select(SET_COLUMNS).in("client_id", ids).order("created_at", { ascending: false })),
        rows<DesignSystemRow>(db.from("client_design_systems").select(DESIGN_SYSTEM_COLUMNS).in("client_id", ids).neq("status", "retired").order("version", { ascending: false })),
        rows<LightReport>(db.from("reports").select(REPORT_LIST_COLUMNS).in("client_id", ids).order("created_at", { ascending: false }).limit(5000)),
        rows<{ client_id: string }>(db.from("competitive_reports").select("client_id").in("client_id", ids).limit(5000)),
        rows<{ client_id: string }>(db.from("post_iterations").select("client_id").in("client_id", ids).is("archived_at", null).limit(20000)),
        rows<{ client_id: string }>(db.from("report_schedules").select("client_id").in("client_id", ids).eq("is_active", true).limit(5000)),
      ]);
      const full = await setsWithCompetitors(db, sets);
      for (const p of profiles) out[p.client_id]?.sproutProfiles.push(p);
      for (const s of full) out[s.client_id]?.sets.push(s);
      for (const d of designs) out[d.client_id]?.designSystems.push(d);
      for (const r of reports) {
        const e = out[r.client_id];
        if (!e) continue;
        e.counts.reports += 1;
        if (!e.lastReport) e.lastReport = reportFromLight(r);
      }
      for (const r of competitive) if (out[r.client_id]) out[r.client_id].counts.competitive_reports += 1;
      for (const r of posts) if (out[r.client_id]) out[r.client_id].counts.posts += 1;
      for (const r of schedules) if (out[r.client_id]) out[r.client_id].counts.schedules += 1;
      return out;
    },
    async schedulesOf(clientId) {
      return rows<ScheduleRow>(db.from("report_schedules").select(SCHEDULE_COLUMNS).eq("client_id", clientId).order("created_at", { ascending: false }));
    },
    async listReports(scope, f, page) {
      if (f.client_id !== undefined && !isId(f.client_id)) return [];
      let q = db.from("reports").select(REPORT_LIST_COLUMNS);
      if (f.client_id) q = q.eq("client_id", f.client_id);
      if (f.status) q = q.eq("status", f.status);
      if (f.from) q = q.gte("created_at", f.from);
      if (f.to) q = q.lte("created_at", f.to);
      return (await rows<LightReport>(keyset(q, page, "client_id", scope))).map(reportFromLight);
    },
    async getReport(id, scope) {
      if (!isId(id)) return null;
      return scoped(await one<ReportRow>(db.from("reports").select(REPORT_COLUMNS).eq("id", id).maybeSingle()), scope);
    },
    async listCompetitiveReports(scope, f, page) {
      if (f.client_id !== undefined && !isId(f.client_id)) return [];
      let q = db.from("competitive_reports").select(COMPETITIVE_LIST_COLUMNS);
      if (f.client_id) q = q.eq("client_id", f.client_id);
      if (f.status) q = q.eq("status", f.status);
      return (await rows<LightCompetitive>(keyset(q, page, "client_id", scope))).map(competitiveFromLight);
    },
    async getCompetitiveReport(id, scope) {
      if (!isId(id)) return null;
      return scoped(await one<CompetitiveReportRow>(db.from("competitive_reports").select(COMPETITIVE_COLUMNS).eq("id", id).maybeSingle()), scope);
    },
    async listSets(scope, f, page) {
      if (f.client_id !== undefined && !isId(f.client_id)) return [];
      let q = db.from("competitor_sets").select(SET_COLUMNS);
      if (f.client_id) q = q.eq("client_id", f.client_id);
      if (f.status) q = q.eq("status", f.status);
      return setsWithCompetitors(db, await rows<CompetitorSetRow>(keyset(q, page, "client_id", scope)));
    },
    async getSet(id, scope) {
      if (!isId(id)) return null;
      const set = scoped(await one<CompetitorSetRow>(db.from("competitor_sets").select(SET_COLUMNS).eq("id", id).maybeSingle()), scope);
      return set ? (await setsWithCompetitors(db, [set]))[0] : null;
    },
    async listPosts(scope, f, page) {
      if ((f.client_id !== undefined && !isId(f.client_id)) || (f.report_id !== undefined && !isId(f.report_id))) return [];
      let q = db.from("post_iterations").select(POST_COLUMNS);
      if (!f.include_archived) q = q.is("archived_at", null);
      if (f.client_id) q = q.eq("client_id", f.client_id);
      if (f.report_id) q = q.eq("report_id", f.report_id);
      if (f.source) q = q.eq("source", f.source);
      if (f.approved != null) q = q.eq("is_approved", f.approved);
      return rows<PostRow>(keyset(q, page, "client_id", scope));
    },
    async getPost(id, scope) {
      if (!isId(id)) return null;
      return scoped(await one<PostRow>(db.from("post_iterations").select(POST_COLUMNS).eq("id", id).maybeSingle()), scope);
    },
    async listMediaJobs(scope, f, page) {
      if (f.client_id !== undefined && !isId(f.client_id)) return [];
      let q = db.from("media_jobs").select(MEDIA_JOB_COLUMNS);
      if (f.client_id) q = q.eq("client_id", f.client_id);
      if (f.status) q = q.eq("status", f.status);
      return rows<MediaJobRow>(keyset(q, page, "client_id", scope));
    },
    async listSchedules(scope, f, page) {
      if (f.client_id !== undefined && !isId(f.client_id)) return [];
      let q = db.from("report_schedules").select(SCHEDULE_COLUMNS);
      if (f.client_id) q = q.eq("client_id", f.client_id);
      return rows<ScheduleRow>(keyset(q, page, "client_id", scope));
    },
    async listScheduledPosts(scope, f, page) {
      if (f.client_id !== undefined && !isId(f.client_id)) return [];
      let q = db.from("scheduled_posts").select(SCHEDULED_POST_COLUMNS);
      if (f.client_id) q = q.eq("client_id", f.client_id);
      if (f.status) q = q.eq("status", f.status);
      return rows<ScheduledPostRow>(keyset(q, page, "client_id", scope));
    },
    async listAlerts(scope, f, page) {
      if (f.client_id !== undefined && !isId(f.client_id)) return [];
      let q = db.from("competitive_alerts").select(ALERT_COLUMNS);
      if (f.client_id) q = q.eq("client_id", f.client_id);
      if (f.status) q = q.eq("status", f.status);
      return rows<AlertRow>(keyset(q, page, "client_id", scope));
    },
    async listDesignSystems(scope, f, page) {
      if (f.client_id !== undefined && !isId(f.client_id)) return [];
      let q = db.from("client_design_systems").select(DESIGN_SYSTEM_COLUMNS);
      if (f.client_id) q = q.eq("client_id", f.client_id);
      return rows<DesignSystemRow>(keyset(q, page, "client_id", scope));
    },
  };
}
