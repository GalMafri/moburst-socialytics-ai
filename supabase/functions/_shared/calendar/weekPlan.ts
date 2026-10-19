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
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function weekDates(monday: string): string[] {
  const base = Date.parse(`${monday}T00:00:00Z`);
  return WEEKDAYS.map((_, i) => new Date(base + i * 86400_000).toISOString().slice(0, 10));
}

const firstLine = (s: string) => String(s || "").split("\n")[0].replace(/\s+/g, " ").trim().slice(0, 120);

function evidenceLine(e: EvidenceItem): string {
  const where = [e.company, e.platform, e.format].filter(Boolean).join(" ");
  const numbers = e.multiple !== undefined ? `${fmtMultiple(e.multiple)} ${e.kind === "own" ? "the client's" : "their"} usual ${e.metric}` : "";
  const parts = [where, e.date, numbers, e.companies ? `${e.companies} companies` : "", e.thin ? "early signal" : ""].filter(Boolean).join(", ");
  return `${e.id} [${parts || e.kind}] ${e.text}`;
}

export function weekPrompt(c: WeekContext): string {
  const dates = weekDates(c.monday).filter((d) => d >= c.firstDate);
  const byKind = (k: EvidenceItem["kind"]) => c.evidence.filter((e) => e.kind === k);
  const section = (title: string, xs: EvidenceItem[]) => (xs.length ? [title, ...xs.map(evidenceLine)].join("\n") : "");
  const rhythm = c.rhythm.map((r) => `- ${r.platform}: ${r.perWeek} post${r.perWeek === 1 ? "" : "s"}${r.days.length ? `, usually ${r.days.slice(0, Math.max(r.perWeek, 2)).join(", ")}` : ""}${r.time ? ` around ${r.time}` : ""}`);
  return [
    `You plan one week of social media posts for ${c.brand}.`,
    c.voiceBlock,
    c.pillars.length ? ["Content pillars:", ...c.pillars.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`)].join("\n") : "",
    c.market.length ? `Market: ${c.market.join(", ")}.` : "",
    c.languages.length ? `Write in: ${c.languages.join(", ")}.` : "",
    rhythm.length ? ["Posts for this week, per platform (this is how often the team actually publishes; follow it exactly):", ...rhythm].join("\n") : "",
    `Dates you can use: ${dates.map((d) => `${WEEKDAYS[weekDates(c.monday).indexOf(d)]} ${d}`).join(", ")}.`,
    "Evidence, by id. Cite the ids each post acts on.",
    section(`${c.brand}'s own posts that beat its usual numbers:`, byKind("own")),
    section("Competitor posts that beat that competitor's usual numbers this week:", byKind("competitor")),
    section("Topics several competitors posted about this week:", byKind("topic")),
    section("Platform trends from the latest monthly report:", byKind("trend")),
    section("Findings from the latest monthly report:", byKind("report")),
    c.avoid.length ? [`${c.brand}'s posts that did worst (don't repeat what they did):`, ...c.avoid.map((a) => `- ${a}`)].join("\n") : "",
    c.competitiveBrief,
    c.thin.length ? ["Where the evidence is thin:", ...c.thin.map((t) => `- ${t}`)].join("\n") : "",
    c.existing.length ? ["Already on the calendar this week (keep them; don't repeat their topics, and count them toward the platform's posts):", ...c.existing.map((p) => `- ${p.date} ${p.platform}: ${firstLine(p.copy)}`)].join("\n") : "",
    c.recent.length ? ["Posts around this week (don't repeat their topics or openings):", ...c.recent.slice(0, 30).map((p) => `- ${p.date} ${p.platform}: ${firstLine(p.copy)}`)].join("\n") : "",
    "Rules:",
    [
      "- Every post acts on the evidence above: list the ids in evidence_ids. Use a competitor's post or topic only when it fits the client's pillars, audience and services, and say how in fit.",
      "- A holiday, awareness day or industry event that matters in the client's market this week can carry a post instead: reason_type \"seasonal\", the moment and its date in moment, and evidence_ids may be empty.",
      "- At most one post is a test: something the evidence hasn't proven for this client yet, such as a competitor format it hasn't tried. Mark it \"test\": true.",
      "- copy is the full caption, ready to publish, written the way the voice section says.",
      ...(c.canFilm ? [] : ["- Every post has to be one the team can make without filming: don't plan ideas that need a specific person on camera (a team member, the founder, a customer) or footage only the client could shoot (its office, events, products in use). Videos made from designed scenes, text and motion are fine."]),
      "- Never invent facts: no names, titles, numbers, quotes, client results, launches or claims about people that aren't in the evidence, the pillars or the voice section.",
      "- fit is ONE short sentence (under 20 words) written for the client on why this post suits them. Never mention evidence ids (like P1 or C2), numbers, other posts, or what the post avoids.",
    ].join("\n"),
    'Reply with JSON only: {"posts":[{"date":"YYYY-MM-DD","platform":"...","format":"...","posting_time":"HH:MM","pillar":"...","copy":"...","hashtags":["..."],"cta":"...","visual_direction":"one sentence on what the visual shows","reason_type":"performance|competitor|trend|seasonal","evidence_ids":["P1"],"fit":"...","moment":"","test":false}]}',
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

function typeFor(evidence: EvidenceRef[], declared: string): Exclude<ReasonType, "test"> {
  const kind = evidence[0]?.kind;
  if (kind === "own" || kind === "report") return "performance";
  if (kind === "competitor" || kind === "topic") return "competitor";
  if (kind === "trend") return "trend";
  return declared === "seasonal" ? "seasonal" : "performance";
}

const toRef = (e: EvidenceItem): EvidenceRef => ({ ...e });

/**
 * The week's posts from the planner's reply. Posts outside the usable dates,
 * without a platform or without copy are dropped; each platform keeps at most
 * the posts its rhythm allows; only the first test stays a test.
 */
export function parseWeekPlan(text: string, c: Pick<WeekContext, "monday" | "firstDate" | "rhythm" | "evidence" | "existing">): PlannedPost[] {
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
    const key = platform.toLowerCase();
    if (cap.size) {
      if (!cap.has(key)) continue;
      if ((used.get(key) ?? 0) >= (cap.get(key) ?? 0)) continue;
    }
    used.set(key, (used.get(key) ?? 0) + 1);
    const evidence = (Array.isArray(p.evidence_ids) ? p.evidence_ids : []).map((id) => byId.get(String(id))).filter((e): e is EvidenceItem => !!e).slice(0, 3).map(toRef);
    const test = p.test === true && !testTaken;
    if (test) testTaken = true;
    const reason = buildReason({ type: typeFor(evidence, str(p.reason_type)), evidence, fit: str(p.fit, 300), moment: str(p.moment, 200), test });
    out.push({
      post_date: date,
      platform,
      format: str(p.format, 40) || null,
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
}): string {
  const writing = c.scope === "empty"
    ? "Write each of these posts, which have no copy yet. Keep its date, platform and format. Pick evidence for each and cite its ids."
    : "Rewrite each of these posts following the note. Keep its date, platform and format, and what it is about unless the note says otherwise.";
  return [
    `You write social media posts for ${c.brand}.`,
    c.voiceBlock,
    c.pillars.length ? ["Content pillars:", ...c.pillars.map((p) => `- ${p.name}${p.description ? `: ${p.description}` : ""}`)].join("\n") : "",
    c.languages.length ? `Write in: ${c.languages.join(", ")}.` : "",
    `The note: "${c.note}"`,
    writing,
    "Never invent facts: no names, titles, numbers, quotes, client results, launches or claims about people that aren't in the posts, the evidence, the pillars or the voice section.",
    c.posts.map((p) => `- [${p.id}] ${p.date} ${p.platform}${p.format ? ` ${p.format}` : ""}${p.pillar ? ` (pillar: ${p.pillar})` : ""}${p.copy ? `\n  Current copy: ${p.copy.replace(/\n+/g, " / ")}` : ""}${p.reason ? `\n  Why it's planned: ${p.reason}` : ""}`).join("\n"),
    c.evidence.length ? ["Evidence, by id:", ...c.evidence.map(evidenceLine)].join("\n") : "",
    c.others.length ? ["Other posts this week (don't repeat their topics):", ...c.others.map((p) => `- ${p.date} ${p.platform}: ${firstLine(p.copy)}`)].join("\n") : "",
    `Reply with JSON only: {"posts":[{"id":"...","pillar":"...","copy":"...","hashtags":["..."],"cta":"...","visual_direction":"..."${c.scope === "empty" ? ',"reason_type":"performance|competitor|trend|seasonal","evidence_ids":["..."],"fit":"...","moment":""' : ""}}]}`,
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
    const refs = withReasons ? (Array.isArray(p.evidence_ids) ? p.evidence_ids : []).map((x) => byId.get(String(x))).filter((e): e is EvidenceItem => !!e).slice(0, 3).map(toRef) : [];
    out.push({
      id, copy,
      pillar: str(p.pillar, 120) || null,
      hashtags: Array.isArray(p.hashtags) ? (p.hashtags as unknown[]).map((h) => str(h, 80)).filter(Boolean).slice(0, 12) : [],
      cta: str(p.cta, 300) || null,
      visual_direction: str(p.visual_direction, 600) || null,
      ...(withReasons ? { reason: buildReason({ type: typeFor(refs, str(p.reason_type)), evidence: refs, fit: str(p.fit, 300), moment: str(p.moment, 200) }) } : {}),
    });
  }
  return out;
}
