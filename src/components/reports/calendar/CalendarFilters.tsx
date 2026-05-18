import { Badge } from "@/components/ui/badge";
import { PlatformBadge } from "@/lib/platform-config";

export interface CalendarFilterState {
  day: string;        // "all" | "Monday" | ... | "Sunday"
  platform: string;   // "all" | platform value
  status: string;     // "all" | "draft" | "designed" | "approved" | "scheduled"
  language: string;   // "all" | language code
}

interface Props {
  filters: CalendarFilterState;
  onChange: (next: CalendarFilterState) => void;
  availablePlatforms: string[];
  availableLanguages: string[];
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STATUSES: Array<{ value: string; label: string }> = [
  { value: "all", label: "Any status" },
  { value: "draft", label: "Draft" },
  { value: "designed", label: "Designed" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
];

export function CalendarFilters({ filters, onChange, availablePlatforms, availableLanguages }: Props) {
  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-2 space-y-2 border-b print:hidden">
      {/* Day row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-muted-foreground mr-1">Day:</span>
        <Badge
          variant={filters.day === "all" ? "default" : "outline"}
          className="cursor-pointer text-sm py-1 px-2.5"
          onClick={() => onChange({ ...filters, day: "all" })}
        >
          All
        </Badge>
        {DAYS.map((d) => (
          <Badge
            key={d}
            variant={filters.day === d ? "default" : "outline"}
            className="cursor-pointer text-sm py-1 px-2.5"
            onClick={() => onChange({ ...filters, day: d })}
          >
            {d.slice(0, 3)}
          </Badge>
        ))}
      </div>

      {/* Platform + status + language row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-muted-foreground mr-1">Platform:</span>
          <Badge
            variant={filters.platform === "all" ? "default" : "outline"}
            className="cursor-pointer text-sm py-1 px-2.5"
            onClick={() => onChange({ ...filters, platform: "all" })}
          >
            All
          </Badge>
          {availablePlatforms.map((p) => (
            <span
              key={p}
              className="cursor-pointer"
              onClick={() => onChange({ ...filters, platform: p })}
            >
              <PlatformBadge
                platform={p}
                size="sm"
                className={filters.platform === p ? "ring-1 ring-offset-1 ring-current" : "opacity-70 hover:opacity-100"}
              />
            </span>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-muted-foreground mr-1">Status:</span>
          {STATUSES.map((s) => (
            <Badge
              key={s.value}
              variant={filters.status === s.value ? "default" : "outline"}
              className="cursor-pointer text-sm py-1 px-2.5"
              onClick={() => onChange({ ...filters, status: s.value })}
            >
              {s.label}
            </Badge>
          ))}
        </div>

        {availableLanguages.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-muted-foreground mr-1">Lang:</span>
            <Badge
              variant={filters.language === "all" ? "default" : "outline"}
              className="cursor-pointer text-sm py-1 px-2.5"
              onClick={() => onChange({ ...filters, language: "all" })}
            >
              All
            </Badge>
            {availableLanguages.map((l) => (
              <Badge
                key={l}
                variant={filters.language === l ? "default" : "outline"}
                className="cursor-pointer text-sm py-1 px-2.5 uppercase"
                onClick={() => onChange({ ...filters, language: l })}
              >
                {l}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
