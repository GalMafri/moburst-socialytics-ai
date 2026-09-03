import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * One AI insight as a scannable card: the first sentence as the headline, the rest
 * as body, and the numbers mentioned pulled out as chips. Nothing is dropped; the
 * full text stays on the card. Used for key insights, takeaways, opportunities.
 */
export function splitHeadline(text: string): { headline: string; body: string } {
  const t = String(text || "").trim();
  // First sentence boundary: ". " followed by an uppercase letter or digit, or a colon early on.
  const colon = t.indexOf(": ");
  if (colon > 8 && colon < 80) return { headline: t.slice(0, colon), body: t.slice(colon + 2).trim() };
  const m = t.match(/^(.{20,160}?[.!?])\s+(?=[A-Z0-9"“])/);
  if (m) return { headline: m[1], body: t.slice(m[0].length).trim() };
  if (t.length <= 140) return { headline: t, body: "" };
  // Long single sentence: break at the first comma or semicolon after 60 chars.
  const k = t.slice(60).search(/[,;]\s/);
  if (k >= 0 && 60 + k < 150) return { headline: t.slice(0, 60 + k), body: t.slice(60 + k + 1).trim() };
  return { headline: t, body: "" };
}

const METRIC = /(?:[-+−]?\d[\d,.]*\s?%|\$\d[\d,.]*[KMB]?|\b\d[\d,.]*[KMB]\b|\b\d{1,3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?x\b)/g;

export function extractMetrics(text: string, max = 3): string[] {
  const out: string[] = [];
  for (const m of String(text || "").matchAll(METRIC)) {
    const v = m[0].replace(/\s+/g, "");
    if (!out.includes(v)) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export function InsightCard({
  text,
  index,
  icon,
  label,
  accent = false,
  className,
  footer,
}: {
  text: string;
  index?: number;
  icon?: ReactNode;
  label?: string;
  accent?: boolean;
  className?: string;
  footer?: ReactNode;
}) {
  const { headline, body } = splitHeadline(text);
  const metrics = extractMetrics(text);
  return (
    <article className={cn("glass-inner p-4 flex flex-col gap-3 min-w-0", accent && "border-[rgba(185,224,69,0.35)]", className)}>
      <div className="flex items-start gap-3">
        {index != null && (
          <span className="flex-shrink-0 h-7 w-7 rounded-full bg-primary text-primary-foreground t-badge flex items-center justify-center mt-0.5">{index}</span>
        )}
        {icon && index == null && <span className="flex-shrink-0 mt-0.5 text-primary">{icon}</span>}
        <div className="min-w-0 space-y-1.5">
          {label && <p className="t-label uppercase tracking-wider">{label}</p>}
          <h3 className="t-body font-semibold text-white leading-snug">{headline}</h3>
          {body && <p className="t-body">{body}</p>}
        </div>
      </div>
      {(metrics.length > 0 || footer) && (
        <div className="flex items-center justify-between gap-3 flex-wrap mt-auto">
          <div className="flex flex-wrap gap-1.5">
            {metrics.map((m) => (
              <span key={m} className="inline-flex items-center px-2 py-0.5 rounded-full bg-[rgba(185,224,69,0.12)] text-[#b9e045] t-badge tabular-nums">{m}</span>
            ))}
          </div>
          {footer}
        </div>
      )}
    </article>
  );
}

/** A responsive grid of InsightCards. */
export function InsightGrid({ items, numbered = true, label, icon, className }: { items: string[]; numbered?: boolean; label?: string; icon?: ReactNode; className?: string }) {
  if (!items?.length) return null;
  return (
    <div className={cn("grid gap-3 md:grid-cols-2 xl:grid-cols-3", className)}>
      {items.map((t, i) => (
        <InsightCard key={i} text={t} index={numbered ? i + 1 : undefined} icon={icon} label={label} />
      ))}
    </div>
  );
}
