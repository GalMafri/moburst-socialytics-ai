import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PlatformBadge } from "@/lib/platform-config";

/**
 * The one segmented filter for the app (platform, company, status, language):
 * a label, then a glass track of segments. It follows the Intercept tabs
 * spec: the active segment is the subtle raised white, never the lime, which
 * is kept for primary buttons.
 *
 * The calendar, the monthly report's top posts, the competitive report and
 * the competitor feed each had their own copy, in three sizes and two active
 * styles.
 */
export function SegmentedGroup({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 min-w-0", className)} role="group" aria-label={label}>
      {label && <span className="t-subhead shrink-0">{label}</span>}
      <div className="flex flex-wrap items-center gap-0.5 p-1 rounded-[12px] bg-[rgba(0,0,0,0.2)] backdrop-blur-xl border border-[rgba(255,255,255,0.07)] shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.03)]">
        {children}
      </div>
    </div>
  );
}

const segmentClass = (active: boolean) =>
  cn(
    "rounded-[8px] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(185,224,69,0.45)]",
    active
      ? "bg-[rgba(255,255,255,0.08)] text-white backdrop-blur-sm shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.06),0_2px_8px_rgba(0,0,0,0.2)]"
      : "text-[#b1b7c1] hover:text-white",
  );

export function Segment({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className={cn("px-3 py-1.5 t-label font-medium tracking-[-0.2px]", segmentClass(active))}
    >
      {children}
    </button>
  );
}

/** A segment that shows a platform's badge instead of a word. */
export function PlatformSegment({ active, platform, onClick }: { active: boolean; platform: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={platform} className={cn("px-2.5 py-1", segmentClass(active))}>
      <PlatformBadge platform={platform} size="sm" className={active ? "" : "opacity-60"} />
    </button>
  );
}
