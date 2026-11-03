/**
 * 06 What we avoid: up to five patterns, each with where it comes from (our
 * posts, the trend profile, the brief, or the team). Written as patterns,
 * never quoting one of the client's posts.
 */

import { Badge } from "@/components/ui/badge";
import { textLines } from "@/lib/strategyView";
import { avoidSourceWords, type AvoidValue } from "../../../supabase/functions/_shared/strategy/sections";
import { EditButton, EditedChip, useSectionEdit, type SectionProps } from "./StrategySection";
import { EditSheet } from "./EditSheet";

export function AvoidList(props: SectionProps) {
  const e = useSectionEdit(props);
  const rows = typeof e.shown === "string"
    ? textLines(e.shown).map((pattern) => ({ pattern, source: "" }))
    : ((e.shown as Partial<AvoidValue> | undefined)?.items ?? []).map((i) => ({ pattern: i.pattern, source: avoidSourceWords(i.source) }));
  return (
    <article className="glass p-card space-y-3 min-w-0" data-testid="strategy-avoid">
      <div className="flex items-start justify-between gap-3">
        <p className="t-subhead pt-1.5">Patterns we stop</p>
        <div className="flex items-center gap-2"><EditedChip e={e} /><EditButton e={e} label="what we avoid" /></div>
      </div>
      <ul className="divide-y divide-[rgba(255,255,255,0.06)]">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <p className="t-read min-w-0">{r.pattern}</p>
            {r.source && <Badge variant="outline" className="shrink-0">{r.source}</Badge>}
          </li>
        ))}
      </ul>
      <EditSheet e={e} title="What we avoid" />
    </article>
  );
}
