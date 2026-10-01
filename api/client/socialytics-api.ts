/**
 * A zero-dependency client for the Socialytics API, for gOS and other Moburst
 * tools. Plain fetch, typed envelopes, one object per resource. Copy the file
 * or import it; it has no imports of its own.
 *
 *   const api = new SocialyticsApi({ baseUrl: "https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/api", key: process.env.SOCIALYTICS_API_KEY });
 *   const reports = await api.reports.list({ client_id });
 *   const job = await api.demoJobs.create({ client_name: "Brooklinen", website: "brooklinen.com", callback_url: "https://moburst.ai/hooks/socialytics" });
 *   const done = await api.demoJobs.wait(job.id);
 */
export type ErrorCode = "invalid_request" | "unauthorized" | "forbidden" | "not_found" | "method_not_allowed" | "conflict" | "rate_limited" | "demo_capacity" | "job_running" | "unprocessable" | "upstream_failed" | "internal";

export class ApiClientError extends Error {
  constructor(public status: number, public code: ErrorCode | string, message: string, public details?: unknown) {
    super(message);
    this.name = "ApiClientError";
  }
}

export interface Page<T> { data: T[]; next_cursor: string | null }
export interface Links { app: string; api: string }
export interface Period { start: string | null; end: string | null }
export interface SetupIssue { kind: string; text: string; fix: "setup" | "competitive" }
export interface Setup { ready: boolean; issues: SetupIssue[] }
export interface Handle { platform: string; handle: string; url: string | null; confidence: number | null; source: string | null; followers: number | null; active: boolean }
export interface Competitor { id: string; name: string; website: string | null; rationale: string | null; similarity_score: number | null; selected: boolean; rank: number | null; detection: string | null; handles: Handle[] }
export interface CompetitorSet { id: string; client_id: string; status: string; source: string | null; confirmed_at: string | null; notes: string | null; tracked: boolean; competitors: Competitor[]; created_at: string; demo_job_id: string | null; links: Links }
export interface Schedule { id: string; client_id: string; kind: string; frequency: string; run_day_of_month: number | null; range_mode: string | null; active: boolean; next_run_at: string | null; last_run_at: string | null; last_result: string | null; created_at: string }
export interface Client {
  id: string; name: string; website: string | null; company_slug: string | null; platforms: string[]; geo: string | null; language: string | null; timezone: string | null;
  pillars: Array<{ name: string; description: string | null }>; keywords: string[]; brand_identity: Record<string, string | null> | null; brief: string | null; logo_url: string | null;
  design: { synthesis_at: string | null; references: number; system: { version: number; status: string; approved_at: string | null } | null };
  sprout: { profiles: number; networks: string[] }; competitors: { set_status: string | null; selected: string[]; tracked: boolean };
  counts: { reports: number; competitive_reports: number; posts: number; schedules: number }; last_report: { id: string; status: string; period: Period; completed_at: string | null } | null;
  setup: Setup; archived: boolean; demo_job_id: string | null; created_at: string; links: Links;
  sprout_profiles?: Array<{ name: string | null; handle: string | null; network: string | null; url: string | null }>; competitor_sets?: CompetitorSet[]; schedules?: Schedule[];
}
export interface Report {
  id: string; client_id: string; type: string | null; status: string; period: Period; previous_period: Period | null; created_at: string; completed_at: string | null; duration_minutes: number | null;
  deck: { url: string | null; status: string | null }; counts: Record<string, unknown> | null; metrics_summary: Record<string, unknown> | null; warnings: string[]; trend_status: string | null; error: string | null; demo_job_id: string | null; links: Links;
  analysis?: Record<string, unknown> | null; calendar?: Array<{ day?: string; date_label?: string; posts: Array<Record<string, unknown>> }> | null; performance?: Record<string, unknown> | null; trends?: { tiktok: { posts: number; patterns: unknown }; instagram: { posts: number; patterns: unknown } } | null;
}
export interface CompetitiveReport {
  id: string; client_id: string; set_id: string | null; status: string; period: Period & { days: number | null }; created_at: string; completed_at: string | null; duration_minutes: number | null;
  deck: { url: string | null }; totals: Record<string, unknown> | null; quality_check: unknown; provider_status: string | null; demo_job_id: string | null; links: Links;
  analysis?: Record<string, unknown> | null; aggregates?: { client_name: string | null; metrics_available: boolean | null; companies: Array<Record<string, unknown>> } | null;
}
export interface Post {
  id: string; client_id: string; report_id: string | null; source: string | null; platform: string; format: string | null; copy: string | null; hashtags: string[]; cta: string | null; concept: string | null; visual_direction: string | null;
  media_urls: string[]; variant_group_id: string | null; variant_angle: string | null; selected: boolean; approved: boolean; approved_at: string | null; rejected_at: string | null; rejection_reason: string | null; finishing: string | null; version: number | null; archived: boolean; created_at: string; demo_job_id: string | null; links: Links;
}
export interface MediaJob { id: string; client_id: string; post_id: string | null; kind: string; provider: string | null; status: string; output_url: string | null; seed_image_url: string | null; error: string | null; review: { dirty: boolean | null; reason: string | null } | null; reviewed_at: string | null; created_at: string; updated_at: string | null; demo_job_id: string | null }
export interface ScheduledPost { id: string; client_id: string; report_id: string | null; platform: string; scheduled_time: string; status: string; content: string | null; media_url: string | null; created_at: string }
export interface Alert { id: string; client_id: string; topic: string; summary: string | null; companies: string[]; platforms: string[]; post_urls: string[]; post_count: number | null; confidence: number | null; window: { start: string; end: string }; status: string; created_at: string }
export interface DesignSystem { id: string; client_id: string; version: number; status: string; approved_at: string | null; templates: Array<{ id: string; name: string; formats: string[] }>; tokens: { font_family: string | null; colors: Record<string, unknown> | null } | null; previews: Array<{ template_id: string | null; format: string | null; url: string | null }>; notes: string | null; created_at: string }
export interface Analytics { client: { id: string; name: string }; range: { start: string; end: string; days: number }; previous_range: { start: string; end: string; days: number }; profiles: Array<{ name: string | null; network: string | null }>; totals: Record<string, number>; previous_totals: Record<string, number>; changes: Record<string, { current: number; previous: number; absolute: number; percent: number | null }>; daily: Array<Record<string, unknown>>; by_profile: Array<Record<string, unknown>>; top_posts: Array<Record<string, unknown>>; fetched_at: string }
export interface Finding { kind: string; severity: "high" | "medium" | "low"; client_id: string | null; client: string | null; detail: string; link: string | null; report_id: string | null; job_id: string | null }
export interface Status { tool: string; time: string; findings: Finding[]; demo_jobs?: { running: number; stuck: number; failed_24h: number }; counts?: Record<string, number> }
export interface DemoInput { client_name: string; website: string; industry?: string; competitors?: Array<{ name: string; website?: string }>; requester?: { id?: string; email?: string; name?: string }; idempotency_key?: string; callback_url?: string; regions?: string[]; force_run?: boolean }
export interface Step { name: string; status: "pending" | "running" | "done" | "skipped" | "failed"; started_at?: string; finished_at?: string; outcome?: string; reason?: string; message?: string; data?: Record<string, unknown> }
export interface Gap { step: string; code: string; message: string }
export type JobStatus = "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
export interface DemoJob {
  id: string; tool: string; status: JobStatus; input: Record<string, unknown>; requester: Record<string, unknown> | null; callback_url: string | null; callback_status: Record<string, unknown> | null; client_id: string | null; run_ids: string[]; steps: Step[];
  outputs: Record<string, unknown> | null; gaps: Gap[]; error: string | null; next_check_at: string | null; created_at: string; started_at: string | null; completed_at: string | null; links: { self: string; client: string | null };
}
export interface Discarded { job_id: string; removed: { client: boolean; competitor_sets: number; reports: number; competitive_reports: number; posts: number; media_jobs: number } }

type Query = Record<string, string | number | boolean | undefined | null>;
const TERMINAL: JobStatus[] = ["completed", "partial", "failed", "cancelled"];

export interface SocialyticsApiOptions { baseUrl: string; key: string; fetchImpl?: typeof fetch }

export class SocialyticsApi {
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SocialyticsApiOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.key = opts.key;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, query?: Query, body?: unknown): Promise<T> {
    const qs = query ? Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&") : "";
    const res = await this.fetchImpl(`${this.base}${path}${qs ? `?${qs}` : ""}`, {
      method, headers: { Authorization: `Bearer ${this.key}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const e = (parsed as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
      throw new ApiClientError(res.status, e?.code ?? "internal", e?.message ?? `The API answered ${res.status}`, e?.details);
    }
    return parsed as T;
  }
  private one = <T>(path: string, query?: Query) => this.request<{ data: T }>("GET", path, query).then((r) => r.data);
  private list = <T>(path: string, query?: Query) => this.request<Page<T>>("GET", path, query);

  readonly clients = {
    list: (q: { q?: string; company_slug?: string; include_archived?: boolean; limit?: number; cursor?: string } = {}) => this.list<Client>("/v1/clients", q),
    get: (id: string) => this.one<Client>(`/v1/clients/${id}`),
    setup: (id: string) => this.one<Setup>(`/v1/clients/${id}/setup`),
    /** Sprout performance over a window (yyyy-mm-dd; the last 30 days by default). Throws `unprocessable` when the client has no Sprout profile. */
    analytics: (id: string, q: { start?: string; end?: string } = {}) => this.one<Analytics>(`/v1/clients/${id}/analytics`, q),
  };
  readonly reports = {
    list: (q: { client_id?: string; status?: string; from?: string; to?: string; limit?: number; cursor?: string } = {}) => this.list<Report>("/v1/reports", q),
    get: (id: string) => this.one<Report>(`/v1/reports/${id}`),
  };
  readonly competitiveReports = {
    list: (q: { client_id?: string; status?: string; limit?: number; cursor?: string } = {}) => this.list<CompetitiveReport>("/v1/competitive-reports", q),
    get: (id: string) => this.one<CompetitiveReport>(`/v1/competitive-reports/${id}`),
  };
  readonly competitorSets = {
    list: (q: { client_id?: string; status?: string; limit?: number; cursor?: string } = {}) => this.list<CompetitorSet>("/v1/competitor-sets", q),
    get: (id: string) => this.one<CompetitorSet>(`/v1/competitor-sets/${id}`),
  };
  readonly posts = {
    list: (q: { client_id?: string; report_id?: string; source?: string; approved?: boolean; include_archived?: boolean; limit?: number; cursor?: string } = {}) => this.list<Post>("/v1/posts", q),
    get: (id: string) => this.one<Post>(`/v1/posts/${id}`),
  };
  readonly mediaJobs = { list: (q: { client_id?: string; status?: string; limit?: number; cursor?: string } = {}) => this.list<MediaJob>("/v1/media-jobs", q) };
  readonly schedules = { list: (q: { client_id?: string; limit?: number; cursor?: string } = {}) => this.list<Schedule>("/v1/schedules", q) };
  readonly scheduledPosts = { list: (q: { client_id?: string; status?: string; limit?: number; cursor?: string } = {}) => this.list<ScheduledPost>("/v1/scheduled-posts", q) };
  readonly alerts = { list: (q: { client_id?: string; status?: string; limit?: number; cursor?: string } = {}) => this.list<Alert>("/v1/alerts", q) };
  readonly designSystems = { list: (q: { client_id?: string; limit?: number; cursor?: string } = {}) => this.list<DesignSystem>("/v1/design-systems", q) };
  readonly status = () => this.one<Status>("/v1/status");
  readonly demoJobs = {
    create: (input: DemoInput) => this.request<{ data: DemoJob }>("POST", "/v1/demo-jobs", undefined, input).then((r) => r.data),
    get: (id: string) => this.one<DemoJob>(`/v1/demo-jobs/${id}`),
    list: (q: { client_id?: string; status?: string; limit?: number; cursor?: string } = {}) => this.list<DemoJob>("/v1/demo-jobs", q),
    cancel: (id: string) => this.request<{ data: DemoJob }>("POST", `/v1/demo-jobs/${id}/cancel`, undefined, {}).then((r) => r.data),
    discard: (id: string) => this.request<{ data: Discarded }>("POST", `/v1/demo-jobs/${id}/discard`, undefined, {}).then((r) => r.data),
    /** Polls until the job reaches a terminal status. A demo takes 30 minutes to 3 hours (the report wait alone allows 100 minutes). */
    wait: async (id: string, opts: { pollMs?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Promise<DemoJob> => {
      const pollMs = opts.pollMs ?? 60_000;
      const timeoutMs = opts.timeoutMs ?? 4 * 3_600_000;
      const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
      const now = opts.now ?? Date.now;
      const start = now();
      for (;;) {
        const job = await this.one<DemoJob>(`/v1/demo-jobs/${id}`);
        if (TERMINAL.includes(job.status)) return job;
        if (now() - start > timeoutMs) throw new Error(`Demo job ${id} did not finish within ${Math.round(timeoutMs / 60_000)} minutes (last status ${job.status})`);
        await sleep(pollMs);
      }
    },
  };
}
