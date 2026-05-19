/**
 * Floating progress indicator. Shows up bottom-right when there's at least one
 * active or recently-completed generation. Pulls from GenerationContext.
 *
 * Each entry renders as a glass card with a progress bar, a "View" button
 * that opens the PostPanel for that post, and a dismiss × on completed entries.
 */

import { Sparkles, Video as VideoIcon, X, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import { useGenerationContext } from "./GenerationContext";

const DISMISS_AFTER_MS = 90_000; // auto-dismiss completed entries after 90s

export function GenerationProgress() {
  const { generations, openPanel, dismissGeneration } = useGenerationContext();
  const entries = Object.values(generations).sort((a, b) => b.startedAt - a.startedAt);

  if (entries.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm print:hidden">
      {entries.map((g) => {
        // Auto-dismiss completed older than threshold (best-effort, fires on
        // re-render; user can also click × any time).
        if (
          g.status !== "running" &&
          g.completedAt &&
          Date.now() - g.completedAt > DISMISS_AFTER_MS
        ) {
          setTimeout(() => dismissGeneration(g.postKey), 0);
          return null;
        }

        const pct = Math.round((g.completed / Math.max(g.total, 1)) * 100);
        const Icon = g.type === "design" ? Sparkles : VideoIcon;
        const isDone = g.status === "completed";
        const isFail = g.status === "failed";
        const successCount = g.completed - g.failed;

        return (
          <div
            key={g.postKey}
            role="status"
            aria-live="polite"
            className="glass-elevated rounded-[16px] p-4 w-80 animate-slide-up"
          >
            <div className="flex items-start gap-3">
              <div
                className={`shrink-0 rounded-full p-1.5 ${
                  isDone
                    ? "bg-[rgba(16,185,129,0.10)] text-[#10b981]"
                    : isFail
                    ? "bg-[rgba(239,68,68,0.10)] text-red-400"
                    : "bg-[rgba(185,224,69,0.10)] text-[#b9e045]"
                }`}
              >
                {isDone ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : isFail ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold tracking-[-0.2px] text-white">
                  {isDone
                    ? `${successCount} ${g.type === "design" ? "design" : "video"}${successCount === 1 ? "" : "s"} ready`
                    : isFail
                    ? `${g.type === "design" ? "Design" : "Video"} generation failed`
                    : `Generating ${g.total} ${g.type === "design" ? "design" : "video"}${g.total === 1 ? "" : "s"}…`}
                </p>
                <p className="text-xs text-[#9ca3af] tracking-[-0.2px] truncate mt-0.5">
                  {g.postLabel}
                </p>
              </div>
              {g.status !== "running" && (
                <button
                  type="button"
                  onClick={() => dismissGeneration(g.postKey)}
                  aria-label="Dismiss"
                  className="shrink-0 rounded-full p-1 text-[#9ca3af] hover:text-white hover:bg-[rgba(255,255,255,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Progress bar */}
            <div className="mt-3 h-1.5 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
              <div
                className={`h-full transition-[width] duration-500 ease-out ${
                  isFail ? "bg-red-400" : isDone ? "bg-[#10b981]" : "bg-[#b9e045]"
                }`}
                style={{ width: `${pct}%` }}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                role="progressbar"
              />
            </div>
            <p className="mt-1.5 text-[11px] uppercase tracking-wider text-[#9ca3af]">
              {g.completed}/{g.total} complete
              {g.failed > 0 && ` · ${g.failed} failed`}
            </p>

            {/* View action — open panel for this post. Passes the variant
                group id so the panel filters to the exact set we just made
                (rather than relying on the platform+copy match heuristic). */}
            {(isDone || g.completed > 0) && (
              <button
                type="button"
                onClick={() => openPanel(g.post, { variantGroupId: g.variantGroupId })}
                className="mt-3 w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-[8px] bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] text-sm font-medium text-white tracking-[-0.2px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                View {g.type === "design" ? "designs" : "videos"}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
