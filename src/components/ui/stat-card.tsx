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

function formatPercent(pct: number): string {
  const abs = Math.abs(pct);
  const body = abs >= 100 ? Math.round(abs).toString() : abs.toFixed(1).replace(/\.0$/, "");
  return `${pct > 0 ? "+" : pct < 0 ? "-" : ""}${body}%`;
}

/**
 * The one stat tile for the whole app: label (13px grey, uppercase), value (30px),
 * an optional delta badge coloured by sign, and an optional sub line.
 */
export function StatCard({
  label,
  value,
  icon,
  delta,
  sub,
  accent = false,
  className,
}: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  delta?: StatDelta;
  sub?: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  const pct = typeof delta?.percent === "number" && Number.isFinite(delta.percent) ? delta.percent : null;
  const tone = pct == null ? "" : pct > 0 ? "text-success" : pct < 0 ? "text-destructive" : "text-[#b1b7c1]";
  const DeltaIcon = pct == null ? null : pct > 0 ? TrendingUp : pct < 0 ? TrendingDown : Minus;
  return (
    <Card className={cn("hover-lift", accent && "glass-accent", className)}>
      <CardContent className="p-5 space-y-2">
        <p className="t-label uppercase tracking-wider flex items-center gap-1.5 min-w-0">
          {icon}
          <span className="truncate">{label}</span>
        </p>
        <p className="t-stat tabular-nums">{value}</p>
        {(pct != null || delta?.previous || sub) && (
          <div className="flex items-center gap-2 flex-wrap">
            {pct != null && DeltaIcon && (
              <span className={cn("inline-flex items-center gap-1 t-label font-semibold", tone)}>
                <DeltaIcon className="h-3.5 w-3.5" />
                {formatPercent(pct)}
                {delta?.label ? ` ${delta.label}` : ""}
              </span>
            )}
            {delta?.previous && <span className="t-label">vs {delta.previous}</span>}
            {sub && <span className="t-secondary">{sub}</span>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
