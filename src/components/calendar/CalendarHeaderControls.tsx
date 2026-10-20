/**
 * The calendar's controls: which client (staff only, "All clients" first) and
 * which week. Shared by the all-clients view and a client's own board.
 */

import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useActiveClients } from "@/lib/activeClients";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDays, weekLabel } from "@/lib/calendarPosts";

export const ALL_CLIENTS = "all";

export function ClientPicker({ value, week }: { value: string; week: string }) {
  const navigate = useNavigate();
  // Active clients only, the one shared definition every client list uses.
  const { data: clients = [] } = useActiveClients("id, name");
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

/**
 * The week band: previous and next, the week, how many posts it holds, and
 * whatever belongs to this week (its plan's status, "Revise this week") at
 * the end of the same band. The count used to sit alone at the far right of
 * a bare row, with the week's own actions on a second row under it.
 */
export function WeekNav({ week, thisWeek, count, onGo, children }: { week: string; thisWeek: string; count: number; onGo: (monday: string) => void; children?: React.ReactNode }) {
  return (
    <nav className="glass px-card py-3 flex items-center gap-x-3 gap-y-2 flex-wrap" aria-label="Weeks">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={() => onGo(addDays(week, -7))} aria-label="Previous week">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="icon-sm" onClick={() => onGo(addDays(week, 7))} aria-label="Next week">
          <ChevronRight />
        </Button>
      </div>
      <h2 className="t-h3 px-1" aria-live="polite">{weekLabel(week)}</h2>
      <span className="t-label rounded-full bg-[rgba(255,255,255,0.06)] px-2.5 py-0.5">{count} post{count === 1 ? "" : "s"}{week === thisWeek ? " this week" : ""}</span>
      {week !== thisWeek && <Button variant="ghost" size="sm" onClick={() => onGo(thisWeek)}>This week</Button>}
      {children && <div className="flex flex-wrap items-center gap-3 sm:ml-auto">{children}</div>}
    </nav>
  );
}
