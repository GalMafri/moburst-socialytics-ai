/**
 * The fourteen steps of a Socialytics demo, in order. Each one checks what
 * already exists before creating anything (the worker may re-run a step
 * after a crash), records a plain outcome, and never stops the job for a
 * gap it can record instead. Everything external comes in through DemoCtx;
 * the project's own functions are driven as the project itself, acting for
 * the user the job resolved.
 */
import { CALLBACK_DELAYS_S, CALLBACK_MAX_ATTEMPTS, deliverOnce } from "../../_shared/api/callback.ts";
import { finalStatus, type Gap, type JobRecord, type StepDef, type StepResult } from "../../_shared/api/jobs.ts";
import { resolveScope } from "../../_shared/api/keys.ts";
import type { ClientScope } from "../../_shared/api/router.ts";
import { isReviewReadyHandle } from "../../_shared/competitive/extractSocialHandles.ts";
import { callEnvFromDeno, callFunction, type CallEnv, type CallResult } from "../../_shared/invoke.ts";
import { clientHost } from "../../_shared/net/clientHost.ts";
import { analyticsOut, CONFIRMED_SET, pillarsOut, type BrandIdentity, type ClientRow, type CompetitiveReportRow, type ReportRow, type SetWithCompetitors } from "../serializers.ts";
import { buildOutputs, type Unplaced } from "./collect.ts";
import { cleanSiteText } from "./site-text.ts";
import { makeDemoDb, type DemoDb } from "./db.ts";

export interface DemoCtx {
  db: DemoDb;
  /** A project function, called as the project itself acting for `actAs`. */
  call(name: string, body: unknown, actAs: string | null): Promise<CallResult>;
  keyHashFor(keyId: string | null): Promise<string | null>;
  deliverOnce(url: string, payload: unknown, keyHash: string | null): Promise<{ status: number | null; error: string | null }>;
  now(): Date;
  tool: string;
}

const FRESH_REPORT_DAYS = 7;
const REPORT_TIMEOUT_MIN = 100;
const TRACKING_TIMEOUT_MIN = 60;
const CHECK_IN_S = 120;
const MIN_REFERENCES = 3;
const DEFAULT_PLATFORMS = ["Instagram", "TikTok", "Facebook", "LinkedIn"];

type Input = { client_name: string; website: string; competitors?: Array<{ name: string; website?: string }>; force_run?: boolean };
const inputOf = (job: JobRecord) => job.input as unknown as Input;
const requesterEmail = (job: JobRecord) => (job.requester as { email?: string } | null)?.email ?? null;
const stepData = (job: JobRecord, name: string) => (job.steps.find((s) => s.name === name)?.data ?? {}) as Record<string, unknown>;
const gap = (step: string, code: string, message: string): Gap => ({ step, code, message });
const minutesSince = (iso: string | null | undefined, now: Date) => (iso ? (now.getTime() - new Date(iso).getTime()) / 60_000 : 0);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : []);
const errorOf = (r: CallResult, fallback: string) => str(obj(r.data).error) ?? (r.status ? `${fallback} (${r.status})` : `${fallback}: ${r.text || "no answer"}`);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** The reach of the key behind a job: every client for an unscoped key or a job without a key. */
async function jobScope(job: JobRecord, ctx: DemoCtx): Promise<ClientScope> {
  const keyId = (job.key_id as string | null | undefined) ?? null;
  if (!keyId) return resolveScope({ company_slugs: null, client_ids: null }, []);
  const reach = await ctx.db.keyReach(keyId);
  if (!reach) return resolveScope({ company_slugs: null, client_ids: null }, []);
  if (!reach.company_slugs?.length && !reach.client_ids?.length) return resolveScope(reach, []);
  return resolveScope(reach, await ctx.db.clientSlugs());
}

export function slugify(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
}

async function clientOf(job: JobRecord, ctx: DemoCtx): Promise<ClientRow> {
  const c = job.client_id ? await ctx.db.getClient(job.client_id) : null;
  if (!c) throw new Error("The job has no client yet.");
  return c;
}
/** The user the job acts for: chosen when the client was resolved. */
const actorOf = (job: JobRecord, client: ClientRow): string | null => str(stepData(job, "resolve_client").acted_as) ?? client.created_by ?? null;
const referenceCount = (c: ClientRow) => (Array.isArray(c.harvested_design_references) ? c.harvested_design_references.length : 0) + (Array.isArray(c.design_references) ? c.design_references.length : 0);
const newestSet = (sets: SetWithCompetitors[]) => [...sets].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
const trackedSet = (sets: SetWithCompetitors[]) => sets.find((s) => CONFIRMED_SET.includes(s.status) && s.rivaliq_landscape_id) ?? null;

/** Start a report through run-report, unless the job already did or a fresh one exists. */
async function startReport(job: JobRecord, ctx: DemoCtx, kind: "social" | "competitive", range?: { start: string; end: string }): Promise<StepResult> {
  const client = await clientOf(job, ctx);
  const stepName = kind === "social" ? "run_social" : "run_competitive";
  const withRun = (ids: string[]) => [...new Set([...job.run_ids, ...ids])];
  const existing: Array<ReportRow | CompetitiveReportRow> = kind === "social" ? await ctx.db.reportsOf(client.id) : await ctx.db.competitiveReportsOf(client.id);
  const mine = existing.find((r) => r.demo_job_id === job.id);
  if (mine) return { status: "done", outcome: "already_started", data: { report_id: mine.id }, patch: { run_ids: withRun([mine.id]) } };
  if (!inputOf(job).force_run) {
    const cutoff = ctx.now().getTime() - FRESH_REPORT_DAYS * 86_400_000;
    const fresh = existing.find((r) => (r.status === "completed" || r.status === "complete") && new Date(r.created_at).getTime() > cutoff);
    if (fresh) return { status: "skipped", reason: "fresh_report_exists", message: `A ${kind} report completed in the last ${FRESH_REPORT_DAYS} days; send force_run to run again.`, data: { report_id: fresh.id }, patch: { run_ids: withRun([fresh.id]) } };
  }
  const r = await ctx.call("run-report", { client_id: client.id, kind, ...(range ? { date_range_start: range.start, date_range_end: range.end } : {}) }, actorOf(job, client));
  const d = obj(r.data) as { report_id?: string; resumed?: boolean; retried?: boolean; range?: unknown };
  if (!r.ok || !d.report_id) {
    const message = errorOf(r, "The report could not be started");
    const reason = r.status === 422 ? "not_ready" : r.status === 409 ? "run_conflict" : r.status === 503 ? "workflow_unavailable" : "run_refused";
    return { status: "failed", reason, message, gaps: [gap(stepName, "report_not_started", `The ${kind} report could not be started: ${message}`)] };
  }
  if (!d.resumed) await ctx.db.flagReport(kind === "social" ? "reports" : "competitive_reports", d.report_id, job.id);
  return { status: "done", outcome: d.resumed ? "resumed" : "started", data: { report_id: d.report_id, range: d.range ?? range ?? null }, patch: { run_ids: withRun([d.report_id]) } };
}

export const DEMO_STEPS: StepDef<DemoCtx>[] = [
  {
    name: "resolve_client",
    async run(job, ctx) {
      const input = inputOf(job);
      const host = input.website;
      const scope = await jobScope(job, ctx);
      const outOfScope = (what: string): StepResult => ({ status: "failed", fatal: true, reason: "out_of_scope", message: `This key may not work on ${what}.` });
      const existing = (await ctx.db.findClientByHost(host)) ?? (await ctx.db.findClientByName(input.client_name));
      if (existing) {
        if (!scope.allows(existing.id)) return outOfScope("this client");
        const mine = existing.demo_job_id === job.id;
        const actedAs = existing.created_by ?? (await ctx.db.ownerFor(requesterEmail(job)));
        return { status: "done", outcome: mine ? "created" : "reused", data: { client_id: existing.id, name: existing.name, matched_by: mine ? "job" : "website_or_name", acted_as: actedAs }, patch: { client_id: existing.id } };
      }
      const owner = await ctx.db.ownerFor(requesterEmail(job));
      if (!owner) return { status: "failed", fatal: true, reason: "no_owner", message: "No Socialytics user is available to own the new client." };
      const base = slugify(input.client_name);
      let slug = base;
      for (let n = 2; (await ctx.db.slugExists(slug)) && n < 20; n++) slug = `${base}-${n}`;
      if (!scope.all) {
        const reach = await ctx.db.keyReach((job.key_id as string | null) ?? "");
        if (!reach?.company_slugs?.includes(slug)) return outOfScope(`a client outside its companies (${slug})`);
      }
      const c = await ctx.db.insertClient({ name: input.client_name, website_url: `https://${host}`, company_slug: slug, created_by: owner, primary_platforms: DEFAULT_PLATFORMS, geo: "US", language: "en", timezone: "UTC", media_backend: "gemini", demo_job_id: job.id });
      return { status: "done", outcome: "created", data: { client_id: c.id, name: c.name, company_slug: slug, acted_as: owner }, patch: { client_id: c.id } };
    },
  },
  {
    name: "brand_identity",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      if (client.brand_identity && Object.keys(client.brand_identity).length) return { status: "skipped", reason: "brand_exists", data: { fields: Object.keys(client.brand_identity).length } };
      const r = await ctx.call("research-brand-identity", { website_url: client.website_url ?? `https://${inputOf(job).website}`, client_name: client.name }, actorOf(job, client));
      const d = obj(r.data) as { brand_identity?: BrandIdentity; logo_url?: string };
      if (!r.ok || !d.brand_identity || typeof d.brand_identity !== "object") {
        const message = errorOf(r, "The website could not be read");
        return { status: "failed", reason: r.ok ? "no_identity" : "research_failed", message, gaps: [gap("brand_identity", "brand_identity_missing", `No brand identity could be read from ${client.name}'s website: ${message}`)] };
      }
      const patch: Record<string, unknown> = { brand_identity: d.brand_identity };
      const logo = str(d.brand_identity.logo_url) ?? str(d.logo_url);
      if (logo && !client.logo_url) patch.logo_url = logo;
      await ctx.db.updateClient(client.id, patch);
      const b = d.brand_identity;
      return { status: "done", outcome: "researched", data: { colors: [b.primary_color, b.secondary_color, b.accent_color].filter(Boolean), font: b.font_family ?? null, tone: b.tone_of_voice ?? null, logo: !!patch.logo_url } };
    },
  },
  {
    name: "site_brief",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      if ((client.brief_text ?? "").trim().length >= 80) return { status: "skipped", reason: "brief_exists", data: { chars: (client.brief_text ?? "").length } };
      const url = client.website_url ?? `https://${inputOf(job).website}`;
      const r = await ctx.call("firecrawl-scrape", { url, options: { formats: ["markdown"], onlyMainContent: true } }, actorOf(job, client));
      const d = obj(r.data) as { success?: boolean; data?: { markdown?: string; metadata?: { title?: string; description?: string } } };
      const markdown = cleanSiteText(d.data?.markdown ?? "");
      if (!r.ok || !d.success || markdown.length < 80) {
        const message = r.ok && d.success ? "The page carried almost no readable text." : errorOf(r, "The website could not be read");
        return { status: "failed", reason: r.ok ? "site_unreadable" : "scrape_failed", message, gaps: [gap("site_brief", "brief_missing", `No brief could be drafted for ${client.name}: ${message}`)] };
      }
      await ctx.db.updateClient(client.id, { brief_text: `Drafted from the website on ${day(ctx.now())}:\n\n${markdown.slice(0, 2500)}` });
      return { status: "done", outcome: "drafted", data: { chars: markdown.length, title: d.data?.metadata?.title ?? null, excerpt: markdown.slice(0, 1200) } };
    },
  },
  {
    name: "pillars",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      const havePillars = pillarsOut(client.content_pillars).length > 0;
      const haveKeywords = strs(client.social_keywords).length > 0;
      if (havePillars && haveKeywords) return { status: "skipped", reason: "pillars_exist", data: { pillars: pillarsOut(client.content_pillars).length, keywords: strs(client.social_keywords).length } };
      const r = await ctx.call("derive-content-pillars", { client_id: client.id }, actorOf(job, client));
      const d = obj(r.data) as { pillars?: unknown[]; keywords?: string[]; source?: string; derived_at?: string };
      if (!r.ok || !Array.isArray(d.pillars) || !d.pillars.length) {
        const message = errorOf(r, "The pillars could not be derived");
        return { status: "failed", reason: r.status === 422 ? "no_evidence" : "derive_failed", message, gaps: [gap("pillars", "pillars_missing", `No content pillars could be derived for ${client.name}: ${message}`)] };
      }
      const patch: Record<string, unknown> = {};
      if (!havePillars) Object.assign(patch, { content_pillars: d.pillars, pillars_source: d.source ?? "website", pillars_derived_at: d.derived_at ?? ctx.now().toISOString() });
      if (!haveKeywords && d.keywords?.length) patch.social_keywords = d.keywords;
      if (Object.keys(patch).length) await ctx.db.updateClient(client.id, patch);
      return { status: "done", outcome: "derived", data: { pillars: pillarsOut(d.pillars).map((p) => p.name), keywords: d.keywords?.length ?? 0, source: d.source ?? null, fields: Object.keys(patch) } };
    },
  },
  {
    name: "design",
    async run(job, ctx) {
      let client = await clientOf(job, ctx);
      const actor = actorOf(job, client);
      const systems = await ctx.db.designSystemsOf(client.id);
      const approved = systems.find((s) => s.status === "approved");
      if (approved) return { status: "skipped", reason: "design_exists", data: { system_id: approved.id, version: approved.version } };
      const profiles = (await ctx.db.sproutProfilesOf(client.id)).filter((p) => p.is_active !== false);
      const noRefs = (): StepResult => ({ status: "skipped", reason: "no_references", message: "No brand references: designs use the brand colours and fonts only.", data: { references: referenceCount(client), sprout_profiles: profiles.length }, gaps: [gap("design", "design_system_missing", "No brand references: designs use the brand colours and fonts only.")] });
      if (!profiles.length && referenceCount(client) < MIN_REFERENCES) return noRefs();
      if (referenceCount(client) < MIN_REFERENCES) {
        const s = await ctx.call("synthesize-design-language", { client_id: client.id, discover: true }, actor);
        if (!s.ok) {
          const message = errorOf(s, "The brand's social posts could not be read");
          return { status: "failed", reason: "synthesis_failed", message, gaps: [gap("design", "design_system_missing", `No design system: ${message}`)] };
        }
        client = (await ctx.db.getClient(client.id)) ?? client;
        if (referenceCount(client) < MIN_REFERENCES) return noRefs();
      }
      const draft = systems.find((s) => s.status === "draft");
      let systemId = draft?.id ?? null;
      let version = draft?.version ?? null;
      if (!systemId) {
        const b = await ctx.call("build-design-system", { client_id: client.id, action: "build" }, actor);
        const sys = obj(obj(b.data).system) as { id?: string; version?: number };
        if (!b.ok || !sys.id) {
          const message = errorOf(b, "The design system could not be built");
          return { status: "failed", reason: "build_failed", message, gaps: [gap("design", "design_system_missing", `No design system: ${message}`)] };
        }
        systemId = sys.id;
        version = sys.version ?? null;
      }
      const a = await ctx.call("build-design-system", { client_id: client.id, action: "approve", id: systemId }, actor);
      if (!a.ok) {
        const message = errorOf(a, "The design system could not be approved");
        return { status: "failed", reason: "approve_failed", message, data: { system_id: systemId }, gaps: [gap("design", "design_system_missing", `The design system was built but not approved: ${message}`)] };
      }
      return { status: "done", outcome: "approved", data: { system_id: systemId, version, references: referenceCount(client) } };
    },
  },
  {
    name: "competitors",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      const actor = actorOf(job, client);
      const requested = inputOf(job).competitors;
      const sets = await ctx.db.setsOf(client.id);
      const mine = sets.find((s) => s.demo_job_id === job.id);
      const other = sets.find((s) => CONFIRMED_SET.includes(s.status) && s.demo_job_id !== job.id);
      const selectedNames = (s: SetWithCompetitors) => s.competitors.filter((c) => c.is_selected).sort((a, b) => (a.selected_rank ?? 99) - (b.selected_rank ?? 99)).map((c) => c.name);
      if (!mine && other) return { status: "skipped", reason: "set_exists", message: `${client.name} already has a confirmed competitor set.`, data: { set_id: other.id, status: other.status, selected: selectedNames(other), tracked: !!other.rivaliq_landscape_id, source: "existing" } };
      if (mine && CONFIRMED_SET.includes(mine.status)) return { status: "done", outcome: "already_confirmed", data: { set_id: mine.id, selected: selectedNames(mine), source: mine.source ?? "ai" } };
      let setId = mine?.id ?? null;
      const source = requested?.length ? "request" : "identified";
      if (!setId) {
        if (requested?.length) {
          const set = await ctx.db.insertSet({ client_id: client.id, status: "draft", source: "manual", generated_by: actor, demo_job_id: job.id });
          await ctx.db.insertCompetitors(requested.map((c, i) => ({ set_id: set.id, client_id: client.id, name: c.name, website_url: c.website ? `https://${c.website}` : null, rationale: "Named in the demo request.", similarity_score: Math.round((1 - i * 0.01) * 100) / 100, source: "manual" })));
          setId = set.id;
        } else {
          const r = await ctx.call("identify-competitors", { client_id: client.id }, actor);
          const d = obj(r.data) as { set_id?: string; competitors?: unknown[] };
          if (!r.ok || !d.set_id) {
            const message = errorOf(r, "No competitors could be proposed");
            return { status: "failed", reason: "no_competitors_found", message, gaps: [gap("competitors", "no_competitors", `${client.name} has no competitors to compare with: ${message}`)] };
          }
          await ctx.db.updateSet(d.set_id, { demo_job_id: job.id });
          setId = d.set_id;
        }
      }
      const reload = async () => (await ctx.db.setsOf(client.id)).find((s) => s.id === setId) ?? null;
      let set = await reload();
      if (!set) return { status: "failed", reason: "set_missing", message: "The competitor set could not be read back.", gaps: [gap("competitors", "no_competitors", `${client.name} has no competitors to compare with.`)] };
      if (set.competitors.some((c) => !c.handles.length)) {
        const h = await ctx.call("detect-competitor-handles", { set_id: setId }, actor);
        if (!h.ok) return { status: "failed", reason: "detection_failed", message: errorOf(h, "Social profiles could not be looked up"), data: { set_id: setId }, gaps: [gap("competitors", "competitors_unconfirmed", `The competitors' social profiles could not be looked up: ${errorOf(h, "the lookup failed")}`)] };
        set = (await reload()) ?? set;
      }
      const placeable = set.competitors.filter((c) => c.website_url && c.handles.some((x) => isReviewReadyHandle(x))).sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0));
      const unplaced: Unplaced[] = set.competitors.filter((c) => !placeable.includes(c)).map((c) => ({ name: c.name, reason: !c.website_url ? "no_website" : c.handles.length ? "no_verified_profile" : "no_profile_found" }));
      if (placeable.length < 3) {
        return { status: "done", outcome: "draft_only", message: `Only ${placeable.length} of ${set.competitors.length} proposed competitors have a verified social profile and a website.`, data: { set_id: setId, source, candidates: set.competitors.length, placeable: placeable.map((c) => c.name), unplaced }, gaps: [gap("competitors", "competitors_unconfirmed", `Only ${placeable.length} of ${set.competitors.length} proposed competitors have a verified social profile and a website; the set stays a draft and the competitive report is skipped.`)] };
      }
      const chosen = placeable.slice(0, 3);
      for (const c of set.competitors) {
        const rank = chosen.indexOf(c);
        const want = rank >= 0 ? { is_selected: true, selected_rank: rank + 1 } : { is_selected: false, selected_rank: null };
        if (!!c.is_selected !== want.is_selected || (c.selected_rank ?? null) !== want.selected_rank) await ctx.db.updateCompetitor(c.id, want);
      }
      const k = await ctx.call("confirm-competitor-set", { set_id: setId, notes: "Selected by the demo onboarding: the three closest competitors with a verified social profile." }, actor);
      if (!k.ok) {
        const message = errorOf(k, "The competitor set could not be confirmed");
        return { status: "failed", reason: "confirm_refused", message, data: { set_id: setId, selected: chosen.map((c) => c.name), unplaced }, gaps: [gap("competitors", "competitors_unconfirmed", `The competitor set could not be confirmed: ${message}`)] };
      }
      const gaps = unplaced.map((u) => gap("competitors", "competitor_unplaced", `${u.name} was proposed but not selected: ${u.reason === "no_website" ? "no website" : "no verified social profile"}.`));
      return { status: "done", outcome: "3_selected", data: { set_id: setId, source, selected: chosen.map((c) => c.name), unplaced, candidates: set.competitors.length }, gaps };
    },
  },
  {
    name: "tracking",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      const comp = stepData(job, "competitors");
      const sets = await ctx.db.setsOf(client.id);
      const set = sets.find((s) => s.id === comp.set_id) ?? newestSet(sets.filter((s) => CONFIRMED_SET.includes(s.status)));
      if (!set) return { status: "skipped", reason: "no_set", message: "There is no competitor set to track." };
      if (set.rivaliq_landscape_id) return { status: "done", outcome: "already_tracked", data: { set_id: set.id } };
      if (!CONFIRMED_SET.includes(set.status)) return { status: "skipped", reason: "set_not_confirmed", message: "The competitor set is not confirmed, so there is nothing to track.", data: { set_id: set.id } };
      const prior = stepData(job, "tracking");
      const startedAt = str(prior.started_at) ?? ctx.now().toISOString();
      const fail = (reason: string, message: string): StepResult => ({ status: "failed", reason, message, data: { set_id: set.id, started_at: startedAt }, gaps: [gap("tracking", "tracking_incomplete", `Competitor tracking was not verified: ${message} The competitive report is skipped.`)] });
      if (minutesSince(startedAt, ctx.now()) > TRACKING_TIMEOUT_MIN) return fail("tracking_timeout", `the provider did not confirm tracking within ${TRACKING_TIMEOUT_MIN} minutes.`);
      const actor = actorOf(job, client);
      const p = await ctx.call("setup-rivaliq-landscape", { set_id: set.id, mode: "preview" }, actor);
      const pd = obj(p.data) as { fingerprint?: string; job?: { phase?: string } | null };
      if (!p.ok || !pd.fingerprint) return fail("tracking_failed", errorOf(p, "the tracking plan could not be prepared") + ".");
      if (pd.job?.phase === "complete") return { status: "done", outcome: "tracked", data: { set_id: set.id, phase: "complete", started_at: startedAt } };
      const a = await ctx.call("setup-rivaliq-landscape", { set_id: set.id, mode: "advance", fingerprint: pd.fingerprint }, actor);
      const ad = obj(a.data) as { job?: { phase?: string } | null };
      if (!a.ok) {
        if (a.status === 409 && /already being checked/i.test(errorOf(a, ""))) return { status: "waiting", check_in_s: CHECK_IN_S, data: { set_id: set.id, phase: pd.job?.phase ?? "busy", started_at: startedAt } };
        return fail("tracking_failed", errorOf(a, "the provider refused the tracking request") + ".");
      }
      const phase = ad.job?.phase ?? "unknown";
      if (phase === "complete") return { status: "done", outcome: "tracked", data: { set_id: set.id, phase, started_at: startedAt } };
      return { status: "waiting", check_in_s: CHECK_IN_S, data: { set_id: set.id, phase, started_at: startedAt } };
    },
  },
  {
    name: "run_social",
    async run(job, ctx) {
      // The monthly workflow analyses the brand's own Sprout performance first; without a profile it stops before anything is written.
      const client = await clientOf(job, ctx);
      const profiles = (await ctx.db.sproutProfilesOf(client.id)).filter((p) => p.is_active !== false);
      if (!profiles.length) return { status: "skipped", reason: "no_sprout_profiles", message: "No Sprout profile: the social report needs the brand's own performance data, so it does not run.", gaps: [gap("run_social", "social_report_unavailable", "No Sprout profile: the social report needs the brand's own performance data, so it does not run for this brand.")] };
      return startReport(job, ctx, "social");
    },
  },
  {
    name: "run_competitive",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      const set = trackedSet(await ctx.db.setsOf(client.id));
      if (!set) return { status: "skipped", reason: "no_tracked_set", message: "No confirmed and tracked competitor set, so the competitive report does not run." };
      const end = new Date(ctx.now().getTime() - 86_400_000);
      const start = new Date(end.getTime() - 29 * 86_400_000);
      return startReport(job, ctx, "competitive", { start: day(start), end: day(end) });
    },
  },
  {
    name: "wait_reports",
    async run(job, ctx) {
      if (!job.run_ids.length) return { status: "skipped", reason: "no_reports" };
      const [social, comp] = await Promise.all([ctx.db.getReports(job.run_ids), ctx.db.getCompetitiveReports(job.run_ids)]);
      const now = ctx.now();
      const state: Record<string, string> = {};
      const gaps: Gap[] = [];
      let open = 0, timedOut = 0;
      const look = (r: ReportRow | CompetitiveReportRow, kind: string) => {
        if (r.status === "completed" || r.status === "complete") state[r.id] = "completed";
        else if (r.status === "failed") {
          state[r.id] = "failed";
          const why = str(obj(r.report_data).error);
          gaps.push(gap("wait_reports", "report_failed", `The ${kind} report ended with an error${why ? `: ${why}` : "."}`));
        } else if (minutesSince(r.created_at, now) > REPORT_TIMEOUT_MIN) { state[r.id] = "timed_out"; timedOut++; }
        else { state[r.id] = r.status; open++; }
      };
      for (const r of social) look(r, "social");
      for (const r of comp) look(r, "competitive");
      for (const id of job.run_ids) if (!(id in state)) state[id] = "missing";
      if (open) return { status: "waiting", check_in_s: CHECK_IN_S, data: { reports: state } };
      if (timedOut) return { status: "failed", reason: "run_timeout", message: `A report did not finish within ${REPORT_TIMEOUT_MIN} minutes.`, data: { reports: state }, gaps: [...gaps, gap("wait_reports", "report_timeout", "A report did not finish in time; it is read into the outputs when it lands.")] };
      return { status: "done", outcome: gaps.length ? "some_failed" : "all_completed", data: { reports: state }, gaps };
    },
  },
  {
    name: "post",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      const actor = actorOf(job, client);
      const existing = await ctx.db.postsForJob(job.id);
      if (existing[0] && (existing[0].media_urls ?? []).length) return { status: "done", outcome: "already_generated", data: { post_id: existing[0].id } };
      let post = existing[0] ?? null;
      let brief: { platform: string; format: string | null; copy: string; hashtags: string[]; cta: string | null; concept: string | null; visual_direction: string | null; report_id: string | null; source: "calendar" | "ad_hoc" } | null = post
        ? { platform: post.platform, format: post.format, copy: post.post_copy ?? "", hashtags: strs(post.hashtags), cta: post.cta, concept: post.concept, visual_direction: post.visual_direction, report_id: post.report_id, source: post.report_id ? "calendar" : "ad_hoc" }
        : null;
      if (!brief) {
        const social = (await ctx.db.getReports(job.run_ids)).find((r) => r.status === "completed");
        const cal = Array.isArray(obj(social?.report_data).content_calendar) ? (obj(social?.report_data).content_calendar as unknown[]) : [];
        const first = cal.map((d) => (Array.isArray(obj(d).posts) ? (obj(d).posts as unknown[]) : [])).flat().map(obj).find((p) => str(p.copy));
        if (social && first) brief = { platform: str(first.platform) ?? "Instagram", format: str(first.format), copy: str(first.copy)!, hashtags: strs(first.hashtags), cta: str(first.cta), concept: str(first.rationale), visual_direction: str(first.visual_direction) ?? str(first.ai_visual_prompt), report_id: social.id, source: "calendar" };
      }
      if (!brief) {
        const platform = strs(client.primary_platforms)[0] ?? "Instagram";
        const topic = pillarsOut(client.content_pillars)[0]?.name ?? str(stepData(job, "site_brief").title) ?? `${client.name}: what the brand stands for`;
        const r = await ctx.call("generate-ad-hoc-post", { client_id: client.id, platform, topic, creative_type: "Image" }, actor);
        const p = obj(obj(r.data).post);
        const copy = str(p.caption_angle) ?? str(p.hook);
        if (!r.ok || !copy) {
          const message = errorOf(r, "The post could not be written");
          return { status: "failed", reason: "copy_failed", message, gaps: [gap("post", "post_missing", `No post could be written for ${client.name}: ${message}`)] };
        }
        brief = { platform: str(p.platform) ?? platform, format: str(p.format) ?? "Image", copy, hashtags: strs(p.hashtags), cta: str(p.CTA) ?? str(p.cta), concept: str(p.concept), visual_direction: str(p.visual_direction), report_id: null, source: "ad_hoc" };
      }
      if (!post) post = await ctx.db.insertPost({ client_id: client.id, report_id: brief.report_id, platform: brief.platform, post_copy: brief.copy, hashtags: brief.hashtags, cta: brief.cta, concept: brief.concept, visual_direction: brief.visual_direction, format: brief.format, source: "ad_hoc", version: 1, is_selected: true, created_by: actor, demo_job_id: job.id });
      const copyOnly = (why: string, code = "post_image_missing"): StepResult => ({ status: "done", outcome: "copy_only", message: why, data: { post_id: post!.id, platform: brief!.platform, source: brief!.source }, gaps: [gap("post", code, `The post was written but its image was not: ${why}`)] });
      const img = await ctx.call("generate-post-image", { client_id: client.id, client_name: client.name, platform: brief.platform, format: brief.format ?? "Image", prompt: brief.visual_direction ?? brief.concept ?? brief.copy, post: { copy: brief.copy, platform: brief.platform, format: brief.format, visual_direction: brief.visual_direction } }, actor);
      const id = obj(img.data) as { image_url?: string; job_id?: string };
      if (img.status === 202 && id.job_id) return { status: "done", outcome: "image_pending", data: { post_id: post.id, platform: brief.platform, source: brief.source, media_job_id: id.job_id }, gaps: [gap("post", "post_image_pending", "The post's image is still rendering; it appears on the post when done.")] };
      if (!img.ok || !str(id.image_url)) return copyOnly(errorOf(img, "the image service did not answer") + ".");
      const up = await ctx.call("upload-generated-media", { client_id: client.id, media_data: id.image_url, media_type: "image", file_name: `demo-${job.id}.png` }, actor);
      const url = str(obj(up.data).url);
      if (!up.ok || !url) return copyOnly(errorOf(up, "the image could not be stored") + ".");
      await ctx.db.updatePost(post.id, { media_urls: [url] });
      return { status: "done", outcome: "generated", data: { post_id: post.id, platform: brief.platform, format: brief.format, source: brief.source, media_url: url } };
    },
  },
  {
    name: "analytics",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      const profiles = (await ctx.db.sproutProfilesOf(client.id)).filter((p) => p.is_active !== false);
      if (!profiles.length) return { status: "skipped", reason: "no_sprout_profiles", message: "No Sprout profile: performance analytics are not available for this brand.", gaps: [gap("analytics", "analytics_unavailable", "No Sprout profile: performance analytics are not available for this brand.")] };
      const end = ctx.now();
      const start = new Date(end.getTime() - 29 * 86_400_000);
      const r = await ctx.call("sprout-analytics", { client_id: client.id, start: day(start), end: day(end) }, actorOf(job, client));
      if (!r.ok || !r.data || typeof r.data !== "object") {
        const message = errorOf(r, "The analytics service did not answer");
        return { status: "failed", reason: "analytics_failed", message, gaps: [gap("analytics", "analytics_unavailable", `Performance analytics could not be read: ${message}`)] };
      }
      const snapshot = analyticsOut(r.data as Record<string, unknown>);
      return { status: "done", outcome: "fetched", data: { range: { start: day(start), end: day(end) }, profiles: profiles.length, totals: snapshot.totals ?? null, snapshot } };
    },
  },
  {
    name: "collect",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      const [sets, reports, competitive, posts, designs] = await Promise.all([ctx.db.setsOf(client.id), ctx.db.getReports(job.run_ids), ctx.db.getCompetitiveReports(job.run_ids), ctx.db.postsForJob(job.id), ctx.db.designSystemsOf(client.id)]);
      const comp = stepData(job, "competitors");
      const set = sets.find((s) => s.id === comp.set_id) ?? newestSet(sets.filter((s) => CONFIRMED_SET.includes(s.status))) ?? newestSet(sets);
      const analytics = (stepData(job, "analytics").snapshot as Record<string, unknown> | undefined) ?? null;
      const outputs = buildOutputs({ client, set, unplaced: (comp.unplaced as Unplaced[] | undefined) ?? [], reports, competitive, posts, designs, analytics, gaps: job.gaps });
      return { status: "done", outcome: "collected", data: { reports: reports.length + competitive.length, posts: posts.length, design: outputs.design.status }, patch: { outputs: outputs as unknown as Record<string, unknown> } };
    },
  },
  {
    name: "callback",
    always: true,
    async run(job, ctx) {
      const url = job.callback_url as string | null | undefined;
      if (!url) return { status: "skipped", reason: "no_callback_url" };
      // One attempt per tick; the engine's waiting mechanism provides the delays (0, 60 s, 300 s).
      const prior = stepData(job, "callback");
      const attempts = (typeof prior.attempts === "number" ? prior.attempts : 0) + 1;
      const provisional = { ...job, steps: job.steps.filter((s) => s.name !== "callback") } as JobRecord;
      const payload = { job_id: job.id, tool: ctx.tool, status: finalStatus(provisional), client_id: job.client_id, outputs: job.outputs, gaps: job.gaps, finished_at: ctx.now().toISOString(), links: { self: `/v1/demo-jobs/${job.id}` } };
      const r = await ctx.deliverOnce(url, payload, await ctx.keyHashFor((job.key_id as string | null) ?? null));
      const delivered = r.status != null && r.status >= 200 && r.status < 300;
      const status = { delivered, attempts, last_status: r.status, last_error: r.error, delivered_at: delivered ? ctx.now().toISOString() : null };
      if (delivered) return { status: "done", outcome: "delivered", data: { attempts, last_status: r.status }, patch: { callback_status: status as unknown as Record<string, unknown> } };
      if (attempts >= CALLBACK_MAX_ATTEMPTS) return { status: "done", outcome: "undelivered", message: `The callback was refused ${attempts} times (last answer ${r.status ?? r.error}).`, data: { attempts, last_status: r.status, last_error: r.error }, patch: { callback_status: status as unknown as Record<string, unknown> } };
      return { status: "waiting", check_in_s: CALLBACK_DELAYS_S[attempts], data: { attempts, last_status: r.status, last_error: r.error } };
    },
  },
];

/**
 * A finished job's outputs are a snapshot taken by the collect step. A report
 * that lands later (a run that outlived the wait) is folded in the next time
 * the job is read. Returns true when the outputs changed.
 */
export async function refreshOutputs(job: JobRecord, ctx: DemoCtx): Promise<boolean> {
  if (!(job.status === "completed" || job.status === "partial") || !job.client_id || !job.run_ids.length) return false;
  const known = ((job.outputs as { reports?: Array<{ id: string; status: string }> } | null)?.reports ?? []).map((r) => `${r.id}:${r.status}`);
  const [social, comp] = await Promise.all([ctx.db.getReports(job.run_ids), ctx.db.getCompetitiveReports(job.run_ids)]);
  const now = [...social, ...comp].map((r) => `${r.id}:${r.status}`);
  if (now.length === known.length && now.every((k) => known.includes(k))) return false;
  const collect = DEMO_STEPS.find((s) => s.name === "collect")!;
  const r = await collect.run(job, ctx);
  if (r.status !== "done" || !r.patch?.outputs) return false;
  job.outputs = { ...(r.patch.outputs as Record<string, unknown>), refreshed_at: ctx.now().toISOString() };
  return true;
}

/** The production context: supabase-js and the shared function caller, acting for the user each call names. */
export function makeDemoCtx(db: Parameters<typeof makeDemoDb>[0], env: CallEnv = callEnvFromDeno()): DemoCtx {
  return {
    db: makeDemoDb(db),
    call: (name, body, actAs) => callFunction(name, body, { ...env, actAs }),
    async keyHashFor(keyId) {
      if (!keyId) return null;
      const { data } = await db.from("api_keys").select("key_hash").eq("id", keyId).maybeSingle();
      return (data as { key_hash?: string } | null)?.key_hash ?? null;
    },
    deliverOnce: (url, payload, keyHash) => deliverOnce(url, payload, keyHash),
    now: () => new Date(),
    tool: "socialytics",
  };
}
