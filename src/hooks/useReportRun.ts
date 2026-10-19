import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeResendable, sendQuietly } from "@/lib/quietSend";
import { STUCK_AFTER_MINUTES } from "@/lib/reportRun";

/**
 * A report run a person asks for, from the moment they ask until the report
 * exists (self-serve design, rule 7, 19 Oct 2026).
 *
 * Asking only queues the run: run-report puts a manual dispatch job in the
 * scheduled-jobs queue, and the worker makes the report through the
 * scheduled path (run-scheduled-jobs/dispatch.ts), retries included. So the
 * page shows the run as running from the request until the report exists,
 * says when a run that did not finish runs again, and never shows a failure.
 * A report a schedule is running counts as running too, so nobody starts a
 * second one beside it.
 */

export type ReportRunKind = "social" | "competitive";
type Range = { start: string; end: string };

export type ReportRunView =
  | { state: "idle" }
  /** Asked for; the report does not exist yet. */
  | { state: "starting"; requestedAt: string; range: Range | null }
  /** A report is being made. */
  | { state: "running"; reportId: string; startedAt: string; range: Range | null }
  /** It did not finish, or (competitive) did not pass its checks: it runs again on its own at nextAt. */
  | { state: "again"; nextAt: string; range: Range | null }
  /** The run this page watched made its report. */
  | { state: "ready"; reportId: string };

interface RequestRow {
  job_id: string;
  status: string;
  requested_at: string;
  range_start: string | null;
  range_end: string | null;
  report_id: string | null;
  open: boolean;
  runs: number | null;
  next_at: string | null;
}
interface RunningRow { id: string; created_at: string; date_range_start: string | null; date_range_end: string | null }

const ACTIVE_POLL_MS = 8_000;
const IDLE_POLL_MS = 60_000;
/** Waits between tries when the request does not get through: run-report answers an open request once however often it is asked. */
const SEND_WAITS_MS = [1_000, 3_000, 9_000, 27_000, 60_000];

const rangeOf = (start: string | null | undefined, end: string | null | undefined): Range | null => (start && end ? { start: String(start).slice(0, 10), end: String(end).slice(0, 10) } : null);

/** The page's view from the newest manual request and the report running now. */
export function runView(request: RequestRow | null, running: RunningRow | null, watched: boolean): ReportRunView {
  if (running) return { state: "running", reportId: running.id, startedAt: running.created_at, range: rangeOf(running.date_range_start, running.date_range_end) };
  if (request?.open) {
    const range = rangeOf(request.range_start, request.range_end);
    if (request.report_id) return { state: "running", reportId: request.report_id, startedAt: request.requested_at, range };
    if ((request.runs ?? 0) > 0 && request.next_at && Date.parse(request.next_at) > Date.now()) return { state: "again", nextAt: request.next_at, range };
    return { state: "starting", requestedAt: request.requested_at, range };
  }
  if (watched && request?.status === "done" && request.report_id) return { state: "ready", reportId: request.report_id };
  return { state: "idle" };
}

export function useReportRun(clientId: string | undefined, kind: ReportRunKind) {
  const table = kind === "competitive" ? "competitive_reports" : "reports";
  const watched = useRef(false);
  const [sending, setSending] = useState(false);
  const [notStarted, setNotStarted] = useState(false);

  const query = useQuery({
    queryKey: ["report-run", kind, clientId],
    enabled: !!clientId,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const since = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString();
      const [req, run] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.rpc as any)("report_run_request", { p_client: clientId, p_kind: kind }),
        supabase.from(table).select("id, created_at, date_range_start, date_range_end").eq("client_id", clientId!).eq("status", "running")
          .gt("created_at", since).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      // Before the request view exists the page still sees the running report.
      const request = (Array.isArray(req?.data) ? req.data[0] : req?.data) as RequestRow | undefined;
      if (run.error) throw run.error;
      return { request: request ?? null, running: (run.data as RunningRow | null) ?? null };
    },
    refetchInterval: (q) => {
      const d = q.state.data as { request: RequestRow | null; running: RunningRow | null } | undefined;
      return d?.running || d?.request?.open ? ACTIVE_POLL_MS : IDLE_POLL_MS;
    },
  });

  const view = sending
    ? ({ state: "starting", requestedAt: new Date().toISOString(), range: null } as ReportRunView)
    : runView(query.data?.request ?? null, query.data?.running ?? null, watched.current);
  useEffect(() => {
    if (view.state === "starting" || view.state === "running" || view.state === "again") watched.current = true;
  }, [view.state]);

  /** Ask for a run. Resolves true once the server has it. */
  const start = useCallback(async (body: Record<string, unknown>) => {
    if (!clientId) return false;
    setSending(true);
    setNotStarted(false);
    watched.current = true;
    const reply = await sendQuietly(() => supabase.functions.invoke("run-report", { body: { client_id: clientId, kind, ...body } }), {
      again: (e) => invokeResendable(e, { idempotent: true }),
      waits: SEND_WAITS_MS,
    });
    const ok = !reply.error && !(reply.data as { error?: unknown } | null)?.error;
    if (!ok) console.warn("[report run] the request was not taken", reply.error ?? (reply.data as { error?: unknown } | null)?.error);
    await query.refetch();
    setSending(false);
    setNotStarted(!ok);
    return ok;
  }, [clientId, kind, query]);

  /** Back to a fresh form after a finished run. */
  const reset = useCallback(() => { watched.current = false; setNotStarted(false); void query.refetch(); }, [query]);

  return { view, start, reset, sending, notStarted, isLoading: query.isLoading, isError: query.isError };
}
