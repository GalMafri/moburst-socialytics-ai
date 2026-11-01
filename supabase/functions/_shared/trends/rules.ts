// The rules in code that run before Claude reads anything (spec section 4,
// step 1). They are cheap and only cut what is plainly out: duplicates, posts
// outside the week, posts in another language, the client's own and its
// tracked competitors' posts, and anything past the 60 most engaged per
// platform. Every cut keeps its reason, so each decision can be checked.

import { SPAM_SIGNALS } from "../pipelines/social/nodes.ts";
import type { RuleDrop, TrendPlatform, TrendPost } from "./types.ts";

/** At most this many candidates per platform reach Claude's filter. */
export const CANDIDATES_PER_PLATFORM = 60;
/** Fewer letters than this is too little to tell a post's script; Claude judges it. */
const LANGUAGE_MIN_LETTERS = 10;

/** The languages written in their own script. Every other language code is read as Latin script. */
const SCRIPTS: Record<string, RegExp> = {
  he: /\p{Script=Hebrew}/u, ar: /\p{Script=Arabic}/u, ru: /\p{Script=Cyrillic}/u, uk: /\p{Script=Cyrillic}/u, hi: /\p{Script=Devanagari}/u,
  th: /\p{Script=Thai}/u, ja: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u, ko: /\p{Script=Hangul}/u, zh: /\p{Script=Han}/u, el: /\p{Script=Greek}/u,
};

/**
 * The post is written in a script one of the client's languages uses. Only a
 * plain script mismatch is cut here (Hindi for an English client); a Latin
 * post in another language goes on to Claude, which judges the audience. The
 * n8n rule this replaces asked for two common English words and dropped short
 * English captions and hashtag-heavy posts (1 Nov 2026 trial).
 */
export function inClientScript(text: string, languages: string[]): boolean {
  let latin = 0;
  let scripted = 0;
  const own: Record<string, number> = {};
  for (const ch of text) {
    if (!/\p{L}/u.test(ch) || /\p{Script=Common}/u.test(ch)) continue;
    scripted++;
    if (/\p{Script=Latin}/u.test(ch)) latin++;
    for (const [lang, re] of Object.entries(SCRIPTS)) if (re.test(ch)) own[lang] = (own[lang] ?? 0) + 1;
  }
  if (scripted < LANGUAGE_MIN_LETTERS) return true;
  return (languages.length ? languages : ["en"]).some((lang) => (SCRIPTS[lang] ? (own[lang] ?? 0) / scripted >= 0.3 : latin / scripted >= 0.5));
}

export interface RuleOptions {
  /** The week collected, as ISO times. */
  windowStart: string;
  windowEnd: string;
  languages: string[];
  ownHandles: string[];
  ownNames: string[];
  competitorHandles: string[];
  competitorNames: string[];
  capPerPlatform?: number;
}

const squash = (s: string): string => s.toLowerCase().replace(/[^\p{L}0-9]+/gu, "");

/** Query parameters that only track a share; the rest (YouTube's v=, Facebook's story_fbid=) name the post. */
const TRACKING = /^(utm_.*|fbclid|igshid|igsh|si|feature|ref|ref_src|mibextid)$/i;

/** One key per post: host without www, the path, and the parameters that name the post, in order. */
function urlKey(url: string): string {
  try {
    const u = new URL(url.trim());
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
    return `${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${query}`;
  } catch {
    return url.trim().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

/** The handle in a post's link, as on tiktok.com/@handle or instagram.com/handle. */
function handleInUrl(url: string): string {
  const at = url.match(/\/@([^/?#]+)/);
  return at ? squash(at[1]) : "";
}

export function ruleFilter(posts: TrendPost[], o: RuleOptions): { candidates: TrendPost[]; dropped: Array<{ post: TrendPost; reason: RuleDrop }> } {
  const dropped: Array<{ post: TrendPost; reason: RuleDrop }> = [];
  const start = Date.parse(o.windowStart);
  const end = Date.parse(o.windowEnd);
  const ours = new Set([...o.ownHandles, ...o.ownNames, ...o.competitorHandles, ...o.competitorNames].map(squash).filter(Boolean));
  const seen = new Set<string>();
  const kept: TrendPost[] = [];

  for (const p of posts) {
    const key = urlKey(p.url);
    if (seen.has(key)) {
      dropped.push({ post: p, reason: "duplicate" });
      continue;
    }
    seen.add(key);
    if (p.posted_at) {
      const at = Date.parse(p.posted_at);
      if (!Number.isNaN(at) && (at < start || at > end)) {
        dropped.push({ post: p, reason: "outside_window" });
        continue;
      }
    }
    if (!inClientScript(p.text, o.languages)) {
      dropped.push({ post: p, reason: "language" });
      continue;
    }
    if (ours.has(squash(p.author)) || (handleInUrl(p.url) && ours.has(handleInUrl(p.url)))) {
      dropped.push({ post: p, reason: "own_or_competitor" });
      continue;
    }
    kept.push(p);
  }

  const cap = o.capPerPlatform ?? CANDIDATES_PER_PLATFORM;
  const byPlatform = new Map<TrendPlatform, TrendPost[]>();
  for (const p of kept) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p]);
  const candidates: TrendPost[] = [];
  for (const list of byPlatform.values()) {
    const ranked = [...list].sort((a, b) => b.engagement - a.engagement);
    candidates.push(...ranked.slice(0, cap));
    for (const p of ranked.slice(cap)) dropped.push({ post: p, reason: "over_cap" });
  }
  return { candidates, dropped };
}

const JUNK = [
  ...SPAM_SIGNALS,
  /\b(we('|’)?re hiring|now hiring|hiring now|job opening|apply now|vacanc(y|ies)|join our team)\b/i,
  /\b(giveaway|give away|enter to win|win a free|sorteo)\b/i,
  /\b(side hustle|passive income|make money online|made [£$€]?\d[\d,]* online|earn [£$€]\d)/i,
];

/**
 * A kept post that reads like a job ad, a giveaway or a money scheme. It is
 * a check on Claude's filter, counted every week; it never drops a post.
 */
export function tripwire(text: string): boolean {
  return JUNK.some((re) => re.test(text));
}
