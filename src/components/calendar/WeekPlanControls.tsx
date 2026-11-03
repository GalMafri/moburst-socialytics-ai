/**
 * Plan and revise the calendar a week at a time (Lital, 19 Oct 2026). Every
 * Monday the following week is planned on its own; "Plan next week" plans the
 * next week without a plan, up to a month ahead, and "Revise this week"
 * rewrites the posts nobody has worked on from a note. Staff and the client's
 * own users can use both. Both only queue work: a request that can't be sent
 * is sent again quietly (calendarRequests.ts), and no error is shown.
 *
 * While a week is being planned or revised, its band says so and where it
 * stands, from the plan as the server has it (Lital, 3 Nov 2026: a status
 * that stays, across reloads and pages). Planning can be stopped while it is
 * on its way, and a finished plan removed, each after a question; the server
 * decides (calendar_stop_plan) and the band shows what it answered.
 */

import { useState } from "react";
import { Check, CheckCircle2, Loader2, PenLine, Wand2 } from "lucide-react";
import { queueCalendarWork } from "@/lib/calendarRequests";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { canRemove, canRevise, canStop, shortDate, type CalendarPlanRow } from "@/lib/calendarPosts";
import { weekPlanView, type PlanStep } from "@/lib/weekPlanStatus";

/** The plan the server answered with, or null when there was no answer. */
const answeredPlan = (data: Record<string, unknown> | null) => (data?.plan && typeof data.plan === "object" ? data.plan as CalendarPlanRow : null);

/** onRequested gets the week being planned and its plan, or nulls when the request didn't go through (the page then shows what the server has). */
export function PlanNextWeekButton({ clientId, week, onRequested }: { clientId: string; week: string | null; onRequested: (week: string | null, plan: CalendarPlanRow | null) => void }) {
  const [busy, setBusy] = useState(false);
  if (!week) return null;
  const plan = async () => {
    setBusy(true);
    const data = await queueCalendarWork({ action: "plan_next_week", client_id: clientId });
    setBusy(false);
    // The week's band shows the planning from here on.
    onRequested(typeof data?.week === "string" ? data.week : null, answeredPlan(data));
  };
  return (
    <Button size="sm" onClick={plan} disabled={busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
      Plan the week of {shortDate(week)}
    </Button>
  );
}

export function ReviseWeekButton({ plan, onRequested }: { plan: CalendarPlanRow; onRequested: (plan: CalendarPlanRow | null) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const data = await queueCalendarWork({ action: "revise_week", plan_id: plan.id, note });
    setBusy(false);
    // Not sent: the dialog stays open with the note, ready to send again.
    if (!data) return;
    setOpen(false);
    setNote("");
    // The week's band shows the revision from here on.
    onRequested(answeredPlan(data));
  };
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <PenLine className="h-3.5 w-3.5 mr-1.5" />
        Revise this week
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Revise the week of {shortDate(plan.week_start)}</DialogTitle>
            <DialogDescription>
              Say what's off. Posts nobody has edited, designed or scheduled are rewritten to match, and later weeks follow your note too.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="For example: too formal, no emojis on LinkedIn, mention the free trial"
            aria-label="What should change"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={send} disabled={busy || !note.trim()}>
              {busy && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Revise the week
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Where a planning or a revision stands: waiting for a run, then the run writing. */
function PlanSteps({ steps }: { steps: PlanStep[] }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Progress">
      {steps.map((s) => (
        <li key={s.label} aria-current={s.state === "current" ? "step" : undefined} className={`t-label inline-flex items-center gap-1.5 ${s.state === "next" ? "opacity-50" : ""}`}>
          {s.state === "done" ? <Check className="h-3 w-3" aria-hidden /> : <span className={`inline-block h-1.5 w-1.5 rounded-full bg-current ${s.state === "current" ? "animate-pulse" : ""}`} aria-hidden />}
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/**
 * The week's plan in its band: being planned (with Stop planning), being
 * revised, planned or revised (with Revise this week and Remove this week's
 * plan), or stopped. canAct: the client is not archived, so its calendar can
 * be changed. onChanged gets the plan the server answered with, or null when
 * no answer came (the page then reads the plan again).
 */
export function WeekPlanBand({ plan, today, canAct, hasPosts, onChanged }: {
  plan: CalendarPlanRow;
  today: string;
  canAct: boolean;
  hasPosts: boolean;
  onChanged: (plan: CalendarPlanRow | null) => void;
}) {
  const [asking, setAsking] = useState<"stop" | "remove" | null>(null);
  const view = weekPlanView(plan, today);
  if (!view) return null;
  const week = shortDate(plan.week_start);

  const stop = async () => {
    const data = await queueCalendarWork({ action: "stop_plan", plan_id: plan.id });
    setAsking(null);
    onChanged(answeredPlan(data));
  };
  const question = (
    <ConfirmDialog
      open={asking !== null}
      onOpenChange={(open) => !open && setAsking(null)}
      title={asking === "remove" ? "Remove this week's plan?" : `Stop planning the week of ${week}?`}
      description={asking === "remove"
        ? "Posts nobody has edited, designed or scheduled leave the calendar. Posts someone worked on stay where they are. You can plan the week again afterwards."
        : "Nothing more is written for this week, and it goes back to having no plan. You can plan it again whenever you like."}
      confirmLabel={asking === "remove" ? "Remove the plan" : "Stop planning"}
      onConfirm={stop}
    />
  );

  if (view.kind === "planning" || view.kind === "revising") {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="t-secondary flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> {view.line}
          </p>
          {view.kind === "revising" && <p className="t-label max-w-[28ch] truncate" title={view.note}>"{view.note}"</p>}
          <PlanSteps steps={view.steps} />
        </div>
        {canAct && canStop(plan) && (
          <Button size="sm" variant="outline" onClick={() => setAsking("stop")}>Stop planning</Button>
        )}
        {question}
      </div>
    );
  }

  if (view.kind === "planned" || view.kind === "revised") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="t-secondary flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {view.line}
        </p>
        {canAct && canRevise(plan, today) && <ReviseWeekButton plan={plan} onRequested={onChanged} />}
        {canAct && canRemove(plan, today) && (
          <Button size="sm" variant="ghost" onClick={() => setAsking("remove")}>Remove this week's plan</Button>
        )}
        {question}
      </div>
    );
  }

  // Stopped or removed. With no posts left the week's empty state says it.
  if (!hasPosts) return null;
  return <p className="t-secondary">{view.kind === "removed" ? `${view.line} The posts someone worked on stay.` : view.line}</p>;
}
