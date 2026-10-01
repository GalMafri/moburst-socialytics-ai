/**
 * What the API says about each thing Socialytics holds. Pure: rows in, JSON
 * out, so every shape is unit-tested. Internal identifiers (Sprout profile
 * and customer ids, RivalIQ landscape and company ids, media provider
 * request ids) never appear in any output.
 */
export const APP_URL = "https://moburst-socialytics-ai.lovable.app";
declare const Deno: { env: { get(k: string): string | undefined } } | undefined;
const SUPABASE_URL = (typeof Deno !== "undefined" ? Deno.env.get("SUPABASE_URL") : undefined) ?? "https://rwouwxqggjjacbpbhqsn.supabase.co";
export const STORAGE_URL = `${SUPABASE_URL}/storage/v1/object/public`;

// ── Row types (the columns read from the tables) ──
export interface BrandIdentity { primary_color?: string; secondary_color?: string; accent_color?: string; font_family?: string; visual_style?: string; tone_of_voice?: string; logo_description?: string; design_elements?: string; background_style?: string; [k: string]: unknown }
export interface ClientRow {
  id: string; name: string; website_url: string | null; company_slug: string | null; primary_platforms: string[] | null; geo: string | null; language: string | null; timezone: string | null;
  content_pillars: unknown; social_keywords: string[] | null; trends_keywords?: string[] | null; brand_identity: BrandIdentity | null; brand_notes?: string | null; brief_text: string | null; logo_url: string | null;
  design_style_synthesis: unknown; harvested_design_references: unknown; design_references: unknown; sprout_customer_id?: string | null; hub_company_name?: string | null; media_backend?: string | null;
  archived_at: string | null; created_at: string; updated_at?: string | null; created_by?: string | null; demo_job_id: string | null; pillars_source?: string | null; pillars_derived_at?: string | null;
}
export interface SproutProfileRow { id: string; client_id: string; sprout_profile_id: number | string; profile_name: string | null; native_name: string | null; network_type: string | null; native_link: string | null; is_active: boolean | null }
export interface CompetitorSetRow { id: string; client_id: string; status: string; notes: string | null; source: string | null; rivaliq_landscape_id: string | null; confirmed_by?: string | null; confirmed_at: string | null; created_at: string; updated_at?: string | null; demo_job_id: string | null }
export interface CompetitorRow { id: string; set_id: string; client_id: string; name: string; website_url: string | null; rationale: string | null; similarity_score: number | null; source: string | null; is_selected: boolean | null; selected_rank: number | null; rivaliq_company_id?: string | null; profile_detection: unknown; created_at: string }
export interface HandleRow { id: string; competitor_id: string; client_id: string; platform: string; handle: string; profile_url: string | null; is_active: boolean | null; followers: number | null; detection_confidence: number | null; source: string | null; detected_at: string | null }
export interface ReportRow { id: string; client_id: string; report_type: string | null; status: string; date_range_start: string | null; date_range_end: string | null; gamma_url: string | null; duration_minutes: number | null; report_data: unknown; created_at: string; created_by?: string | null; demo_job_id: string | null }
export interface CompetitiveReportRow { id: string; client_id: string; set_id: string | null; report_data: unknown; status: string; gamma_url: string | null; duration_minutes: number | null; date_range_start: string | null; date_range_end: string | null; created_by?: string | null; created_at: string; demo_job_id: string | null }
export interface PostRow {
  id: string; client_id: string; report_id: string | null; recommendation_index: number | null; version: number | null; platform: string; post_copy: string | null; hashtags: unknown; cta: string | null; concept: string | null; visual_direction: string | null;
  format: string | null; source: string | null; created_at: string; created_by?: string | null; media_urls: string[] | null; video_edits?: unknown; variant_group_id: string | null; is_selected: boolean | null; variant_angle: string | null;
  is_approved: boolean | null; approved_at: string | null; approved_by?: string | null; rejected_at: string | null; rejection_reason: string | null; rejection_note?: string | null; archived_at: string | null; calendar_post_key?: string | null; finishing: string | null; demo_job_id: string | null;
}
export interface MediaJobRow { id: string; client_id: string; post_iteration_id: string | null; kind: string; provider: string | null; request_id?: string | null; model_path?: string | null; status: string; input?: unknown; output_url: string | null; seed_image_url: string | null; error: string | null; created_by?: string | null; created_at: string; updated_at: string | null; review: unknown; reviewed_at: string | null; demo_job_id: string | null }
export interface ScheduleRow { id: string; client_id: string; frequency: string; is_active: boolean; next_run_at: string | null; last_run_at: string | null; trends_date_range_days?: number | null; analysis_date_range_days?: number | null; created_by?: string | null; created_at: string; updated_at?: string | null; report_kind: string | null; run_day_of_month: number | null; range_mode: string | null; last_result: string | null; pending_competitive_report_id?: string | null; dispatch_claimed_at?: string | null }
export interface ScheduledPostRow { id: string; client_id: string; report_id: string | null; sprout_post_id?: string | null; profile_id?: string | null; platform: string; scheduled_time: string; status: string; post_content: string | null; media_url: string | null; created_at: string; created_by?: string | null }
export interface AlertRow { id: string; client_id: string; window_start: string; window_end: string; topic: string; topic_key?: string | null; summary: string | null; companies: string[] | null; platforms: string[] | null; post_urls: string[] | null; post_count: number | null; confidence: number | null; status: string; created_at: string }
export interface DesignSystemRow { id: string; client_id: string; version: number; status: string; system: unknown; previews: unknown; built_from?: unknown; approved_by?: string | null; approved_at: string | null; created_by?: string | null; created_at: string; updated_at?: string | null }

export type SetWithCompetitors = CompetitorSetRow & { competitors: Array<CompetitorRow & { handles: HandleRow[] }> };

// ── Output types ──
export interface Links { app: string; api: string }
export interface SetupIssue { kind: string; text: string; fix: "setup" | "competitive" }
export interface Setup { ready: boolean; issues: SetupIssue[] }
export interface HandleOut { platform: string; handle: string; url: string | null; confidence: number | null; source: string | null; followers: number | null; active: boolean }
export interface CompetitorOut { id: string; name: string; website: string | null; rationale: string | null; similarity_score: number | null; selected: boolean; rank: number | null; detection: string | null; handles: HandleOut[] }
export interface CompetitorSetOut { id: string; client_id: string; status: string; source: string | null; confirmed_at: string | null; notes: string | null; tracked: boolean; competitors: CompetitorOut[]; created_at: string; demo_job_id: string | null; links: Links }
export interface ScheduleOut { id: string; client_id: string; kind: string; frequency: string; run_day_of_month: number | null; range_mode: string | null; active: boolean; next_run_at: string | null; last_run_at: string | null; last_result: string | null; created_at: string }
export interface ClientOut {
  id: string; name: string; website: string | null; company_slug: string | null; platforms: string[]; geo: string | null; language: string | null; timezone: string | null;
  pillars: Array<{ name: string; description: string | null }>; keywords: string[]; brand_identity: Record<string, string | null> | null; brief: string | null; logo_url: string | null;
  design: { synthesis_at: string | null; references: number; system: { version: number; status: string; approved_at: string | null } | null };
  sprout: { profiles: number; networks: string[] }; competitors: { set_status: string | null; selected: string[]; tracked: boolean };
  counts: { reports: number; competitive_reports: number; posts: number; schedules: number };
  last_report: { id: string; status: string; period: { start: string | null; end: string | null }; completed_at: string | null } | null;
  setup: Setup; archived: boolean; demo_job_id: string | null; created_at: string; links: Links;
  sprout_profiles?: Array<{ name: string | null; handle: string | null; network: string | null; url: string | null }>; competitor_sets?: CompetitorSetOut[]; schedules?: ScheduleOut[];
}
export interface ReportOut {
  id: string; client_id: string; type: string | null; status: string; period: { start: string | null; end: string | null }; previous_period: { start: string | null; end: string | null } | null; created_at: string; completed_at: string | null; duration_minutes: number | null;
  deck: { url: string | null; status: string | null }; counts: Record<string, unknown> | null; metrics_summary: Record<string, unknown> | null; warnings: string[]; trend_status: string | null; error: string | null; demo_job_id: string | null; links: Links;
  analysis?: Record<string, unknown> | null; calendar?: Array<{ day?: string; date_label?: string; posts: Array<Record<string, unknown>> }> | null; performance?: Record<string, unknown> | null; trends?: { tiktok: TrendOut; instagram: TrendOut } | null;
}
export interface TrendOut { posts: number; patterns: unknown }
export interface CompetitiveReportOut {
  id: string; client_id: string; set_id: string | null; status: string; period: { start: string | null; end: string | null; days: number | null }; created_at: string; completed_at: string | null; duration_minutes: number | null;
  deck: { url: string | null }; totals: Record<string, unknown> | null; quality_check: unknown; provider_status: string | null; demo_job_id: string | null; links: Links;
  analysis?: Record<string, unknown> | null; aggregates?: { client_name: string | null; metrics_available: boolean | null; companies: Array<Record<string, unknown>> } | null;
}
export interface PostOut {
  id: string; client_id: string; report_id: string | null; source: string | null; platform: string; format: string | null; copy: string | null; hashtags: string[]; cta: string | null; concept: string | null; visual_direction: string | null;
  media_urls: string[]; variant_group_id: string | null; variant_angle: string | null; selected: boolean; approved: boolean; approved_at: string | null; rejected_at: string | null; rejection_reason: string | null; finishing: string | null; version: number | null;
  archived: boolean; created_at: string; demo_job_id: string | null; links: Links;
}
export interface MediaJobOut { id: string; client_id: string; post_id: string | null; kind: string; provider: string | null; status: string; output_url: string | null; seed_image_url: string | null; error: string | null; review: { dirty: boolean | null; reason: string | null } | null; reviewed_at: string | null; created_at: string; updated_at: string | null; demo_job_id: string | null }
export interface ScheduledPostOut { id: string; client_id: string; report_id: string | null; platform: string; scheduled_time: string; status: string; content: string | null; media_url: string | null; created_at: string }
export interface AlertOut { id: string; client_id: string; topic: string; summary: string | null; companies: string[]; platforms: string[]; post_urls: string[]; post_count: number | null; confidence: number | null; window: { start: string; end: string }; status: string; created_at: string }
export interface DesignSystemOut { id: string; client_id: string; version: number; status: string; approved_at: string | null; templates: Array<{ id: string; name: string; formats: string[] }>; tokens: { font_family: string | null; colors: Record<string, unknown> | null } | null; previews: Array<{ template_id: string | null; format: string | null; url: string | null }>; notes: string | null; created_at: string }

// ── Helpers ──
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" && v ? v.split(/[\s,]+/).filter(Boolean) : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A copy of a JSON value without the named keys, at any depth. */
export function omitDeep<T>(value: T, keys: string[]): T {
  if (Array.isArray(value)) return value.map((v) => omitDeep(v, keys)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!keys.includes(k)) out[k] = omitDeep(v, keys);
    return out as T;
  }
  return value;
}
const INTERNAL_KEYS = ["post_id", "profile_id", "sprout_profile_id", "sprout_customer_id", "company_id", "focus_company_id", "landscape_id", "landscape", "rivaliq_landscape_id", "rivaliq_company_id", "request_id", "model_path"];

const BRAND_FIELDS = ["primary_color", "secondary_color", "accent_color", "font_family", "visual_style", "tone_of_voice", "logo_description", "design_elements", "background_style"];
function brandOut(b: BrandIdentity | null): Record<string, string | null> | null {
  if (!b || typeof b !== "object") return null;
  const out: Record<string, string | null> = {};
  for (const k of BRAND_FIELDS) out[k] = str(b[k]);
  return out;
}

export function pillarsOut(v: unknown): Array<{ name: string; description: string | null }> {
  if (!Array.isArray(v)) return [];
  return v.map((p) => (typeof p === "string" ? { name: p, description: null } : { name: str(obj(p).name) ?? str(obj(p).title) ?? "", description: str(obj(p).description) })).filter((p) => p.name);
}

export const CONFIRMED_SET = ["confirmed", "analyzing", "complete"];
const newestFirst = <T extends { created_at: string }>(rows: T[]) => [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

export function clientSetup(row: ClientRow, i: { sproutProfiles: SproutProfileRow[]; sets: SetWithCompetitors[]; designSystems: DesignSystemRow[]; schedules: number }): Setup {
  const issues: SetupIssue[] = [];
  if (!row.brand_identity || !Object.keys(row.brand_identity).length) issues.push({ kind: "brand_identity_missing", text: "No brand identity: research the website or upload a brand book.", fix: "setup" });
  if (!pillarsOut(row.content_pillars).length) issues.push({ kind: "pillars_missing", text: "No content pillars: derive them from the website or write them.", fix: "setup" });
  if (!strs(row.social_keywords).length) issues.push({ kind: "keywords_missing", text: "No social keywords: trend research has nothing to search for.", fix: "setup" });
  if (!i.sproutProfiles.some((p) => p.is_active !== false)) issues.push({ kind: "sprout_missing", text: "No Sprout Social profile: performance analytics and scheduled posting are not available.", fix: "setup" });
  const set = newestFirst(i.sets)[0] ?? null;
  if (!set || !CONFIRMED_SET.includes(set.status)) issues.push({ kind: "competitors_missing", text: "No confirmed competitor set: competitive reports cannot run.", fix: "competitive" });
  if (!i.designSystems.some((d) => d.status === "approved")) issues.push({ kind: "design_system_missing", text: "No approved design system: generated posts use the brand colours and fonts only.", fix: "setup" });
  if (i.schedules <= 0) issues.push({ kind: "schedule_missing", text: "No report schedule: reports run only when started by hand.", fix: "setup" });
  return { ready: issues.length === 0, issues };
}

export function clientOut(row: ClientRow, extras: { sproutProfiles: SproutProfileRow[]; sets: SetWithCompetitors[]; designSystems: DesignSystemRow[]; counts: { reports: number; competitive_reports: number; posts: number; schedules: number }; lastReport: ReportRow | null; schedules?: ScheduleRow[]; detail?: boolean }): ClientOut {
  const set = newestFirst(extras.sets)[0] ?? null;
  const approved = extras.designSystems.filter((d) => d.status === "approved").sort((a, b) => b.version - a.version)[0] ?? newestFirst(extras.designSystems)[0] ?? null;
  const synthesis = obj(row.design_style_synthesis);
  const refs = (Array.isArray(row.harvested_design_references) ? row.harvested_design_references.length : 0) + (Array.isArray(row.design_references) ? row.design_references.length : 0);
  const active = extras.sproutProfiles.filter((p) => p.is_active !== false);
  const last = extras.lastReport;
  const lastData = obj(last?.report_data);
  const out: ClientOut = {
    id: row.id, name: row.name, website: row.website_url, company_slug: row.company_slug, platforms: strs(row.primary_platforms), geo: row.geo, language: row.language, timezone: row.timezone,
    pillars: pillarsOut(row.content_pillars), keywords: strs(row.social_keywords), brand_identity: brandOut(row.brand_identity), brief: row.brief_text, logo_url: row.logo_url,
    design: { synthesis_at: str(synthesis.synthesized_at), references: refs, system: approved ? { version: approved.version, status: approved.status, approved_at: approved.approved_at } : null },
    sprout: { profiles: active.length, networks: [...new Set(active.map((p) => p.network_type).filter((n): n is string => !!n))] },
    competitors: { set_status: set?.status ?? null, selected: set ? set.competitors.filter((c) => c.is_selected).sort((a, b) => (a.selected_rank ?? 99) - (b.selected_rank ?? 99)).map((c) => c.name) : [], tracked: !!set?.rivaliq_landscape_id },
    counts: extras.counts,
    last_report: last ? { id: last.id, status: last.status, period: { start: last.date_range_start ?? str(obj(obj(lastData.report_period).current_month).start), end: last.date_range_end ?? str(obj(obj(lastData.report_period).current_month).end) }, completed_at: str(lastData.completed_at) } : null,
    setup: clientSetup(row, { sproutProfiles: extras.sproutProfiles, sets: extras.sets, designSystems: extras.designSystems, schedules: Math.max(extras.counts.schedules, extras.schedules?.length ?? 0) }),
    archived: !!row.archived_at, demo_job_id: row.demo_job_id, created_at: row.created_at, links: { app: `${APP_URL}/clients/${row.id}/setup`, api: `/v1/clients/${row.id}` },
  };
  if (extras.detail) {
    out.sprout_profiles = active.map((p) => ({ name: p.profile_name ?? p.native_name, handle: p.native_name, network: p.network_type, url: p.native_link }));
    out.competitor_sets = newestFirst(extras.sets).map(competitorSetOut);
    out.schedules = (extras.schedules ?? []).map(scheduleOut);
  }
  return out;
}

export function competitorSetOut(set: SetWithCompetitors): CompetitorSetOut {
  const competitors = [...set.competitors].sort((a, b) => (a.is_selected === b.is_selected ? (a.selected_rank ?? 99) - (b.selected_rank ?? 99) || (b.similarity_score ?? 0) - (a.similarity_score ?? 0) : a.is_selected ? -1 : 1));
  return {
    id: set.id, client_id: set.client_id, status: set.status, source: set.source, confirmed_at: set.confirmed_at, notes: set.notes, tracked: !!set.rivaliq_landscape_id,
    competitors: competitors.map((c) => ({
      id: c.id, name: c.name, website: c.website_url, rationale: c.rationale, similarity_score: c.similarity_score, selected: !!c.is_selected, rank: c.selected_rank, detection: str(obj(c.profile_detection).status),
      handles: (c.handles ?? []).map((h) => ({ platform: h.platform, handle: h.handle, url: h.profile_url, confidence: h.detection_confidence, source: h.source, followers: h.followers, active: h.is_active !== false })),
    })),
    created_at: set.created_at, demo_job_id: set.demo_job_id, links: { app: `${APP_URL}/clients/${set.client_id}/competitive`, api: `/v1/competitor-sets/${set.id}` },
  };
}

const trendOut = (v: unknown): TrendOut => ({ posts: Array.isArray(obj(v).posts) ? (obj(v).posts as unknown[]).length : 0, patterns: obj(v).patterns ?? null });

export function reportOut(row: ReportRow, opts: { detail?: boolean } = {}): ReportOut {
  const rd = obj(row.report_data);
  const period = obj(rd.report_period);
  const cur = obj(period.current_month), prev = obj(period.previous_month);
  const counts = rd.data_counts && typeof rd.data_counts === "object" ? (rd.data_counts as Record<string, unknown>) : null;
  const out: ReportOut = {
    id: row.id, client_id: row.client_id, type: row.report_type, status: row.status,
    period: { start: row.date_range_start ?? str(cur.start), end: row.date_range_end ?? str(cur.end) }, previous_period: str(prev.start) || str(prev.end) ? { start: str(prev.start), end: str(prev.end) } : null,
    created_at: row.created_at, completed_at: str(rd.completed_at), duration_minutes: row.duration_minutes ?? num(rd.duration_minutes),
    deck: { url: row.gamma_url ?? str(rd.gamma_url), status: str(rd.gamma_status) }, counts, metrics_summary: rd.metrics_summary && typeof rd.metrics_summary === "object" ? (rd.metrics_summary as Record<string, unknown>) : null,
    warnings: strs(rd.warnings), trend_status: str(rd.trend_status), error: str(rd.error), demo_job_id: row.demo_job_id,
    links: { app: `${APP_URL}/clients/${row.client_id}/reports/${row.id}`, api: `/v1/reports/${row.id}` },
  };
  if (opts.detail) {
    out.analysis = rd.ai_analysis && typeof rd.ai_analysis === "object" ? omitDeep(rd.ai_analysis as Record<string, unknown>, INTERNAL_KEYS) : null;
    out.calendar = Array.isArray(rd.content_calendar) ? (rd.content_calendar as ReportOut["calendar"]) : null;
    out.performance = rd.sprout_performance && typeof rd.sprout_performance === "object" ? omitDeep(rd.sprout_performance as Record<string, unknown>, INTERNAL_KEYS) : null;
    out.trends = rd.tiktok_trends || rd.instagram_trends ? { tiktok: trendOut(rd.tiktok_trends), instagram: trendOut(rd.instagram_trends) } : null;
  }
  return out;
}

export function competitiveReportOut(row: CompetitiveReportRow, opts: { detail?: boolean } = {}): CompetitiveReportOut {
  const rd = obj(row.report_data);
  const period = obj(rd.period);
  const out: CompetitiveReportOut = {
    id: row.id, client_id: row.client_id, set_id: row.set_id, status: row.status,
    period: { start: row.date_range_start ?? str(period.start), end: row.date_range_end ?? str(period.end), days: num(period.days) }, created_at: row.created_at, completed_at: str(rd.generated_at), duration_minutes: row.duration_minutes,
    deck: { url: row.gamma_url ?? str(rd.gamma_url) }, totals: rd.totals && typeof rd.totals === "object" ? (rd.totals as Record<string, unknown>) : null, quality_check: rd.quality_check ?? null, provider_status: str(rd.provider_status), demo_job_id: row.demo_job_id,
    links: { app: `${APP_URL}/clients/${row.client_id}/competitive/reports/${row.id}`, api: `/v1/competitive-reports/${row.id}` },
  };
  if (opts.detail) {
    out.analysis = rd.ai_analysis && typeof rd.ai_analysis === "object" ? omitDeep(rd.ai_analysis as Record<string, unknown>, INTERNAL_KEYS) : null;
    const agg = obj(rd.aggregates);
    out.aggregates = rd.aggregates ? { client_name: str(agg.client_name), metrics_available: typeof agg.metrics_available === "boolean" ? agg.metrics_available : null, companies: Array.isArray(agg.companies) ? agg.companies.map((c) => omitDeep(obj(c), INTERNAL_KEYS)) : [] } : null;
  }
  return out;
}

export function postOut(row: PostRow): PostOut {
  return {
    id: row.id, client_id: row.client_id, report_id: row.report_id, source: row.source, platform: row.platform, format: row.format, copy: row.post_copy, hashtags: strs(row.hashtags), cta: row.cta, concept: row.concept, visual_direction: row.visual_direction,
    media_urls: strs(row.media_urls), variant_group_id: row.variant_group_id, variant_angle: row.variant_angle, selected: !!row.is_selected, approved: !!row.is_approved, approved_at: row.approved_at, rejected_at: row.rejected_at, rejection_reason: row.rejection_reason,
    finishing: row.finishing, version: row.version, archived: !!row.archived_at, created_at: row.created_at, demo_job_id: row.demo_job_id,
    links: { app: row.report_id ? `${APP_URL}/clients/${row.client_id}/reports/${row.report_id}` : `${APP_URL}/clients/${row.client_id}/reports`, api: `/v1/posts/${row.id}` },
  };
}

export function mediaJobOut(row: MediaJobRow): MediaJobOut {
  const review = row.review && typeof row.review === "object" ? obj(row.review) : null;
  return {
    id: row.id, client_id: row.client_id, post_id: row.post_iteration_id, kind: row.kind, provider: row.provider, status: row.status, output_url: row.output_url, seed_image_url: row.seed_image_url, error: row.error,
    review: review ? { dirty: typeof review.dirty === "boolean" ? review.dirty : null, reason: str(review.reason) } : null, reviewed_at: row.reviewed_at, created_at: row.created_at, updated_at: row.updated_at, demo_job_id: row.demo_job_id,
  };
}

export function scheduleOut(row: ScheduleRow): ScheduleOut {
  return { id: row.id, client_id: row.client_id, kind: row.report_kind ?? "social", frequency: row.frequency, run_day_of_month: row.run_day_of_month, range_mode: row.range_mode, active: row.is_active, next_run_at: row.next_run_at, last_run_at: row.last_run_at, last_result: row.last_result, created_at: row.created_at };
}

export function scheduledPostOut(row: ScheduledPostRow): ScheduledPostOut {
  return { id: row.id, client_id: row.client_id, report_id: row.report_id, platform: row.platform, scheduled_time: row.scheduled_time, status: row.status, content: row.post_content, media_url: row.media_url, created_at: row.created_at };
}

export function alertOut(row: AlertRow): AlertOut {
  return { id: row.id, client_id: row.client_id, topic: row.topic, summary: row.summary, companies: strs(row.companies), platforms: strs(row.platforms), post_urls: strs(row.post_urls), post_count: row.post_count, confidence: row.confidence, window: { start: row.window_start, end: row.window_end }, status: row.status, created_at: row.created_at };
}

export function designSystemOut(row: DesignSystemRow): DesignSystemOut {
  const sys = obj(row.system);
  const tokens = obj(sys.tokens);
  const previews = Array.isArray(row.previews) ? row.previews.map((p) => obj(p)) : [];
  return {
    id: row.id, client_id: row.client_id, version: row.version, status: row.status, approved_at: row.approved_at,
    templates: Array.isArray(sys.templates) ? sys.templates.map((t) => ({ id: str(obj(t).id) ?? "", name: str(obj(t).name) ?? "", formats: strs(obj(t).formats) })) : [],
    tokens: sys.tokens ? { font_family: str(obj(tokens.font).family), colors: tokens.colors && typeof tokens.colors === "object" ? (tokens.colors as Record<string, unknown>) : null } : null,
    previews: previews.map((p) => ({ template_id: str(p.template_id), format: str(p.format), url: str(p.url) ?? (str(p.path) ? `${STORAGE_URL}/design-previews/${p.path}` : null) })),
    notes: str(sys.notes), created_at: row.created_at,
  };
}

/** The sprout-analytics body without Sprout profile ids. */
export function analyticsOut(body: Record<string, unknown>): Record<string, unknown> {
  const { profiles, by_profile, top_posts, ...rest } = body;
  return {
    ...omitDeep(rest, INTERNAL_KEYS),
    profiles: Array.isArray(profiles) ? profiles.map((p) => ({ name: str(obj(p).name), network: str(obj(p).network) })) : [],
    by_profile: Array.isArray(by_profile) ? by_profile.map((p) => omitDeep(obj(p), INTERNAL_KEYS)) : [],
    top_posts: Array.isArray(top_posts) ? top_posts.map((p) => omitDeep(obj(p), INTERNAL_KEYS)) : [],
  };
}
