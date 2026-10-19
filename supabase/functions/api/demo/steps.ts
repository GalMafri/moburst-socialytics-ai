/**
 * The fourteen steps of a Socialytics demo, in order. Each one checks what
 * already exists before creating anything (the worker may re-run a step
 * after a crash), records a plain outcome, and never stops the job for a
 * gap it can record instead. Everything external comes in through DemoCtx;
 * the project's own functions are driven as the project itself, acting for
 * the user the job resolved.
 *
 * Onboarding is the client lifecycle's (_shared/lifecycle): the brand read,
 * the brief and pillars, the design references and the competitor set come
 * from the same steps every client goes through, run now for the demo's
 * copy of the brand (ctx.lifecycle). There is one onboarding path.
 */
import { CALLBACK_DELAYS_S, CALLBACK_MAX_ATTEMPTS, deliverOnce } from "../../_shared/api/callback.ts";
import { finalStatus, type Gap, type JobRecord, type StepDef, type StepResult } from "../../_shared/api/jobs.ts";
import { demoSlug, resolveScope } from "../../_shared/api/keys.ts";
import type { ClientScope } from "../../_shared/api/router.ts";
import { callEnvFromDeno, callFunction, type CallEnv, type CallResult } from "../../_shared/invoke.ts";
import { runStepNow, type StepView } from "../../_shared/lifecycle/run.ts";
import { slugify } from "../../_shared/lifecycle/names.ts";
import { clientHost } from "../../_shared/net/clientHost.ts";
import { analyticsOut, CONFIRMED_SET, pillarsOut, type BrandIdentity, type ClientRow, type CompetitiveReportRow, type ReportRow, type SetWithCompetitors } from "../serializers.ts";
import { buildOutputs, type Unplaced } from "./collect.ts";
import { makeDemoDb, type DemoDb } from "./db.ts";

export interface DemoCtx {
  db: DemoDb;
  /** A project function, called as the project itself acting for `actAs`. */
  call(name: string, body: unknown, actAs: string | null): Promise<CallResult>;
  /** Bring a client lifecycle step of the client up to date now: run it when it is due, else read what it stored. */
  lifecycle(step: string, clientId: string): Promise<StepView>;
  keyHashFor(keyId: string | null): Promise<string | null>;
  deliverOnce(url: string, payload: unknown, keyHash: string | null): Promise<{ status: number | null; error: string | null }>;
  now(): Date;
  tool: string;
}

const FRESH_REPORT_DAYS = 7;
const REPORT_TIMEOUT_MIN = 100;
const CHECK_IN_S = 120;
const MIN_REFERENCES = 3;
const DEFAULT_PLATFORMS = ["Instagram", "TikTok", "Facebook", "LinkedIn"];
/** How long a demo step waits before looking at a lifecycle step that is still working. */
const LIFECYCLE_CHECK_IN_S = 30;
/** What a demo does not show for a prospect: the parts of the product built on the brand's own connections. */
const CONNECTED_ONLY = {
  tracking: "A demo takes no competitor tracking slots; the connected showcase workspace shows tracking and the competitive report.",
  competitive: "The competitive report is built on tracked competitors; the connected showcase workspace shows one.",
  analytics: "Performance analytics come from the brand's own Sprout connection; the connected showcase workspace shows them.",
};

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

/** The portal's slug rule, shared with the client lifecycle's access step. */
export { slugify };

async function clientOf(job: JobRecord, ctx: DemoCtx): Promise<ClientRow> {
  const c = job.client_id ? await ctx.db.getClient(job.client_id) : null;
  if (!c) throw new Error("The job has no client yet.");
  return c;
}
/** The user the job acts for: chosen when the client was resolved. */
const actorOf = (job: JobRecord, client: ClientRow): string | null => str(stepData(job, "resolve_client").acted_as) ?? client.created_by ?? null;
const referenceCount = (c: ClientRow) => (Array.isArray(c.harvested_design_references) ? c.harvested_design_references.length : 0) + (Array.isArray(c.design_references) ? c.design_references.length : 0);
const newestSet = (sets: SetWithCompetitors[]) => [...sets].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
/** A lifecycle step still at work: the demo step looks again shortly. */
const working = (v: StepView) => v.status === "running" || (v.status === "waiting" && v.waiting_for === "in_progress");
const stillWorking = (step: string): StepResult => ({ status: "waiting", check_in_s: LIFECYCLE_CHECK_IN_S, data: { lifecycle: step } });


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
    if (fresh) return { status: "skipped", reason: "fresh_report_exists", message: `A ${kind} report completed in the last ${FRESH_REPORT_DAYS} days, so the demo uses it (force_run starts a new one).`, data: { report_id: fresh.id }, patch: { run_ids: withRun([fresh.id]) } };
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
      // A demo works on its own copy of the brand. A production client with the same website or name is never read, reused or written.
      const existing = (await ctx.db.findDemoClientByHost(host)) ?? (await ctx.db.findDemoClientByName(input.client_name));
      if (existing) {
        if (!scope.allows(existing.id)) return outOfScope("this client");
        const mine = existing.demo_job_id === job.id;
        const actedAs = existing.created_by ?? (await ctx.db.ownerFor(requesterEmail(job)));
        return { status: "done", outcome: mine ? "created" : "reused", data: { client_id: existing.id, name: existing.name, company_slug: existing.company_slug, matched_by: mine ? "job" : "website_or_name", acted_as: actedAs }, patch: { client_id: existing.id } };
      }
      const owner = await ctx.db.ownerFor(requesterEmail(job));
      if (!owner) return { status: "failed", fatal: true, reason: "no_owner", message: "No Socialytics user is available to own the new client." };
      const company = slugify(input.client_name);
      const base = demoSlug(company);
      let slug = base;
      for (let n = 2; (await ctx.db.slugExists(slug)) && n < 20; n++) slug = `${base}-${n}`;
      // A company-scoped key may only create the demo copy of one of its companies.
      if (!scope.all) {
        const reach = await ctx.db.keyReach((job.key_id as string | null) ?? "");
        if (!reach?.company_slugs?.some((s) => s === slug || s === company)) return outOfScope(`a client outside its companies (${company})`);
      }
      const c = await ctx.db.insertClient({ name: input.client_name, website_url: `https://${host}`, company_slug: slug, created_by: owner, primary_platforms: DEFAULT_PLATFORMS, geo: "US", language: "en", timezone: "UTC", media_backend: "gemini", demo_job_id: job.id });
      return { status: "done", outcome: "created", data: { client_id: c.id, name: c.name, company_slug: slug, acted_as: owner }, patch: { client_id: c.id } };
    },
  },
  {
    name: "brand_identity",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      const v = await ctx.lifecycle("brand_read", client.id);
      if (working(v)) return stillWorking("brand_read");
      const fresh = (await ctx.db.getClient(client.id)) ?? client;
      const b = fresh.brand_identity;
      if (!b || !Object.keys(b).length) {
        const message = v.error ?? "The website could not be read.";
        return { status: "failed", reason: v.status === "failed" ? "research_failed" : "no_identity", message, gaps: [gap("brand_identity", "brand_identity_missing", `No brand identity was read from ${client.name}'s website: ${message}`)] };
      }
      const r = v.result ?? {};
      const data = { colors: [b.primary_color, b.secondary_color, b.accent_color].filter(Boolean), font: b.font_family ?? null, tone: b.tone_of_voice ?? null, logo: !!fresh.logo_url, timezone: fresh.timezone ?? null, timezone_source: str(r.timezone_source) };
      return v.ran ? { status: "done", outcome: "researched", data } : { status: "skipped", reason: "brand_exists", data };
    },
  },
  {
    name: "site_brief",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      const v = await ctx.lifecycle("brief_pillars", client.id);
      if (working(v)) return stillWorking("brief_pillars");
      const fresh = (await ctx.db.getClient(client.id)) ?? client;
      const brief = fresh.brief_text ?? "";
      const made = v.result?.brief;
      if ((made === "drafted" || made === "from_doc") && v.ran) return { status: "done", outcome: made === "drafted" ? "drafted" : "from_strategy_doc", data: { chars: brief.length, excerpt: brief.slice(0, 1200) } };
      if (brief.trim().length >= 80) return { status: "skipped", reason: "brief_exists", data: { chars: brief.length } };
      const message = v.error ?? "The website carried almost no readable text.";
      return { status: "failed", reason: "site_unreadable", message, gaps: [gap("site_brief", "brief_missing", `No brief was drafted for ${client.name}: ${message}`)] };
    },
  },
  {
    name: "pillars",
    async run(job, ctx) {
      const client = await clientOf(job, ctx);
      // The brief_pillars step ran with the brief above; this reads what it stored.
      const v = await ctx.lifecycle("brief_pillars", client.id);
      if (working(v)) return stillWorking("brief_pillars");
      const fresh = (await ctx.db.getClient(client.id)) ?? client;
      const r = v.result ?? {};
      const pillars = pillarsOut(fresh.content_pillars);
      const keywords = strs(fresh.social_keywords);
      if (r.pillars === "derived") return { status: "done", outcome: "derived", data: { pillars: pillars.map((p) => p.name), keywords: keywords.length, source: str(r.source), fields: Array.isArray(r.written) ? r.written : [] } };
      if (pillars.length && keywords.length) return { status: "skipped", reason: "pillars_exist", data: { pillars: pillars.length, keywords: keywords.length } };
      const message = v.error ?? `There was nothing to read for ${client.name} yet.`;
      return { status: "failed", reason: v.status === "failed" ? "derive_failed" : "no_evidence", message, gaps: [gap("pillars", "pillars_missing", `No content pillars were derived for ${client.name}: ${message}`)] };
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
      // Approving a design system is a team decision; the demo takes it only for a client it created.
      if (client.demo_job_id !== job.id) return { status: "skipped", reason: "existing_client", message: "This client existed before the demo, so the demo does not approve a design system for it.", data: { drafts: systems.length }, gaps: [gap("design", "design_system_missing", "No approved design system yet. Generated posts use the brand colors and fonts.")] };
      const profiles = (await ctx.db.sproutProfilesOf(client.id)).filter((p) => p.is_active !== false);
      const noRefs = (): StepResult => ({ status: "skipped", reason: "no_references", message: "No brand references yet. Generated posts use the brand colors and fonts.", data: { references: referenceCount(client), sprout_profiles: profiles.length }, gaps: [gap("design", "design_system_missing", "No brand references yet. Generated posts use the brand colors and fonts.")] });
      if (!profiles.length && referenceCount(client) < MIN_REFERENCES) return noRefs();
      if (referenceCount(client) < MIN_REFERENCES) {
        // The brand's designed posts and the style learned from them: the lifecycle's design_refs step.
        const v = await ctx.lifecycle("design_refs", client.id);
        if (working(v)) return stillWorking("design_refs");
        if (v.status === "failed") {
          const message = v.error ?? "The brand's social posts could not be read.";
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
      /** One rule for every client: the three closest proposals that have a website (RivalIQ tracks by website). */
      const outcome = (set: SetWithCompetitors, source: string): StepResult => {
        const chosen = selectedNames(set);
        const unplaced: Unplaced[] = set.competitors.filter((c) => !c.is_selected).map((c) => ({ name: c.name, reason: c.website_url ? "not_among_closest" : "no_website" }));
        const gaps = unplaced.map((u) => gap("competitors", "competitor_unplaced", `${u.name} was proposed but not selected: ${u.reason === "no_website" ? "no website" : "three closer competitors were selected"}.`));
        return { status: "done", outcome: "3_selected", data: { set_id: set.id, source, selected: chosen, unplaced, candidates: set.competitors.length }, gaps };
      };
      const draftOnly = (set: SetWithCompetitors | null, source: string, placeable: string[]): StepResult => ({
        status: "done", outcome: "draft_only", message: `Only ${placeable.length} of ${set?.competitors.length ?? 0} proposed competitors have a website.`,
        data: { set_id: set?.id ?? null, source, candidates: set?.competitors.length ?? 0, placeable, unplaced: (set?.competitors ?? []).filter((c) => !c.website_url).map((c) => ({ name: c.name, reason: "no_website" })) },
        gaps: [gap("competitors", "competitors_unconfirmed", `Only ${placeable.length} of ${set?.competitors.length ?? 0} proposed competitors have a website; the set stays a draft and the competitive report is skipped.`)],
      });
      const reload = async (id: string) => (await ctx.db.setsOf(client.id)).find((s) => s.id === id) ?? null;

      if (requested?.length) {
        // The competitors the request named, in its order.
        let setId = mine?.id ?? null;
        if (!setId) {
          const set = await ctx.db.insertSet({ client_id: client.id, status: "draft", source: "manual", generated_by: actor, demo_job_id: job.id });
          await ctx.db.insertCompetitors(requested.map((c, i) => ({ set_id: set.id, client_id: client.id, name: c.name, website_url: c.website ? `https://${c.website}` : null, rationale: "Named in the demo request.", similarity_score: Math.round((1 - i * 0.01) * 100) / 100, source: "manual" })));
          setId = set.id;
        }
        let set = await reload(setId);
        if (!set) return { status: "failed", reason: "set_missing", message: "The competitor set could not be read back.", gaps: [gap("competitors", "no_competitors", `${client.name} has no competitors to compare with.`)] };
        if (set.competitors.some((c) => !c.handles.length)) {
          // Their profiles, for the outputs; the selection does not need them.
          await ctx.call("detect-competitor-handles", { set_id: setId }, actor);
          set = (await reload(setId)) ?? set;
        }
        const placeable = set.competitors.filter((c) => c.website_url).sort((a, b) => (b.similarity_score ?? 0) - (a.similarity_score ?? 0));
        if (placeable.length < 3) return draftOnly(set, "request", placeable.map((c) => c.name));
        const chosen = placeable.slice(0, 3);
        for (const c of set.competitors) {
          const rank = chosen.indexOf(c);
          const want = rank >= 0 ? { is_selected: true, selected_rank: rank + 1 } : { is_selected: false, selected_rank: null };
          if (!!c.is_selected !== want.is_selected || (c.selected_rank ?? null) !== want.selected_rank) await ctx.db.updateCompetitor(c.id, want);
        }
        await ctx.db.confirmSet(setId, actor, "Selected by the demo onboarding: the first three named competitors with a website.");
        set = (await reload(setId)) ?? set;
        return outcome(set, "request");
      }

      // Identified: the lifecycle's competitors step, the same one every client goes through.
      const v = await ctx.lifecycle("competitors", client.id);
      if (working(v)) return stillWorking("competitors");
      const r = v.result ?? {};
      const setId = str(r.set_id) ?? str(r.draft_set_id);
      if (v.status === "failed" || !setId) {
        if (v.status === "waiting") return draftOnly(null, "identified", []);
        const message = v.error ?? "No competitors could be proposed.";
        return { status: "failed", reason: "no_competitors_found", message, gaps: [gap("competitors", "no_competitors", `${client.name} has no competitors to compare with: ${message}`)] };
      }
      const set = await reload(setId);
      if (!set) return { status: "failed", reason: "set_missing", message: "The competitor set could not be read back.", gaps: [gap("competitors", "no_competitors", `${client.name} has no competitors to compare with.`)] };
      // A set the lifecycle made during this job goes with the job when it is discarded.
      if (!set.demo_job_id && r.created === true) await ctx.db.updateSet(set.id, { demo_job_id: job.id });
      if (r.source === "existing" && set.demo_job_id && set.demo_job_id !== job.id) return { status: "skipped", reason: "set_exists", message: `${client.name} already has a confirmed competitor set.`, data: { set_id: set.id, status: set.status, selected: selectedNames(set), tracked: !!set.rivaliq_landscape_id, source: "existing" } };
      if (!CONFIRMED_SET.includes(set.status)) return draftOnly(set, "identified", set.competitors.filter((c) => c.website_url).map((c) => c.name));
      return outcome(set, "identified");
    },
  },
  {
    name: "tracking",
    // Competitor tracking takes a RivalIQ seat and the competitive report is built on it; both belong to the connected
    // product. A demo keeps the competitor set and shows tracking and the report on the connected showcase workspace.
    async run() {
      return { status: "skipped", reason: "connected_only", message: CONNECTED_ONLY.tracking, gaps: [gap("tracking", "connected_only", CONNECTED_ONLY.tracking)] };
    },
  },
  {
    name: "run_social",
    async run(job, ctx) {
      // The monthly workflow branches around Sprout when a brand has no profile (trends, calendar and deck still come out);
      // the gap only says what the report will not contain.
      const client = await clientOf(job, ctx);
      const profiles = (await ctx.db.sproutProfilesOf(client.id)).filter((p) => p.is_active !== false);
      const r = await startReport(job, ctx, "social");
      if (!profiles.length && (r.status === "done")) r.gaps = [...(r.gaps ?? []), gap("run_social", "performance_data_unavailable", "No Sprout profile: the social report has no performance section for this brand; trends, recommendations, the calendar and the deck are still produced.")];
      return r;
    },
  },
  {
    name: "run_competitive",
    // The gap is recorded once, by the tracking step.
    async run() {
      return { status: "skipped", reason: "connected_only", message: CONNECTED_ONLY.competitive };
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
      if (!post) post = await ctx.db.insertPost({ client_id: client.id, report_id: brief.report_id, platform: brief.platform, post_copy: brief.copy, hashtags: brief.hashtags, cta: brief.cta, concept: brief.concept, visual_direction: brief.visual_direction, format: brief.format, source: brief.source, version: 1, is_selected: true, created_by: actor, demo_job_id: job.id });
      const copyOnly = (why: string, code = "post_image_missing"): StepResult => ({ status: "done", outcome: "copy_only", message: why, data: { post_id: post!.id, platform: brief!.platform, source: brief!.source }, gaps: [gap("post", code, `The post was written but its image was not: ${why}`)] });
      const img = await ctx.call("generate-post-image", { client_id: client.id, client_name: client.name, platform: brief.platform, format: brief.format ?? "Image", prompt: brief.visual_direction ?? brief.concept ?? brief.copy, post: { copy: brief.copy, platform: brief.platform, format: brief.format, visual_direction: brief.visual_direction } }, actor);
      const id = obj(img.data) as { image_url?: string; job_id?: string };
      if (img.status === 202 && id.job_id) return { status: "done", outcome: "image_pending", data: { post_id: post.id, platform: brief.platform, source: brief.source, media_job_id: id.job_id }, gaps: [gap("post", "post_image_pending", "The post's image is still rendering; it appears on the post when done.")] };
      if (!img.ok || !str(id.image_url)) return copyOnly(errorOf(img, "the image service did not answer") + ".");
      const up = await ctx.call("upload-generated-media", { client_id: client.id, media_data: id.image_url, media_type: "image", file_name: `demo-${job.id}` }, actor);
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
      if (!profiles.length) return { status: "skipped", reason: "no_sprout_profiles", message: CONNECTED_ONLY.analytics, gaps: [gap("analytics", "analytics_unavailable", CONNECTED_ONLY.analytics)] };
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
    lifecycle: (step, clientId) => runStepNow(db, clientId, step),
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
