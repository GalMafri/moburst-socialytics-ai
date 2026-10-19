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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function CalendarPostActions({ postId, clientId, date, onDone }: { postId: string; clientId?: string; date: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [moveTo, setMoveTo] = useState(date);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["calendar-posts", clientId] });
    void qc.invalidateQueries({ queryKey: ["calendar-all-posts"] });
  };
  const move = async () => {
    if (!moveTo || moveTo === date) return;
    setMoving(true);
    try {
      // calendar_posts is not in the generated types yet.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.from("calendar_posts" as never) as any).update({ post_date: moveTo, touched_at: new Date().toISOString() }).eq("id", postId);
      if (error) throw error;
      refresh();
      toast.success("Post moved");
      onDone();
    } catch (e) {
      toast.error("Could not move the post", { description: e instanceof Error ? e.message : "Try again." });
    } finally {
      setMoving(false);
    }
  };
  const remove = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("calendar_posts" as never) as any).delete().eq("id", postId);
    if (error) { toast.error("Could not delete the post", { description: error.message }); return; }
    refresh();
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
        </PopoverContent>
      </Popover>
      <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-white" onClick={() => setDeleting(true)} aria-label="Delete this post">
        <Trash2 className="h-4 w-4" />
      </Button>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this post?"
        description="It is removed from the calendar. Anything already scheduled in Sprout is not affected."
        onConfirm={remove}
      />
    </div>
  );
}
