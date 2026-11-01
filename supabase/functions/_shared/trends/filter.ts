// Claude's brand-fit filter (spec section 4, step 2). Every candidate the
// rules let through is kept or dropped with a reason, judged against the
// client's trend profile and exclusions. A kept post carries a fit score, why
// it matters for the brand, its format and the lesson to borrow.

import { parseAnswer } from "../pipelines/competitive/analysis.ts";
import { fenced, POSTS_ARE_DATA } from "./text.ts";
import { DROP_REASONS, TREND_FORMATS, type DropReason, type KeptPost, type Term, type TrendFormat, type TrendPost } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export const TREND_FILTER_MODEL = "claude-sonnet-5-5";
/** The lowest fit a kept post may have; set from the trial. */
export const MIN_FIT = 60;
export const KEPT_PER_PLATFORM = 10;
const TEXT_CHARS = 500;
const MAX_TOKENS = 32000;

/** The parts of the profile the filter reads. */
export interface FilterProfile {
  audience: string;
  fit_rubric: string;
  topics: Term[];
  /** The brand's name and its direct competitors, so own and competitor posts can be dropped. */
  brand?: string;
  competitors?: string[];
}

const FILTER_SYSTEM = `You filter social posts for a brand whose social media Moburst, a marketing agency, manages. The posts were found by searching the brand's industry landscape; the brand's team will learn from the ones you keep.
Judge every post against the brand's trend profile. Keep a post only when this brand would want to learn from it: on topic for its industry, made for an audience like the brand's, and of real quality. Drop everything else with one reason:
- off_topic: not about the brand's industry
- scheme_or_spam: money-making schemes, side hustles, fake reviews, bots, engagement bait
- job_ad: hiring posts and job openings
- giveaway: contests and giveaways
- wrong_audience: on topic but made for an audience the brand doesn't speak to
- own_or_competitor: the brand's own post or a direct competitor's
- low_quality: too thin to learn from
For each kept post give a fit score from 0 to 100, one line on why it matters for the brand, its format (short_video, long_video, carousel, image, text or pin) and the lesson to borrow: the hook, the angle or the format.
${POSTS_ARE_DATA}
Answer with one JSON object and nothing else.`;

/** The Messages API request that judges every candidate. Candidates are numbered P1, P2, ... in the order given. */
export function filterRequest(profile: FilterProfile, exclusions: Term[], candidates: TrendPost[]): Record<string, unknown> {
  const posts = candidates.map((p, i) => [
    `<post id="P${i + 1}">`,
    `${p.platform} | by ${fenced(p.author, 80) || "unknown"}${p.posted_at ? ` | ${p.posted_at.slice(0, 10)}` : ""}`,
    `views ${p.views}, likes ${p.likes}, comments ${p.comments}, shares ${p.shares}, saves ${p.saves}`,
    fenced(p.text, TEXT_CHARS) || "(no text)",
    "</post>",
  ].join("\n")).join("\n\n");
  const content = [
    ...(profile.brand ? [`The brand: ${profile.brand}${profile.competitors?.length ? `. Its direct competitors: ${profile.competitors.join(", ")}` : ""}. Drop their own posts as own_or_competitor.`] : []),
    `Who the brand speaks to: ${profile.audience}`,
    `What fits: ${profile.fit_rubric}`,
    `Topics the brand tracks: ${profile.topics.map((t) => t.term).join(", ") || "none"}`,
    `Never keep posts like these: ${exclusions.map((x) => `${x.term}${x.reason ? ` (${x.reason})` : ""}`).join("; ") || "none listed"}`,
    `\nThe posts:\n\n${posts}`,
    `\nAnswer with a decision for every post, in this shape:\n{"decisions": [{"id": "P1", "keep": true, "fit": 82, "why": "...", "format": "short_video", "lesson": "..."}, {"id": "P2", "keep": false, "reason": "job_ad"}]}`,
  ].join("\n");
  return { model: TREND_FILTER_MODEL, max_tokens: MAX_TOKENS, system: FILTER_SYSTEM, messages: [{ role: "user", content }] };
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** What in an answer is wrong; empty when every candidate has one valid decision. */
export function filterProblems(answer: Any, candidates: TrendPost[]): string[] {
  const decisions = answer?.decisions;
  if (!Array.isArray(decisions)) return ["The answer has no decisions list."];
  const out: string[] = [];
  const seen = new Set<string>();
  const unknown: string[] = [];
  for (const d of decisions) {
    const id = text(d?.id);
    const i = Number(id.replace(/^P/, "")) - 1;
    if (!/^P\d+$/.test(id) || !candidates[i]) {
      unknown.push(id || "(blank)");
      continue;
    }
    if (seen.has(id)) {
      out.push(`${id} has two decisions.`);
      continue;
    }
    seen.add(id);
    if (d.keep === true) {
      const fit = Number(d.fit);
      if (!Number.isInteger(fit) || fit < 0 || fit > 100) out.push(`${id} has a fit of ${d.fit}; it must be a whole number from 0 to 100.`);
      else if (!text(d.why) || !text(d.lesson) || !TREND_FORMATS.includes(d.format)) out.push(`${id} is kept without a why, a lesson or a known format.`);
    } else if (!DROP_REASONS.includes(d?.reason)) {
      out.push(`${id} is dropped with "${d?.reason}", which is not one of the reasons.`);
    }
  }
  if (unknown.length) out.push(`These ids are not posts in the list: ${unknown.join(", ")}.`);
  const missing = candidates.map((_, i) => `P${i + 1}`).filter((id) => !seen.has(id));
  if (missing.length) out.push(`These posts have no decision: ${missing.join(", ")}.`);
  return out;
}

/** The kept and dropped posts in an answer, or what is wrong with it. */
export function parseFilter(answerText: string, candidates: TrendPost[]): { value: { kept: KeptPost[]; dropped: Array<{ post: TrendPost; reason: DropReason }> } } | { error: string } {
  const parsed = parseAnswer(answerText);
  if ("error" in parsed) return parsed;
  const problems = filterProblems(parsed.value, candidates);
  if (problems.length) return { error: problems.join(" ") };
  const kept: KeptPost[] = [];
  const dropped: Array<{ post: TrendPost; reason: DropReason }> = [];
  for (const d of parsed.value.decisions as Any[]) {
    const p = candidates[Number(String(d.id).slice(1)) - 1];
    if (d.keep === true) kept.push({ ...p, fit: Number(d.fit), why: text(d.why), format: d.format as TrendFormat, lesson: text(d.lesson) });
    else dropped.push({ post: p, reason: d.reason as DropReason });
  }
  return { value: { kept, dropped } };
}

/** The posts the week keeps: at most 10 per platform at or above the minimum fit, best fit first, then most engaged. */
export function pickKept(kept: KeptPost[], o: { perPlatform?: number; minFit?: number } = {}): KeptPost[] {
  const per = o.perPlatform ?? KEPT_PER_PLATFORM;
  const min = o.minFit ?? MIN_FIT;
  const byPlatform = new Map<string, KeptPost[]>();
  for (const p of kept) if (p.fit >= min) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p]);
  return [...byPlatform.values()].flatMap((list) => [...list].sort((a, b) => b.fit - a.fit || b.engagement - a.engagement).slice(0, per));
}
