/**
 * Progress for a post's design, inside its Design tab: three named steps,
 * how long it has been running against how long it usually takes, and a
 * reminder that closing the panel does not stop anything.
 */

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { DESIGN_STEPS, elapsedLabel, progressPercent, stageIndex, typicalMinutes, type DesignRequest } from "@/lib/designRequests";
import { useDesignRequests } from "./DesignRequestsContext";

export function DesignProgressCard({ request, isStaff, replacing = false }: { request: DesignRequest; isStaff: boolean; replacing?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const history = useDesignRequests()?.requests ?? [];
  const current = stageIndex(request);
  const pct = progressPercent(request);
  const staffAttention = isStaff && request.status === "needs_staff";
  const noun = request.kind === "carousel" ? "carousel" : "design";
  const usual = typicalMinutes(request, history);
  const over = now - new Date(request.created_at).getTime() > usual * 60_000;

  return (
    <div role="status" aria-live="polite" className="glass-inner p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white tracking-[-0.2px]">
            {staffAttention ? `This ${noun} needs a look` : replacing ? `Making a new ${noun}` : `Preparing your ${noun}`}
          </p>
          <p className="t-secondary mt-0.5">
            {staffAttention
              ? request.error || "It did not finish. The client still sees it as being prepared."
              : `${over ? "Taking a little longer than usual" : `Usually about ${usual} minutes`}. ${replacing ? `The current ${noun} stays until the new one is ready. ` : ""}You can close this panel; it keeps going.`}
          </p>
        </div>
        <span className="t-label shrink-0 tabular-nums">{elapsedLabel(request.created_at, now)}</span>
      </div>

      <ol className="grid grid-cols-3 gap-2" aria-label="Steps">
        {DESIGN_STEPS.map((step, i) => {
          const done = i < current;
          const active = i === current && !staffAttention;
          return (
            <li key={step.stage} className="space-y-1.5">
              <div className={`h-1.5 rounded-full ${done ? "bg-[#b9e045]" : active ? "bg-[rgba(185,224,69,0.45)] animate-pulse" : "bg-[rgba(255,255,255,0.08)]"}`} />
              <p className={`t-label flex items-center gap-1 ${done || active ? "!text-white" : ""}`}>
                {done ? <Check className="h-3 w-3 text-[#b9e045]" aria-hidden /> : active ? <Loader2 className="h-3 w-3 animate-spin text-[#b9e045]" aria-hidden /> : null}
                {step.label}
              </p>
            </li>
          );
        })}
      </ol>
      <span className="sr-only">{pct}% done</span>
    </div>
  );
}
