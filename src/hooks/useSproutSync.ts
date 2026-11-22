// The "Sync from Sprout" run as the staff dashboard holds it
// (src/components/dashboard/SproutSync.tsx): read from the server when the
// dashboard opens and every ten seconds while a run is under way, so the
// button is busy across reloads and for everyone on staff. A press starts
// one run at most; when the run this page watched is over, one line says
// what it did and the client list is read again.

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { finishedLine, readSproutSync, startSproutSync, SYNC_NOT_STARTED, type SproutSyncState, type SyncLine } from "@/lib/sproutSync";

const SYNC_KEY = ["sprout-sync"];
/** How often the run is looked at while one is under way. */
const SYNC_POLL_MS = 10_000;

export interface SproutSync {
  /** A run is under way, or a press is on its way to the server. */
  busy: boolean;
  /** The run under way is on another try. */
  slow: boolean;
  /** What the run this page watched came to, until dismissed. */
  line: SyncLine | null;
  start: () => void;
  dismiss: () => void;
}

/** The run as the server has it, for the people who can manage clients (`enabled`). */
export function useSproutSync(enabled: boolean): SproutSync {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: SYNC_KEY,
    enabled: enabled === true,
    queryFn: readSproutSync,
    refetchInterval: (query) => ((query.state.data as SproutSyncState | undefined)?.open ? SYNC_POLL_MS : false),
  });
  const [starting, setStarting] = useState(false);
  const [line, setLine] = useState<SyncLine | null>(null);
  const pressing = useRef(false);
  // Whether this page has seen a run under way: only then does it say how the run ended.
  const watched = useRef(false);
  const state = status.data ?? null;
  const open = !!state?.open;

  useEffect(() => {
    if (!state) return;
    if (state.open) {
      watched.current = true;
      setLine(null);
      return;
    }
    if (!watched.current) return;
    watched.current = false;
    setLine(finishedLine(state.last));
    // New clients appear in the list.
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  }, [state, queryClient]);

  const start = useCallback(() => {
    if (pressing.current || open) return;
    pressing.current = true;
    setStarting(true);
    setLine(null);
    void startSproutSync().then(async (reply) => {
      if (!reply || (!reply.started && !reply.sync.open)) {
        pressing.current = false;
        setStarting(false);
        setLine({ added: [], text: SYNC_NOT_STARTED });
        return;
      }
      // QA 22 Nov 2026: a read of the run that left before the press (the dashboard opening, the tab
      // regaining focus) is stopped first. Landing after the press's answer, it said the run was over
      // and showed the last run's line while the new run went on.
      await queryClient.cancelQueries({ queryKey: SYNC_KEY });
      watched.current = true;
      queryClient.setQueryData(SYNC_KEY, reply.sync);
      pressing.current = false;
      setStarting(false);
    });
  }, [open, queryClient]);

  const dismiss = useCallback(() => setLine(null), []);
  return { busy: starting || open, slow: open && !!state?.slow, line, start, dismiss };
}
