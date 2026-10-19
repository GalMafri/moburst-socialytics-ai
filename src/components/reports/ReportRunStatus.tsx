import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { minutesRunning, RUN_ESTIMATE } from "@/lib/reportRun";
import { formatDateTime, formatRange } from "@/lib/display";
import type { ReportRunView } from "@/hooks/useReportRun";

/**
 * Where a report run stands, from the request until its report exists. A run
 * that does not finish is made again by the product, so this says when, and
 * never shows a failure or a retry.
 */
export function ReportRunStatus({ view, kind }: { view: ReportRunView; kind: "monthly" | "competitive" }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const noun = kind === "competitive" ? "Competitive analysis" : "Analysis";
  if (view.state === "idle" || view.state === "ready") return null;
  const range = "range" in view && view.range ? formatRange(view.range) : "";
  return <div className="space-y-4 text-center" role="status">
    <div className="flex items-center justify-center gap-2">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="font-medium">
        {view.state === "running" ? `${noun} in progress` : view.state === "again" ? `${noun} runs again on its own` : `Starting the ${noun.toLowerCase()}`}
      </span>
    </div>
    {range && <p className="t-secondary mx-auto">{range}</p>}
    {view.state === "again"
      ? <p className="t-secondary mx-auto">It runs again at {formatDateTime(view.nextAt)} and appears in report history when it is ready.</p>
      : <p className="t-secondary mx-auto">{RUN_ESTIMATE}</p>}
    {view.state === "running" && <p className="t-secondary mx-auto">Elapsed: {Math.floor(minutesRunning({ created_at: view.startedAt }, now))} minutes. This page updates when the report is ready.</p>}
  </div>;
}
