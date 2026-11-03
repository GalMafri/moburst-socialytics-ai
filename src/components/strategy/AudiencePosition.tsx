/**
 * 03 Audience and positioning: who we write for, what they want and where
 * they are; our position in one sentence and a line against each competitor.
 * Two cards side by side, each with its own pencil.
 */

import { PlatformBadge } from "@/lib/platform-config";
import { textLines } from "@/lib/strategyView";
import type { AudienceValue, PositioningValue } from "../../../supabase/functions/_shared/strategy/sections";
import { EditButton, EditedChip, useSectionEdit, type SectionEditor, type SectionProps } from "./StrategySection";
import { EditSheet } from "./EditSheet";

function CardHead({ title, e }: { title: string; e: SectionEditor }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <p className="t-subhead pt-1.5">{title}</p>
      <div className="flex items-center gap-2"><EditedChip e={e} /><EditButton e={e} label={title.toLowerCase()} /></div>
    </div>
  );
}

const asText = (v: unknown) => (typeof v === "string" ? textLines(v) : null);

export function AudienceCard(props: SectionProps) {
  const e = useSectionEdit(props);
  const text = asText(e.shown);
  const v = (e.shown ?? {}) as Partial<AudienceValue>;
  return (
    <article className="glass p-card space-y-4 min-w-0 break-inside-avoid" data-testid="strategy-audience">
      <CardHead title="Who we write for" e={e} />
      {text ? <ul className="space-y-2">{text.map((l, i) => <li key={i} className="t-read">{l}</li>)}</ul> : (
        <>
          <p className="t-h3">{v.who}</p>
          {!!v.wants?.length && (
            <div className="space-y-2">
              <p className="t-label">What they want</p>
              <ul className="space-y-1.5 list-disc pl-5 marker:text-[#b9e045]">{v.wants.map((w, i) => <li key={i} className="t-read">{w}</li>)}</ul>
            </div>
          )}
          {!!v.where?.length && (
            <div className="space-y-2">
              <p className="t-label">Where they are</p>
              <div className="flex flex-wrap gap-2">{v.where.map((p) => <PlatformBadge key={p} platform={p} />)}</div>
            </div>
          )}
        </>
      )}
      <EditSheet e={e} title="Who we write for" />
    </article>
  );
}

export function PositioningCard(props: SectionProps) {
  const e = useSectionEdit(props);
  const text = asText(e.shown);
  const v = (e.shown ?? {}) as Partial<PositioningValue>;
  return (
    <article className="glass p-card space-y-4 min-w-0 break-inside-avoid" data-testid="strategy-positioning">
      <CardHead title="Our position" e={e} />
      {text ? <ul className="space-y-2">{text.map((l, i) => <li key={i} className="t-read">{l}</li>)}</ul> : (
        <>
          <p className="t-h3">{v.statement}</p>
          {!!v.points?.length && (
            <ul className="space-y-2.5">
              {v.points.map((p, i) => (
                <li key={i} className="glass-inner p-inner space-y-1">
                  <p className="t-label">vs {p.vs}</p>
                  <p className="t-read">{p.point}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <EditSheet e={e} title="Our position" />
    </article>
  );
}
