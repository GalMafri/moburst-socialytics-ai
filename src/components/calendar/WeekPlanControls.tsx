/**
 * Plan and revise the calendar a week at a time (Lital, 19 Oct 2026). Every
 * Monday the following week is planned on its own; "Plan next week" plans the
 * next week without a plan, up to a month ahead, and "Revise this week"
 * rewrites the posts nobody has worked on from a note. Staff and the client's
 * own users can use both. Both only queue work: a request that can't be sent
 * is sent again quietly (calendarRequests.ts), and no error is shown.
 */

import { useState } from "react";
import { Loader2, PenLine, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { queueCalendarWork } from "@/lib/calendarRequests";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { shortDate, type CalendarPlanRow } from "@/lib/calendarPosts";

/** onRequested gets the week being planned, or null when the request didn't go through (the page then shows what the server has). */
export function PlanNextWeekButton({ clientId, week, onRequested }: { clientId: string; week: string | null; onRequested: (week: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  if (!week) return null;
  const plan = async () => {
    setBusy(true);
    const data = await queueCalendarWork({ action: "plan_next_week", client_id: clientId });
    setBusy(false);
    const planned = typeof data?.week === "string" ? data.week : null;
    if (planned) toast.success(`Planning the week of ${shortDate(planned)}`, { description: "The posts appear here in a few minutes." });
    onRequested(planned);
  };
  return (
    <Button size="sm" onClick={plan} disabled={busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
      Plan the week of {shortDate(week)}
    </Button>
  );
}

export function ReviseWeekButton({ plan, onRequested }: { plan: CalendarPlanRow; onRequested: () => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const data = await queueCalendarWork({ action: "revise_week", plan_id: plan.id, note });
    setBusy(false);
    // Not sent: the dialog stays open with the note, ready to send again.
    if (!data) return;
    toast.success("Revising this week", { description: "Posts nobody has edited, designed or scheduled are being rewritten. The rest stay as they are." });
    setOpen(false);
    setNote("");
    onRequested();
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

/**
 * One line while the week's plan is being written or revised. A plan that
 * doesn't finish is tried again on its own until its week is over, so there
 * is no failed state to show.
 */
export function WeekPlanStatus({ plan }: { plan: CalendarPlanRow | null | undefined }) {
  if (!plan) return null;
  if (plan.status === "queued" || plan.status === "planning") {
    return (
      <p role="status" className="t-secondary flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> This week is being planned. The posts appear here in a few minutes.
      </p>
    );
  }
  if (plan.pending_revision) {
    return (
      <p role="status" className="t-secondary flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Revising this week: "{plan.pending_revision.note}"
      </p>
    );
  }
  return null;
}
