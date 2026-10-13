// A suggested test as the team left it: the report's suggestion with any
// staff edit applied (competitive_insight_feedback.edited). The row stays
// keyed by the ORIGINAL suggestion text, so verdicts keep matching after an
// edit; readers look the edit up by insightKey(original) and show this.

export interface SuggestionEdit {
  gap?: string | null;
  why_it_matters?: string | null;
  suggested_play?: string | null;
}

export interface Suggestion {
  gap?: string;
  why_it_matters?: string;
  suggested_play?: string;
  platform?: string;
}

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** The suggestion with the edit's non-empty fields in place of its own. */
export function editedSuggestion<T extends Suggestion>(g: T, edit: SuggestionEdit | null | undefined): T & { edited: boolean } {
  if (!edit || typeof edit !== "object") return { ...g, edited: false };
  const gap = clean(edit.gap), why = clean(edit.why_it_matters), play = clean(edit.suggested_play);
  if (!gap && !why && !play) return { ...g, edited: false };
  return {
    ...g,
    ...(gap ? { gap } : {}),
    ...(why ? { why_it_matters: why } : {}),
    ...(play ? { suggested_play: play } : {}),
    edited: true,
  };
}

/** Limits a rewrite or a hand edit is held to. */
export const SUGGESTION_LIMITS = { gap: 160, why_it_matters: 600, suggested_play: 600 } as const;

/** A rewrite from the model, or null when it is not usable. */
export function parseRevision(text: string): Required<Pick<Suggestion, "gap" | "why_it_matters" | "suggested_play">> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let data: Record<string, unknown>;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  const gap = clean(data.gap), why = clean(data.why_it_matters), play = clean(data.suggested_play);
  if (!gap || !play) return null;
  if (gap.length > SUGGESTION_LIMITS.gap || why.length > SUGGESTION_LIMITS.why_it_matters || play.length > SUGGESTION_LIMITS.suggested_play) return null;
  return { gap, why_it_matters: why, suggested_play: play };
}

/** A standing preference learned from the team's edits (competitive_learnings). */
export interface CompetitiveLearning {
  kind: "prefer" | "avoid";
  text: string;
}

/** Preferences from the model, cleaned; at most two, each one sentence. */
export function parseLearnings(text: string): CompetitiveLearning[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return [];
  let data: { rules?: unknown };
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  if (!Array.isArray(data.rules)) return [];
  const out: CompetitiveLearning[] = [];
  for (const r of data.rules as Array<Record<string, unknown>>) {
    const t = clean(r?.text);
    if (t.length < 3 || t.length > 240) continue;
    out.push({ kind: r?.kind === "avoid" ? "avoid" : "prefer", text: t });
    if (out.length >= 2) break;
  }
  return out;
}

/** The preferences as lines for a prompt. */
export function learningLines(learnings: CompetitiveLearning[]): string[] {
  return learnings.map((l) => `${l.kind === "avoid" ? "Avoid" : "Prefer"}: ${l.text}`);
}
