import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlatformBadge } from "@/lib/platform-config";
import { X } from "lucide-react";

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

const DEFAULT_FILTERS: CalendarFilterState = {
  day: "all",
  platform: "all",
  status: "all",
  language: "all",
};

function FilterChip({
  active,
  onClick,
  children,
  ariaLabel,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      className="inline-flex items-center rounded-full
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary
                 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Badge
        variant={active ? "default" : "outline"}
        className={`cursor-pointer text-sm py-2 px-3 transition-colors ${
          active ? "" : "hover:border-foreground/40"
        }`}
      >
        {children}
      </Badge>
    </button>
  );
}

export function CalendarFilters({ filters, onChange, availablePlatforms, availableLanguages }: Props) {
  const hasActive =
    filters.day !== "all" ||
    filters.platform !== "all" ||
    filters.status !== "all" ||
    filters.language !== "all";

  return (
    <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-3 space-y-3 border-b border-white/10 print:hidden">
      {/* Day row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground w-16">Day</span>
        <FilterChip
          active={filters.day === "all"}
          onClick={() => onChange({ ...filters, day: "all" })}
        >
          All
        </FilterChip>
        {DAYS.map((d) => (
          <FilterChip
            key={d}
            active={filters.day === d}
            onClick={() => onChange({ ...filters, day: d })}
            ariaLabel={d}
          >
            {d.slice(0, 3)}
          </FilterChip>
        ))}
      </div>

      {/* Platform row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground w-16">Platform</span>
        <FilterChip
          active={filters.platform === "all"}
          onClick={() => onChange({ ...filters, platform: "all" })}
        >
          All
        </FilterChip>
        {availablePlatforms.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange({ ...filters, platform: p })}
            aria-pressed={filters.platform === p}
            className="inline-flex items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <PlatformBadge
              platform={p}
              size="sm"
              className={`cursor-pointer ${
                filters.platform === p
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "opacity-75 hover:opacity-100"
              }`}
            />
          </button>
        ))}
      </div>

      {/* Status row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground w-16">Status</span>
        {STATUSES.map((s) => (
          <FilterChip
            key={s.value}
            active={filters.status === s.value}
            onClick={() => onChange({ ...filters, status: s.value })}
          >
            {s.label}
          </FilterChip>
        ))}
      </div>

      {/* Language row — only when more than one available */}
      {availableLanguages.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground w-16">Language</span>
          <FilterChip
            active={filters.language === "all"}
            onClick={() => onChange({ ...filters, language: "all" })}
          >
            All
          </FilterChip>
          {availableLanguages.map((l) => (
            <FilterChip
              key={l}
              active={filters.language === l}
              onClick={() => onChange({ ...filters, language: l })}
            >
              <span className="uppercase">{l}</span>
            </FilterChip>
          ))}
        </div>
      )}

      {/* Clear filters action */}
      {hasActive && (
        <div className="flex items-center justify-end pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="text-sm text-muted-foreground hover:text-foreground gap-1.5"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
