import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page-level section: a slim glass band carrying the title and one line of
 * context, with the content (cards, grids) standing below it. Every screen
 * uses this for its sections so the reading rhythm is the same everywhere.
 */
export function Section({
  id,
  index,
  title,
  description,
  action,
  children,
  className,
}: {
  id?: string;
  /** Chapter number shown before the title (01, 02, …). */
  index?: number;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("space-y-4 scroll-mt-[156px]", className)}>
      <div className="glass px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1 min-w-0">
          <h2 className="t-h2 flex items-center gap-3">
            {index != null && <span className="t-label !text-[#b9e045] tabular-nums tracking-[0.2em]">{String(index).padStart(2, "0")}</span>}
            <span className="flex items-center gap-2">{title}</span>
          </h2>
          {description && <p className="t-secondary">{description}</p>}
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Section navigation for long reports: a rail down the left of the report.
 *
 * It sat across the top before and followed the scroll, which meant it passed
 * over the report as you read — the wrong trade for a reader. In its own column
 * it is always in reach and never covers a word. It holds its place beside the
 * content on wide screens; below that there is no room for a column, so it
 * becomes a plain row at the top of the report that scrolls away with
 * everything else rather than floating over it.
 */
export function SectionNav({ items, className }: { items: { id: string; label: string }[]; className?: string }) {
  const [active, setActive] = useState<string | null>(null);
  // Which of the given sections are actually on the page right now. Several
  // reports render a section only when it has data, so the rail is told the
  // full running order and drops what isn't there rather than offering a link
  // that goes nowhere.
  const [presentIds, setPresentIds] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const key = items.map((it) => it.id).join("|");

  useEffect(() => {
    if (!key) return;
    let nodes: HTMLElement[] = [];
    let observer: IntersectionObserver | null = null;
    let queued = 0;

    // The active section is the last one whose heading has passed the top of
    // the reading area, so the highlight follows the eye rather than whichever
    // section happens to cover the most pixels.
    const pick = () => {
      if (nodes.length === 0) return;
      const line = 156;
      let current = nodes[0].id;
      for (const n of nodes) {
        if (n.getBoundingClientRect().top <= line) current = n.id;
        else break;
      }
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) current = nodes[nodes.length - 1].id;
      setActive(current);
    };

    const wire = () => {
      const found = itemsRef.current
        .map((it) => document.getElementById(it.id))
        .filter((n): n is HTMLElement => !!n);
      const foundKey = found.map((n) => n.id).join("|");
      if (foundKey === nodes.map((n) => n.id).join("|") && observer) return;
      nodes = found;
      setPresentIds(foundKey);
      observer?.disconnect();
      observer = new IntersectionObserver(pick, { rootMargin: "-140px 0px -60% 0px", threshold: [0, 0.5, 1] });
      nodes.forEach((n) => observer!.observe(n));
      pick();
    };

    wire();
    // Sections come and go as a tab changes or a query resolves, so keep the
    // rail in step with the page instead of with the first render.
    const mutations = new MutationObserver(() => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        wire();
      });
    });
    mutations.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      if (queued) cancelAnimationFrame(queued);
      mutations.disconnect();
      observer?.disconnect();
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [key]);

  // Keep the active item in view when the rail itself has had to scroll.
  useEffect(() => {
    if (!active || !navRef.current) return;
    const el = navRef.current.querySelector<HTMLElement>(`[data-section="${active}"]`);
    const bar = navRef.current;
    if (!el) return;
    const overflowsY = bar.scrollHeight > bar.clientHeight + 1;
    const overflowsX = bar.scrollWidth > bar.clientWidth + 1;
    if (!overflowsY && !overflowsX) return;
    if (overflowsY) bar.scrollTo({ top: el.offsetTop - bar.clientHeight / 2 + el.offsetHeight / 2, behavior: "smooth" });
    else bar.scrollTo({ left: el.offsetLeft - bar.clientWidth / 2 + el.offsetWidth / 2, behavior: "smooth" });
  }, [active]);

  const visible = presentIds === null ? items : items.filter((it) => presentIds.split("|").includes(it.id));
  if (visible.length === 0) return null;

  const go = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setActive(id);
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav
      ref={navRef}
      aria-label="Sections"
      // Navigation chrome, not report content: the PDF export drops it.
      data-print="hide"
      className={cn(
        // Under xl: a plain row at the top of the report, in the flow.
        "flex gap-1 flex-nowrap overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        // xl and up: the rail. Sticky only within its own column, so it stays
        // beside the reader without ever crossing the content.
        "xl:flex-col xl:gap-0.5 xl:overflow-x-visible xl:overflow-y-auto",
        "xl:sticky xl:top-[88px] xl:self-start xl:max-h-[calc(100vh-7rem)]",
        "glass p-2",
        "print:static print:overflow-visible print:flex-wrap print:flex-row",
        className,
      )}
    >
      {visible.map((it) => {
        const on = active === it.id;
        return (
          <a
            key={it.id}
            href={`#${it.id}`}
            data-section={it.id}
            aria-current={on ? "true" : undefined}
            onClick={(e) => go(e, it.id)}
            className={cn(
              "px-3 py-1.5 rounded-[8px] t-body whitespace-nowrap shrink-0 transition-colors",
              "xl:whitespace-normal xl:text-left xl:border-l-2",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(185,224,69,0.45)]",
              on
                ? "bg-[rgba(185,224,69,0.14)] text-white xl:border-l-[#b9e045]"
                : "text-white hover:bg-[rgba(255,255,255,0.08)] xl:border-l-transparent",
            )}
          >
            {it.label}
          </a>
        );
      })}
    </nav>
  );
}
