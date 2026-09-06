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
        {/* The line of context sits beside the title on a wide band rather than
            under it. Body text is capped at 72ch, so stacked it wrapped after
            half the band and left the header looking cut short with a field of
            empty glass beside it. */}
        <div className="min-w-0 flex flex-col gap-1 lg:flex-row lg:items-baseline lg:gap-6">
          <h2 className="t-h2 flex items-center gap-3 lg:shrink-0">
            {index != null && <span className="t-label !text-[#b9e045] tabular-nums tracking-[0.2em]">{String(index).padStart(2, "0")}</span>}
            <span className="flex items-center gap-2">{title}</span>
          </h2>
          {description && <p className="t-secondary min-w-0">{description}</p>}
        </div>
        {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * Section navigation for long pages: a rail down the left, in `AppLayout`'s own
 * left column, so it starts level with the page header and every card on the
 * page keeps one left edge. It is always in reach and never covers a word.
 *
 * It sat across the top before and followed the scroll, which meant it passed
 * over the report as you read; then it sat in a column inside the content,
 * which pushed the whole page right of its own header. Below xl there is no
 * room for a column at all, so it becomes a plain row above the page that
 * scrolls away with everything else.
 *
 * Give it the full running order. It drops the sections that are not on the
 * page and keeps up as tabs change and queries land.
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
  // While a click is scrolling the page to a section, the section under the
  // reading line is every section in between. Without this the dot walked the
  // whole list on the way down, once per frame, which is the stutter you see.
  const lockedRef = useRef<string | null>(null);
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
      // A click owns the highlight until its scroll lands, and the lock lifts
      // itself once the target is where it was going.
      const locked = lockedRef.current;
      if (locked) {
        const target = nodes.find((n) => n.id === locked);
        if (!target || Math.abs(target.getBoundingClientRect().top - 156) < 4) lockedRef.current = null;
        return;
      }
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

    // One read per frame at most: `pick` measures every section, and running
    // that on each of the scroll events a smooth scroll fires is a layout pass
    // per event on a page full of blurred glass.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        pick();
      });
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
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Chrome fires this when the smooth scroll settles; the distance check in
    // `pick` covers the browsers that do not.
    const onScrollEnd = () => {
      lockedRef.current = null;
    };
    window.addEventListener("scrollend", onScrollEnd);
    return () => {
      if (queued) cancelAnimationFrame(queued);
      if (frame) cancelAnimationFrame(frame);
      mutations.disconnect();
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scrollend", onScrollEnd);
    };
  }, [key]);

  // Keep the active item in view when the rail itself has had to scroll — but
  // only when the item is actually out of sight, and instantly. Animating the
  // rail while the page is animating underneath it was the second half of the
  // stutter.
  useEffect(() => {
    if (!active || !navRef.current) return;
    const bar = navRef.current;
    const el = bar.querySelector<HTMLElement>(`[data-section="${active}"]`);
    if (!el) return;
    const overflowsY = bar.scrollHeight > bar.clientHeight + 1;
    const overflowsX = bar.scrollWidth > bar.clientWidth + 1;
    if (overflowsY) {
      const top = el.offsetTop - bar.scrollTop;
      if (top >= 0 && top + el.offsetHeight <= bar.clientHeight) return;
      bar.scrollTop = el.offsetTop - bar.clientHeight / 2 + el.offsetHeight / 2;
    } else if (overflowsX) {
      const left = el.offsetLeft - bar.scrollLeft;
      if (left >= 0 && left + el.offsetWidth <= bar.clientWidth) return;
      bar.scrollLeft = el.offsetLeft - bar.clientWidth / 2 + el.offsetWidth / 2;
    }
  }, [active]);

  const visible = presentIds === null ? items : items.filter((it) => presentIds.split("|").includes(it.id));
  // One link to the only section on the page helps nobody; the column it sits
  // in stays reserved by the layout either way, so nothing shifts.
  if (visible.length < 2) return null;

  const go = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    lockedRef.current = id;
    // The last section on a page cannot always reach the reading line, so the
    // lock has a deadline as well as the two ways of lifting itself.
    window.setTimeout(() => {
      if (lockedRef.current === id) lockedRef.current = null;
    }, 1200);
    setActive(id);
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <nav
      ref={navRef}
      aria-label="Sections"
      // Navigation chrome, not report content: the PDF export drops it.
      data-print="hide"
      className={cn(
        // Under xl there is no room for a column, so it is a plain row above the
        // page, in the flow, on its own surface so it reads as a control strip.
        // The surface is written out rather than taken from .glass, because
        // .glass lives outside a layer: its `overflow: hidden` and its
        // background would both beat any xl: override, and the rail has to
        // shed the card and scroll at that width.
        "flex gap-1 flex-nowrap p-2 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        "rounded-[20px] border border-[rgba(255,255,255,0.08)] border-t-[rgba(255,255,255,0.14)] bg-[rgba(0,0,0,0.20)] backdrop-blur-[60px]",
        // xl and up: the rail proper — no card, and a spine rather than a
        // panel. Navigation should be quieter and narrower than the content it
        // points at; as a glass panel it competed with the report and reserved
        // a column far wider than the little it holds. The line down the left
        // carries a dot per section, lime at the one you are reading.
        "xl:flex-col xl:gap-0 xl:p-0 xl:pl-[18px] xl:rounded-none xl:border-0 xl:bg-transparent xl:backdrop-blur-none",
        "xl:relative xl:before:content-[''] xl:before:absolute xl:before:left-[3px] xl:before:top-2 xl:before:bottom-2 xl:before:w-px xl:before:bg-[rgba(255,255,255,0.10)]",
        "xl:overflow-x-hidden xl:overflow-y-auto xl:max-h-[calc(100vh-9rem)]",
        "print:static print:overflow-visible print:flex-wrap print:flex-row",
        className,
      )}
    >
      <p className="hidden xl:block t-label uppercase tracking-[0.14em] pb-3 pl-0">On this page</p>
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
              // A dot on the spine per section, lime where you are.
              "xl:w-full xl:rounded-none xl:py-[7px] xl:px-0 xl:whitespace-normal xl:text-left",
              "xl:relative xl:hover:bg-transparent",
              "xl:before:content-[''] xl:before:absolute xl:before:-left-[18px] xl:before:top-[14px] xl:before:h-[7px] xl:before:w-[7px] xl:before:rounded-full",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(185,224,69,0.45)]",
              on
                ? "bg-[rgba(255,255,255,0.06)] text-white xl:bg-transparent xl:font-semibold xl:before:bg-[#b9e045] xl:before:shadow-[0_0_0_4px_rgba(185,224,69,0.14)]"
                : "text-[#9ca3af] hover:text-white hover:bg-[rgba(255,255,255,0.03)] xl:before:bg-[rgba(255,255,255,0.18)]",
            )}
          >
            {it.label}
          </a>
        );
      })}
    </nav>
  );
}
