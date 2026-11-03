// supabase/functions/_shared/voice/voice.ts
//
// How a client writes, for every piece of code that writes its copy (weekly
// calendar, Lital 19 Oct 2026). Four sources, in this order of authority:
//   1. what the client told the team (client notes, 2 Nov 2026): the points
//      in use from its notes and files, and the team's standing notes
//      (clients.brand_notes); _shared/notes/notes.ts selects them;
//   2. the team's stated preferences (brand_voice_learnings, active ones),
//      learned from copy edits and "Revise this week" notes;
//   3. the client's real social voice per platform (clients.social_voice),
//      learned from the organic posts it actually published: a platform with
//      5 posts gets a voice of its own; one with fewer is written in the
//      brand's overall voice, learned from all its platforms, with its own
//      posts as examples (design: docs/superpowers/specs/2026-11-02-design-
//      refs-refresh-design.md);
//   4. the brief's tone line (clients.brand_identity.tone_of_voice).
// Between 1 and 2 the later date wins, so both carry dates. A client with
// nothing in 1 has the other three, numbered from 1.
// The memory stays short: a preference confirmed again gets stronger, one a
// newer signal contradicts is replaced, anything else is added. A preference
// may hold for one platform only; a writer sees the ones for every platform
// and its own platform's. Client notes never write to it.
// Free of Deno and network imports so it can be tested; load.ts reads and
// writes the database.

import { notesSectionLines, shortDate, type NotesVoice } from "../notes/notes.ts";
import { platformName } from "../calendar/evidence.ts";
import { CATEGORY_WORDS, type MomentCategory } from "../calendar/moments.ts";

export const PATTERN_TYPES = ["tone", "length", "emoji_usage", "cta_style", "hashtag_preference", "vocabulary", "structure", "topics", "format", "other"] as const;
export type PatternType = typeof PATTERN_TYPES[number];

export interface Preference {
  id: string;
  pattern_type: string;
  pattern_description: string;
  times_confirmed: number;
  source: string;
  last_confirmed_at: string;
  /** The platform it holds for; null or absent for every platform. */
  platform?: string | null;
}

export interface PlatformVoice {
  summary: string;
  opening: string;
  length: string;
  structure: string;
  emoji: string;
  hashtags: string;
  cta: string;
  person: string;
  formality: string;
  phrases: string[];
}

export interface VoiceExample {
  text: string;
  date: string;
  link: string | null;
  format: string;
}

export interface SocialVoice {
  built_at: string;
  post_count: number;
  platforms: Record<string, PlatformVoice>;
  examples: Record<string, VoiceExample[]>;
  /** How often the client published per platform when the profile was built (evidence.ts rhythmFromPosts). */
  rhythm?: Array<{ platform: string; perWeek: number; average: number }>;
  /** How the brand writes across all its platforms, for a platform with too few posts of its own. */
  overall?: PlatformVoice;
  /** Platforms with posts but fewer than COPY_MIN_POSTS, and how many they have. */
  thin?: Record<string, number>;
}

/** Posts on one platform before it gets a voice of its own (the calendar's thin line, evidence.ts MIN_SAMPLE). */
export const COPY_MIN_POSTS = 5;
/** The newest posts per platform a voice is learned from. */
export const VOICE_SAMPLE = 25;

export interface VoicePost { text: string; date: string; format: string; link: string | null }

/** The posts a voice is learned from: organic (no boosted post), with 20 characters of text or more, the newest 25 per platform. */
export function voiceSample(posts: Array<{ platform: string; text: string; publishedAt: string; format: string; link?: string | null; boosted?: boolean }>): Record<string, VoicePost[]> {
  const out: Record<string, VoicePost[]> = {};
  const usable = posts.filter((p) => !p.boosted && String(p.text || "").trim().length >= 20 && p.platform);
  for (const p of [...usable].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))) {
    const list = (out[p.platform] ??= []);
    if (list.length < VOICE_SAMPLE) list.push({ text: p.text, date: String(p.publishedAt).slice(0, 10), format: p.format, link: p.link ?? null });
  }
  return out;
}

/** Which platforms get a voice of their own, and the thin ones with how many posts they have. */
export function voicePlatforms(sample: Record<string, VoicePost[]>): { own: string[]; thin: Record<string, number> } {
  const own: string[] = [];
  const thin: Record<string, number> = {};
  for (const [platform, xs] of Object.entries(sample)) {
    if (xs.length >= COPY_MIN_POSTS) own.push(platform);
    else if (xs.length) thin[platform] = xs.length;
  }
  return { own, thin };
}

/** The thin platforms of a stored voice that now have COPY_MIN_POSTS: the profile is built again early for them. */
export function voiceReady(social: Pick<SocialVoice, "thin"> | null | undefined, posts: Parameters<typeof voiceSample>[0]): string[] {
  if (!social?.thin) return [];
  const sample = voiceSample(posts);
  return Object.keys(social.thin).filter((p) => (sample[p]?.length ?? 0) >= COPY_MIN_POSTS);
}

export interface ClientVoice {
  brand: string;
  preferences: Preference[];
  social: SocialVoice | null;
  briefTone: string | null;
  /** What the client told the team (loadClientVoice always sets it). */
  notes?: NotesVoice;
}

/**
 * The voice section of a copy prompt. `platforms` narrows what the client
 * told the team, the social voice and the examples to the platforms the copy
 * is for.
 */
export function voicePromptBlock(v: ClientVoice, opts: { platforms?: string[]; examples?: Record<string, VoiceExample[]> } = {}): string {
  const wanted = opts.platforms?.length ? new Set(opts.platforms.map((p) => p.toLowerCase())) : null;
  const keep = (platform: string) => !wanted || wanted.has(platform.toLowerCase());
  const told = v.notes ? notesSectionLines(v.notes, { platforms: opts.platforms }) : [];
  const today = v.notes?.today ?? new Date().toISOString().slice(0, 10);
  const lines: string[] = [told.length
    ? `How ${v.brand} writes. When these disagree, the earlier one wins, except between 1 and 2, where the later date wins.`
    : `How ${v.brand} writes. When these disagree, the earlier one wins.`];
  let n = 0;

  if (told.length) {
    lines.push(`${++n}. What ${v.brand} told the team. Follow these; use the facts, but never say they come from notes or meetings.`, ...told);
  }

  lines.push(`${++n}. The team's stated preferences, each with the date it was last confirmed (always follow these):`);
  // A preference for one platform reaches only that platform's writer.
  const preferences = v.preferences.filter((p) => !p.platform || keep(p.platform));
  if (preferences.length) {
    for (const p of preferences) lines.push(`- ${p.pattern_description} (${p.platform ? `${p.platform} only, ` : ""}${shortDate(p.last_confirmed_at, today)}${p.times_confirmed > 1 ? `, confirmed ${p.times_confirmed} times` : ""})`);
  } else {
    lines.push("- None recorded yet.");
  }

  const platforms = Object.entries(v.social?.platforms ?? {}).filter(([k]) => keep(k));
  // A platform with too few posts of its own, asked for (or, with none asked for, every thin one), borrows the overall voice.
  const ownNames = new Set(Object.keys(v.social?.platforms ?? {}).map((k) => k.toLowerCase()));
  const thinCount = (p: string) => Object.entries(v.social?.thin ?? {}).find(([k]) => k.toLowerCase() === p.toLowerCase())?.[1] ?? 0;
  const borrowing = v.social?.overall
    ? (opts.platforms?.length ? opts.platforms.filter((p) => !ownNames.has(p.toLowerCase())) : Object.keys(v.social.thin ?? {}))
    : [];
  const voiceLines = (pv: PlatformVoice) => {
    const details: Array<[string, string]> = [["Openings", pv.opening], ["Length", pv.length], ["Structure", pv.structure], ["Emoji", pv.emoji], ["Hashtags", pv.hashtags], ["Calls to action", pv.cta], ["Person", pv.person], ["Formality", pv.formality]];
    for (const [label, text] of details) if (text) lines.push(`  - ${label}: ${text}`);
    if (pv.phrases?.length) lines.push(`  - Phrases it uses: ${pv.phrases.slice(0, 8).map((x) => `"${x}"`).join(", ")}`);
  };
  lines.push(`${++n}. ${v.brand}'s real social voice, learned from its published posts${v.social ? ` (${v.social.post_count} posts, ${v.social.built_at.slice(0, 10)})` : ""}:`);
  if (platforms.length || borrowing.length) {
    for (const [platform, pv] of platforms) {
      lines.push(`${platform}: ${pv.summary}`);
      voiceLines(pv);
    }
    if (borrowing.length && v.social?.overall) {
      for (const p of borrowing) {
        const count = thinCount(p);
        lines.push(`${p}: ${count ? `${count} ${count === 1 ? "post" : "posts"}` : "no posts"} so far, too few for a voice of its own. Write it in ${v.brand}'s overall voice, learned from its other platforms:`);
      }
      lines.push(`Overall: ${v.social.overall.summary}`);
      voiceLines(v.social.overall);
    }
  } else {
    lines.push("- Not learned yet (no published posts to learn from).");
  }

  lines.push(`${++n}. The brief's tone: ${v.briefTone?.trim() || "not given"}`);

  // A platform borrowing the overall voice keeps its own posts as examples.
  const stored = v.social?.examples ?? {};
  const given = { ...(opts.examples ?? stored) };
  for (const p of borrowing) {
    const key = Object.keys(stored).find((k) => k.toLowerCase() === p.toLowerCase());
    if (key && !given[key]?.length) given[key] = stored[key];
  }
  const examples = Object.entries(given).filter(([k, xs]) => keep(k) && xs.length);
  if (examples.length) {
    lines.push(`Examples of ${v.brand}'s best-performing recent posts (match their voice, never copy their wording):`);
    for (const [platform, xs] of examples) for (const x of xs) lines.push(`- ${platform}, ${x.date}: "${x.text}"`);
  }
  return lines.join("\n");
}

// ── Voice profile ───────────────────────────────────────────────────────────

/**
 * The voice profile's instruction. `own` names the platforms with enough posts
 * for a voice of their own; when given, the reply also has "overall": how the
 * brand writes across every post below, for the platforms with too few.
 */
export function voiceProfilePrompt(brand: string, byPlatform: Record<string, Array<{ text: string; date: string; format: string }>>, own?: string[]): string {
  const sections = Object.entries(byPlatform).filter(([, xs]) => xs.length).map(([platform, xs]) => [
    `${platform} (${xs.length} posts):`,
    ...xs.map((x) => `- ${x.date} ${x.format}: "${x.text.replace(/\s+/g, " ").trim().slice(0, 700)}"`),
  ].join("\n"));
  const named = own ?? Object.keys(byPlatform);
  const fields = '"summary":"...","opening":"...","length":"...","structure":"...","emoji":"...","hashtags":"...","cta":"...","person":"...","formality":"...","phrases":["..."]';
  return [
    `Below are posts ${brand} actually published on social media. Describe how ${brand} writes on each platform, so a writer can match it.`,
    "Describe only what the posts show. Where the posts disagree, describe the most common habit.",
    ...sections,
    ...(own ? [
      named.length ? `Describe these platforms on their own: ${named.join(", ")}. The others have too few posts for a voice of their own.` : "No platform has enough posts for a voice of its own.",
      `Also describe "overall": how ${brand} writes across every post above, on all platforms together, for a platform with too few posts of its own.`,
    ] : []),
    own ? "For each platform you describe, and for overall, give:" : "For each platform give:",
    "- summary: one sentence on the overall voice",
    "- opening: how posts usually start",
    "- length: typical length (for example \"2 to 3 short sentences\")",
    "- structure: line breaks, lists, paragraphs",
    "- emoji: whether and how emoji are used",
    "- hashtags: how many and what kind, and where",
    "- cta: how posts ask the reader to act, if they do",
    "- person: \"we\", \"I\", \"you\", or third person",
    "- formality: how formal or casual",
    "- phrases: up to 8 words or phrases it repeats",
    own
      ? `Reply with JSON only: {"platforms":{${named.length ? `"${named[0]}":{${fields}}` : ""}},"overall":{${fields}}}`
      : `Reply with JSON only: {"platforms":{"${Object.keys(byPlatform)[0] ?? "Instagram"}":{${fields}}}}`,
  ].join("\n\n");
}

function jsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const str = (x: unknown, n = 400) => (typeof x === "string" ? x.trim().slice(0, n) : "");

function platformVoice(p: Record<string, unknown> | null | undefined): PlatformVoice | null {
  if (!p || !str(p.summary)) return null;
  return {
    summary: str(p.summary), opening: str(p.opening), length: str(p.length), structure: str(p.structure), emoji: str(p.emoji),
    hashtags: str(p.hashtags), cta: str(p.cta), person: str(p.person), formality: str(p.formality),
    phrases: Array.isArray(p.phrases) ? (p.phrases as unknown[]).map((x) => str(x, 80)).filter(Boolean).slice(0, 8) : [],
  };
}

export function parseVoiceProfile(text: string, platforms: string[]): Record<string, PlatformVoice> {
  const data = jsonObject(text);
  const raw = (data?.platforms ?? {}) as Record<string, Record<string, unknown>>;
  const out: Record<string, PlatformVoice> = {};
  for (const platform of platforms) {
    const key = Object.keys(raw).find((k) => k.toLowerCase() === platform.toLowerCase());
    const pv = platformVoice(key ? raw[key] : null);
    if (pv) out[platform] = pv;
  }
  return out;
}

/** The overall voice from the reply, or null. */
export function parseOverallVoice(text: string): PlatformVoice | null {
  const data = jsonObject(text);
  return platformVoice(data?.overall && typeof data.overall === "object" ? data.overall as Record<string, unknown> : null);
}

// ── The preference memory ───────────────────────────────────────────────────

export type MemorySignal =
  | { kind: "copy_edit"; before: string; after: string; platform?: string | null }
  | { kind: "revise_note"; note: string }
  /** A note left on a post's Regenerate (notes on regenerate, 3 Nov 2026), with the copy before and after the rewrite; story: the post is a Story's message. */
  | { kind: "rewrite_note"; note: string; before: string; after: string; platform?: string | null; story?: boolean }
  /** A person removed a planned seasonal post (calendar/runMoments.ts moment_feedback). */
  | { kind: "moment_removed"; moment: string; category: string | null; date: string | null };

/**
 * What one signal changed in the memory, for the line under a rewrite and its
 * Undo: a preference added, one replaced (by a new one, added: true, or by one
 * the memory already had), or one confirmed.
 */
export type LearnedChange =
  | { op: "add"; id: string; description: string; platform: string | null }
  | { op: "replace"; id: string; description: string; platform: string | null; added: boolean; replaced: { id: string; description: string } }
  | { op: "confirm"; id: string; description: string; platform: string | null };

/** A removed seasonal post, in words: which moment, and what a removal can teach. */
function momentRemovedText(brand: string, signal: Extract<MemorySignal, { kind: "moment_removed" }>): string {
  const kind = signal.category ? CATEGORY_WORDS[signal.category as MomentCategory] : null;
  return [
    `Someone on ${brand}'s side removed a planned post for ${signal.moment.slice(0, 200)}${signal.date ? ` (${signal.date})` : ""}${kind ? `, a ${kind}` : ""}.`,
    `A removal says which dated moments ${brand} does not want posts for. If it shows a kind of moment to skip, add or confirm a topics preference such as "Skip civic and political moments."; a single removal of an everyday moment may say nothing general.`,
  ].join("\n\n");
}

export type MergeOp =
  | { op: "confirm"; id: string }
  | { op: "replace"; id: string; pattern_type: PatternType; description: string; platform: string | null }
  | { op: "add"; pattern_type: PatternType; description: string; platform: string | null };

/** "(tone, LinkedIn only)": a preference's type, and its platform when it holds for one. */
const kindOf = (p: Preference) => `(${p.pattern_type}${p.platform ? `, ${p.platform} only` : ""})`;

export function mergePrompt(brand: string, current: Preference[], signal: MemorySignal): string {
  const list = current.length
    ? current.map((p) => `- [${p.id}] ${kindOf(p)} ${p.pattern_description}`).join("\n")
    : "- (none yet)";
  const what = signal.kind === "moment_removed" ? momentRemovedText(brand, signal) : signal.kind === "copy_edit"
    ? [`Someone on ${brand}'s side edited a post's copy${signal.platform ? ` for ${signal.platform}` : ""}.`, `Before:\n${signal.before.slice(0, 3000)}`, `After:\n${signal.after.slice(0, 3000)}`].join("\n\n")
    : signal.kind === "rewrite_note"
      ? [
          `Someone on ${brand}'s side asked for a post's copy${signal.platform ? ` for ${signal.platform}` : ""} to be rewritten with this note:\n"${signal.note.slice(0, 2000)}"`,
          `Before:\n${signal.before.slice(0, 3000)}`,
          `After (the rewrite that followed the note):\n${signal.after.slice(0, 3000)}`,
          "A note about this post's own topic, offer or date is a one-off: do nothing for that part.",
          ...(signal.story ? ["This was a Story's message: one or two short sentences seen full screen, with no hashtags. Its length and its lack of hashtags are how Stories are written, never a preference for every post."] : []),
        ].join("\n\n")
      : `Someone on ${brand}'s side asked for a week of posts to be rewritten with this note:\n"${signal.note.slice(0, 2000)}"`;
  return [
    `You keep ${brand}'s list of writing preferences short and current.`,
    `The current preferences:\n${list}`,
    what,
    "Decide what this tells us about how they want copy written, as general preferences (never about one post's topic unless the note says so).",
    "- If it says the same as a current preference: confirm it.",
    "- If it contradicts a current preference: replace that preference (the newer signal wins).",
    "- If it says something new: add it.",
    "- If it says nothing general (a typo fix, a one-off fact): do nothing.",
    "At most 3 operations. Write each description as a plain instruction a writer can follow, for example \"Keep posts under 3 lines.\"",
    "platform: the platform a preference holds for when it holds for one platform only (for example \"LinkedIn\"), else null. An edit to one platform's post is a preference for that platform only when it says so or the habit clearly belongs to that platform.",
    `pattern_type is one of: ${PATTERN_TYPES.join(", ")}.`,
    'Reply with JSON only: {"ops":[{"op":"confirm","id":"..."},{"op":"replace","id":"...","pattern_type":"tone","description":"...","platform":null},{"op":"add","pattern_type":"cta_style","description":"...","platform":"LinkedIn"}]}',
  ].join("\n\n");
}

const asType = (x: unknown): PatternType => (PATTERN_TYPES as readonly string[]).includes(String(x)) ? String(x) as PatternType : "other";

/** The model's operations, keeping only ones that refer to real preferences; at most one operation per preference. */
export function parseMergeOps(text: string, currentIds: string[]): MergeOp[] {
  const data = jsonObject(text);
  const raw = Array.isArray(data?.ops) ? data!.ops as Array<Record<string, unknown>> : [];
  const ids = new Set(currentIds);
  const touched = new Set<string>();
  const out: MergeOp[] = [];
  for (const o of raw) {
    if (out.length >= 3) break;
    const description = str(o.description, 300);
    const platform = typeof o.platform === "string" && o.platform.trim() ? platformName(o.platform) || null : null;
    if (o.op === "confirm" && ids.has(String(o.id)) && !touched.has(String(o.id))) {
      touched.add(String(o.id));
      out.push({ op: "confirm", id: String(o.id) });
    } else if (o.op === "replace" && ids.has(String(o.id)) && !touched.has(String(o.id)) && description) {
      touched.add(String(o.id));
      out.push({ op: "replace", id: String(o.id), pattern_type: asType(o.pattern_type), description, platform });
    } else if (o.op === "add" && description) {
      out.push({ op: "add", pattern_type: asType(o.pattern_type), description, platform });
    }
  }
  return out;
}

/** One pass over preferences learned before the memory merged them, oldest first. */
export function consolidatePrompt(brand: string, oldestFirst: Preference[]): string {
  return [
    `These writing preferences for ${brand} were learned one at a time, oldest first, and never merged:`,
    oldestFirst.map((p) => `- [${p.id}] ${p.last_confirmed_at.slice(0, 10)} ${kindOf(p)} ${p.pattern_description}`).join("\n"),
    "Merge them into a short, current list:",
    "- preferences that say the same thing become one, listing every id it came from; one for a single platform stays apart from the ones for every platform;",
    "- where two contradict, keep the newer one only;",
    "- write each as a plain instruction a writer can follow.",
    `pattern_type is one of: ${PATTERN_TYPES.join(", ")}.`,
    'Reply with JSON only: {"preferences":[{"pattern_type":"tone","description":"...","from":["id","id"]}]}',
  ].join("\n\n");
}

export function parseConsolidation(text: string, ids: string[]): Array<{ pattern_type: PatternType; description: string; from: string[] }> {
  const data = jsonObject(text);
  const raw = Array.isArray(data?.preferences) ? data!.preferences as Array<Record<string, unknown>> : [];
  const known = new Set(ids);
  return raw
    .map((p) => ({ pattern_type: asType(p.pattern_type), description: str(p.description, 300), from: Array.isArray(p.from) ? (p.from as unknown[]).map(String).filter((id) => known.has(id)) : [] }))
    .filter((p) => p.description && p.from.length);
}
