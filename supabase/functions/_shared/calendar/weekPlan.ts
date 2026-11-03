// supabase/functions/_shared/calendar/weekPlan.ts
//
// Writing one week of a client's calendar, and revising it from a note
// (weekly calendar, Lital 19 Oct 2026). The model plans posts and cites the
// evidence each one acts on by id; a post's reason keeps that evidence with
// its real numbers, so a reason never carries a figure the data does not
// have, and is worded from it when shown (reasonText.ts). At most one post a
// week is a test. Free of Deno and network imports so it can be tested.

import type { EvidenceItem, RhythmLine } from "./evidence.ts";
import { clientFit, fmtMultiple, reasonLabel, type EvidenceRef, type Reason, type ReasonType } from "./reasonText.ts";
import { STORY_FORMAT, isStoryFormat } from "../design/story.ts";
import { CATEGORY_WORDS, type MomentCategory } from "./moments.ts";
import { postInstant } from "../design/requestRules.ts";

export { clientFit, evidenceSentence, fmtMultiple, headline } from "./reasonText.ts";
export type { EvidenceRef, Reason, ReasonType } from "./reasonText.ts";

export interface WeekContext {
  brand: string;
  voiceBlock: string;
  pillars: Array<{ name: string; description?: string }>;
  market: string[];
  languages: string[];
  monday: string;
  /** The first date that can get a post (today, when the week has started). */
  firstDate: string;
  rhythm: RhythmLine[];
  evidence: EvidenceItem[];
  /** The client's posts that did worst, so the plan avoids repeating them. */
  avoid: string[];
  /** The competitive picture with the team's calls on its ideas (competitive/brief.ts); "" when there is none. */
  competitiveBrief: string;
  /** Posts already on the calendar this week (people added them). */
  existing: Array<{ date: string; platform: string; copy: string }>;
  /** Posts around this week, so topics and openings are not repeated. */
  recent: Array<{ date: string; platform: string; copy: string }>;
  /** Where the evidence is thin, in plain words. */
  thin: string[];
  /** The client uploaded filmed footage in the last 60 days, so ideas that need someone on camera can be produced. */
  canFilm: boolean;
  /** The hashtags the client's trend profile keeps, by lowercase platform name; empty for a client with no profile. */
  hashtags: Record<string, string[]>;
  /** The client's content strategy (strategy/prompt.ts strategyPromptBlock); "" or absent for a client with none. */
  strategy?: string;
}

export interface PlannedPost {
  post_date: string;
  platform: string;
  format: string | null;
  posting_time: string | null;
  pillar: string | null;
  copy: string;
  hashtags: string[];
  cta: string | null;
  visual_direction: string | null;
  reasons: Reason[];
  source: "plan";
  /** Set when the week has Stories (withStories): the row's id and key, so a Story can name its post before either is written. */
  id?: string;
  post_key?: string;
  /** A Story: its post's key. */
  story_of?: string;
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function weekDates(monday: string): string[] {
  const base = Date.parse(`${monday}T00:00:00Z`);
  return WEEKDAYS.map((_, i) => new Date(base + i * 86400_000).toISOString().slice(0, 10));
}

const firstLine = (s: string) => String(s || "").split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 120);

/** Said under the client's content strategy in both prompts: where they differ, the week's own rules win. */
export const STRATEGY_PRECEDENCE = "The posting rhythm, the dates and the evidence rules here win wherever the strategy differs from them.";

/** The strategy and its precedence line, placed after the pillars; "" for a client with no strategy. */
const strategySection = (strategy: string | undefined) => (strategy ? `${strategy}\n${STRATEGY_PRECEDENCE}` : "");

/** A dated moment as the planner reads it: its date and kind, the client's own post on it last year, and the judge's sentence on why it fits. */
function momentLine(e: EvidenceItem): string {
  const history = e.multiple !== undefined && e.platform ? `the client's ${e.platform} ${e.format ?? "post"} on it last year got ${fmtMultiple(e.multiple)} the client's usual ${e.metric}` : "";
  const parts = [e.date, CATEGORY_WORDS[e.category as MomentCategory] ?? "", history, e.companies ? `${e.companies} competitor${e.companies === 1 ? "" : "s"} posted about it` : "", e.thin ? "early signal" : ""].filter(Boolean).join(", ");
  return `${e.id} [${parts}] ${e.text}.${e.fit ? ` Why it fits: ${e.fit}` : ""}`;
}

function evidenceLine(e: EvidenceItem): string {
  if (e.kind === "moment") return momentLine(e);
  const where = [e.company, e.platform, e.format].filter(Boolean).join(" ");
  const numbers = e.multiple !== undefined ? `${fmtMultiple(e.multiple)} ${e.kind === "own" ? "the client's" : "their"} usual ${e.metric}` : "";
  const parts = [where, e.date, e.theme ? `theme "${e.theme}"` : "", numbers, e.companies ? `${e.companies} companies` : "", e.thin ? "early signal" : ""].filter(Boolean).join(", ");
  return `${e.id} [${parts || e.kind}] ${e.text}`;
}

export function weekPrompt(c: WeekContext): string {
  const dates = weekDates(c.monday).filter((d) => d >= c.firstDate);
  const byKind = (k: EvidenceItem["kind"]) => c.evidence.filter((e) => e.kind === k);
  const section = (title: string, xs: EvidenceItem[]) => (xs.length ? [title, ...xs.map(evidenceLine)].join("\n") : "");
  const rhythm = c.rhythm.map((r) => `- ${r.platform}: ${r.perWeek} post${r.perWeek === 1 ? "" : "s"}${r.days.length ? `, usually ${r.days.slice(0, Math.max(r.perWeek, 2)).join(", ")}` : ""}${r.time ? ` around ${r.time}` : ""}`);
  // One line for each platform this week posts on that the profile has hashtags for.
  const tagLines = c.rhythm.map((r) => ({ platform: r.platform, tags: c.hashtags[r.platform.toLowerCase()] ?? [] })).filter((t) => t.tags.length)
    .map((t) => `- ${t.platform}: ${t.tags.join(", ")}`);
  return [
    `You plan one week of social media posts for ${c.brand}.`,
    c.voiceBlock,
    c.pillars.length ? ["Content pillars:", ...c.pillars.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`)].join("\n") : "",
    strategySection(c.strategy),
    c.market.length ? `Market: ${c.market.join(", ")}.` : "",
    c.languages.length ? `Write in: ${c.languages.join(", ")}.` : "",
    rhythm.length ? ["Posts for this week, per platform (this is how often the team actually publishes; follow it exactly):", ...rhythm].join("\n") : "",
    `Dates you can use: ${dates.map((d) => `${WEEKDAYS[weekDates(c.monday).indexOf(d)]} ${d}`).join(", ")}.`,
    tagLines.length ? ["Hashtags the brand's space uses, by platform. Add the ones that suit a post to its hashtags; none is required:", ...tagLines].join("\n") : "",
    "Evidence, by id. Cite the ids each post acts on.",
    section(`${c.brand}'s own posts that beat its usual numbers:`, byKind("own")),
    section("Competitor posts that beat that competitor's usual numbers this week:", byKind("competitor")),
    section("Topics several competitors posted about this week:", byKind("topic")),
    section("Industry trends this week, each shown by a real post that fit the client's audience:", byKind("trend")),
    section("Findings from the latest monthly report:", byKind("report")),
    section("Dated moments this week, each checked against the client (a seasonal post cites one):", byKind("moment")),
    c.avoid.length ? [`${c.brand}'s posts that did worst (don't repeat what they did):`, ...c.avoid.map((a) => `- ${a}`)].join("\n") : "",
    c.competitiveBrief,
    c.thin.length ? ["Where the evidence is thin:", ...c.thin.map((t) => `- ${t}`)].join("\n") : "",
    c.existing.length ? ["Already on the calendar this week (keep them; don't repeat their topics, and count them toward the platform's posts):", ...c.existing.map((p) => `- ${p.date} ${p.platform}: ${firstLine(p.copy)}`)].join("\n") : "",
    c.recent.length ? ["Posts around this week (don't repeat their topics or openings):", ...c.recent.slice(0, 30).map((p) => `- ${p.date} ${p.platform}: ${firstLine(p.copy)}`)].join("\n") : "",
    "Rules:",
    [
      "- Every post acts on the evidence above: list the ids in evidence_ids. Use a competitor's post or topic only when it fits the client's pillars, audience and services, and say how in fit.",
      byKind("moment").length
        ? "- A post for one of the dated moments above has reason_type \"seasonal\" and its M id in evidence_ids. A seasonal post cites one M id; no other holiday, awareness day or event can carry a post."
        : "- No dated moment checked out for this client this week, so no post is seasonal: don't plan a post for a holiday, awareness day or event.",
      "- At most one post is a test: something the evidence hasn't proven for this client yet, such as a competitor format it hasn't tried. Mark it \"test\": true.",
      "- copy is the full caption, ready to publish, written the way the voice section says.",
      ...(c.canFilm ? [] : ["- Every post has to be one the team can make without filming: don't plan ideas that need a specific person on camera (a team member, the founder, a customer) or footage only the client could shoot (its office, events, products in use). Videos made from designed scenes, text and motion are fine."]),
      "- Never invent facts: no names, titles, numbers, quotes, client results, launches or claims about people that aren't in the evidence, the pillars or the voice section.",
      "- fit is ONE short sentence (under 20 words) written for the client on why this post suits them. Never mention evidence ids (like P1 or C2), numbers, other posts, or what the post avoids.",
    ].join("\n"),
    'Reply with JSON only: {"posts":[{"date":"YYYY-MM-DD","platform":"...","format":"...","posting_time":"HH:MM","pillar":"...","copy":"...","hashtags":["..."],"cta":"...","visual_direction":"one sentence on what the visual shows","reason_type":"performance|competitor|trend|seasonal","evidence_ids":["P1"],"fit":"...","test":false}]}',
  ].filter(Boolean).join("\n\n");
}

function jsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const str = (x: unknown, n = 4000) => (typeof x === "string" ? x.trim().slice(0, n) : "");

/** A post's reason: its parts, stored so it can be worded when shown, and its words as of now. */
export function buildReason(input: { type: ReasonType; evidence: EvidenceRef[]; fit?: string; moment?: string; test?: boolean }): Reason {
  const thin = input.evidence.some((e) => e.thin);
  const fit = clientFit(input.fit);
  const moment = input.moment?.trim();
  const test = !!input.test;
  return {
    type: test ? "test" : input.type,
    label: reasonLabel({ type: input.type, evidence: input.evidence, fit, moment, test }),
    ...(fit ? { fit } : {}),
    ...(input.evidence.length ? { evidence: input.evidence } : {}),
    ...(thin ? { thin } : {}),
    ...(moment ? { moment } : {}),
    test,
  };
}

/** A post's type, from the evidence it acts on first: a post is seasonal only when it cites a checked moment (moments.ts). */
function typeFor(evidence: EvidenceRef[]): Exclude<ReasonType, "test"> {
  const kind = evidence[0]?.kind;
  if (kind === "moment") return "seasonal";
  if (kind === "competitor" || kind === "topic") return "competitor";
  if (kind === "trend") return "trend";
  return "performance";
}

const toRef = (e: EvidenceItem): EvidenceRef => ({ ...e });

/**
 * The evidence a post's reply cites, at most three, a moment first, and the
 * sentence on why it fits: for a moment, the judge's, which code checked;
 * otherwise the planner's. A post names at most one moment.
 */
function cited(p: Record<string, unknown>, byId: Map<string, EvidenceItem>): { evidence: EvidenceRef[]; moment: EvidenceItem | undefined; fit: string } {
  const all = (Array.isArray(p.evidence_ids) ? p.evidence_ids : []).map((id) => byId.get(String(id))).filter((e): e is EvidenceItem => !!e);
  const moment = all.find((e) => e.kind === "moment");
  const ordered = moment ? [moment, ...all.filter((e) => e.kind !== "moment")] : all;
  return { evidence: ordered.slice(0, 3).map(toRef), moment, fit: moment ? moment.fit ?? "" : str(p.fit, 300) };
}

/** A seasonal post the planner wrote without a checked moment, noted on the plan for staff. */
export interface DroppedPost {
  date: string;
  platform: string;
  copy: string;
  why: string;
}

/**
 * The week's posts from the planner's reply. Posts outside the usable dates,
 * without a platform or without copy are dropped; each platform keeps at most
 * the posts its rhythm allows; only the first test stays a test. A feed post
 * the model set to Story is saved as a single image: Stories are added in
 * code (withStories) and never count toward the rhythm.
 */
export function parseWeekPlan(text: string, c: Pick<WeekContext, "monday" | "firstDate" | "rhythm" | "evidence" | "existing">, opts: { dropped?: DroppedPost[] } = {}): PlannedPost[] {
  const data = jsonObject(text);
  const raw = Array.isArray(data?.posts) ? data!.posts as Array<Record<string, unknown>> : [];
  const dates = new Set(weekDates(c.monday).filter((d) => d >= c.firstDate));
  const byId = new Map(c.evidence.map((e) => [e.id, e]));
  const cap = new Map(c.rhythm.map((r) => [r.platform.toLowerCase(), r.perWeek]));
  for (const e of c.existing) {
    const k = e.platform.toLowerCase();
    if (cap.has(k)) cap.set(k, Math.max(0, (cap.get(k) ?? 0) - 1));
  }
  const used = new Map<string, number>();
  let testTaken = false;
  const out: PlannedPost[] = [];
  for (const p of raw) {
    const date = str(p.date, 10);
    const platform = str(p.platform, 40);
    const copy = str(p.copy);
    if (!dates.has(date) || !platform || !copy) continue;
    // A seasonal post rests on a moment the client's data checked, or it isn't planned.
    const reasonParts = cited(p, byId);
    if (!reasonParts.moment && str(p.reason_type) === "seasonal") {
      opts.dropped?.push({ date, platform, copy: firstLine(copy), why: "seasonal post without a checked moment" });
      continue;
    }
    const key = platform.toLowerCase();
    if (cap.size) {
      if (!cap.has(key)) continue;
      if ((used.get(key) ?? 0) >= (cap.get(key) ?? 0)) continue;
    }
    used.set(key, (used.get(key) ?? 0) + 1);
    const test = p.test === true && !testTaken;
    if (test) testTaken = true;
    const reason = buildReason({ type: typeFor(reasonParts.evidence), evidence: reasonParts.evidence, fit: reasonParts.fit, test });
    out.push({
      post_date: date,
      platform,
      format: isStoryFormat(str(p.format, 40)) ? "Single Image" : str(p.format, 40) || null,
      posting_time: str(p.posting_time, 10) || null,
      pillar: str(p.pillar, 120) || null,
      copy,
      hashtags: Array.isArray(p.hashtags) ? (p.hashtags as unknown[]).map((h) => str(h, 80)).filter(Boolean).slice(0, 12) : [],
      cta: str(p.cta, 300) || null,
      visual_direction: str(p.visual_direction, 600) || null,
      reasons: [reason],
      source: "plan",
    });
  }
  return out;
}

// ── The week's Stories ──────────────────────────────────────────────────────

/** A feed post a Story can be suggested with: on Instagram, and not a Story itself. */
const instagramFeedPost = (p: PlannedPost) => /instagram/i.test(p.platform) && !isStoryFormat(p.format);

/**
 * How many Stories the week gets, and the reason each says (Lital, 3 Nov 2026,
 * decision 3). A client whose own Instagram Stories Sprout shows over the last
 * 90 days follows its own weekly rate (storyRhythm). Every other Instagram
 * client gets one Story with each planned Instagram feed post. Facebook gets
 * none: Sprout reports no Facebook Story type, so a count would not come from
 * the client's data, and "Add a Story" is one press on any Facebook post.
 */
export function storyPlan(history: { stories: number; perWeek: number }, brand: string, posts: PlannedPost[]): { count: number; reason: Reason } {
  if (history.stories > 0) {
    return { count: history.perWeek, reason: { type: "story", label: `${brand} posted ${history.stories} Instagram ${history.stories === 1 ? "Story" : "Stories"} in the last 90 days.` } };
  }
  return { count: posts.filter(instagramFeedPost).length, reason: { type: "story", label: "One Story with each Instagram post." } };
}

/**
 * The week's posts with their Stories (Stories design, 2 Nov 2026): one Story
 * for each of the soonest planned Instagram posts, up to the week's count
 * (storyPlan). Each Story is dated with its post, carries its copy (the
 * message its frame is written from) and the reason that says where the
 * count came from, and names its post in story_of. No model call, and no
 * design until a person presses. With Stories, every row carries its id and
 * key: a bulk insert sends one set of columns, and a row without an id would
 * be sent with none.
 */
export function withStories(posts: PlannedPost[], count: number, reason: Reason, newId: () => string = () => crypto.randomUUID()): PlannedPost[] {
  const at = (p: PlannedPost) => postInstant(p.post_date, p.posting_time, "UTC")?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const chosen = new Set(posts.filter(instagramFeedPost).sort((a, b) => at(a) - at(b)).slice(0, Math.max(0, count)));
  if (!chosen.size) return posts;
  const keyed = (p: PlannedPost): PlannedPost => {
    const id = newId();
    return { ...p, id, post_key: `post:${id}` };
  };
  const out: PlannedPost[] = [];
  for (const p of posts) {
    const post = keyed(p);
    out.push(post);
    if (!chosen.has(p)) continue;
    out.push(keyed({
      post_date: p.post_date, platform: p.platform, format: STORY_FORMAT, posting_time: p.posting_time, pillar: p.pillar, copy: p.copy,
      hashtags: [], cta: p.cta, visual_direction: null, reasons: [reason], source: "plan", story_of: post.post_key,
    }));
  }
  return out;
}

// ── Revising a week ─────────────────────────────────────────────────────────

export interface RevisePost {
  id: string;
  date: string;
  platform: string;
  format: string | null;
  pillar: string | null;
  copy: string;
  reason: string;
}

export function revisePrompt(c: {
  brand: string;
  voiceBlock: string;
  note: string;
  scope: "untouched" | "empty";
  posts: RevisePost[];
  pillars: Array<{ name: string; description?: string }>;
  languages: string[];
  evidence: EvidenceItem[];
  others: Array<{ date: string; platform: string; copy: string }>;
  /** The client's content strategy; "" or absent for a client with none. */
  strategy?: string;
}): string {
  const writing = c.scope === "empty"
    ? "Write each of these posts, which have no copy yet. Keep its date, platform and format. Pick evidence for each and cite its ids."
    : "Rewrite each of these posts following the note. Keep its date, platform and format, and what it is about unless the note says otherwise.";
  return [
    `You write social media posts for ${c.brand}.`,
    c.voiceBlock,
    c.pillars.length ? ["Content pillars:", ...c.pillars.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`)].join("\n") : "",
    strategySection(c.strategy),
    c.languages.length ? `Write in: ${c.languages.join(", ")}.` : "",
    `The note: "${c.note}"`,
    writing,
    "Never invent facts: no names, titles, numbers, quotes, client results, launches or claims about people that aren't in the posts, the evidence, the pillars or the voice section.",
    c.posts.map((p) => `- [${p.id}] ${p.date} ${p.platform}${p.format ? ` ${p.format}` : ""}${p.pillar ? ` (pillar: ${p.pillar})` : ""}${p.copy ? `\n  Current copy: ${p.copy.replace(/\n+/g, " / ")}` : ""}${p.reason ? `\n  Why it's planned: ${p.reason}` : ""}`).join("\n"),
    c.evidence.length ? ["Evidence, by id:", ...c.evidence.map(evidenceLine)].join("\n") : "",
    c.others.length ? ["Other posts this week (don't repeat their topics):", ...c.others.map((p) => `- ${p.date} ${p.platform}: ${firstLine(p.copy)}`)].join("\n") : "",
    `Reply with JSON only: {"posts":[{"id":"...","pillar":"...","copy":"...","hashtags":["..."],"cta":"...","visual_direction":"..."${c.scope === "empty" ? ',"reason_type":"performance|competitor|trend|seasonal","evidence_ids":["..."],"fit":"..."' : ""}}]}`,
  ].filter(Boolean).join("\n\n");
}

export interface RevisedPost {
  id: string;
  copy: string;
  pillar: string | null;
  hashtags: string[];
  cta: string | null;
  visual_direction: string | null;
  reason?: Reason;
}

export function parseRevision(text: string, ids: string[], evidence: EvidenceItem[] = [], withReasons = false): RevisedPost[] {
  const data = jsonObject(text);
  const raw = Array.isArray(data?.posts) ? data!.posts as Array<Record<string, unknown>> : [];
  const known = new Set(ids);
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: RevisedPost[] = [];
  for (const p of raw) {
    const id = str(p.id, 80);
    const copy = str(p.copy);
    if (!known.has(id) || seen.has(id) || !copy) continue;
    seen.add(id);
    const parts = withReasons ? cited(p, byId) : null;
    out.push({
      id, copy,
      pillar: str(p.pillar, 120) || null,
      hashtags: Array.isArray(p.hashtags) ? (p.hashtags as unknown[]).map((h) => str(h, 80)).filter(Boolean).slice(0, 12) : [],
      cta: str(p.cta, 300) || null,
      visual_direction: str(p.visual_direction, 600) || null,
      ...(parts ? { reason: buildReason({ type: typeFor(parts.evidence), evidence: parts.evidence, fit: parts.fit }) } : {}),
    });
  }
  return out;
}
