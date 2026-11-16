import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { compactNumber } from "@/lib/display";

/** Emphasis palette: the subject in the accent, context in the de-emphasis gray. Text never wears the data colour. */
export const SERIES = { accent: "#b9e045", muted: "rgba(255,255,255,0.18)" } as const;

function Bar({ value, max, color, label, title }: { value: number; max: number; color: string; label: string; title: string }) {
  const w = max > 0 ? Math.max((value / max) * 100, value > 0 ? 1.5 : 0) : 0;
  return (
    <div className="flex items-center gap-3" title={title}>
      <div className="relative flex-1 h-[14px]">
        <div className="absolute inset-y-0 left-0 w-px bg-[rgba(255,255,255,0.14)]" aria-hidden />
        <div className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500 ease-out hover:brightness-110" style={{ width: `${w}%`, backgroundColor: color }} />
      </div>
      <span className="t-label text-white tabular-nums w-16 text-right shrink-0">{label}</span>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-5 flex-wrap">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-2 t-label">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: it.color }} aria-hidden /> {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Before/after per item as small multiples: every metric gets its own scale, the current
 * period in the accent and the previous period in gray. Values are labelled at the tip.
 * With `max`, every item shares that one scale (shares of one whole, 0 to 100).
 */
export function CompareBars({
  items,
  currentLabel,
  previousLabel,
  columns = "grid-cols-1 md:grid-cols-2 xl:grid-cols-3",
  max: sharedMax,
}: {
  items: { key: string; label: string; current: number; previous: number; format?: (v: number) => string }[];
  currentLabel: string;
  previousLabel: string;
  columns?: string;
  /** One maximum for every item, for values that are parts of one whole; each item scales alone without it. */
  max?: number;
}) {
  return (
    <div className="space-y-5">
      <div className={cn("grid gap-x-8 gap-y-5", columns)}>
        {items.map((it) => {
          const f = it.format || compactNumber;
          const max = sharedMax ?? Math.max(it.current, it.previous, 0);
          return (
            <div key={it.key} className="space-y-1.5 min-w-0">
              <p className="t-subhead">{it.label}</p>
              <div className="space-y-[2px]">
                <Bar value={it.current} max={max} color={SERIES.accent} label={f(it.current)} title={`${it.label}, ${currentLabel}: ${it.current.toLocaleString()}`} />
                <Bar value={it.previous} max={max} color={SERIES.muted} label={f(it.previous)} title={`${it.label}, ${previousLabel}: ${it.previous.toLocaleString()}`} />
              </div>
            </div>
          );
        })}
      </div>
      <Legend items={[{ label: currentLabel, color: SERIES.accent }, { label: previousLabel, color: SERIES.muted }]} />
    </div>
  );
}

/**
 * One series, one hue: magnitude by category (platforms, companies). Sorted high to low,
 * the subject row (if any) in the accent and the rest in gray, value at the tip.
 */
export function RankedBars({
  rows,
  format = compactNumber,
  emphasis,
  legend,
  max: sharedMax,
}: {
  rows: { key: string; label: ReactNode; name: string; value: number; emphasized?: boolean }[];
  format?: (v: number) => string;
  /** When set, emphasized rows use the accent and the others gray; otherwise every bar is the accent. */
  emphasis?: boolean;
  legend?: { subject: string; others: string };
  /** One maximum for every bar, for values that are parts of one whole; the largest value without it. */
  max?: number;
}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const max = sharedMax ?? Math.max(...sorted.map((r) => r.value), 0);
  return (
    <div className="space-y-4">
      <div className="space-y-2.5">
        {sorted.map((r) => (
          <div key={r.key} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3">
            {/* The subject's own row is white and medium: the accent bar says
                which one it is, but only if you have read the legend, and the
                name is what the eye lands on first. */}
            <div
              title={r.name}
              className={cn(
                "t-body flex items-center gap-2 min-w-0 break-words leading-snug",
                emphasis && r.emphasized ? "font-semibold !text-white" : "!text-[#d1d5db]",
              )}
            >
              {r.label}
            </div>
            <Bar
              value={r.value}
              max={max}
              color={emphasis ? (r.emphasized ? SERIES.accent : SERIES.muted) : SERIES.accent}
              label={format(r.value)}
              title={`${r.name}: ${r.value.toLocaleString()}`}
            />
          </div>
        ))}
      </div>
      {emphasis && legend && <Legend items={[{ label: legend.subject, color: SERIES.accent }, { label: legend.others, color: SERIES.muted }]} />}
    </div>
  );
}
