// The week's themes (spec section 5): one Claude call per client per week
// groups the kept posts from every platform into 3 to 6 themes. Themes are
// what people see first; the posts are the evidence behind them.

import { parseAnswer } from "../pipelines/competitive/analysis.ts";
import type { FilterProfile } from "./filter.ts";
import { fenced, POSTS_ARE_DATA, withoutDashes } from "./text.ts";
import type { KeptPost, Theme, TrendPlatform } from "./types.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

export const TREND_THEMES_MODEL = "claude-opus-5-5";
/** Below this many kept posts a week has no themes, and no call is made. */
export const THEMES_MIN_KEPT = 3;
const MIN_THEMES = 3;
const MAX_THEMES = 6;
const TEXT_CHARS = 400;

export function themesWanted(kept: KeptPost[]): boolean {
  return kept.length >= THEMES_MIN_KEPT;
}

const THEMES_SYSTEM = `You find the themes in a week of social posts from a brand's industry landscape. Moburst, a marketing agency, manages the brand's social media, and the team plans the brand's posts from these themes.
Group the posts into 3 to 6 themes. A theme is something several creators are doing or talking about, not one post. Each theme has a short title, what is happening, why it matters for this brand, the angle the brand could take, and the posts that show it (by id, at least one each).
Write in plain American English. Never use an em dash or an en dash: use a comma, a colon or a new sentence.
${POSTS_ARE_DATA}
Answer with one JSON object and nothing else.`;

/** The Messages API request for the week's themes. Kept posts are numbered K1, K2, ... in the order given. */
export function themesRequest(profile: Pick<FilterProfile, "audience" | "fit_rubric">, kept: KeptPost[]): Record<string, unknown> {
  const posts = kept.map((p, i) => [
    `<post id="K${i + 1}">`,
    `${p.platform} | ${p.format} | fit ${p.fit} | by ${fenced(p.author, 80) || "unknown"}`,
    `Why it matters: ${fenced(p.why, 300)}`,
    `Lesson: ${fenced(p.lesson, 300)}`,
    fenced(p.text, TEXT_CHARS),
    "</post>",
  ].join("\n")).join("\n\n");
  const content = [
    `Who the brand speaks to: ${profile.audience}`,
    `What fits: ${profile.fit_rubric}`,
    `\nThis week's kept posts:\n\n${posts}`,
    `\nAnswer in this shape:\n{"themes": [{"title": "...", "happening": "...", "why_it_matters": "...", "angle": "...", "post_ids": ["K1", "K4"]}]}`,
  ].join("\n");
  return { model: TREND_THEMES_MODEL, max_tokens: 6000, system: THEMES_SYSTEM, messages: [{ role: "user", content }] };
}

/** A theme field as stored: trimmed, with no em or en dash (people and clients read it on the report and its deck). */
const text = (v: unknown): string => (typeof v === "string" ? withoutDashes(v.trim()) : "");

/** The themes in an answer, with posts named by link and platforms taken from those posts; or what is wrong. */
export function parseThemes(answerText: string, kept: KeptPost[]): { value: Theme[] } | { error: string } {
  const parsed = parseAnswer(answerText);
  if ("error" in parsed) return parsed;
  const list = parsed.value?.themes;
  if (!Array.isArray(list)) return { error: "The answer has no themes list." };
  if (list.length < MIN_THEMES || list.length > MAX_THEMES) return { error: `There must be 3 to 6 themes; there are ${list.length}.` };
  const problems: string[] = [];
  const themes: Theme[] = list.map((t: Any) => {
    const ids: string[] = Array.isArray(t?.post_ids) ? t.post_ids.map((x: unknown) => text(x)) : [];
    const posts = ids.map((id) => kept[Number(id.replace(/^K/, "")) - 1]);
    if (!ids.length || posts.some((p, i) => !p || !/^K\d+$/.test(ids[i]))) problems.push(`The theme "${text(t?.title)}" names posts that were not kept: ${ids.join(", ") || "none"}.`);
    if (!text(t?.title) || !text(t?.happening) || !text(t?.why_it_matters) || !text(t?.angle)) problems.push(`A theme is missing its title, what is happening, why it matters or the angle.`);
    const found = posts.filter(Boolean) as KeptPost[];
    return {
      title: text(t?.title), happening: text(t?.happening), why_it_matters: text(t?.why_it_matters), angle: text(t?.angle),
      platforms: [...new Set(found.map((p) => p.platform))] as TrendPlatform[], post_urls: found.map((p) => p.url),
    };
  });
  return problems.length ? { error: problems.join(" ") } : { value: themes };
}
