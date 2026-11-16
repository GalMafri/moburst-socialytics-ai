import type { ReactNode } from "react";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type StatDelta = {
  /** Percentage change. null/undefined hides the badge. */
  percent: number | null | undefined;
  /** Short suffix such as "vs prev. period" or "MoM". */
  label?: string;
  /** Formatted previous value, shown as "vs 12.3K". */
  previous?: string;
  /** The raw values the percent was made from. With them, a change on a tiny base reads "from 1 to 19" (describeChange). */
  from?: number;
  to?: number;
};

/** A previous value under this is too small for a percent to mean anything. */
export const DELTA_MIN_BASE = 10;
/** A change above this percent reads as the two values instead. */
export const DELTA_MAX_PERCENT = 500;

export interface ChangeText {
  text: string;
  direction: "up" | "down" | "flat";
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * The one way a change between two periods is worded, for the tiles, the
 * At a glance line, the period section and the platform cards. A percent on
 * a base under DELTA_MIN_BASE, or a change above DELTA_MAX_PERCENT, reads as
 * "from 1 to 19"; something where there was nothing reads "New". Null when
 * there is nothing to say.
 */
export function describeChange(c: { previous?: number | null; current?: number | null; percent?: number | null }): ChangeText | null {
  const { previous, current } = c;
  if (finite(previous) && finite(current)) {
    if (previous === 0) return current > 0 ? { text: "New", direction: "up" } : null;
    const direction = current > previous ? "up" : current < previous ? "down" : "flat";
    const pct = finite(c.percent) ? c.percent : ((current - previous) / previous) * 100;
    if (current !== previous && (previous < DELTA_MIN_BASE || Math.abs(pct) > DELTA_MAX_PERCENT)) {
      return { text: `from ${previous.toLocaleString("en-US")} to ${current.toLocaleString("en-US")}`, direction };
    }
    return { text: formatPercentChange(pct), direction };
  }
  if (finite(c.percent)) return { text: formatPercentChange(c.percent), direction: c.percent > 0 ? "up" : c.percent < 0 ? "down" : "flat" };
  return null;
}

/** The six metrics a report's tiles show, in their order. Every line that counts or ranks metrics counts these. */
export const SHOWN_METRIC_KEYS = ["impressions", "reactions", "link_clicks", "video_views", "comments", "shares"] as const;

export interface Move {
  key: string;
  label: string;
  percent: number;
  previous: number;
  current: number;
}

/**
 * The headline move of a period: the largest percent change among the six
 * shown metrics, on a base of DELTA_MIN_BASE or more and not above the cap
 * (those read as two values, never as a headline). Null when none qualifies.
 */
export function biggestMove(changes: Record<string, { previous?: unknown; current?: unknown; percent?: unknown } | null | undefined> | null | undefined): Move | null {
  let best: Move | null = null;
  for (const key of SHOWN_METRIC_KEYS) {
    const v = changes?.[key];
    const previous = Number(v?.previous), current = Number(v?.current);
    if (!v || !Number.isFinite(previous) || !Number.isFinite(current) || previous < DELTA_MIN_BASE) continue;
    const percent = finite(v.percent) ? v.percent : ((current - previous) / previous) * 100;
    if (!Number.isFinite(percent) || Math.abs(percent) > DELTA_MAX_PERCENT) continue;
    if (!best || Math.abs(percent) > Math.abs(best.percent)) best = { key, label: key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), percent, previous, current };
  }
  return best;
}

export function formatPercentChange(pct: number): string {
  const abs = Math.abs(pct);
  const body = abs > 0 && abs < 0.1 ? Number(abs.toPrecision(2)).toString() : abs >= 100 ? Math.round(abs).toString() : abs.toFixed(1).replace(/\.0$/, "");
  return `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${body}%`;
}

/**
 * The one stat tile for the whole app: label (13px grey, uppercase), value (30px),
 * an optional delta badge colored by sign, and an optional sub line.
 *
 * `size="compact"` is the same tile at a 20px value on an inner surface, for a
 * group of figures inside a card (a client's overview, a profile's numbers),
 * where pages used to hand-build their own number blocks.
 */
export function StatCard({
  label,
  value,
  icon,
  delta,
  sub,
  accent = false,
  size = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  delta?: StatDelta;
  sub?: ReactNode;
  accent?: boolean;
  size?: "default" | "compact";
  className?: string;
}) {
  const change = delta ? describeChange({ previous: delta.from, current: delta.to, percent: delta.percent }) : null;
  const tone = !change ? "" : change.direction === "up" ? "text-success" : change.direction === "down" ? "text-destructive" : "text-muted-foreground";
  const DeltaIcon = !change ? null : change.direction === "up" ? TrendingUp : change.direction === "down" ? TrendingDown : Minus;
  const compact = size === "compact";
  const body = (
    <>
        <p className="t-label uppercase tracking-wider flex items-center gap-1.5 min-w-0 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0">
          {icon}
          <span className="truncate">{label}</span>
        </p>
        <p className={compact ? "t-h2 tabular-nums" : "t-stat tabular-nums"}>{value}</p>
        {(change || delta?.previous || sub) && (
          <div className="flex items-center gap-2 flex-wrap">
            {change && DeltaIcon && (
              <span className={cn("inline-flex items-center gap-1 t-label font-semibold", tone)}>
                <DeltaIcon className="h-3.5 w-3.5" />
                {change.text}
                {delta?.label ? ` ${delta.label}` : ""}
              </span>
            )}
            {delta?.previous && <span className="t-label">vs {delta.previous}</span>}
            {sub && <span className={compact ? "t-label" : "t-secondary"}>{sub}</span>}
          </div>
        )}
    </>
  );
  if (compact) {
    return <div className={cn("glass-inner p-inner space-y-1.5 min-w-0", accent && "is-selected", className)}>{body}</div>;
  }
  return (
    <Card className={cn("hover-lift", accent && "glass-accent", className)}>
      <CardContent className="space-y-2">{body}</CardContent>
    </Card>
  );
}

/**
 * A row of stat tiles that never leaves a hole. The columns come from the
 * width and the number of tiles (auto-fit), so two tiles share the row and
 * six fit on one line, instead of a fixed 3, 4 or 5 column grid that left
 * empty cells whenever a figure was missing for a client.
 */
export function StatGrid({ children, min = 150, className }: { children: ReactNode; min?: number; className?: string }) {
  return (
    <div
      className={cn("grid gap-inner stagger-children", className)}
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${min}px), 1fr))` }}
    >
      {children}
    </div>
  );
}
