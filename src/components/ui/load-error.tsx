import { useEffect, useRef } from "react";
import { Loading } from "@/components/ui/loading";

/** The waits before each new try of a load that did not answer: quick at first, then once a minute while the page is open. */
export const LOAD_RETRY_WAITS_MS = [3_000, 10_000, 30_000, 60_000] as const;

/**
 * A load that did not answer (a dropped connection, a server restart), tried
 * again on its own. Nothing failed is shown: the reader sees the loading
 * state, and the page fills in when a try answers (Lital, 19 Oct 2026:
 * nothing may fail and flag the user it failed). The tries go on while this
 * is on screen, so a page left open recovers by itself.
 *
 * Kept apart from EmptyState: a load that did not answer never claims
 * anything about the data (an empty state does). The error's own text goes
 * to the console for the team, named by `context`.
 */
export function LoadRetry({
  onRetry,
  context,
  error,
  label = "Loading",
  className,
}: {
  onRetry: () => unknown;
  /** What was loading, for the console. */
  context?: string;
  error?: unknown;
  label?: string;
  className?: string;
}) {
  const retry = useRef(onRetry);
  retry.current = onRetry;

  useEffect(() => {
    const raw =
      error instanceof Error ? error.message
        : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message
          : "";
    console.warn("[load retry]", context ?? label, raw);
  }, [error, context, label]);

  useEffect(() => {
    let tries = 0;
    let timer: number | undefined;
    const schedule = () => {
      const wait = LOAD_RETRY_WAITS_MS[Math.min(tries, LOAD_RETRY_WAITS_MS.length - 1)];
      timer = window.setTimeout(() => {
        tries += 1;
        void Promise.resolve().then(() => retry.current()).catch(() => undefined);
        schedule();
      }, wait);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, []);

  return <Loading label={label} className={className} />;
}
