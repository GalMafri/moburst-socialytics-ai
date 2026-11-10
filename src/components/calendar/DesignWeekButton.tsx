/**
 * The week's design button, in the week band of a client's calendar (Lital,
 * 2 Nov 2026: "one button to design a whole week's posts, on request only,
 * never automatic"). Moburst staff see what a press would design and roughly
 * what it costs, press it, and can stop the rest; everyone sees the week's
 * progress, and how many posts were designed once it is done. Nothing here
 * reports a failure: a press that did not get through is sent again quietly
 * (src/lib/designWeek.ts) and the band shows what the server has.
 */

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { designRequestsQuery, weekRunsQuery } from "@/components/reports/calendar/DesignRequestsContext";
import {
  buttonLabel, designWeek, doneLine, filmingLine, postsToDesign, previewLine, previewWeek, progressLine, stopWeek, waitingLine, weekMinutes, weekProgress,
} from "@/lib/designWeek";

export function DesignWeekBand({ clientId, clientName, week }: { clientId: string; clientName: string | null; week: string }) {
  const { isMoburstStaff } = useAuth();
  const qc = useQueryClient();
  const { data: runs = [] } = useQuery(weekRunsQuery(clientId));
  // The week's newest run (runs come newest first).
  const run = runs.find((r) => r.week_start === week) ?? null;
  const { data: requests = [] } = useQuery(designRequestsQuery(clientId, run?.status === "running"));
  const progress = run ? weekProgress(run, new Map(requests.map((r) => [r.id, r]))) : null;
  // What a press would design, for staff; asked again as the week moves on.
  const { data: preview } = useQuery({
    queryKey: ["design-week-preview", clientId, week, run?.id ?? null, run?.status ?? null, run?.posts.length ?? 0, progress?.ready ?? 0],
    enabled: isMoburstStaff,
    queryFn: () => previewWeek(clientId, week),
  });
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["design-week-runs", clientId] });
    void qc.invalidateQueries({ queryKey: ["design-requests", clientId] });
    void qc.invalidateQueries({ queryKey: ["design-week-preview", clientId, week] });
  };

  const weekCounts = preview && !preview.code ? preview.counts : undefined;
  // Videos whose price could not be read wait for the next press: what a press designs now leaves them out.
  const unpriced = !!preview?.price_unavailable && (weekCounts?.video ?? 0) > 0;
  const counts = weekCounts && unpriced ? { ...weekCounts, video: 0 } : weekCounts;
  const n = postsToDesign(counts);
  const minutes = counts ? weekMinutes(counts, requests) : 0;
  const credits = preview?.credits ?? 0;
  const offered = isMoburstStaff && !!counts && n > 0;
  const stoppable = isMoburstStaff && run?.status === "running" && run.posts.some((p) => p.state === "queued");
  const active = !!progress?.active;
  const designed = !active && progress && progress.ready > 0 ? progress.ready : 0;
  const filming = offered ? filmingLine(counts!.filming) : null;
  const waiting = isMoburstStaff && preview?.code === "not_set_up" ? waitingLine(preview.waiting_for, preview.client_name ?? clientName) : null;
  const priceLine = isMoburstStaff && unpriced
    ? `Video prices can't be read right now. The videos wait for the next press.${n > 0 ? " The other posts go ahead." : ""}`
    : null;

  const press = async () => {
    if (!counts) return;
    setBusy(true);
    const started = await designWeek({
      clientId, week,
      estimate: { posts: n, single: counts.single, story: counts.story ?? 0, carousel: counts.carousel, video: counts.video, credits, credits_per_clip: preview?.credits_per_clip ?? null, minutes },
    });
    setBusy(false);
    if (started?.run) {
      const description = (started.left_out_no_price ?? 0) > 0
        ? "The videos wait for the next press; the other posts are being designed."
        : "Each post shows where it stands on its card.";
      toast.success("Designing this week's posts", { description });
    }
    refresh();
  };
  const stop = async () => {
    if (!run) return;
    const stopped = await stopWeek(run.id);
    if (stopped) toast.success("The rest of this week won't be designed", { description: "Posts already being designed finish." });
    refresh();
  };

  if (!active && !designed && !waiting && !offered && !priceLine) return null;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {active && progress && (
        <p role="status" className="t-secondary flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {progressLine(progress)}
        </p>
      )}
      {designed > 0 && <p className="t-secondary">{doneLine(designed, isMoburstStaff && run && preview?.run_id === run.id ? preview.credits_used : null)}</p>}
      {waiting && <p className="t-secondary">{waiting}</p>}
      {offered && <p className="t-secondary">{previewLine(counts!, credits, minutes)}</p>}
      {priceLine && <p className="t-secondary">{priceLine}</p>}
      {filming && <p className="t-secondary">{filming}</p>}
      {offered && (
        <Button size="sm" onClick={press} disabled={busy}>
          {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
          {buttonLabel(n)}
        </Button>
      )}
      {stoppable && (
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          Stop designing the rest
        </Button>
      )}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Stop designing the rest of this week?"
        description="Posts that haven't started are left without a design. Posts already being designed finish, and each can be stopped on its own post."
        confirmLabel="Stop the rest"
        onConfirm={async () => { setConfirming(false); await stop(); }}
      />
    </div>
  );
}
