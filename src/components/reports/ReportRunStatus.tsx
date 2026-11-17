import { useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";
import { minutesRunning, RUN_ESTIMATE } from "@/lib/reportRun";
import { formatDateTime, formatRange } from "@/lib/display";
import type { ReportRunView } from "@/hooks/useReportRun";

/**
 * Where a report run stands, from the request until its report exists. A run
 * that does not finish is made again by the product, so this says when, and
 * never shows a failure or a retry. A competitive analysis that waits for its
 * competitors to be tracked says so, and promises no time: `tracked` is
 * whether the confirmed selection is tracked, where the page knows. While it
 * is not, a request cannot start, so one that is only starting or between
 * runs reads as waiting for tracking too: the dispatch puts it there on its
 * next look (run-scheduled-jobs/dispatch.ts). `notCovered` is the one case
 * where tracking exists but does not hold the confirmed selection: the
 * request waits for the two to match.
 */
export function ReportRunStatus({ view, kind, tracked, notCovered }: { view: ReportRunView; kind: "monthly" | "competitive"; tracked?: boolean; notCovered?: boolean }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const noun = kind === "competitive" ? "Competitive analysis" : "Analysis";
  if (view.state === "idle" || view.state === "ready") return null;
  const range = "range" in view && view.range ? formatRange(view.range) : "";
  const untracked = kind === "competitive" && tracked === false;
  if (view.state === "waiting" || (untracked && (view.state === "starting" || view.state === "again"))) {
    return <div className="space-y-4 text-center" role="status">
      <div className="flex items-center justify-center gap-2">
        <Clock className="h-5 w-5" aria-hidden />
        <span className="font-medium">{tracked ? `${noun} not started yet` : notCovered ? "Waiting for tracking to cover this selection" : "Waiting for tracking"}</span>
      </div>
      {range && <p className="t-secondary mx-auto">{range}</p>}
      <p className="t-secondary mx-auto">
        {tracked
          ? "It starts on its own and appears in report history when it is ready."
          : notCovered ? "The analysis starts on its own once the tracked companies match the confirmed competitors, and appears in report history when it is ready."
          : "The analysis starts on its own once tracking of these competitors has started, and appears in report history when it is ready."}
      </p>
    </div>;
  }
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
