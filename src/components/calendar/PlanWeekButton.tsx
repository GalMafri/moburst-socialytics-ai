/**
 * Plan an empty week from the client's latest report (staff). The posts are
 * written in the background and appear on the board within about a minute.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { describeInvokeError } from "@/lib/invokeError";
import { Button } from "@/components/ui/button";

export function PlanWeekButton({ clientId, week, onPlanned }: { clientId: string; week: string; onPlanned: () => void }) {
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  const plan = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("calendar-posts", { body: { action: "plan_weeks", client_id: clientId, start: week, count: 1 } });
      if (error || data?.error) throw new Error(await describeInvokeError(error, data));
      toast.success("Planning this week", { description: "The posts appear here in about a minute." });
      // Look for the new posts every 10 seconds for up to 3 minutes.
      let tries = 0;
      timer.current = setInterval(() => {
        tries += 1;
        onPlanned();
        if (tries >= 18 && timer.current) { clearInterval(timer.current); setBusy(false); }
      }, 10_000);
    } catch (e) {
      toast.error("Could not plan the week", { description: e instanceof Error ? e.message : "Try again." });
      setBusy(false);
    }
  };
  return (
    <Button size="sm" onClick={plan} disabled={busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
      {busy ? "Planning…" : "Plan this week"}
    </Button>
  );
}
