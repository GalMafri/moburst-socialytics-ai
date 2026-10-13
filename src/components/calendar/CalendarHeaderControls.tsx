/**
 * The calendar's controls: which client (staff only, "All clients" first) and
 * which week. Shared by the all-clients view and a client's own board.
 */

import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDays, weekLabel } from "@/lib/calendarPosts";

export const ALL_CLIENTS = "all";

export function ClientPicker({ value, week }: { value: string; week: string }) {
  const navigate = useNavigate();
  const { data: clients = [] } = useQuery({
    queryKey: ["calendar-client-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("id, name, archived_at").order("name");
      if (error) throw error;
      return (data || []).filter((c) => !c.archived_at);
    },
  });
  return (
    <Select value={value} onValueChange={(v) => navigate(v === ALL_CLIENTS ? `/calendar?week=${week}` : `/clients/${v}/calendar?week=${week}`)}>
      <SelectTrigger className="w-[220px]" aria-label="Client"><SelectValue placeholder="Client" /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_CLIENTS}>All clients</SelectItem>
        {clients.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function WeekNav({ week, thisWeek, count, onGo }: { week: string; thisWeek: string; count: number; onGo: (monday: string) => void }) {
  return (
    <nav className="flex items-center gap-2 flex-wrap" aria-label="Weeks">
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => onGo(addDays(week, -7))} aria-label="Previous week">
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => onGo(addDays(week, 7))} aria-label="Next week">
        <ChevronRight className="h-4 w-4" />
      </Button>
      <h2 className="text-[17px] font-semibold tracking-[-0.3px] text-white px-1" aria-live="polite">{weekLabel(week)}</h2>
      {week !== thisWeek && <Button variant="ghost" size="sm" onClick={() => onGo(thisWeek)}>This week</Button>}
      <span className="t-secondary ml-auto">{count} post{count === 1 ? "" : "s"} this week</span>
    </nav>
  );
}
