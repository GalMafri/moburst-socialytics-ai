/**
 * 04 Pillars: the content mix in one chart (each pillar's share of the
 * calendar's posts over the last 8 weeks in gray, its planned share in lime),
 * then a card per pillar: what it is for, its formats, its planned share, and
 * its example posts behind a disclosure, which the PDF opens.
 */

import { CompareBars, RankedBars } from "@/components/ui/bars";
import { Badge } from "@/components/ui/badge";
import { textLines } from "@/lib/strategyView";
import type { PillarValue } from "../../../supabase/functions/_shared/strategy/sections";
import { pillarSectionKey } from "../../../supabase/functions/_shared/strategy/platforms";
import { EditButton, EditedChip, useSectionEdit, type SectionProps } from "./StrategySection";
import { EditSheet } from "./EditSheet";
import type { StrategyEdit } from "@/lib/strategyView";

const pct = (v: number) => `${Math.round(v)}%`;

export function MixChart({ pillars, sections, edits }: { pillars: Array<{ name: string; share: number | null }>; sections: Record<string, unknown>; edits: Map<string, StrategyEdit> }) {
  const planned = (name: string): number | null => {
    const key = pillarSectionKey(name);
    const edit = edits.get(key);
    const v = (edit?.value && typeof edit.value === "object" ? edit.value : sections[key]) as Partial<PillarValue> | undefined;
    const n = Number(v?.planned_share);
    return v && typeof v === "object" && Number.isFinite(n) ? n : null;
  };
  const rows = pillars.map((p) => ({ name: p.name, current: p.share, planned: planned(p.name) })).filter((r) => r.planned !== null);
  if (!rows.length) return null;
  const hasCurrent = rows.some((r) => r.current !== null);
  return (
    <div className="glass p-card space-y-4" data-testid="strategy-mix">
      <p className="t-subhead">Share of posts</p>
      {hasCurrent ? (
        <CompareBars
          items={rows.map((r) => ({ key: r.name, label: r.name, current: r.planned as number, previous: r.current ?? 0, format: pct }))}
          currentLabel="Planned"
          previousLabel="Last 8 weeks"
        />
      ) : (
        <RankedBars rows={rows.map((r) => ({ key: r.name, label: r.name, name: r.name, value: r.planned as number }))} format={pct} />
      )}
    </div>
  );
}

export function PillarCard({ name, ...props }: SectionProps & { name: string }) {
  const e = useSectionEdit(props);
  const text = typeof e.shown === "string" ? textLines(e.shown) : null;
  const v = (e.shown ?? {}) as Partial<PillarValue>;
  return (
    <article className="glass p-card space-y-3 min-w-0 break-inside-avoid" data-testid={`strategy-pillar-${name}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="t-h3 min-w-0">{name}</h3>
        <div className="flex items-center gap-2"><EditedChip e={e} /><EditButton e={e} label={name} /></div>
      </div>
      {text ? <ul className="space-y-2">{text.map((l, i) => <li key={i} className="t-read">{l}</li>)}</ul> : (
        <>
          {v.purpose && <p className="t-read">{v.purpose}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {(v.formats ?? []).map((f) => <Badge key={f} variant="outline">{f}</Badge>)}
            {Number.isFinite(Number(v.planned_share)) && <span className="t-label ml-auto">{Number(v.planned_share)}% of posts planned</span>}
          </div>
          {!!v.ideas?.length && (
            <details className="group glass-inner p-inner">
              <summary className="t-body cursor-pointer select-none">Example posts</summary>
              <ul className="mt-3 space-y-2.5">
                {v.ideas.map((idea, i) => (
                  <li key={i} className="space-y-1">
                    <p className="t-read">{idea.hook}</p>
                    {idea.format && <p className="t-label">{idea.format}</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <EditSheet e={e} title={name} />
    </article>
  );
}
