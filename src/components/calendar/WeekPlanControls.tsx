/**
 * Plan and revise the calendar a week at a time (Lital, 19 Oct 2026). Every
 * Monday the following week is planned on its own; "Plan next week" plans the
 * next week without a plan, up to a month ahead, and "Revise this week"
 * rewrites the posts nobody has worked on from a note. Staff and the client's
 * own users can use both.
 */

import { useState } from "react";
import { Loader2, PenLine, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/invokeError";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { shortDate, type CalendarPlanRow } from "@/lib/calendarPosts";

export function PlanNextWeekButton({ clientId, week, onRequested }: { clientId: string; week: string | null; onRequested: (week: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!week) return null;
  const plan = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("calendar-posts", { body: { action: "plan_next_week", client_id: clientId } });
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      toast.success(`Planning the week of ${shortDate(data.week)}`, { description: "The posts appear here in a few minutes." });
      onRequested(data.week);
    } catch (e) {
      toast.error("Couldn't plan the week", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setBusy(false);
    }
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
    try {
      const { data, error } = await supabase.functions.invoke("calendar-posts", { body: { action: "revise_week", plan_id: plan.id, note } });
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      toast.success("Revising this week", { description: "Posts nobody has edited, designed or scheduled are being rewritten. The rest stay as they are." });
      setOpen(false);
      setNote("");
      onRequested();
    } catch (e) {
      toast.error("Couldn't revise the week", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setBusy(false);
    }
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

/** One line on where the week's plan stands, when it isn't simply ready. */
export function WeekPlanStatus({ plan, isStaff }: { plan: CalendarPlanRow | null | undefined; isStaff: boolean }) {
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
  if (plan.status === "failed") {
    // Staff get the one cause they can fix themselves; nobody sees a raw error.
    const needsRhythm = /posting rhythm/i.test(plan.error ?? "");
    return (
      <p role="alert" className="t-secondary">
        This week couldn't be planned yet.
        {isStaff && needsRhythm ? " The client hasn't published in the last 8 weeks, so set posts per week in the client's Content strategy settings." : " Try again with the button above."}
      </p>
    );
  }
  return null;
}
