// supabase/functions/_shared/calendar/runWeek.ts
//
// The weekly calendar's jobs (Lital, 19 Oct 2026), run by run-scheduled-jobs:
//   week_plan      write one week's plan, once, from the freshest evidence
//   week_revise    rewrite a week's posts nobody worked on, from a note
//   voice_profile  learn how the client writes from its published posts
// Each job is one bounded model call. A plan that already has posts (a run
// cut off after writing them) is finished rather than written twice.

import { anthropicMessages } from "../anthropic.ts";
import { collectOwnedCompetitive } from "../competitive/ownedSource.ts";
import { competitiveBrief } from "../competitive/brief.ts";
import { applyRhythmSetting, bestExamples, numberEvidence, platformName, rhythmFromPosts, scoreCompetitorPosts, scoreOwnPosts, MIN_COMPETITOR_WEEKS, OWN_DAYS, type CompetitorPost, type EvidenceItem, type OwnPost, type RhythmLine } from "./evidence.ts";
import { parseRevision, parseWeekPlan, revisePrompt, weekPrompt, type Reason, type RevisePost } from "./weekPlan.ts";
import { buildVoiceProfile, COPY_MODEL, learnFromSignal, loadClientVoice } from "../voice/load.ts";
import { voicePromptBlock } from "../voice/voice.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface WeekJob {
  id: string;
  kind: string;
  client_id: string;
  occurrence: string | null;
  attempts: number;
  max_attempts: number;
}

export interface WeekJobOutcome {
  status: "done" | "queued" | "skipped" | "failed";
  reason?: string | null;
  result?: Record<string, unknown> | null;
  available_at?: string;
  /** A wait for another job, which does not count as an attempt. */
  deferred?: boolean;
}

const RETRY_MINUTES = 10;
const DAY = 86400_000;

const CLIENT_COLUMNS = "id, name, brand_identity, content_pillars, geo, language, timezone, posting_rhythm, sprout_customer_id, website_url";

function apiKey(): string {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured.");
  return key;
}

function todayIn(timeZone: string, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const list = (s: unknown) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const strings = (x: unknown): string[] => (Array.isArray(x) ? x.map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v as Record<string, unknown>).filter((t) => typeof t === "string").join(": ") : "")).filter(Boolean) : []);
const usage = (raw: unknown) => {
  const u = (raw as { usage?: { input_tokens?: number; output_tokens?: number } } | null)?.usage;
  return { input: Number(u?.input_tokens) || 0, output: Number(u?.output_tokens) || 0 };
};

// ── Evidence ────────────────────────────────────────────────────────────────

export interface Gathered {
  own: OwnPost[];
  /** What the client actually published, per platform. */
  learnedRhythm: RhythmLine[];
  /** The rhythm the plan follows: learned, with staff's setting applied. */
  rhythm: RhythmLine[];
  evidence: EvidenceItem[];
  avoid: string[];
  thin: string[];
  examples: ReturnType<typeof bestExamples>;
  sources: { sprout: string; feed_weeks: number; report: string | null; topics: number };
}

/** The client's own posts for the last 90 days: Sprout where profiles are assigned, RivalIQ's copy for other platforms. */
async function ownPosts(admin: Db, client: Record<string, unknown>, snapshots: Array<{ payload: any }>, now: Date): Promise<{ posts: OwnPost[]; sprout: string }> {
  const end = new Date(now.getTime() - DAY).toISOString().slice(0, 10);
  const start = new Date(now.getTime() - OWN_DAYS * DAY).toISOString().slice(0, 10);
  let posts: OwnPost[] = [];
  let sprout = "not_connected";
  const covered = new Set<string>();
  try {
    const owned = await collectOwnedCompetitive(admin, client, { start, end });
    sprout = owned.coverage;
    for (const p of owned.profiles ?? []) covered.add(platformName(p.network));
    posts = (owned.posts ?? []).map((p: any) => ({
      id: String(p.postId), platform: platformName(p.channel), format: String(p.type || "unknown"), publishedAt: String(p.publishedAt),
      text: String(p.message || ""), link: p.postLink ?? null, impressions: p.ownedImpressions ?? null, engagement: Number(p.engagementTotal) || 0,
    }));
  } catch (e) {
    sprout = "failed";
    console.warn("[calendar] Sprout posts could not be read:", e instanceof Error ? e.message : String(e));
  }
  // Platforms Sprout doesn't cover for this client, from the weekly feed.
  const seen = new Set(posts.map((p) => p.id));
  for (const s of snapshots) {
    const clientCompany = clientCompanyId(s.payload, String(client.name ?? ""));
    for (const p of (s.payload?.socialPosts ?? []) as any[]) {
      if (!isClientPost(p, clientCompany, String(client.name ?? ""))) continue;
      const platform = platformName(p.channel);
      const id = String(p.postId || p.nativeId || p.postLink || "");
      if (!id || covered.has(platform) || seen.has(id)) continue;
      seen.add(id);
      posts.push({ id, platform, format: String(p.type || "unknown"), publishedAt: String(p.publishedAt), text: String(p.message || ""), link: p.postLink ?? null, impressions: null, engagement: Number(p.engagementTotal) || 0 });
    }
  }
  return { posts, sprout };
}

function clientCompanyId(payload: any, clientName: string): string | null {
  if (payload?.client_company_id) return String(payload.client_company_id);
  const own = (payload?.socialPosts ?? []).find((p: any) => p?.source === "sprout" || String(p?.companyName || "").toLowerCase() === clientName.toLowerCase());
  return own?.companyId ? String(own.companyId) : null;
}

function isClientPost(p: any, clientCompany: string | null, clientName: string): boolean {
  if (clientCompany && String(p?.companyId) === clientCompany) return true;
  const name = String(p?.companyName || "").toLowerCase();
  return !!clientName && !!name && name.includes(clientName.toLowerCase());
}

export async function gatherEvidence(admin: Db, client: Record<string, any>, now: Date): Promise<Gathered> {
  const { data: snapshotRows } = await admin.from("rivaliq_snapshots").select("payload, fetched_at")
    .eq("client_id", client.id).eq("endpoint", "feed").order("fetched_at", { ascending: false }).limit(14);
  const snapshots = (snapshotRows ?? []).filter((s: any) => Array.isArray(s.payload?.socialPosts));
  const { posts: own, sprout } = await ownPosts(admin, client, snapshots, now);

  // Competitors: the newest feed week against the four before it.
  const recent = snapshots.slice(0, 1 + MIN_COMPETITOR_WEEKS);
  const newestStart = String(recent[0]?.payload?.window?.start ?? "");
  const byId = new Map<string, CompetitorPost>();
  for (const s of [...recent].reverse()) {
    const clientCompany = clientCompanyId(s.payload, String(client.name ?? ""));
    for (const p of s.payload.socialPosts as any[]) {
      if (isClientPost(p, clientCompany, String(client.name ?? ""))) continue;
      const id = String(p.postId || p.nativeId || p.postLink || "");
      if (!id || !p.companyName) continue;
      byId.set(id, {
        id, company: String(p.companyName), platform: platformName(p.channel), format: String(p.type || "unknown"), publishedAt: String(p.publishedAt),
        text: String(p.message || ""), link: p.postLink ?? null, engagement: Number(p.engagementTotal) || 0,
        followers: Number(p.presenceReach) > 0 ? Number(p.presenceReach) : null, boosted: p.facebookLikelyBoosted === true,
      });
    }
  }
  const competitors = newestStart ? scoreCompetitorPosts([...byId.values()], newestStart, recent.length) : [];

  const { data: alerts } = newestStart
    ? await admin.from("competitive_alerts").select("topic, summary, companies, post_urls, confidence")
      .eq("client_id", client.id).neq("status", "dismissed").gte("window_start", newestStart).order("confidence", { ascending: false }).limit(8)
    : { data: [] };

  const { data: report } = await admin.from("reports").select("id, created_at, report_data").eq("client_id", client.id).eq("status", "completed")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const rd = Array.isArray(report?.report_data) ? report.report_data[0] : report?.report_data;
  const ai = rd?.ai_analysis ?? {};
  const perf = ai.sprout_performance_analysis ?? {};
  const findings = [...strings(perf.key_insights), ...strings(perf.pillar_alignment?.recommendations), ...strings(ai.competitive_takeaways)];
  const trends = [...strings(ai.tiktok_trends_analysis?.opportunities_for_client), ...strings(ai.instagram_trends_analysis?.opportunities_for_client)];

  const scored = scoreOwnPosts(own, now);
  const evidence = numberEvidence({ ownTop: scored.top, competitors, topics: alerts ?? [], trends, findings });
  const learnedRhythm = rhythmFromPosts(own, now, String(client.timezone || "UTC"));
  const rhythm = applyRhythmSetting(learnedRhythm, client.posting_rhythm);
  const thin = [
    ...Object.entries(scored.platforms).filter(([, v]) => v.thin).map(([k, v]) => `${k}: ${v.posts} post${v.posts === 1 ? "" : "s"} in the last 90 days, so its numbers are an early signal.`),
    ...(recent.length && recent.length < 1 + MIN_COMPETITOR_WEEKS ? [`Competitor history: ${recent.length} week${recent.length === 1 ? "" : "s"} so far, so competitor numbers are an early signal.`] : []),
  ];
  const fmt = (s: typeof scored.low[number]) => `${s.post.platform} ${s.post.format} from ${s.post.publishedAt.slice(0, 10)} got ${s.multiple}x the usual ${s.metric}: ${s.post.text.replace(/\s+/g, " ").slice(0, 140)}`;
  return {
    own, learnedRhythm, rhythm, evidence, avoid: scored.low.map(fmt), thin,
    examples: bestExamples(scored.top),
    sources: { sprout, feed_weeks: recent.length, report: report?.id ?? null, topics: (alerts ?? []).length },
  };
}

// ── Plan a week ─────────────────────────────────────────────────────────────

function fail(job: WeekJob, reason: string): boolean {
  return job.attempts >= job.max_attempts || /no posting rhythm|week is over/i.test(reason);
}

export async function runWeekPlan(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  const week = String(job.occurrence ?? "").slice(0, 10);
  const { data: plan } = await admin.from("calendar_plans").select("*").eq("client_id", job.client_id).eq("week_start", week).maybeSingle();
  if (!plan) return { status: "skipped", reason: "The plan this job was for no longer exists." };
  if (plan.status === "ready") return { status: "done", result: { plan_id: plan.id, already: true } };

  // The voice profile is learned first when it is due.
  const { count: voicePending } = await admin.from("scheduled_jobs").select("id", { count: "exact", head: true })
    .eq("client_id", job.client_id).eq("kind", "voice_profile").in("status", ["queued", "running"]);
  if (voicePending) return { status: "queued", reason: "Waiting for the client's voice profile.", available_at: new Date(now.getTime() + 60_000).toISOString(), deferred: true };

  // A run cut off after writing the posts: finish the plan, don't write them twice.
  const { count: written } = await admin.from("calendar_posts").select("id", { count: "exact", head: true }).eq("plan_id", plan.id);
  if (written) {
    await admin.from("calendar_plans").update({ status: "ready", ready_at: now.toISOString(), updated_at: now.toISOString() }).eq("id", plan.id);
    return { status: "done", result: { plan_id: plan.id, posts: written, finished: true } };
  }

  await admin.from("calendar_plans").update({ status: "planning", error: null, updated_at: now.toISOString() }).eq("id", plan.id);
  try {
    const { data: client, error } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", job.client_id).maybeSingle();
    if (error || !client) throw new Error("Could not read the client.");
    const tz = String(client.timezone || "UTC");
    const tomorrow = addDays(todayIn(tz, now), 1);
    const firstDate = tomorrow > week ? tomorrow : week;
    if (firstDate > addDays(week, 6)) throw new Error("The week is over, so it can't be planned.");

    const gathered = await gatherEvidence(admin, client, now);
    if (!gathered.rhythm.length) throw new Error("No posting rhythm: the client hasn't published in the last 8 weeks. Set posts per week in client settings.");

    const voice = await loadClientVoice(admin, client.id);
    const { data: weekPosts } = await admin.from("calendar_posts").select("post_date, platform, copy, plan_id")
      .eq("client_id", client.id).gte("post_date", addDays(week, -21)).lte("post_date", addDays(week, 27)).order("post_date");
    const inWeek = (d: string) => d >= week && d <= addDays(week, 6);
    const existing = (weekPosts ?? []).filter((p: any) => inWeek(p.post_date) && !p.plan_id).map((p: any) => ({ date: p.post_date, platform: p.platform, copy: p.copy || "" }));
    const recent = (weekPosts ?? []).filter((p: any) => !inWeek(p.post_date) && p.copy).map((p: any) => ({ date: p.post_date, platform: p.platform, copy: p.copy }));
    const ctx = {
      brand: String(client.name),
      voiceBlock: voicePromptBlock(voice, { platforms: gathered.rhythm.map((r) => r.platform), examples: gathered.examples }),
      pillars: (Array.isArray(client.content_pillars) ? client.content_pillars : []).map((p: any) => ({ name: String(p?.name ?? p ?? ""), description: p?.description ? String(p.description).slice(0, 240) : undefined })).filter((p: any) => p.name),
      market: list(client.geo),
      languages: list(client.language),
      monday: week,
      firstDate,
      rhythm: gathered.rhythm,
      evidence: gathered.evidence,
      avoid: gathered.avoid,
      competitiveBrief: await competitiveBrief(admin, client.id).catch(() => ""),
      existing,
      recent,
      thin: gathered.thin,
    };
    let posts: ReturnType<typeof parseWeekPlan> = [];
    const tokens = { input: 0, output: 0 };
    for (let attempt = 0; attempt < 2 && !posts.length; attempt++) {
      const result = await anthropicMessages({ apiKey: apiKey(), body: { model: COPY_MODEL, max_tokens: 16000, messages: [{ role: "user", content: weekPrompt(ctx) }] } });
      const u = usage(result.raw);
      tokens.input += u.input; tokens.output += u.output;
      posts = parseWeekPlan(result.text, ctx);
    }
    if (!posts.length) throw new Error("The planner's reply had no usable posts.");
    const rows = posts.map((p) => ({ ...p, client_id: client.id, plan_id: plan.id, created_by: plan.requested_by ?? null }));
    const { error: insertError } = await admin.from("calendar_posts").insert(rows);
    if (insertError) throw new Error(`Could not add the week's posts: ${insertError.message}`);
    await admin.from("calendar_plans").update({
      status: "ready", ready_at: new Date().toISOString(), updated_at: new Date().toISOString(), model: COPY_MODEL,
      input_tokens: tokens.input, output_tokens: tokens.output, rhythm: { applied: gathered.rhythm, learned: gathered.learnedRhythm },
      evidence: { items: gathered.evidence, avoid: gathered.avoid, thin: gathered.thin, sources: gathered.sources, first_date: firstDate },
    }).eq("id", plan.id);
    return { status: "done", result: { plan_id: plan.id, posts: rows.length, input_tokens: tokens.input, output_tokens: tokens.output } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (fail(job, reason)) {
      await admin.from("calendar_plans").update({ status: "failed", error: reason, updated_at: new Date().toISOString() }).eq("id", plan.id);
      // Setup a person has to do is not an outage: skipped, not failed, so the daily check doesn't alert.
      return { status: /no posting rhythm|week is over/i.test(reason) ? "skipped" : "failed", reason };
    }
    await admin.from("calendar_plans").update({ status: "queued", error: reason, updated_at: new Date().toISOString() }).eq("id", plan.id);
    return { status: "queued", reason, available_at: new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString() };
  }
}

// ── Revise a week ───────────────────────────────────────────────────────────

/** The ids of posts someone worked on: edited copy, moved, designed or scheduled (calendar_post_worked, in bulk). */
export async function workedOn(admin: Db, clientId: string, posts: Array<{ id: string; post_key: string; platform: string; copy: string; touched_at: string | null }>): Promise<Set<string>> {
  const keys = posts.map((p) => p.post_key);
  const [{ data: iterations }, { data: designs }, { data: scheduled }] = await Promise.all([
    admin.from("post_iterations").select("calendar_post_key").eq("client_id", clientId).in("calendar_post_key", keys),
    admin.from("design_requests").select("calendar_post_key, status").eq("client_id", clientId).in("calendar_post_key", keys),
    admin.from("scheduled_posts").select("platform, post_content").eq("client_id", clientId),
  ]);
  const edited = new Set((iterations ?? []).map((r: any) => r.calendar_post_key));
  const designed = new Set((designs ?? []).filter((r: any) => r.status !== "canceled").map((r: any) => r.calendar_post_key));
  const head = (s: string) => String(s || "").trim().slice(0, 200);
  const sent = new Set((scheduled ?? []).map((r: any) => `${String(r.platform || "").toLowerCase()}|${head(r.post_content)}`));
  return new Set(posts.filter((p) => p.touched_at || edited.has(p.post_key) || designed.has(p.post_key) || (p.copy && sent.has(`${p.platform.toLowerCase()}|${head(p.copy)}`))).map((p) => p.id));
}

export async function runWeekRevise(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  const week = String(job.occurrence ?? "").slice(0, 10);
  const { data: plan } = await admin.from("calendar_plans").select("*").eq("client_id", job.client_id).eq("week_start", week).maybeSingle();
  const pending = plan?.pending_revision as { note: string; by: string | null; at: string; scope: "untouched" | "empty" } | null;
  if (!plan || !pending) return { status: "skipped", reason: "No revision is waiting for this week." };

  const finish = async (entry: Record<string, unknown>) => {
    await admin.from("calendar_plans").update({
      pending_revision: null, updated_at: new Date().toISOString(),
      revisions: [...(Array.isArray(plan.revisions) ? plan.revisions : []), { note: pending.note, by: pending.by, at: pending.at, scope: pending.scope, done_at: new Date().toISOString(), ...entry }],
    }).eq("id", plan.id);
  };

  try {
    const { data: client, error } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", job.client_id).maybeSingle();
    if (error || !client) throw new Error("Could not read the client.");
    const today = todayIn(String(client.timezone || "UTC"), now);
    const { data: rows } = await admin.from("calendar_posts").select("id, post_key, post_date, platform, format, pillar, copy, hashtags, cta, visual_direction, reasons, touched_at, plan_id")
      .eq("client_id", client.id).gte("post_date", week).lte("post_date", addDays(week, 6)).order("post_date");
    const all = (rows ?? []) as any[];
    const planPosts = all.filter((p) => p.plan_id === plan.id && p.post_date >= today);
    const worked = await workedOn(admin, client.id, planPosts);
    const targets = planPosts.filter((p) => !worked.has(p.id) && (pending.scope === "empty" ? !String(p.copy || "").trim() : true));
    if (!targets.length) {
      await finish({ rewritten: 0, kept: planPosts.filter((p) => worked.has(p.id)).map((p) => p.id) });
      return { status: "done", result: { plan_id: plan.id, rewritten: 0 } };
    }

    const voice = await loadClientVoice(admin, client.id);
    const gathered = pending.scope === "empty" ? await gatherEvidence(admin, client, now) : null;
    const reasonText = (r: unknown) => (Array.isArray(r) && (r[0] as Reason | undefined)?.label) || "";
    const revisePosts: RevisePost[] = targets.map((p) => ({ id: p.id, date: p.post_date, platform: p.platform, format: p.format, pillar: p.pillar, copy: p.copy || "", reason: pending.scope === "empty" ? "" : reasonText(p.reasons) }));
    const prompt = revisePrompt({
      brand: String(client.name),
      voiceBlock: voicePromptBlock(voice, { platforms: [...new Set(targets.map((p) => p.platform))], ...(gathered ? { examples: gathered.examples } : {}) }),
      note: pending.note,
      scope: pending.scope,
      posts: revisePosts,
      pillars: (Array.isArray(client.content_pillars) ? client.content_pillars : []).map((p: any) => ({ name: String(p?.name ?? p ?? ""), description: p?.description ? String(p.description).slice(0, 240) : undefined })).filter((p: any) => p.name),
      languages: list(client.language),
      evidence: gathered?.evidence ?? [],
      others: all.filter((p) => !targets.some((t) => t.id === p.id) && p.copy).map((p) => ({ date: p.post_date, platform: p.platform, copy: p.copy })),
    });
    const result = await anthropicMessages({ apiKey: apiKey(), body: { model: COPY_MODEL, max_tokens: 12000, messages: [{ role: "user", content: prompt }] } });
    const revised = parseRevision(result.text, targets.map((p) => p.id), gathered?.evidence ?? [], pending.scope === "empty");
    if (!revised.length) throw new Error("The rewrite's reply had no usable posts.");

    const replaced: Array<Record<string, unknown>> = [];
    for (const r of revised) {
      const was = targets.find((p) => p.id === r.id)!;
      const patch: Record<string, unknown> = { copy: r.copy, hashtags: r.hashtags, cta: r.cta, visual_direction: r.visual_direction, ...(r.pillar ? { pillar: r.pillar } : {}), ...(r.reason ? { reasons: [r.reason] } : {}) };
      // Only if nobody changed the copy since it was read.
      const { data: updated } = await admin.from("calendar_posts").update(patch).eq("id", r.id).eq("copy", was.copy ?? "").is("touched_at", null).select("id");
      if (updated?.length) replaced.push({ id: was.id, copy: was.copy, hashtags: was.hashtags, cta: was.cta, pillar: was.pillar, visual_direction: was.visual_direction, reasons: was.reasons });
    }
    const u = usage(result.raw);
    await finish({ rewritten: replaced.length, kept: planPosts.filter((p) => worked.has(p.id)).map((p) => p.id), replaced, input_tokens: u.input, output_tokens: u.output });

    // A person's note teaches the memory; the cutover's own note does not.
    if (pending.by && pending.scope === "untouched") {
      await learnFromSignal(admin, client.id, { kind: "revise_note", note: pending.note }).catch((e) => console.warn("[calendar] memory:", e instanceof Error ? e.message : e));
    }
    return { status: "done", result: { plan_id: plan.id, rewritten: replaced.length } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (job.attempts >= job.max_attempts) {
      await finish({ failed: true, error: reason, rewritten: 0 });
      return { status: "failed", reason };
    }
    return { status: "queued", reason, available_at: new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString() };
  }
}

// ── Voice profile ───────────────────────────────────────────────────────────

export async function runVoiceProfile(admin: Db, job: WeekJob, now = new Date()): Promise<WeekJobOutcome> {
  try {
    const { data: client, error } = await admin.from("clients").select(CLIENT_COLUMNS).eq("id", job.client_id).maybeSingle();
    if (error || !client) throw new Error("Could not read the client.");
    const { data: snapshotRows } = await admin.from("rivaliq_snapshots").select("payload, fetched_at")
      .eq("client_id", client.id).eq("endpoint", "feed").order("fetched_at", { ascending: false }).limit(14);
    const { posts, sprout } = await ownPosts(admin, client, (snapshotRows ?? []).filter((s: any) => Array.isArray(s.payload?.socialPosts)), now);
    const voice = await buildVoiceProfile(admin, client.id, posts, now);
    return { status: "done", result: { posts: voice.post_count, platforms: Object.keys(voice.platforms), sprout } };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    if (job.attempts >= job.max_attempts) return { status: "failed", reason };
    return { status: "queued", reason, available_at: new Date(Date.now() + RETRY_MINUTES * 60_000).toISOString() };
  }
}

