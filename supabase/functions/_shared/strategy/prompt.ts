// supabase/functions/_shared/strategy/prompt.ts
//
// The client's content strategy as the weekly calendar planner reads it
// (spec: docs/superpowers/specs/2026-11-02-content-strategy-tab-design.md,
// "The calendar planner"): goals, audience, positioning, pillars, the
// platforms the client posts on now and what to avoid, with people's versions
// wherever they edited a section. New platforms are left out, since their
// posts need a live account first; measures and the not now list are for the
// team. A client with no strategy gets "", so its prompts stay as they were.

import { clip } from "../trends/text.ts";
import { pillarSectionKey, platformSectionKey } from "./platforms.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const STRATEGY_BLOCK_CHARS = 4000;

export interface StoredStrategy {
  /** Null while the row holds only a write under way: no strategy yet. */
  written_at?: string | null;
  sections: Record<string, string> | null;
  platforms: Array<{ platform: string; state: string }> | null;
  pillars: Array<{ name: string }> | null;
}

/** At most n characters, cut at the last line that fits when one ends in the last quarter. */
function capped(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = clip(text, n);
  const at = cut.lastIndexOf("\n");
  return (at > n * 0.75 ? cut.slice(0, at) : cut).trimEnd();
}

/** The block from a stored strategy and people's versions of its sections. */
export function strategyBlock(s: StoredStrategy, edits: Array<{ section_key: string; text: string }>): string {
  const mine = new Map(edits.filter((e) => String(e.text ?? "").trim()).map((e) => [e.section_key, String(e.text).trim()]));
  const text = (key: string) => mine.get(key) ?? String(s.sections?.[key] ?? "").trim();
  const oneLine = (t: string) => t.replace(/\s*\n+\s*/g, " ");
  const part = (title: string, body: string) => (body ? `${title}:\n${body}` : "");
  const pillars = (s.pillars ?? []).map((p) => ({ name: p.name, text: text(pillarSectionKey(p.name)) })).filter((p) => p.text);
  const posting = (s.platforms ?? []).filter((p) => p.state === "posting").map((p) => ({ name: p.platform, text: text(platformSectionKey(p.platform, "posting")) })).filter((p) => p.text);
  const block = [
    "The client's content strategy, as the team keeps it:",
    part("Goals", text("goals")),
    part("Audience", text("audience")),
    part("Positioning", text("positioning")),
    part("Pillars", pillars.map((p) => `- ${p.name}: ${oneLine(p.text)}`).join("\n")),
    part("Platforms it posts on now", posting.map((p) => `- ${p.name}: ${oneLine(p.text)}`).join("\n")),
    part("What to avoid", text("avoid")),
  ].filter(Boolean).join("\n");
  return capped(block, STRATEGY_BLOCK_CHARS);
}

/** The client's strategy for the planner's prompts; "" when it has none. */
export async function strategyPromptBlock(db: Db, clientId: string): Promise<string> {
  const { data: s, error } = await db.from("content_strategies").select("sections, platforms, pillars, written_at").eq("client_id", clientId).maybeSingle();
  if (error) throw new Error(`Could not read the content strategy: ${error.message}`);
  if (!s?.written_at) return "";
  const { data: edits, error: editsError } = await db.from("content_strategy_edits").select("section_key, text").eq("client_id", clientId);
  if (editsError) throw new Error(`Could not read the team's versions of the strategy: ${editsError.message}`);
  return strategyBlock(s, edits ?? []);
}
