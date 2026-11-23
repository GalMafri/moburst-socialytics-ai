/**
 * The OpenAPI component schemas: one per documented response and body.
 * A contract test scans them for internal field names and checks that
 * every route's doc.response exists here.
 */
import { SCOPES } from "../_shared/api/router.ts";
import { COST_SCHEMAS } from "../_shared/cost/routes.ts";
type S = Record<string, unknown>;
const str = { type: ["string", "null"] };
const num = { type: ["number", "null"] };
const int = { type: ["integer", "null"] };
const bool = { type: "boolean" };
const obj = (properties: Record<string, unknown>, required?: string[]): S => ({ type: "object", properties, ...(required ? { required } : {}) });
const arr = (items: unknown): S => ({ type: "array", items });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const list = (item: string): S => obj({ data: arr(ref(item)), next_cursor: str }, ["data", "next_cursor"]);
const one = (item: string): S => obj({ data: ref(item) }, ["data"]);
const anyObj = { type: ["object", "null"] };

const Links = obj({ app: { type: "string" }, api: { type: "string" } });
const Period = obj({ start: str, end: str });
const SetupIssue = obj({
  kind: { type: "string", enum: ["brand_identity_missing", "pillars_missing", "keywords_missing", "sprout_missing", "competitors_missing", "design_style_missing", "schedule_missing"] },
  text: { type: "string" }, fix: { type: "string", enum: ["setup", "competitive"] },
});
const Setup = obj({ ready: bool, issues: arr(SetupIssue) }, ["ready", "issues"]);
const Handle = obj({ platform: { type: "string" }, handle: { type: "string" }, url: str, confidence: num, source: str, followers: int, active: bool });
const Competitor = obj({ id: { type: "string" }, name: { type: "string" }, website: str, rationale: str, similarity_score: num, selected: bool, rank: int, detection: str, handles: arr(Handle) });
const CompetitorSet = obj({ id: { type: "string" }, client_id: { type: "string" }, status: { type: "string" }, source: str, confirmed_at: str, notes: str, tracked: bool, competitors: arr(Competitor), created_at: { type: "string" }, demo_job_id: str, links: Links });
const Schedule = obj({ id: { type: "string" }, client_id: { type: "string" }, kind: { type: "string" }, frequency: { type: "string" }, run_day_of_month: int, range_mode: str, active: bool, next_run_at: str, last_run_at: str, last_result: str, created_at: { type: "string" } });
const BrandIdentity = obj({ primary_color: str, secondary_color: str, accent_color: str, font_family: str, visual_style: str, tone_of_voice: str, logo_description: str, design_elements: str, background_style: str });
const Client = obj({
  id: { type: "string" }, name: { type: "string" }, website: str, company_slug: str, platforms: arr({ type: "string" }), geo: str, language: str, timezone: str,
  pillars: arr(obj({ name: { type: "string" }, description: str })), keywords: arr({ type: "string" }), brand_identity: { oneOf: [BrandIdentity, { type: "null" }] }, brief: str, logo_url: str,
  // system is the retired design system, kept for its readers; designs start once the design settings are confirmed (ready),
  // and until then waiting_for says what the client's setup waits for.
  design: obj({
    synthesis_at: str, references: { type: "integer" }, system: { oneOf: [obj({ version: { type: "integer" }, status: { type: "string" }, approved_at: str }), { type: "null" }] },
    ready: bool, waiting_for: { type: ["string", "null"], enum: ["look", "designed_posts", "social_accounts", "logo_file", null] },
  }),
  sprout: obj({ profiles: { type: "integer" }, networks: arr({ type: "string" }) }), competitors: obj({ set_status: str, selected: arr({ type: "string" }), tracked: bool }),
  counts: obj({ reports: { type: "integer" }, competitive_reports: { type: "integer" }, posts: { type: "integer" }, schedules: { type: "integer" } }),
  last_report: { oneOf: [obj({ id: { type: "string" }, status: { type: "string" }, period: Period, completed_at: str }), { type: "null" }] },
  setup: Setup, archived: bool, demo_job_id: str, created_at: { type: "string" }, links: Links,
  sprout_profiles: arr(obj({ name: str, handle: str, network: str, url: str })), competitor_sets: arr(CompetitorSet), schedules: arr(Schedule),
});
const Trend = obj({ posts: { type: "integer" }, patterns: anyObj });
const IndustryPost = obj({ platform: { type: "string" }, url: { type: "string" }, author: { type: "string" }, text: { type: "string" }, format: str, posted_at: str });
const IndustryTheme = obj({ title: { type: "string" }, happening: { type: "string" }, why_it_matters: { type: "string" }, angle: { type: "string" }, platforms: arr({ type: "string" }), posts: arr(IndustryPost) });
const Report = obj({
  id: { type: "string" }, client_id: { type: "string" }, type: str, status: { type: "string" }, period: Period, previous_period: { oneOf: [Period, { type: "null" }] }, created_at: { type: "string" }, completed_at: str, duration_minutes: num,
  deck: obj({ url: str, status: str }), counts: anyObj, metrics_summary: anyObj, warnings: arr({ type: "string" }), trend_status: str, error: str, demo_job_id: str, links: Links,
  analysis: anyObj, calendar: { type: ["array", "null"], items: obj({ day: str, date_label: str, posts: arr({ type: "object" }) }) }, performance: anyObj, trends: { oneOf: [obj({ tiktok: Trend, instagram: Trend }), { type: "null" }] },
  industry_trends: { oneOf: [obj({ themes: arr(IndustryTheme) }, ["themes"]), { type: "null" }], description: "The themes the weekly trend collection stored for the weeks that start inside the report's period (newest week first), each with its example posts. Null when none." },
});
const CompetitiveReport = obj({
  id: { type: "string" }, client_id: { type: "string" }, set_id: str, status: { type: "string" }, period: obj({ start: str, end: str, days: int }), created_at: { type: "string" }, completed_at: str, duration_minutes: num,
  deck: obj({ url: str }), totals: anyObj, quality_check: {}, provider_status: str, demo_job_id: str, links: Links,
  analysis: anyObj, aggregates: { oneOf: [obj({ client_name: str, metrics_available: { type: ["boolean", "null"] }, companies: arr({ type: "object" }) }), { type: "null" }] },
});
const Post = obj({
  id: { type: "string" }, client_id: { type: "string" }, report_id: str, source: str, platform: { type: "string" }, format: str, copy: str, hashtags: arr({ type: "string" }), cta: str, concept: str, visual_direction: str,
  media_urls: arr({ type: "string" }), variant_group_id: str, variant_angle: str, selected: bool, approved: bool, approved_at: str, rejected_at: str, rejection_reason: str, finishing: str, version: int, archived: bool, created_at: { type: "string" }, demo_job_id: str, links: Links,
});
const MediaJob = obj({ id: { type: "string" }, client_id: { type: "string" }, post_id: str, kind: { type: "string" }, provider: str, status: { type: "string" }, output_url: str, seed_image_url: str, error: str, review: { oneOf: [obj({ dirty: { type: ["boolean", "null"] }, reason: str }), { type: "null" }] }, reviewed_at: str, created_at: { type: "string" }, updated_at: str, demo_job_id: str });
const ScheduledPost = obj({ id: { type: "string" }, client_id: { type: "string" }, report_id: str, platform: { type: "string" }, scheduled_time: { type: "string" }, status: { type: "string" }, content: str, media_url: str, created_at: { type: "string" } });
const Alert = obj({ id: { type: "string" }, client_id: { type: "string" }, topic: { type: "string" }, summary: str, companies: arr({ type: "string" }), platforms: arr({ type: "string" }), post_urls: arr({ type: "string" }), post_count: int, confidence: num, window: obj({ start: { type: "string" }, end: { type: "string" } }), status: { type: "string" }, created_at: { type: "string" } });
const DesignSystem = obj({
  id: { type: "string" }, client_id: { type: "string" }, version: { type: "integer" }, status: { type: "string" }, approved_at: str, templates: arr(obj({ id: { type: "string" }, name: { type: "string" }, formats: arr({ type: "string" }) })),
  tokens: { oneOf: [obj({ font_family: str, colors: anyObj }), { type: "null" }] }, previews: arr(obj({ template_id: str, format: str, url: str })), notes: str, created_at: { type: "string" },
});
const Totals = obj({ impressions: { type: "number" }, reactions: { type: "number" }, post_link_clicks: { type: "number" }, video_views: { type: "number" }, comments: { type: "number" }, shares: { type: "number" } });
const Analytics = obj({
  client: obj({ id: { type: "string" }, name: { type: "string" } }), range: obj({ start: { type: "string" }, end: { type: "string" }, days: { type: "integer" } }), previous_range: obj({ start: { type: "string" }, end: { type: "string" }, days: { type: "integer" } }),
  profiles: arr(obj({ name: str, network: str })), totals: Totals, previous_totals: Totals, changes: { type: "object" }, daily: arr({ type: "object" }), by_profile: arr({ type: "object" }), top_posts: arr({ type: "object" }), fetched_at: { type: "string" },
});
const Finding = obj({ kind: { type: "string" }, severity: { type: "string" }, client_id: str, client: str, detail: { type: "string" }, link: str, report_id: str, job_id: str });
const Status = obj({ tool: { type: "string" }, time: { type: "string" }, findings: arr(Finding), demo_jobs: obj({ running: { type: "integer" }, stuck: { type: "integer" }, failed_24h: { type: "integer" } }), counts: { type: "object" } });
const Health = obj({ ok: bool, tool: { type: "string" }, version: { type: "string" }, build: { type: "string", description: "Hash of the deployed API function source; equals BUILD_STAMP in supabase/functions/api/build-stamp.ts on the commit it was built from." }, time: { type: "string" } });

const DemoInput = obj({
  client_name: { type: "string", description: "The brand's name." }, website: { type: "string", description: "The brand's website (domain or URL)." }, industry: { type: "string", description: "Accepted for parity with AdVisor; not used by Socialytics." },
  competitors: arr(obj({ name: { type: "string" }, website: { type: "string" } })), requester: obj({ id: str, email: str, name: str }), idempotency_key: { type: "string" }, callback_url: { type: "string", description: "An https URL that receives the finished job (signed with X-Demo-Signature)." },
  regions: arr({ type: "string" }), force_run: { type: "boolean", description: "Run the reports even when one completed in the last 7 days." },
}, ["client_name", "website"]);
const Step = obj({ name: { type: "string" }, status: { type: "string", enum: ["pending", "running", "done", "skipped", "failed"] }, started_at: str, finished_at: str, outcome: str, reason: str, message: str, data: anyObj });
const Gap = obj({ step: { type: "string" }, code: { type: "string" }, message: { type: "string" } });
const DemoJob = obj({
  id: { type: "string" }, tool: { type: "string" }, status: { type: "string", enum: ["queued", "running", "completed", "partial", "failed", "cancelled"] }, input: { type: "object" }, requester: anyObj, callback_url: str, callback_status: anyObj,
  client_id: str, run_ids: arr({ type: "string" }), steps: arr(Step), outputs: anyObj, gaps: arr(Gap), error: str, next_check_at: str, created_at: { type: "string" }, started_at: str, completed_at: str, updated_at: str, idempotency_key: str,
  links: obj({ self: { type: "string" }, client: str }),
});
const Discarded = obj({ job_id: { type: "string" }, removed: obj({ client: bool, competitor_sets: { type: "integer" }, reports: { type: "integer" }, competitive_reports: { type: "integer" }, posts: { type: "integer" }, media_jobs: { type: "integer" } }) });
const ApiKey = obj({ id: { type: "string" }, name: { type: "string" }, key_prefix: { type: "string" }, scopes: arr({ type: "string", enum: [...SCOPES] }), company_slugs: { type: ["array", "null"], items: { type: "string" } }, client_ids: { type: ["array", "null"], items: { type: "string" } }, rate_limit_per_minute: { type: "integer" }, created_at: { type: "string" }, expires_at: str, last_used_at: str, revoked_at: str, note: str, owner_user_id: str, owner_email: str, created_by_email: { ...str, description: "Who made the key (the admin list)." } });
const ApiKeyCreate = obj({ name: { type: "string" }, scopes: arr({ type: "string", enum: [...SCOPES] }), company_slugs: arr({ type: "string" }), client_ids: arr({ type: "string" }), rate_limit_per_minute: { type: "integer" }, expires_at: str, note: str }, ["name", "scopes"]);
const ApiKeyCreated = obj({ ...(ApiKey.properties as Record<string, unknown>), key: { type: "string", description: "Shown once; store it now." }, warning: { type: "string" } });
// A person's own key (/v1/me/keys): read only or read and write, for all the companies its owner can see or some, at most 90 days,
// reaching what its owner can see in Socialytics at the time of each call (narrowed to its companies).
const PersonalKey = obj({
  id: { type: "string" }, name: { type: "string" }, key_prefix: { type: "string" }, scopes: arr({ type: "string", enum: ["read", "run"] }),
  company_slugs: { type: ["array", "null"], items: { type: "string" }, description: "The companies the key is for; null for every company its owner can see." },
  created_at: { type: "string" }, expires_at: str, last_used_at: str, revoked_at: str,
});
const PersonalKeyCreate = obj({
  name: { type: "string", minLength: 1, maxLength: 80, description: "1 to 80 characters after trimming, with at least one visible character and no line breaks, tabs or other control characters." },
  scopes: arr({ type: "string", enum: ["read", "run"], description: "[\"read\"] (default, read only) or [\"read\", \"run\"] (read and write: start work through the actions)." }),
  company_slugs: { type: ["array", "null"], items: { type: "string" }, maxItems: 50, description: "Only these companies' clients. Default: every company the person can see." },
  expires_at: { type: ["string", "null"], format: "date-time", description: "When the key stops working, at most 90 days ahead. Default: 90 days." },
}, ["name"]);
const PersonalKeyCreated = obj({ ...(PersonalKey.properties as Record<string, unknown>), key: { type: "string", description: "Shown once; store it now." } });
const PersonalKeyRevoked = obj({ id: { type: "string" }, revoked_at: { type: "string" } }, ["id", "revoked_at"]);

// ── Actions (actions.ts): fixed public inputs, whatever the internal functions take today ──
const idem = { type: "string", maxLength: 200, description: "Optional. A retry with the same key, from the same caller, returns the first answer instead of starting the work again. Kept for 24 hours." };
const day = (description: string) => ({ type: "string", format: "date", description });
const StartReportInput = obj({ start: day("First day of the period (yyyy-mm-dd). Send with end, or neither for the last 30 days."), end: day("Last day of the period (yyyy-mm-dd)."), idempotency_key: idem });
const ReportStarted = obj({
  client_id: { type: "string" }, kind: { type: "string", enum: ["social", "competitive"] },
  status: { type: "string", enum: ["queued", "running"], description: "queued: the run is waiting for the worker (it starts within a minute); running: a report for the client was already running." },
  resumed: { type: "boolean", description: "True when the answer is a run that was already open or running, not a new one." },
  report_id: { ...str, description: "The report, once it exists; until then, find it in the links.reports list." }, range: { oneOf: [obj({ start: str, end: str }), { type: "null" }] }, requested_at: str,
  waiting_for: { type: ["string", "null"], description: "tracking: a competitive run waits until the confirmed competitors are tracked, then starts by itself." },
  links: obj({ reports: { type: "string" }, report: str }),
});
const DraftPostInput = obj({
  platform: { type: "string", description: "Instagram, Facebook, TikTok, LinkedIn, X and so on." }, topic: { type: "string", maxLength: 2000, description: "What the post is about, in a person's words." },
  format: { type: "string", description: "Optional: Image, Carousel, Video, Reel, or Story (Instagram and Facebook only). Default: the model chooses." }, idempotency_key: idem,
}, ["platform", "topic"]);
const DraftedPost = obj({
  client_id: { type: "string" }, saved: { type: "boolean", description: "Always false: the draft is returned, not added to the calendar." },
  post: obj({ platform: { type: "string" }, format: str, pillar: str, hook: str, concept: str, visual_direction: str, copy: str, cta: str, hashtags: arr({ type: "string" }) }),
});
const RewriteCopyInput = obj({
  post_key: { type: "string", description: "A calendar post's key: its copy, platform, format, pillar and CTA are read from the calendar. Or send the fields below instead." },
  copy: { type: "string" }, concept: { type: "string" }, platform: { type: "string" }, format: { type: "string" }, pillar: { type: "string" }, cta: { type: "string" },
  note: { type: "string", maxLength: 2000, description: "Optional: what to change, as a person would say it." }, idempotency_key: idem,
});
const RewrittenCopy = obj({ client_id: { type: "string" }, post_key: str, saved: { type: "boolean", description: "Always false: save the copy in the app." }, copy: str, cta: str, hashtags: { type: ["array", "null"], items: { type: "string" }, description: "Null when the model gave none (the post keeps its own)." } });
const DesignPostInput = obj({ post_key: { type: "string", description: "The calendar post's key." }, note: { type: "string", maxLength: 2000, description: "Optional: what every design option should follow." }, idempotency_key: idem }, ["post_key"]);
const DesignStarted = obj({
  client_id: { type: "string" }, post_key: { type: "string" }, status: { type: "string", description: "preparing while the options are made; needs_filming when the idea is a real person on camera, which is filmed, never generated." },
  filmed_by: str, design: { oneOf: [obj({ id: { type: "string" }, status: str, created_at: str }), { type: "null" }] },
});
const IdentifyCompetitorsInput = obj({ idempotency_key: idem });
const CompetitorProposal = obj({
  client_id: { type: "string" }, set_id: str, status: { type: "string", enum: ["draft"] },
  competitors: arr(obj({ id: str, name: str, website: str, rationale: str, similarity_score: num })), rejected: { type: "integer", description: "Proposals left out because their website could not be checked." }, links: obj({ set: str }),
});
const RefreshFeedInput = obj({ days: { type: "integer", minimum: 1, maximum: 30, description: "The window in days (default 7)." }, idempotency_key: idem });
const FeedRefreshed = obj({
  client_id: { type: "string" }, window: { oneOf: [obj({ start: str, end: str }), { type: "null" }] }, posts: { type: "integer" }, alerts: { type: "integer" },
  linkedin_pending: { type: "boolean", description: "LinkedIn posts are still being collected; they are added by themselves." }, topics_pending: { type: "boolean", description: "Shared topics are still being detected." }, links: obj({ alerts: { type: "string" } }),
});
const PlanWeekInput = obj({ week: { type: "string", format: "date", description: "Optional: the Monday of the week to plan, up to four weeks ahead. Default: the earliest week without a plan." }, idempotency_key: idem });
const WeekPlanned = obj({ client_id: { type: "string" }, week: str, plan: { oneOf: [obj({ id: { type: "string" }, week_start: str, status: str }), { type: "null" }] } });

export const SCHEMAS: Record<string, S> = {
  // The cost routes' schemas, shared with every Moburst tool.
  ...(COST_SCHEMAS as Record<string, S>),
  Error: obj({ error: obj({ code: { type: "string" }, message: { type: "string" }, details: {} }, ["code", "message"]) }, ["error"]),
  Empty: obj({}), Links, SetupIssue,
  SetupObject: Setup, Setup: one("SetupObject"),
  ClientObject: Client, Client: one("ClientObject"), ClientList: list("ClientObject"),
  AnalyticsObject: Analytics, Analytics: one("AnalyticsObject"),
  ReportObject: Report, Report: one("ReportObject"), ReportList: list("ReportObject"),
  CompetitiveReportObject: CompetitiveReport, CompetitiveReport: one("CompetitiveReportObject"), CompetitiveReportList: list("CompetitiveReportObject"),
  CompetitorSetObject: CompetitorSet, CompetitorSet: one("CompetitorSetObject"), CompetitorSetList: list("CompetitorSetObject"),
  PostObject: Post, Post: one("PostObject"), PostList: list("PostObject"),
  MediaJobObject: MediaJob, MediaJobList: list("MediaJobObject"),
  ScheduleObject: Schedule, ScheduleList: list("ScheduleObject"),
  ScheduledPostObject: ScheduledPost, ScheduledPostList: list("ScheduledPostObject"),
  AlertObject: Alert, AlertList: list("AlertObject"),
  DesignSystemObject: DesignSystem, DesignSystemList: list("DesignSystemObject"),
  StatusObject: Status, Status: one("StatusObject"), Health,
  DemoInput, DemoJobObject: DemoJob, DemoJob: one("DemoJobObject"), DemoJobList: list("DemoJobObject"), DiscardedObject: Discarded, Discarded: one("DiscardedObject"),
  ApiKeyCreate, ApiKeyObject: ApiKey, ApiKeyCreatedObject: ApiKeyCreated, ApiKeyCreated: one("ApiKeyCreatedObject"), ApiKeyList: list("ApiKeyObject"),
  PersonalKeyCreate, PersonalKeyObject: PersonalKey, PersonalKeyList: list("PersonalKeyObject"), PersonalKeyCreatedObject: PersonalKeyCreated, PersonalKeyCreated: one("PersonalKeyCreatedObject"),
  PersonalKeyRevokedObject: PersonalKeyRevoked, PersonalKeyRevoked: one("PersonalKeyRevokedObject"),
  StartReportInput, ReportStartedObject: ReportStarted, ReportStarted: one("ReportStartedObject"),
  DraftPostInput, DraftedPostObject: DraftedPost, DraftedPost: one("DraftedPostObject"),
  RewriteCopyInput, RewrittenCopyObject: RewrittenCopy, RewrittenCopy: one("RewrittenCopyObject"),
  DesignPostInput, DesignStartedObject: DesignStarted, DesignStarted: one("DesignStartedObject"),
  IdentifyCompetitorsInput, CompetitorProposalObject: CompetitorProposal, CompetitorProposal: one("CompetitorProposalObject"),
  RefreshFeedInput, FeedRefreshedObject: FeedRefreshed, FeedRefreshed: one("FeedRefreshedObject"),
  PlanWeekInput, WeekPlannedObject: WeekPlanned, WeekPlanned: one("WeekPlannedObject"),
};
