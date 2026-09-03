import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page-level section: a slim glass band carrying the title and one line of
 * context, with the content (cards, grids) standing below it. Every screen
 * uses this for its sections so the reading rhythm is the same everywhere.
 */
export function Section({
  id,
  title,
  description,
  action,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("space-y-4 scroll-mt-28", className)}>
      <div className="glass px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-0">
          <h2 className="t-h2 flex items-center gap-2">{title}</h2>
          {description && <p className="t-secondary">{description}</p>}
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Sticky in-page navigation for long reports: one chip per section. */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Sections" className="glass px-3 py-2 flex gap-1 flex-wrap sticky top-[88px] z-20">
      {items.map((it) => (
        <a
          key={it.id}
          href={`#${it.id}`}
          className="px-3 py-1.5 rounded-[8px] t-body text-white hover:bg-[rgba(255,255,255,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(185,224,69,0.45)]"
        >
          {it.label}
        </a>
      ))}
    </nav>
  );
}
