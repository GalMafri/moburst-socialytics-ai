// supabase/functions/_shared/voice/voice.ts
//
// How a client writes, for every piece of code that writes its copy (weekly
// calendar, Lital 19 Oct 2026). Three sources, in this order of authority:
//   1. the team's stated preferences (brand_voice_learnings, active ones),
//      learned from copy edits and "Revise this week" notes;
//   2. the client's real social voice per platform (clients.social_voice),
//      learned from the posts it actually published;
//   3. the brief's tone line (clients.brand_identity.tone_of_voice).
// The memory stays short: a preference confirmed again gets stronger, one a
// newer signal contradicts is replaced, anything else is added.
// Free of Deno and network imports so it can be tested; load.ts reads and
// writes the database.

export const PATTERN_TYPES = ["tone", "length", "emoji_usage", "cta_style", "hashtag_preference", "vocabulary", "structure", "topics", "format", "other"] as const;
export type PatternType = typeof PATTERN_TYPES[number];

export interface Preference {
  id: string;
  pattern_type: string;
  pattern_description: string;
  times_confirmed: number;
  source: string;
  last_confirmed_at: string;
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
}

export interface ClientVoice {
  brand: string;
  preferences: Preference[];
  social: SocialVoice | null;
  briefTone: string | null;
}

/**
 * The voice section of a copy prompt. `platforms` narrows the social voice
 * and examples to the platforms the copy is for.
 */
export function voicePromptBlock(v: ClientVoice, opts: { platforms?: string[]; examples?: Record<string, VoiceExample[]> } = {}): string {
  const wanted = opts.platforms?.length ? new Set(opts.platforms.map((p) => p.toLowerCase())) : null;
  const keep = (platform: string) => !wanted || wanted.has(platform.toLowerCase());
  const lines: string[] = [`How ${v.brand} writes. When these disagree, the earlier one wins.`];

  lines.push("1. The team's stated preferences (always follow these):");
  if (v.preferences.length) {
    for (const p of v.preferences) lines.push(`- ${p.pattern_description}${p.times_confirmed > 1 ? ` (confirmed ${p.times_confirmed} times)` : ""}`);
  } else {
    lines.push("- None recorded yet.");
  }

  const platforms = Object.entries(v.social?.platforms ?? {}).filter(([k]) => keep(k));
  lines.push(`2. ${v.brand}'s real social voice, learned from its published posts${v.social ? ` (${v.social.post_count} posts, ${v.social.built_at.slice(0, 10)})` : ""}:`);
  if (platforms.length) {
    for (const [platform, pv] of platforms) {
      lines.push(`${platform}: ${pv.summary}`);
      const details: Array<[string, string]> = [["Openings", pv.opening], ["Length", pv.length], ["Structure", pv.structure], ["Emoji", pv.emoji], ["Hashtags", pv.hashtags], ["Calls to action", pv.cta], ["Person", pv.person], ["Formality", pv.formality]];
      for (const [label, text] of details) if (text) lines.push(`  - ${label}: ${text}`);
      if (pv.phrases?.length) lines.push(`  - Phrases it uses: ${pv.phrases.slice(0, 8).map((x) => `"${x}"`).join(", ")}`);
    }
  } else {
    lines.push("- Not learned yet (no published posts to learn from).");
  }

  lines.push(`3. The brief's tone: ${v.briefTone?.trim() || "not given"}`);

  const examples = Object.entries(opts.examples ?? v.social?.examples ?? {}).filter(([k, xs]) => keep(k) && xs.length);
  if (examples.length) {
    lines.push(`Examples of ${v.brand}'s best-performing recent posts (match their voice, never copy their wording):`);
    for (const [platform, xs] of examples) for (const x of xs) lines.push(`- ${platform}, ${x.date}: "${x.text}"`);
  }
  return lines.join("\n");
}

// ── Voice profile ───────────────────────────────────────────────────────────

export function voiceProfilePrompt(brand: string, byPlatform: Record<string, Array<{ text: string; date: string; format: string }>>): string {
  const sections = Object.entries(byPlatform).filter(([, xs]) => xs.length).map(([platform, xs]) => [
    `${platform} (${xs.length} posts):`,
    ...xs.map((x) => `- ${x.date} ${x.format}: "${x.text.replace(/\s+/g, " ").trim().slice(0, 700)}"`),
  ].join("\n"));
  return [
    `Below are posts ${brand} actually published on social media. Describe how ${brand} writes on each platform, so a writer can match it.`,
    "Describe only what the posts show. Where the posts disagree, describe the most common habit.",
    ...sections,
    "For each platform give:",
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
    `Reply with JSON only: {"platforms":{"${Object.keys(byPlatform)[0] ?? "Instagram"}":{"summary":"...","opening":"...","length":"...","structure":"...","emoji":"...","hashtags":"...","cta":"...","person":"...","formality":"...","phrases":["..."]}}}`,
  ].join("\n\n");
}

function jsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

const str = (x: unknown, n = 400) => (typeof x === "string" ? x.trim().slice(0, n) : "");

export function parseVoiceProfile(text: string, platforms: string[]): Record<string, PlatformVoice> {
  const data = jsonObject(text);
  const raw = (data?.platforms ?? {}) as Record<string, Record<string, unknown>>;
  const out: Record<string, PlatformVoice> = {};
  for (const platform of platforms) {
    const key = Object.keys(raw).find((k) => k.toLowerCase() === platform.toLowerCase());
    const p = key ? raw[key] : null;
    if (!p || !str(p.summary)) continue;
    out[platform] = {
      summary: str(p.summary), opening: str(p.opening), length: str(p.length), structure: str(p.structure), emoji: str(p.emoji),
      hashtags: str(p.hashtags), cta: str(p.cta), person: str(p.person), formality: str(p.formality),
      phrases: Array.isArray(p.phrases) ? (p.phrases as unknown[]).map((x) => str(x, 80)).filter(Boolean).slice(0, 8) : [],
    };
  }
  return out;
}

// ── The preference memory ───────────────────────────────────────────────────

export type MemorySignal =
  | { kind: "copy_edit"; before: string; after: string; platform?: string | null }
  | { kind: "revise_note"; note: string };

export type MergeOp =
  | { op: "confirm"; id: string }
  | { op: "replace"; id: string; pattern_type: PatternType; description: string }
  | { op: "add"; pattern_type: PatternType; description: string };

export function mergePrompt(brand: string, current: Preference[], signal: MemorySignal): string {
  const list = current.length
    ? current.map((p) => `- [${p.id}] (${p.pattern_type}) ${p.pattern_description}`).join("\n")
    : "- (none yet)";
  const what = signal.kind === "copy_edit"
    ? [`Someone on ${brand}'s side edited a post's copy${signal.platform ? ` for ${signal.platform}` : ""}.`, `Before:\n${signal.before.slice(0, 3000)}`, `After:\n${signal.after.slice(0, 3000)}`].join("\n\n")
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
    "At most 3 operations. Write each description as a plain instruction a writer can follow, for example \"No emoji on LinkedIn.\"",
    `pattern_type is one of: ${PATTERN_TYPES.join(", ")}.`,
    'Reply with JSON only: {"ops":[{"op":"confirm","id":"..."},{"op":"replace","id":"...","pattern_type":"tone","description":"..."},{"op":"add","pattern_type":"cta_style","description":"..."}]}',
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
    if (o.op === "confirm" && ids.has(String(o.id)) && !touched.has(String(o.id))) {
      touched.add(String(o.id));
      out.push({ op: "confirm", id: String(o.id) });
    } else if (o.op === "replace" && ids.has(String(o.id)) && !touched.has(String(o.id)) && description) {
      touched.add(String(o.id));
      out.push({ op: "replace", id: String(o.id), pattern_type: asType(o.pattern_type), description });
    } else if (o.op === "add" && description) {
      out.push({ op: "add", pattern_type: asType(o.pattern_type), description });
    }
  }
  return out;
}

/** One pass over preferences learned before the memory merged them, oldest first. */
export function consolidatePrompt(brand: string, oldestFirst: Preference[]): string {
  return [
    `These writing preferences for ${brand} were learned one at a time, oldest first, and never merged:`,
    oldestFirst.map((p) => `- [${p.id}] ${p.last_confirmed_at.slice(0, 10)} (${p.pattern_type}) ${p.pattern_description}`).join("\n"),
    "Merge them into a short, current list:",
    "- preferences that say the same thing become one, listing every id it came from;",
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
