/**
 * Move a calendar post to another date, or delete it (staff). Its copy edits
 * and designs stay attached to it when it moves, and a moved post counts as
 * worked on, so a newer plan keeps it on the calendar.
 */

import { useState } from "react";
import { CalendarClock, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sendQuietly, writeResendable } from "@/lib/quietSend";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function CalendarPostActions({ postId, clientId, date, onDone }: { postId: string; clientId?: string; date: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [moveTo, setMoveTo] = useState(date);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** A move or a delete that has not reached the server yet; the post is where it was. */
  const [notMoved, setNotMoved] = useState(false);
  const [notDeleted, setNotDeleted] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["calendar-posts", clientId] });
    void qc.invalidateQueries({ queryKey: ["calendar-all-posts"] });
  };
  // Both writes repeat safely, so each is sent again quietly; the calendar then shows where the post is.
  const move = async () => {
    if (!moveTo || moveTo === date) return;
    setMoving(true);
    setNotMoved(false);
    // calendar_posts is not in the generated types yet.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await sendQuietly(() => (supabase.from("calendar_posts" as never) as any).update({ post_date: moveTo, touched_at: new Date().toISOString() }).eq("id", postId), { again: writeResendable });
    setMoving(false);
    refresh();
    if (error) {
      console.warn("[calendar post] not moved yet", error);
      setNotMoved(true);
      return;
    }
    toast.success("Post moved");
    onDone();
  };
  const remove = async () => {
    setNotDeleted(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await sendQuietly(() => (supabase.from("calendar_posts" as never) as any).delete().eq("id", postId), { again: writeResendable });
    refresh();
    if (error) {
      // The dialog stays up and says the post is still on the calendar.
      console.warn("[calendar post] not deleted yet", error);
      setNotDeleted(true);
      return;
    }
    toast.success("Post deleted");
    onDone();
  };
  return (
    <div className="flex items-center gap-1">
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 px-2" aria-label="Move to another date"><CalendarClock className="h-3.5 w-3.5 mr-1.5" />Move</Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2" align="end">
          <p className="t-label">Move to</p>
          <Input type="date" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="New date" />
          <Button size="sm" className="w-full" onClick={move} disabled={moving || !moveTo || moveTo === date}>
            {moving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : null}Move post
          </Button>
          {notMoved && <p role="status" className="t-secondary">Not moved yet. The post keeps its current date.</p>}
        </PopoverContent>
      </Popover>
      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-white" onClick={() => setDeleting(true)} aria-label="Delete this post">
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmDialog
        open={deleting}
        onOpenChange={(o) => { setDeleting(o); if (!o) setNotDeleted(false); }}
        title="Delete this post?"
        description={
          <>
            <p>It is removed from the calendar. Anything already scheduled in Sprout is not affected.</p>
            {notDeleted && <p role="status" className="t-secondary">Not deleted yet. The post is still on the calendar.</p>}
          </>
        }
        onConfirm={remove}
      />
    </div>
  );
}
