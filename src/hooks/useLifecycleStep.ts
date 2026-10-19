import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendQuietly, writeResendable } from "@/lib/quietSend";

/** The lifecycle steps a person can ask to run again (lifecycle_request). */
export type LifecycleStepName = "brand_read" | "brief_pillars" | "accounts" | "access" | "design_refs" | "competitors" | "tracking" | "design_settings" | "first_output";

export interface LifecycleStepRow {
  status: "running" | "done" | "waiting" | "failed";
  attempted_at: string | null;
  done_at: string | null;
}

/** A run that has not reported for this long died (policy.ts STALE_RUN_MS); it is not shown as in progress. */
const STALE_MS = 30 * 60_000;
const POLL_MS = 10_000;

/**
 * One step of a client's lifecycle, as the setup page shows it: when it last
 * produced something, whether it is running now, and a quiet way to ask for
 * it again. The step's own error is never read or shown: a step that did not
 * finish is tried again by the server (policy.ts).
 */
export function useLifecycleStep(clientId: string | undefined, step: LifecycleStepName, opts: { onDone?: () => void } = {}) {
  const queryClient = useQueryClient();
  const [asking, setAsking] = useState(false);
  const key = ["lifecycle-step", clientId, step];
  const { data: row } = useQuery({
    queryKey: key,
    enabled: !!clientId,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from as any)("client_lifecycle_steps").select("status, attempted_at, done_at").eq("client_id", clientId).eq("step", step).maybeSingle();
      if (error) throw error;
      return (data ?? null) as LifecycleStepRow | null;
    },
    refetchInterval: (q) => {
      const r = q.state.data as LifecycleStepRow | null | undefined;
      return r?.status === "running" ? POLL_MS : false;
    },
  });
  const running = !!row && row.status === "running" && Date.now() - Date.parse(row.attempted_at ?? "") < STALE_MS;

  // When a run this page watched finishes, the page reads what it produced.
  const wasRunning = useRef(false);
  const onDone = useRef(opts.onDone);
  onDone.current = opts.onDone;
  useEffect(() => {
    if (wasRunning.current && !running) onDone.current?.();
    wasRunning.current = running;
  }, [running]);

  // Asking only queues the step on the server; a request that does not get through is sent again quietly.
  const refresh = useCallback(async () => {
    if (!clientId) return;
    setAsking(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await sendQuietly(() => (supabase.rpc as any)("lifecycle_request", { p_client: clientId, p_step: step }), { again: writeResendable });
    if (!error) queryClient.setQueryData(key, (r: LifecycleStepRow | null | undefined) => ({ status: "running", attempted_at: new Date().toISOString(), done_at: r?.done_at ?? null }));
    void queryClient.invalidateQueries({ queryKey: key });
    setAsking(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, step, queryClient]);

  return { row: row ?? null, running: running || asking, refresh };
}
