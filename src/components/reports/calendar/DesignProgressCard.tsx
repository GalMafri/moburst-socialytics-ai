/**
 * Progress for a post's design, inside its Design tab: three named steps,
 * how long it has been running against how long it usually takes, and a
 * reminder that closing the panel does not stop anything.
 */

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { stepsFor, cancelDesign, elapsedLabel, progressPercent, stageIndex, typicalMinutes, type DesignRequest } from "@/lib/designRequests";
import { useDesignRequests } from "./DesignRequestsContext";

export function DesignProgressCard({ request, replacing = false }: { request: DesignRequest; isStaff: boolean; replacing?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ctx = useDesignRequests();
  const history = ctx?.requests ?? [];
  const [confirming, setConfirming] = useState(false);
  const stop = async () => {
    try {
      await cancelDesign(request.id);
      toast.success(`The ${request.kind === "carousel" ? "carousel" : request.kind === "video" ? "video" : "design"} was stopped`);
    } catch {
      // The card stays while it is still being prepared, so Cancel can simply be pressed again.
    }
    ctx?.refresh();
  };
  const current = stageIndex(request);
  const pct = progressPercent(request);
  const noun = request.kind === "carousel" ? "carousel" : request.kind === "video" ? "video" : "design";
  const usual = typicalMinutes(request, history);
  const since = request.started_at ?? request.created_at;
  const over = now - new Date(since).getTime() > usual * 60_000;

  return (
    <div role="status" aria-live="polite" className="glass-inner p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="t-h4">
            {replacing ? `Making a new ${noun}` : `Preparing your ${noun}`}
          </p>
          <p className="t-secondary mt-0.5">
            {`${over ? "Taking a little longer than usual" : `Usually about ${usual} minutes`}. ${replacing ? `The current ${noun} stays until the new one is ready. ` : ""}You can close this panel; it keeps going.`}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-1">
          <span className="t-label tabular-nums">{elapsedLabel(since, now)}</span>
          <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setConfirming(true)} aria-label={`Stop preparing this ${noun}`}>
            <X className="h-3.5 w-3.5 mr-1" aria-hidden />Cancel
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Stop preparing this ${noun}?`}
        description={replacing ? `It stops now, and the current ${noun} stays on the post. You can make a new one any time.` : `It stops now. You can start a new one any time.`}
        confirmLabel="Stop it"
        onConfirm={async () => { setConfirming(false); await stop(); }}
      />

      <ol className="grid grid-cols-3 gap-2" aria-label="Steps">
        {stepsFor(request).map((step, i) => {
          const done = i < current;
          const active = i === current;
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
