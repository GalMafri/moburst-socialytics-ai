import { useEffect, useRef } from "react";
import { track } from "@/lib/telemetry";

/**
 * Tracks that a user opened a piece of generated output, and how long they
 * actually spent on it.
 *
 * This closes the single biggest measurement gap in both products: the
 * database records that a report was generated, but nothing records whether
 * anyone read it. "Generated" and "delivered value" are different numbers.
 *
 * Emits `<name>_opened` once the entity id is known, then `<name>_closed`
 * with dwell time and how far down the page the reader got. Time spent with
 * the tab hidden is excluded, so dwell reflects attention rather than an
 * abandoned tab left open overnight.
 */
export function useTrackView(name: string, entityId?: string | null, props: Record<string, unknown> = {}) {
  const opened = useRef(false);
  const activeMs = useRef(0);
  const lastResume = useRef(0);
  const maxScroll = useRef(0);
  // Keep the latest props without making them a dependency, so a new object
  // literal on each render cannot re-fire the open event.
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!entityId || opened.current) return;
    opened.current = true;
    lastResume.current = performance.now();

    track(`${name}_opened`, { entity_id: entityId, ...propsRef.current });

    const onScroll = () => {
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const pct = scrollable > 0 ? Math.round((doc.scrollTop / scrollable) * 100) : 100;
      if (pct > maxScroll.current) maxScroll.current = Math.min(100, pct);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        if (lastResume.current) activeMs.current += performance.now() - lastResume.current;
        lastResume.current = 0;
      } else {
        lastResume.current = performance.now();
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      if (lastResume.current) activeMs.current += performance.now() - lastResume.current;
      track(`${name}_closed`, {
        entity_id: entityId,
        duration_ms: activeMs.current,
        scroll_pct: maxScroll.current,
        ...propsRef.current,
      });
    };
  }, [name, entityId]);
}
