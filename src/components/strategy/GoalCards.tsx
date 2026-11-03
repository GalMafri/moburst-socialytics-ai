/**
 * 01 The plan (spec: docs/superpowers/specs/2026-11-03-strategy-v2-design.md,
 * section 1): three tiles (platforms, posts a week, pillars) and a card per
 * goal, its figure today and the date it is for. One pencil edits the goals.
 */

import type { ReactNode } from "react";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { platformName } from "@/lib/display";
import { goalFigure, textLines, type PagePlatform } from "@/lib/strategyView";
import type { Goal } from "../../../supabase/functions/_shared/strategy/sections";
import { EditButton, EditedChip, useSectionEdit, type SectionProps } from "./StrategySection";
import { EditSheet } from "./EditSheet";

const round1 = (n: number) => Math.round(n * 10) / 10;

export function PlanTiles({ platforms, pillars }: { platforms: PagePlatform[]; pillars: number }) {
  const live = platforms.filter((p) => p.state !== "not_now");
  const perWeek = round1(live.reduce((s, p) => s + (p.cadence && p.cadence.per_week > 0 ? p.cadence.per_week : 0), 0));
  return (
    <StatGrid min={180}>
      <StatCard label="Platforms" value={live.length} sub={`${live.filter((p) => p.state === "posting").length} posting now`} />
      <StatCard label="Posts a week" value={perWeek} sub="across every platform" />
      <StatCard label="Pillars" value={pillars} />
    </StatGrid>
  );
}

function GoalCard({ goal, children }: { goal: Goal; children?: ReactNode }) {
  const f = goalFigure(goal);
  return (
    <article className="glass-accent p-card space-y-3 min-w-0 break-inside-avoid">
      <h3 className="t-h3">{goal.title}</h3>
      <p className="t-label">{platformName(goal.platform)}</p>
      <p className="flex flex-wrap items-baseline gap-x-2">
        {f.figure && <span className="t-stat tabular-nums">{f.figure}</span>}
        <span className="t-read">{f.line}</span>
      </p>
      {goal.why && <p className="t-read">Why: {goal.why}</p>}
      {children}
    </article>
  );
}

export function GoalCards(props: SectionProps) {
  const e = useSectionEdit(props);
  const shown = e.shown;
  const goals = shown && typeof shown === "object" && Array.isArray((shown as { items?: unknown }).items) ? ((shown as { items: Goal[] }).items) : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="t-subhead">Goals for the next 90 days</p>
        <div className="flex items-center gap-2"><EditedChip e={e} /><EditButton e={e} label="the goals" /></div>
      </div>
      {goals ? (
        // Two or four goals pair up; three sit in one row where the width allows.
        <div className={`grid gap-inner lg:grid-cols-2 ${goals.length === 3 ? "xl:grid-cols-3" : ""}`} data-testid="strategy-goals">
          {goals.map((g, i) => <GoalCard key={i} goal={g} />)}
        </div>
      ) : (
        <article className="glass-accent p-card min-w-0" data-testid="strategy-goals">
          <ul className="space-y-2">{textLines(String(shown ?? "")).map((l, i) => <li key={i} className="t-read">{l}</li>)}</ul>
        </article>
      )}
      <EditSheet e={e} title="Goals" />
    </div>
  );
}
