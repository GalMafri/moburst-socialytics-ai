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
};

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
  const pct = typeof delta?.percent === "number" && Number.isFinite(delta.percent) ? delta.percent : null;
  const tone = pct == null ? "" : pct > 0 ? "text-success" : pct < 0 ? "text-[#f87171]" : "text-[#b1b7c1]";
  const DeltaIcon = pct == null ? null : pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  const compact = size === "compact";
  const body = (
    <>
        <p className="t-label uppercase tracking-wider flex items-center gap-1.5 min-w-0 [&_svg]:h-3.5 [&_svg]:w-3.5 [&_svg]:shrink-0">
          {icon}
          <span className="truncate">{label}</span>
        </p>
        <p className={compact ? "t-h2 tabular-nums" : "t-stat tabular-nums"}>{value}</p>
        {(pct != null || delta?.previous || sub) && (
          <div className="flex items-center gap-2 flex-wrap">
            {pct != null && DeltaIcon && (
              <span className={cn("inline-flex items-center gap-1 t-label font-semibold", tone)}>
                <DeltaIcon className="h-3.5 w-3.5" />
                {formatPercentChange(pct)}
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
