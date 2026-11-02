// What the setup page says about a client's design references (design:
// docs/superpowers/specs/2026-11-02-design-refs-refresh-design.md, "What staff
// see on Client setup"): when its posts were last checked, when the look was
// learned and from how many posts, one line per platform for designs and for
// copy, and a new look when the client's posts show one. Plain sentences
// only; the numbers come from the design_refs step's result, the learned
// look and the voice profile. Pure, so it can be tested.

import { formatDate } from "@/lib/display";

/** A platform gets design rules of its own at this many posts (brand-references/corpus.ts). */
export const DESIGN_MIN_POSTS = 4;
/** A platform gets a copy voice of its own at this many posts (voice/voice.ts). */
export const COPY_MIN_POSTS = 5;

export interface RefsStep {
  status: "running" | "done" | "waiting" | "failed";
  done_at: string | null;
  attempted_at?: string | null;
  result?: Record<string, unknown> | null;
}

export interface PlatformLine {
  posts: number;
  newest: string | null;
  own_rules: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The step is reading the client's posts right now (a check, or reviews that go on a minute later). */
export function checking(step: RefsStep | null): boolean {
  return step?.status === "running" || (step?.status === "waiting" && obj(step.result).waiting_for === "in_progress");
}

/** "Checked for new posts Nov 2, 2026. Look learned Oct 28, 2026 from 11 posts." */
export function checkedLine(step: RefsStep | null, synthesis: unknown, references: number): string {
  if (!step) return "";
  if (checking(step)) return "Checking the client's posts for new designs.";
  const waitingFor = step.status === "waiting" ? String(obj(step.result).waiting_for ?? "") : "";
  if (waitingFor === "social_accounts") return "The client's posts are checked once its social accounts are connected.";
  const checkedAt = step.status === "failed" ? step.done_at : step.attempted_at ?? step.done_at;
  const s = obj(synthesis);
  const learnedAt = typeof s.synthesized_at === "string" ? formatDate(s.synthesized_at) : "";
  const from = typeof s.source_count === "number" ? s.source_count : references;
  const parts = [
    checkedAt ? `Checked for new posts ${formatDate(checkedAt)}.` : "",
    learnedAt ? `Look learned ${learnedAt} from ${plural(from, "post", "posts")}.` : "",
  ];
  if (waitingFor === "designed_posts") {
    parts.push(references
      ? "There are fewer than 3 new designed posts, so these references stay until there are more."
      : "The client has fewer than 3 designed posts so far. Its posts are checked again every week.");
  }
  return parts.filter(Boolean).join(" ");
}

/** "Instagram: 6 posts, newest Oct 27." and "LinkedIn: 2 posts. LinkedIn designs follow the Instagram look until there are 4." */
export function platformLines(platforms: Record<string, PlatformLine> | null | undefined): string[] {
  const entries = Object.entries(platforms ?? {});
  const lead = entries.filter(([, l]) => l.own_rules).sort((a, b) => b[1].posts - a[1].posts)[0]?.[0];
  const follows = (p: string) => `${p} designs follow the ${lead ? `${lead} look` : "brand's overall look"} until there are ${DESIGN_MIN_POSTS}.`;
  return entries.map(([p, l]) => {
    if (l.own_rules) return `${p}: ${plural(l.posts, "post", "posts")}${l.newest ? `, newest ${formatDate(l.newest, { year: false })}` : ""}.`;
    if (!l.posts) return `${p}: no designed posts yet. ${follows(p)}`;
    return `${p}: ${plural(l.posts, "post", "posts")}. ${follows(p)}`;
  });
}

/** "TikTok: 3 posts. TikTok copy follows the brand's overall voice until there are 5." */
export function copyLines(socialVoice: unknown): string[] {
  const v = obj(socialVoice);
  if (!v.overall) return [];
  return Object.entries(obj(v.thin)).filter(([, n]) => typeof n === "number" && n > 0)
    .map(([p, n]) => `${p}: ${plural(n as number, "post", "posts")}. ${p} copy follows the brand's overall voice until there are ${COPY_MIN_POSTS}.`);
}

/** "New look in posts since Oct 20, 2026: A coral and navy palette with a serif headline." */
export function lookLine(synthesis: unknown): string {
  const change = obj(obj(synthesis).look_change);
  if (typeof change.since !== "string" || !change.since) return "";
  const what = typeof change.what === "string" ? change.what.trim().replace(/\.+$/, "") : "";
  return `New look in posts since ${formatDate(change.since)}${what ? `: ${what}.` : "."}`;
}
