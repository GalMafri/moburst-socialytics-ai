import { useEffect, useState } from "react";
import { Ban, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * What a generation is doing right now, and how long it usually takes.
 *
 * A spinner with "Generating…" leaves the person guessing whether ten seconds
 * or four minutes is normal. This names the stages, marks the one in
 * progress, shows the clock, and says up front what "usual" is, so a wait is
 * a wait and not a worry.
 */
export function GenerationStages({
  stages,
  current,
  startedAt,
  estimate,
  note,
  done,
  total,
  failed = 0,
  onCancel,
  cancelling,
}: {
  stages: string[];
  /** Index of the stage in progress; stages before it are done. */
  current: number;
  startedAt: number;
  /** Plain words: "about a minute", "2 to 4 minutes". */
  estimate: string;
  /** One line under the clock, e.g. that the dialog can be closed. */
  note?: string;
  done?: number;
  total?: number;
  failed?: number;
  onCancel: () => void;
  cancelling: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(1, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="glass-inner p-4 space-y-4" role="status" aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <p className="t-body text-white">
          {cancelling ? "Stopping after the current step" : stages[current] || "Working"}
          {typeof done === "number" && typeof total === "number" && total > 1 ? (
            <span className="t-secondary"> · {done}/{total} done{failed ? `, ${failed} dropped` : ""}</span>
          ) : null}
        </p>
        <p className="t-label tabular-nums text-[#d1d5db]">
          {mm}:{ss} <span className="text-[#9ca3af]">/ usually {estimate}</span>
        </p>
      </div>
      <ol className="space-y-2">
        {stages.map((label, i) => {
          const state = i < current ? "done" : i === current ? "now" : "next";
          return (
            <li key={label} className="flex items-center gap-3">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                  state === "done"
                    ? "border-[#b9e045] bg-[#b9e045] text-black"
                    : state === "now"
                    ? "border-[#b9e045] text-[#b9e045]"
                    : "border-[rgba(255,255,255,0.18)] text-transparent"
                }`}
                aria-hidden
              >
                {state === "done" ? <Check className="h-3 w-3" /> : state === "now" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              </span>
              <span className={state === "next" ? "t-body text-[#9ca3af]" : "t-body text-white"}>{label}</span>
            </li>
          );
        })}
      </ol>
      {note && <p className="t-secondary">{note}</p>}
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={cancelling}
          className="text-red-300 hover:text-red-200 hover:bg-[rgba(239,68,68,0.10)] border-[rgba(239,68,68,0.30)]"
        >
          <Ban className="h-3.5 w-3.5 mr-1.5" />
          {cancelling ? "Stopping…" : "Stop"}
        </Button>
      </div>
    </div>
  );
}
