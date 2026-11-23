/**
 * Socialytics' public actions: the work people start in the app, as stable
 * tasks with fixed inputs (schemas.ts), each with a small adapter that calls
 * the internal function(s) doing the work today, through callFunction with
 * the operational secret, acting for the person behind the caller (the
 * signed-in person, else the key's owner; see _shared/invoke.ts and the
 * act-as header in _shared/auth/authz.ts). When a screen's function changes
 * its inputs, the adapter changes here; the public contract does not (see
 * _shared/api/actions.ts, the shared builder).
 *
 * The functions record what their paid calls cost themselves, charged to the
 * client in the body; every adapter passes it.
 *
 * INTERNAL_ONLY (supabase/functions/api/internal-only.ts, kept out of _shared
 * so it is not deployed with every function) lists the functions the screens
 * call that are deliberately not public, with the reason.
 * supabase/tests/api/actions-coverage.test.ts fails when a screen calls a
 * function that is in neither list.
 */
import type { ActionContext, ActionDef } from "../api/actions.ts";
import { ApiError, forbidden, invalid, notFound } from "../api/errors.ts";
import { scopeAll } from "../api/keys.ts";
import type { AuthContext } from "../api/router.ts";
import type { CallResult } from "../invoke.ts";
import type { Store } from "./store.ts";

/** A calendar post as the actions read it (calendar_posts). */
export interface CalendarPostRow {
  client_id: string;
  post_key: string;
  report_id: string | null;
  platform: string;
  format: string | null;
  pillar: string | null;
  copy: string;
  cta: string | null;
  visual_direction: string | null;
  rationale: string | null;
}

export interface ActionAdapterDeps {
  store: Store;
  /** An internal function, called as the project acting for `actAs` (_shared/invoke.ts callFunction). */
  call(name: string, body: unknown, actAs: string): Promise<CallResult>;
  /** The person an action acts for: the signed-in person, else the API key's owner. Null when there is none. */
  actingUser(auth: AuthContext): Promise<string | null>;
  /** One of the client's calendar posts by its post_key, or null. */
  calendarPost(clientId: string, postKey: string): Promise<CalendarPostRow | null>;
}


const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TOPIC_MAX = 2000;
const NOTE_MAX = 2000;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const tags = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : []);

/** A string field of the body: absent is undefined, anything but a string is refused. */
function field(body: Record<string, unknown>, name: string, max = 500): string | undefined {
  const v = body[name];
  if (v == null || v === "") return undefined;
  if (typeof v !== "string") throw invalid(`${name} must be a string`, { field: name });
  const t = v.trim();
  if (t.length > max) throw invalid(`${name} can be at most ${max} characters`, { field: name });
  return t || undefined;
}
function day(body: Record<string, unknown>, name: string): string | undefined {
  const v = field(body, name, 10);
  if (v !== undefined && (!DAY.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`)))) throw invalid(`${name} must be a date (yyyy-mm-dd)`, { field: name });
  return v;
}

/** What a function's error answer says, for the caller. */
function said(r: CallResult): string {
  const d = obj(r.data);
  const words = [d.error, d.message].find((w): w is string => typeof w === "string" && w.trim().length > 0);
  return words?.trim() ?? "";
}

/** A refusal (4xx) passes through with the function's words; anything else is an upstream failure. */
export function failed(r: CallResult, what: string): ApiError {
  if (r.status === 400) return new ApiError(400, "invalid_request", said(r) || `${what}: invalid request`);
  if (r.status === 403) return forbidden(said(r) || `${what}: not allowed`);
  if (r.status === 404) return new ApiError(404, "not_found", said(r) || `${what}: not found`);
  if (r.status === 409) return new ApiError(409, "conflict", said(r) || `${what}: conflict`);
  if (r.status === 422) return new ApiError(422, "unprocessable", said(r) || `${what}: cannot be done`);
  if (r.status === 429) return new ApiError(429, "rate_limited", said(r) || `${what}: try again later`);
  console.error(`${what} failed: ${r.status} ${r.text.slice(0, 300)}`);
  return new ApiError(502, "upstream_failed", `${what} failed; try again in a few minutes`);
}

const NO_ACTOR = "This key has no Socialytics user to act for. Ask an admin for a key made from a signed-in session.";

type Kind = "social" | "competitive";

export function socialyticsActions(deps: ActionAdapterDeps): ActionDef[] {
  const { store } = deps;
  const clientPath = async (_b: unknown, p: Record<string, string>) => (await store.getClient(p.id, scopeAll()))?.id ?? null;
  const mustClient = async (ctx: ActionContext) => {
    const c = await store.getClient(ctx.clientId, ctx.auth.clients);
    if (!c) throw notFound("Client");
    return c;
  };
  const actor = async (ctx: ActionContext): Promise<string> => {
    const id = await deps.actingUser(ctx.auth);
    if (!id) throw forbidden(NO_ACTOR);
    return id;
  };
  const mustPost = async (clientId: string, postKey: string) => {
    const p = await deps.calendarPost(clientId, postKey);
    if (!p || p.client_id !== clientId) throw notFound("Calendar post");
    return p;
  };

  /** run-report for a kind: it queues the run, or answers the run already open or running. */
  const startReport = (kind: Kind) => async (ctx: ActionContext, body: Record<string, unknown>) => {
    const start = day(body, "start"), end = day(body, "end");
    if (!!start !== !!end) throw invalid("Send both start and end, or neither (the last 30 days)", { field: start ? "end" : "start" });
    if (start && end && start > end) throw invalid("start must be on or before end", { field: "start" });
    const client = await mustClient(ctx);
    const actAs = await actor(ctx);
    const r = await deps.call("run-report", { client_id: client.id, kind, ...(start && end ? { date_range_start: start, date_range_end: end } : {}) }, actAs);
    if (!r.ok) throw failed(r, "The report could not be started");
    const d = obj(r.data);
    const reportId = text(d.report_id);
    const range = obj(d.range);
    const list = kind === "social" ? "/v1/reports" : "/v1/competitive-reports";
    return {
      data: {
        client_id: client.id, kind, status: d.queued === true ? "queued" : "running", resumed: d.resumed === true, report_id: reportId,
        range: text(range.start) ? { start: text(range.start), end: text(range.end) } : null, requested_at: text(d.requested_at) ?? text(d.created_at),
        waiting_for: text(d.waiting_for),
        links: { reports: `${list}?client_id=${client.id}`, report: reportId ? `${list}/${reportId}` : null },
      },
    };
  };

  return [
    {
      name: "start_social_report", summary: "Start a client's social report for a period (default the last 30 days); answers the run already open instead of starting a second", tag: "Actions",
      method: "POST", path: "/v1/clients/:id/reports", body: "StartReportInput", response: "ReportStarted", status: 202,
      maps: ["run-report"], clientOf: clientPath, run: startReport("social"),
    },
    {
      name: "start_competitive_report", summary: "Start a client's competitive report on its confirmed competitors (default the last 30 complete days)", tag: "Actions",
      method: "POST", path: "/v1/clients/:id/competitive-reports", body: "StartReportInput", response: "ReportStarted", status: 202,
      maps: ["run-report"], clientOf: clientPath, run: startReport("competitive"),
    },
    {
      name: "draft_post", summary: "Draft one post for a client from a topic, in its voice and pillars; nothing is saved", tag: "Actions",
      method: "POST", path: "/v1/clients/:id/post-drafts", body: "DraftPostInput", response: "DraftedPost",
      maps: ["generate-ad-hoc-post"], clientOf: clientPath,
      run: async (ctx, body) => {
        const platform = field(body, "platform", 40);
        const topic = field(body, "topic", TOPIC_MAX);
        if (!platform) throw invalid("platform is required", { field: "platform" });
        if (!topic) throw invalid("topic is required", { field: "topic" });
        const format = field(body, "format", 40);
        const client = await mustClient(ctx);
        const r = await deps.call("generate-ad-hoc-post", { client_id: client.id, platform, topic, ...(format ? { creative_type: format } : {}) }, await actor(ctx));
        const p = obj(obj(r.data).post);
        if (!r.ok || !text(p.caption_angle)) throw failed(r.ok ? { ...r, status: 502 } : r, "The post could not be drafted");
        return {
          data: {
            client_id: client.id, saved: false,
            post: { platform: text(p.platform) ?? platform, format: text(p.format), pillar: text(p.pillar), hook: text(p.hook), concept: text(p.concept), visual_direction: text(p.visual_direction), copy: text(p.caption_angle), cta: text(p.CTA) ?? text(p.cta), hashtags: tags(p.hashtags) },
          },
        };
      },
    },
    {
      name: "rewrite_post_copy", summary: "Write a calendar post's copy again, optionally following a note; nothing is saved", tag: "Actions",
      method: "POST", path: "/v1/clients/:id/copy-drafts", body: "RewriteCopyInput", response: "RewrittenCopy",
      maps: ["regenerate-post-copy"], clientOf: clientPath,
      run: async (ctx, body) => {
        const postKey = field(body, "post_key", 200);
        const note = field(body, "note", NOTE_MAX);
        const given = { copy: field(body, "copy", 5000), concept: field(body, "concept", 2000), platform: field(body, "platform", 40), format: field(body, "format", 40), pillar: field(body, "pillar", 200), cta: field(body, "cta", 500) };
        const client = await mustClient(ctx);
        const post = postKey ? await mustPost(client.id, postKey) : null;
        const copy = given.copy ?? text(post?.copy);
        const concept = given.concept ?? text(post?.rationale) ?? copy;
        if (!concept) throw invalid("Send post_key, or the copy (or concept) to write again", { field: "post_key" });
        const r = await deps.call("regenerate-post-copy", {
          client_id: client.id, platform: given.platform ?? post?.platform ?? null, concept, pillar: given.pillar ?? post?.pillar ?? null, current_copy: copy ?? "",
          current_cta: given.cta ?? post?.cta ?? null, format: given.format ?? post?.format ?? null, ...(note ? { note } : {}),
        }, await actor(ctx));
        const p = obj(obj(r.data).post);
        if (!r.ok || !text(p.caption_angle)) throw failed(r.ok ? { ...r, status: 502 } : r, "The copy could not be written again");
        return { data: { client_id: client.id, post_key: postKey ?? null, saved: false, copy: text(p.caption_angle), cta: text(p.CTA) ?? text(p.cta), hashtags: "hashtags" in p ? tags(p.hashtags) : null } };
      },
    },
    {
      name: "design_post", summary: "Start the design options for one of a client's calendar posts (the post's Create design)", tag: "Actions",
      method: "POST", path: "/v1/clients/:id/post-designs", body: "DesignPostInput", response: "DesignStarted", status: 202,
      maps: ["design-request"], clientOf: clientPath,
      run: async (ctx, body) => {
        const postKey = field(body, "post_key", 200);
        if (!postKey) throw invalid("post_key is required", { field: "post_key" });
        const note = field(body, "note", NOTE_MAX);
        const client = await mustClient(ctx);
        const post = await mustPost(client.id, postKey);
        if (!text(post.copy)) throw new ApiError(422, "unprocessable", "The post has no copy yet, so there is nothing to design from");
        const r = await deps.call("design-request", {
          action: "create", client_id: client.id, report_id: post.report_id, calendar_post_key: post.post_key, platform: post.platform, format: post.format, post_copy: post.copy,
          ...(post.visual_direction ? { visual_direction: post.visual_direction } : {}), ...(note ? { note } : {}),
        }, await actor(ctx));
        if (!r.ok) throw failed(r, "The design could not be started");
        const d = obj(r.data);
        if (d.code === "not_set_up") {
          const waiting = text(d.waiting_for);
          throw new ApiError(422, "unprocessable", waiting === "social_accounts" ? "Designs start once the client's social accounts are connected in Sprout" : "The client's designs are not set up yet: confirm its design settings in Socialytics first", { waiting_for: waiting ?? "design_settings" });
        }
        const req = obj(d.request);
        const design = text(req.id) ? { id: text(req.id), status: text(req.status), created_at: text(req.created_at) } : null;
        if (d.code === "needs_filming") return { status: 200, data: { client_id: client.id, post_key: post.post_key, status: "needs_filming", filmed_by: text(d.who), design } };
        if (!design) throw failed({ ...r, status: 502 }, "The design could not be started");
        return { data: { client_id: client.id, post_key: post.post_key, status: design.status ?? "preparing", filmed_by: null, design } };
      },
    },
    {
      name: "identify_competitors", summary: "Propose a new draft set of competitors for a client, for the team to review and confirm in the app", tag: "Actions",
      method: "POST", path: "/v1/clients/:id/competitor-proposals", body: "IdentifyCompetitorsInput", response: "CompetitorProposal",
      maps: ["identify-competitors"], clientOf: clientPath,
      run: async (ctx) => {
        const client = await mustClient(ctx);
        const r = await deps.call("identify-competitors", { client_id: client.id }, await actor(ctx));
        if (!r.ok) throw failed(r, "Competitors could not be proposed");
        const d = obj(r.data);
        const rows = (Array.isArray(d.competitors) ? d.competitors : []).map(obj);
        return {
          data: {
            client_id: client.id, set_id: text(d.set_id), status: "draft",
            competitors: rows.map((c) => ({ id: text(c.id), name: text(c.name), website: text(c.website_url), rationale: text(c.rationale), similarity_score: typeof c.similarity_score === "number" ? c.similarity_score : null })),
            rejected: Array.isArray(d.rejected) ? d.rejected.length : 0,
            links: { set: text(d.set_id) ? `/v1/competitor-sets/${text(d.set_id)}` : null },
          },
        };
      },
    },
    {
      name: "refresh_competitor_feed", summary: "Collect the client's competitors' recent posts again and detect the topics they share", tag: "Actions",
      method: "POST", path: "/v1/clients/:id/competitor-feed", body: "RefreshFeedInput", response: "FeedRefreshed",
      maps: ["refresh-competitor-feed"], clientOf: clientPath,
      run: async (ctx, body) => {
        const days = body.days == null ? undefined : Number(body.days);
        if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > 30)) throw invalid("days must be a whole number between 1 and 30", { field: "days" });
        const client = await mustClient(ctx);
        const r = await deps.call("refresh-competitor-feed", { client_id: client.id, ...(days ? { days } : {}) }, await actor(ctx));
        if (!r.ok) throw failed(r, "The competitor feed could not be refreshed");
        const d = obj(r.data);
        const w = obj(d.window);
        return {
          data: {
            client_id: client.id, window: text(w.start) ? { start: text(w.start), end: text(w.end) } : null, posts: typeof d.posts === "number" ? d.posts : 0, alerts: typeof d.alerts === "number" ? d.alerts : 0,
            linkedin_pending: d.linkedin_not_collected === true, topics_pending: d.topics_not_detected === true, links: { alerts: `/v1/alerts?client_id=${client.id}` },
          },
        };
      },
    },
    {
      name: "plan_calendar_week", summary: "Plan a week of a client's content calendar (the calendar's Plan next week): the week named, or the earliest unplanned one", tag: "Actions",
      method: "POST", path: "/v1/clients/:id/calendar-weeks", body: "PlanWeekInput", response: "WeekPlanned", status: 202,
      maps: ["calendar-posts"], clientOf: clientPath,
      run: async (ctx, body) => {
        const week = day(body, "week");
        if (week && new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) throw invalid("week must be a Monday (yyyy-mm-dd)", { field: "week" });
        const client = await mustClient(ctx);
        const r = await deps.call("calendar-posts", { action: "plan_next_week", client_id: client.id, ...(week ? { week } : {}) }, await actor(ctx));
        if (!r.ok) throw failed(r, "The week could not be planned");
        const d = obj(r.data);
        const plan = obj(d.plan);
        return { data: { client_id: client.id, week: text(d.week) ?? text(plan.week_start), plan: text(plan.id) ? { id: text(plan.id), week_start: text(plan.week_start), status: text(plan.status) } : null } };
      },
    },
  ];
}
