// supabase/functions/_shared/calendar/weekPlan.ts
//
// Writing one week of a client's calendar, and revising it from a note
// (weekly calendar, Lital 19 Oct 2026). The model plans posts and cites the
// evidence each one acts on by id; the numbers on a post's reason are filled
// in here from the evidence, so a reason never carries a figure the data
// does not have. At most one post a week is a test. Free of Deno and network
// imports so it can be tested.

import type { EvidenceItem, RhythmLine } from "./evidence.ts";

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
}

export type ReasonType = "performance" | "competitor" | "trend" | "seasonal" | "test";

export interface EvidenceRef {
  id: string;
  kind: EvidenceItem["kind"];
  text: string;
  platform?: string;
  company?: string;
  format?: string;
  date?: string;
  link?: string | null;
  metric?: string;
  value?: number;
  median?: number;
  multiple?: number;
  sample?: number;
  thin?: boolean;
  companies?: number;
}

export interface Reason {
  type: ReasonType;
  label: string;
  fit?: string;
  evidence?: EvidenceRef[];
  thin?: boolean;
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
    ["Posts for this week, per platform (this is how often the team actually publishes; follow it exactly):", ...rhythm].join("\n"),
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

export function fmtMultiple(m: number): string {
  return `${Number.isInteger(m) ? m : m.toFixed(1)}x`;
}

const FORMAT_WORDS: Record<string, string> = {
  photo: "image post", image: "image post", single_image: "image post", "single image": "image post", video: "video", reel: "reel", "reel/video": "reel",
  carousel: "carousel", album: "carousel", document: "document post", link: "link post", status: "text post", text: "text post", short: "short",
};

function formatWord(f?: string): string {
  const key = String(f || "").toLowerCase().trim();
  return FORMAT_WORDS[key] ?? (key && key !== "unknown" ? key : "post");
}

function shortDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * A report finding's headline. The report writes findings as "claim: evidence";
 * a short label before the colon (such as "TikTok") is not a claim, so the
 * first sentence is used instead.
 */
export function headline(text: string): string {
  const first = text.split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, "").trim();
  const [claim, rest] = [first.split(":")[0].trim(), first.includes(":")];
  return rest && claim.split(/\s+/).length >= 3 ? claim : first;
}

/**
 * The model's "why it fits", as a client reads it: its first sentence, kept
 * only when it names no evidence id and is short. Planner notes ("doesn't
 * repeat this week's topics") don't survive the first-sentence rule.
 */
export function clientFit(fit: string | undefined): string | undefined {
  const first = String(fit ?? "").replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  if (!first || /\b[PCTNR]\d{1,2}\b/.test(first) || first.length > 180) return undefined;
  return first;
}

/** The first sentence of a reason, from the first piece of evidence it cites. */
export function evidenceSentence(e: EvidenceRef): string {
  const when = shortDate(e.date);
  switch (e.kind) {
    case "own":
      return `Your ${e.platform} ${formatWord(e.format)}${when ? ` from ${when}` : ""} got ${fmtMultiple(e.multiple ?? 0)} your usual ${e.metric}`;
    case "competitor":
      return `${e.company}'s ${e.platform} ${formatWord(e.format)}${when ? ` from ${when}` : ""} got ${fmtMultiple(e.multiple ?? 0)} their usual ${e.metric}`;
    case "topic": {
      const topic = e.text.split(":")[0].trim();
      return e.companies && e.companies > 1 ? `${e.companies} competitors posted about ${topic} this week` : `Competitors posted about ${topic} this week`;
    }
    case "trend":
      return `Trend from the monthly report: ${headline(e.text)}`;
    case "report":
      return `From the monthly report: ${headline(e.text)}`;
  }
}

/** A post's reason: the evidence in words with its real numbers, then why it fits. */
export function buildReason(input: { type: ReasonType; evidence: EvidenceRef[]; fit?: string; moment?: string; test?: boolean }): Reason {
  const thin = input.evidence.some((e) => e.thin);
  const first = input.evidence[0];
  const base = first ? evidenceSentence(first) : input.moment?.trim() || (input.type === "seasonal" ? "A dated moment this week" : "Planned from the client's content pillars");
  const fit = clientFit(input.fit);
  const label = [
    input.test ? "Test: " : "",
    base.replace(/[.\s]+$/, ""),
    ".",
    fit ? ` ${fit.replace(/[.\s]+$/, "")}.` : "",
    thin ? " Early signal." : "",
  ].join("").slice(0, 400);
  return { type: input.test ? "test" : input.type, label, ...(fit ? { fit } : {}), ...(input.evidence.length ? { evidence: input.evidence } : {}), ...(thin ? { thin } : {}) };
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
