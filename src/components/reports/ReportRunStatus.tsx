import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { canRetry, minutesRunning, RUN_ESTIMATE } from "@/lib/reportRun";
import { RetryReportButton } from "./RetryReportButton";

export function ReportRunStatus({ reportId, startedAt, kind, onStarted }: {
  reportId: string | null;
  startedAt: string | null;
  kind: "monthly" | "competitive";
  onStarted: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const report = { status: "running", created_at: startedAt };
  return <div className="space-y-4 text-center" role="status">
    <div className="flex items-center justify-center gap-2">
      <Loader2 className="h-5 w-5 animate-spin" />
      <span className="font-medium">{reportId ? "Analysis in progress" : "Starting analysis"}</span>
    </div>
    <p className="t-secondary mx-auto">{RUN_ESTIMATE}</p>
    {startedAt && <p className="t-secondary mx-auto">Elapsed: {Math.floor(minutesRunning(report, now))} minutes. This page updates when the report is ready.</p>}
    {reportId && canRetry(report, now) ? <>
      <p className="t-secondary mx-auto">This run has exceeded 90 minutes. It may still be working. Check its status before starting it again.</p>
      <RetryReportButton reportId={reportId} kind={kind} label="Review retry" onStarted={onStarted} />
    </> : <p className="t-secondary mx-auto">Retry is unavailable for the first 90 minutes to prevent duplicate analyses.</p>}
  </div>;
}
