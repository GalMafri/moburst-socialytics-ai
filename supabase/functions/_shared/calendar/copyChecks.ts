// supabase/functions/_shared/calendar/copyChecks.ts
//
// What a planned post's copy is checked against before it is saved (copy
// sources, 17 Nov 2026). An outside post (a competitor's, a trend's) tells
// the planner which subject is timely and nothing more: the planner no longer
// reads its caption (weekPlan.ts), and these checks are the backstop for what
// it writes. Each is exact, done in code:
//   * wording shared with an outside caption, or the name of who posted it;
//   * a list of video chapters ("0:00 Intro", "1:45 The checklist"): a planned
//     video has none yet. Clock times, time ranges and opening hours are
//     ordinary copy and are never refused;
//   * a link or a handle that is not the client's;
//   * a pointer to something to watch or read (refers_to) that the client's
//     own evidence does not show.
// A post that fails one is refused with the reason, never saved; the planner
// is asked once more for it (runWeek.ts), and a post refused twice is listed
// on the plan for staff. A fact retold in new words is not something code can
// see: that part rests on the rules the planner is given.
// Pure: no Deno and no network imports, so it can be tested.

import type { EvidenceItem, OutsideSource } from "./evidence.ts";

/** The version of the copy rules a plan was written under (calendar_plans.evidence.rules). */
export const COPY_RULE = 1;
/** A run of this many consecutive words shared with one outside caption refuses the post. */
export const SHARED_RUN_WORDS = 6;
/** This many distinct word trigrams shared with one outside caption refuses the post. */
export const SHARED_TRIGRAMS = 5;
/** An author name shorter than this is not searched for. */
export const AUTHOR_MIN_CHARS = 5;
/** A chapter list that does not start at 0:00 starts within this many seconds of it; a list of times that starts later is an agenda or opening hours. */
export const CHAPTER_START_MAX_SECONDS = 59;
/** Endings a bare domain is recognized by. */
export const LINK_TLDS = ["com", "net", "org", "io", "ai", "co", "app", "me", "ly", "gg", "tv", "us", "uk", "ca", "de", "il", "link", "bio", "shop", "store", "info", "biz", "dev", "xyz"];

/** What is the client's own, for the checks. */
export interface OwnFacts {
  /** The client's website host, lowercase, without www. */
  hosts: string[];
  /** The client's own handles, lowercase, without "@". */
  handles: string[];
  /** The client's own posts of the last 90 days and its notes, lowercase, joined. */
  text: string;
  /** The client has notes in use. */
  hasNotes: boolean;
  /**
   * What else of the client's own material the planner was given, by the word
   * refers_to may cite it with: "pillars", "strategy", "voice". "notes" is
   * said by hasNotes.
   */
  material?: string[];
}

export interface CopyCheck { outside: OutsideSource[]; own: OwnFacts }

/** A post the checks refused: what it was, and why. `ids` are the outside evidence ids a borrowed refusal names. */
export interface RefusedPost { id?: string; date: string; platform: string; copy: string; why: string; ids: string[]; kind: RefusalKind }

/** What a refusal is about, for the words a person reads (the reason itself names evidence ids, which a person never sees). */
export type RefusalKind = "borrowed" | "chapters" | "link" | "handle" | "pointer";

const LINK = /https?:\/\/\S+|(?<![\p{L}\p{N}])www\.\S+/giu;
const HANDLE = /(?<![\p{L}\p{N}._])@[\p{L}\p{N}_.]+/gu;
const HASHTAG = /#[\p{L}\p{N}_]+/gu;

/**
 * Text as the words two captions can share: lowercase, with links, @handles
 * and #hashtags removed, apostrophes removed, and every other character that
 * is not a letter or a digit read as a space.
 */
export function copyWords(text: string): string[] {
  return String(text ?? "").toLowerCase()
    .replace(LINK, " ").replace(HANDLE, " ").replace(HASHTAG, " ")
    .replace(/['\u2018\u2019\u02BC`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ").filter(Boolean);
}

const trigramsOf = (words: string[]): Set<string> => {
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
};

/** The same measure over words already split. */
function sharedWords(a: string[], b: string[]): { run: number; trigrams: number } {
  if (!a.length || !b.length) return { run: 0, trigrams: 0 };
  // The longest common run of consecutive words: one row of the table at a time.
  let run = 0;
  let prev = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    const row = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      row[j] = prev[j - 1] + 1;
      if (row[j] > run) run = row[j];
    }
    prev = row;
  }
  const theirs = trigramsOf(b);
  let trigrams = 0;
  for (const t of trigramsOf(a)) if (theirs.has(t)) trigrams++;
  return { run, trigrams };
}

/**
 * How much wording a copy shares with one caption: the longest run of
 * consecutive words both hold, and how many distinct word trigrams both hold.
 */
export function sharedWording(copy: string, source: string): { run: number; trigrams: number } {
  return sharedWords(copyWords(copy), copyWords(source));
}

/** The client's own text as words, and every run of SHARED_RUN_WORDS words in it: worked out once for an OwnFacts. */
const ownRuns = new WeakMap<OwnFacts, { words: string; runs: Set<string> }>();
function ownWording(own: OwnFacts): { words: string; runs: Set<string> } {
  const known = ownRuns.get(own);
  if (known) return known;
  const words = copyWords(own.text);
  const runs = new Set<string>();
  for (let i = 0; i + SHARED_RUN_WORDS <= words.length; i++) runs.add(words.slice(i, i + SHARED_RUN_WORDS).join(" "));
  const made = { words: ` ${words.join(" ")} `, runs };
  ownRuns.set(own, made);
  return made;
}

/**
 * The copy's words with the client's own wording set aside: a stretch of
 * SHARED_RUN_WORDS words or more that the client's own posts or notes already
 * carry (its usual call to action, its sign-off) is its own, whoever else
 * writes the same. Each such word is replaced by a mark no caption holds.
 */
function withoutOwnWording(words: string[], own: OwnFacts | undefined): string[] {
  if (!own?.text) return words;
  const { runs } = ownWording(own);
  if (!runs.size) return words;
  const out = [...words];
  for (let i = 0; i + SHARED_RUN_WORDS <= words.length; i++) {
    if (!runs.has(words.slice(i, i + SHARED_RUN_WORDS).join(" "))) continue;
    for (let k = i; k < i + SHARED_RUN_WORDS; k++) out[k] = `\u0000${k}`;
  }
  return out;
}

const POSSESSIVE = /['\u2018\u2019\u02BC]s(?![\p{L}\p{N}])/giu;

/**
 * The first outside post the copy borrows from, and how: its wording (a run
 * of SHARED_RUN_WORDS words, or SHARED_TRIGRAMS trigrams, shared with its
 * caption) or the name of who posted it, as whole words. With `own`, wording
 * the client's own posts or notes already carry is not counted, and neither
 * is a name they carry (the client's own name, a partner it names itself).
 */
export function borrowedFrom(copy: string, outside: OutsideSource[], own?: OwnFacts): { id: string; why: string } | null {
  const words = copyWords(copy);
  if (!words.length) return null;
  const compared = withoutOwnWording(words, own);
  // For a name, a possessive is the name: "Northwind's video" names Northwind.
  const spaced = ` ${copyWords(String(copy ?? "").replace(POSSESSIVE, "")).join(" ")} `;
  for (const s of outside) {
    const { run, trigrams } = sharedWords(compared, copyWords(s.text));
    if (run >= SHARED_RUN_WORDS || trigrams >= SHARED_TRIGRAMS) return { id: s.id, why: `shares wording with ${s.id}` };
    const author = copyWords(String(s.author ?? "").replace(/^@+/, "")).join(" ");
    if (author.length < AUTHOR_MIN_CHARS || !spaced.includes(` ${author} `)) continue;
    if (own && (own.handles.includes(author.replace(/ /g, "")) || ownWording(own).words.includes(` ${author} `))) continue;
    return { id: s.id, why: `names who posted ${s.id}` };
  }
  return null;
}

// A time as a video chapter or a clock writes it: 0:45, 12:30, 1:02:03.
const TIME = "(?<![\\d:])(\\d{1,2}:\\d{2}(?::\\d{2})?)(?![\\d:])";
// What makes a time a chapter mark: after it (an optional closing bracket, an optional separator) comes a label, a word
// that is not "am" or "pm" and does not carry a range on ("to", "until", "and").
const LABEL = "[)\\]]?\\s*[-:|\u2013\u2014]?\\s*(?!(?:a\\.?m|p\\.?m|to|till?|until|through|thru|and)\\b)\\p{L}";
const TIMED_LINE = new RegExp(`^\\s*[-*(\\[\u2013\u2014\u2022\u00B7\u25B6\u25BA\u27A4]*\\s*${TIME}${LABEL}`, "iu");
const TIMED = new RegExp(`${TIME}${LABEL}`, "giu");
// Before a zero time, what makes it a clock time and not the start of a video: "to 0:00", "at 0:00", "22:00-0:00", "(0:00)".
const CLOCK_BEFORE = /(?:\b(?:to|till?|until|through|thru|and|at|by|from|before|after|around|about|between)|[-(\u2013\u2014])\s*$/iu;

const seconds = (time: string) => time.split(":").map(Number).reduce((total, part) => total * 60 + part, 0);
const ascending = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]);

/**
 * Whether a text carries a list of video chapters. Exactly one of:
 *   (a) a line that starts with the zero time (0:00, 00:00, 0:00:00) and a label;
 *   (b) two or more lines that each start with a time and a label, in
 *       ascending order, the first within CHAPTER_START_MAX_SECONDS of zero;
 *   (c) on one line, the zero time with a label and at least one later time
 *       with a label, in ascending order, where the zero time is not written
 *       as a clock time (after "to", "at", "until", a dash or a bracket).
 * A label is a word after the time that is neither "am" nor "pm" nor a word
 * that carries a range on. So clock times, time ranges, opening hours and an
 * event's schedule are not chapters: "Happy hour 4:00-6:00, live music 8:30",
 * "Doors 6:30, show 7:00", "9:00 AM Registration", "Open 0:00 to 24:00".
 */
export function chapterList(text: string): boolean {
  const lines = String(text ?? "").split(/\r?\n/);
  const timed = lines.map((l) => TIMED_LINE.exec(l)?.[1]).filter((t): t is string => !!t).map(seconds);
  if (timed.includes(0)) return true;
  if (timed.length >= 2 && ascending(timed) && timed[0] <= CHAPTER_START_MAX_SECONDS) return true;
  for (const line of lines) {
    const marks = [...line.matchAll(TIMED)];
    const zero = marks.findIndex((m) => seconds(m[1]) === 0 && !CLOCK_BEFORE.test(line.slice(0, m.index)));
    if (zero < 0) continue;
    const after = marks.slice(zero + 1).map((m) => seconds(m[1]));
    if (after.length && ascending([0, ...after])) return true;
  }
  return false;
}

const hostOf = (link: string) => link.toLowerCase().replace(/^https?:\/\//, "").replace(/^[^/@\s]*@/, "").replace(/^www\./, "").split(/[/?#:]/)[0].replace(/[^a-z0-9]+$/, "");
const BARE_DOMAIN = new RegExp(`(?<![\\p{L}\\p{N}@._-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${LINK_TLDS.join("|")})(?![\\p{L}\\p{N}-])`, "giu");

/**
 * The hosts a text links to that are not the client's: links with a scheme
 * or www, and bare domains ending in one of LINK_TLDS, leaving out the
 * client's own host (and its subdomains) and any host its own posts or notes
 * show.
 */
export function foreignLinks(text: string, own: OwnFacts): string[] {
  const t = String(text ?? "");
  const hosts = new Set<string>();
  for (const m of t.match(LINK) ?? []) hosts.add(hostOf(m));
  for (const m of t.replace(LINK, " ").match(BARE_DOMAIN) ?? []) hosts.add(hostOf(m));
  const mine = own.hosts.map((h) => h.toLowerCase().replace(/^www\./, "")).filter(Boolean);
  return [...hosts].filter((h) => h && !mine.some((m) => h === m || h.endsWith(`.${m}`)) && !own.text.includes(h));
}

const MENTION = /(?<![\p{L}\p{N}._])@([A-Za-z0-9_.]{3,})/gu;

/** The @handles in a text that are not the client's: not one of its own, and not one its own posts or notes show. An email address is not a handle. */
export function foreignHandles(text: string, own: OwnFacts): string[] {
  const out = new Set<string>();
  for (const m of String(text ?? "").matchAll(MENTION)) {
    const handle = m[1].toLowerCase().replace(/\.+$/, "");
    if (!handle || own.handles.includes(handle) || own.text.includes(`@${handle}`)) continue;
    out.add(handle);
  }
  return [...out];
}

/**
 * What is wrong with a post's refers_to, or null. Null or absent is fine.
 * One that names what the reader is sent to ("what") has to cite the client's
 * own material that shows it: a P or R id, "notes" for a client that has
 * notes in use, or one of the other parts of its own material the planner
 * was given (own.material: "pillars", "strategy", "voice").
 */
export function refersToProblem(refersTo: unknown, evidence: EvidenceItem[], own: OwnFacts): string | null {
  if (!refersTo || typeof refersTo !== "object") return null;
  const r = refersTo as { what?: unknown; evidence_id?: unknown };
  if (typeof r.what !== "string" || !r.what.trim()) return null;
  const id = typeof r.evidence_id === "string" ? r.evidence_id.trim() : "";
  if (id.toLowerCase() === "notes" && own.hasNotes) return null;
  if ((own.material ?? []).includes(id.toLowerCase())) return null;
  if (evidence.some((e) => e.id === id && (e.kind === "own" || e.kind === "report"))) return null;
  return "points to something the client's evidence does not show";
}

/**
 * The first reason a post's copy is refused, or null. Checked in order: wording
 * or a name borrowed from any outside post of the week (cited or not), a list
 * of video chapters, a link that is not the client's, a handle that is not the client's,
 * refers_to. `ids` are the outside evidence ids a borrowed refusal names.
 */
export function checkCopy(i: { copy: string; cta?: string | null; refersTo?: unknown; evidence: EvidenceItem[]; check: CopyCheck }): { why: string; ids: string[]; kind: RefusalKind } | null {
  const text = [i.copy, i.cta ?? ""].filter(Boolean).join("\n");
  const borrowed = borrowedFrom(text, i.check.outside, i.check.own);
  if (borrowed) return { why: borrowed.why, ids: [borrowed.id], kind: "borrowed" };
  if (chapterList(text)) return { why: "lists video chapter times", ids: [], kind: "chapters" };
  const links = foreignLinks(text, i.check.own);
  if (links.length) return { why: `links to ${links[0]}, which is not the client's`, ids: [], kind: "link" };
  const handles = foreignHandles(text, i.check.own);
  if (handles.length) return { why: `names @${handles[0]}, which is not the client's`, ids: [], kind: "handle" };
  const pointer = refersToProblem(i.refersTo, i.evidence, i.check.own);
  return pointer ? { why: pointer, ids: [], kind: "pointer" } : null;
}

const firstReasonEvidence = (reasons: unknown): Array<Record<string, unknown>> => {
  const first = Array.isArray(reasons) ? reasons[0] as { evidence?: unknown } | null | undefined : null;
  return Array.isArray(first?.evidence) ? (first!.evidence as unknown[]).filter((e): e is Record<string, unknown> => !!e && typeof e === "object") : [];
};

/** The outside posts a stored reason cites (reasons[0].evidence): its trend and competitor refs, with the excerpt and the company they were stored with. */
export function outsideFromReasons(reasons: unknown): OutsideSource[] {
  return firstReasonEvidence(reasons)
    .filter((e) => e.kind === "trend" || e.kind === "competitor")
    .map((e) => ({ id: String(e.id ?? ""), kind: e.kind as OutsideSource["kind"], author: typeof e.company === "string" ? e.company : "", text: typeof e.text === "string" ? e.text : "" }));
}

/** A stored reason cites an outside post: a trend, a competitor post or a competitor topic. */
export function citesOutside(reasons: unknown): boolean {
  return firstReasonEvidence(reasons).some((e) => e.kind === "trend" || e.kind === "competitor" || e.kind === "topic");
}
