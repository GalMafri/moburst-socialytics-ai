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
 * Sticky in-page navigation for long reports: one chip per section.
 *
 * The chips track where the reader actually is. Without that, a nav on a
 * twelve-thousand-pixel report tells you where you can go but never where you
 * are, so on a long scroll it stops being navigation and becomes decoration.
 * It also stays a single row: wrapping made the bar two or three lines tall,
 * and a sticky bar that tall eats the content it is supposed to help you read.
 */
export function SectionNav({ items, className }: { items: { id: string; label: string }[]; className?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (items.length === 0) return;
    const nodes = items.map((it) => document.getElementById(it.id)).filter((n): n is HTMLElement => !!n);
    if (nodes.length === 0) return;

    // The reading line is the bottom of the sticky bar itself, not a magic
    // number: the active section is the last one whose heading has passed under
    // it. Measuring the bar means the highlight stays correct whether the bar is
    // one row or has grown, and it matches where a clicked section comes to rest.
    const pick = () => {
      const bar = navRef.current?.getBoundingClientRect();
      const line = (bar ? bar.bottom : 142) + 12;
      let current = nodes[0]?.id ?? null;
      for (const n of nodes) {
        if (n.getBoundingClientRect().top <= line) current = n.id;
        else break;
      }
      // At the very bottom the last section may never reach the line, so the
      // final scroll position always resolves to the final section.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (atBottom) current = nodes[nodes.length - 1].id;
      if (current) setActive(current);
    };

    pick();
    const observer = new IntersectionObserver(pick, {
      rootMargin: "-120px 0px -60% 0px",
      threshold: [0, 0.25, 0.5, 1],
    });
    nodes.forEach((n) => observer.observe(n));
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", pick);
      window.removeEventListener("resize", pick);
    };
  }, [items]);

  // Keep the active chip visible when the bar itself has to scroll sideways.
  useEffect(() => {
    if (!active || !navRef.current) return;
    const chip = navRef.current.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!chip) return;
    const bar = navRef.current;
    if (bar.scrollWidth <= bar.clientWidth + 1) return;
    const left = chip.offsetLeft - bar.clientWidth / 2 + chip.offsetWidth / 2;
    bar.scrollTo({ left, behavior: "smooth" });
  }, [active]);

  if (items.length === 0) return null;

  const go = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    setActive(id);
    // Keep the URL shareable without letting the jump fight the smooth scroll.
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav
      ref={navRef}
      aria-label="Sections"
      className={cn(
        "px-3 py-2 flex gap-1 flex-nowrap overflow-x-auto sticky top-[88px] z-30",
        // Deliberately NOT .glass. Content scrolls underneath this bar, and at
        // .glass's 20% black the text behind it read straight through — lines of
        // the report showing through the nav. This is near-opaque with a shadow
        // so it reads as a layer sitting above the page, not a window onto it.
        "rounded-[16px] border border-[rgba(255,255,255,0.10)] bg-[rgba(11,12,16,0.97)]",
        "backdrop-blur-[60px] shadow-[0_10px_28px_rgba(0,0,0,0.55)]",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:static print:overflow-visible print:flex-wrap print:shadow-none",
        className,
      )}
    >
      {items.map((it) => {
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
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(185,224,69,0.45)]",
              on
                ? "bg-[rgba(185,224,69,0.16)] text-white shadow-[inset_0_0_0_1px_rgba(185,224,69,0.45)]"
                : "text-white hover:bg-[rgba(255,255,255,0.08)]",
            )}
          >
            {it.label}
          </a>
        );
      })}
    </nav>
  );
}
