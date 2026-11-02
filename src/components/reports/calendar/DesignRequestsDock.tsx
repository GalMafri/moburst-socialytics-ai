/**
 * Design progress that stays on screen: one card per post whose designs are
 * being prepared, and a card for each that just finished, in the same
 * bottom-right column as the other generation cards. "Open" takes you to the
 * post's Design tab. A week being designed (the week's design button) is one
 * card for the whole week, not one per post.
 *
 * Built after Lital's notes on the 12 Oct build: the status disappeared after
 * a second, a user had to scroll to find each post's state, and "Open" did
 * nothing.
 */

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, Loader2, Sparkles, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useDesignRequests } from "./DesignRequestsContext";
import { isPreparing, progressPercent, stageLine, type DesignRequest } from "@/lib/designRequests";
import { postLabel } from "@/lib/designRequestLabels";
import { weekProgress } from "@/lib/designWeek";

const DISMISSED_KEY = "socialytics.design-dock.dismissed";
const SHOW_READY_FOR_MS = 30 * 60 * 1000;

function loadDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveDismissed(ids: Set<string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...ids].slice(-200)));
  } catch {
    // Storage can be unavailable (private window); dismissal then lasts for the visit.
  }
}

export function DesignRequestsDockItems() {
  const ctx = useDesignRequests();
  const { isMoburstStaff } = useAuth();
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!ctx) return null;

  const now = Date.now();
  const recent = (at: string | null | undefined) => !!at && now - new Date(at).getTime() < SHOW_READY_FOR_MS;
  // Only what the signed-in person asked for; other people's designs show on their posts.
  const mine = ctx.requests.filter((r) => !!r.requested_by && r.requested_by === ctx.myId);

  // A week being designed is one card: its posts' requests carry its id.
  const weeks = new Map<string, DesignRequest[]>();
  for (const r of mine) if (r.batch_id) weeks.set(r.batch_id, [...(weeks.get(r.batch_id) ?? []), r]);
  const weekCards = [...weeks].flatMap(([id, requests]) => {
    if (dismissed.has(`week:${id}`)) return [];
    const run = ctx.weekRuns.find((w) => w.id === id);
    const progress = run
      ? weekProgress(run, new Map(ctx.requests.map((r) => [r.id, r])))
      : { total: requests.length, ready: requests.filter((r) => r.status === "ready").length, active: requests.some((r) => r.status === "preparing") };
    const lastReady = requests.filter((r) => r.status === "ready").map((r) => r.updated_at).sort().pop();
    if (!progress.active && !(progress.ready > 0 && recent(run?.finished_at ?? lastReady))) return [];
    return [{ id, requests, progress }];
  });

  const shown = mine.filter((r) => {
    if (r.batch_id || dismissed.has(r.id)) return false;
    if (isPreparing(r, isMoburstStaff)) return true;
    return r.status === "ready" && recent(r.updated_at);
  }).slice(0, Math.max(0, 4 - weekCards.length));
  if (!shown.length && !weekCards.length) return null;

  const dismiss = (id: string) => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    saveDismissed(next);
  };

  return (
    <>
      {weekCards.slice(0, 4).map((w) => (
        <WeekDockCard key={w.id} requests={w.requests} progress={w.progress} onOpen={(key) => ctx.openDesigns(key)} onDismiss={() => dismiss(`week:${w.id}`)} />
      ))}
      {shown.map((r) => <DockCard key={r.id} request={r} isStaff={isMoburstStaff} onOpen={() => ctx.openDesigns(r.calendar_post_key)} onDismiss={() => dismiss(r.id)} />)}
    </>
  );
}

function WeekDockCard({ requests, progress, onOpen, onDismiss }: { requests: DesignRequest[]; progress: { total: number; ready: number; active: boolean }; onOpen: (calendarPostKey: string) => void; onDismiss: () => void }) {
  const pct = Math.round((progress.ready / Math.max(1, progress.total)) * 100);
  // Open the post being designed now, else the latest one that is ready.
  const target = requests.find((r) => r.status === "preparing") ?? requests.find((r) => r.status === "ready") ?? requests[0];
  const done = !progress.active;
  return (
    <div role="status" aria-live="polite" className="glass-elevated rounded-[16px] p-4 w-80 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className={`shrink-0 rounded-full p-1.5 ${done ? "bg-[rgba(16,185,129,0.10)] text-[#10b981]" : "bg-[rgba(185,224,69,0.10)] text-[#b9e045]"}`}>
          {done ? <CheckCircle2 className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="t-h4">{done ? "This week's posts are designed" : "Designing this week's posts"}</p>
          <p className="t-label tracking-[-0.2px] truncate mt-0.5">{`${progress.ready} of ${progress.total} ready`}</p>
        </div>
        {done && (
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-[#b1b7c1] hover:text-white hover:bg-[rgba(255,255,255,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-3 h-1.5 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
        <div className={`h-full transition-[width] duration-500 ease-out ${done ? "bg-[#10b981]" : "bg-[#b9e045]"}`} style={{ width: `${pct}%` }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} />
      </div>
      {target && (
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => onOpen(target.calendar_post_key)} className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-[8px] bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] text-sm font-medium text-white tracking-[-0.2px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Open
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function DockCard({ request, isStaff, onOpen, onDismiss }: { request: DesignRequest; isStaff: boolean; onOpen: () => void; onDismiss: () => void }) {
  const preparing = isPreparing(request, isStaff);
  const ready = request.status === "ready";
  const pct = progressPercent(request);
  return (
    <div role="status" aria-live="polite" className="glass-elevated rounded-[16px] p-4 w-80 animate-slide-up">
      <div className="flex items-start gap-3">
        <div className={`shrink-0 rounded-full p-1.5 ${ready ? "bg-[rgba(16,185,129,0.10)] text-[#10b981]" : "bg-[rgba(185,224,69,0.10)] text-[#b9e045]"}`}>
          {ready ? <CheckCircle2 className="h-4 w-4" /> : preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="t-h4">
            {ready ? stageLine(request, isStaff) : preparing ? `Preparing your ${nounOf(request)}` : stageLine(request, isStaff)}
          </p>
          <p className="t-label tracking-[-0.2px] truncate mt-0.5">{postLabel(request)}</p>
        </div>
        {!preparing && (
          <button type="button" onClick={onDismiss} aria-label="Dismiss" className="shrink-0 rounded-full p-1 text-[#b1b7c1] hover:text-white hover:bg-[rgba(255,255,255,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-3 h-1.5 w-full rounded-full bg-[rgba(255,255,255,0.06)] overflow-hidden">
        <div className={`h-full transition-[width] duration-500 ease-out ${ready ? "bg-[#10b981]" : "bg-[#b9e045]"}`} style={{ width: `${pct}%` }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} />
      </div>
      {preparing && <p className="mt-1.5 t-subhead">{stageLine(request, isStaff)}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={onOpen} className="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-[8px] bg-[rgba(255,255,255,0.06)] hover:bg-[rgba(255,255,255,0.10)] text-sm font-medium text-white tracking-[-0.2px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {ready ? `View ${nounOf(request)}` : "Open"}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function nounOf(r: DesignRequest): string {
  return r.kind === "carousel" ? "carousel" : r.kind === "video" ? "video" : "design";
}

