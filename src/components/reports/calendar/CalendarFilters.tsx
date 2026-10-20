import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlatformSegment, Segment, SegmentedGroup } from "@/components/ui/segmented";

export interface CalendarFilterState {
  day: string;
  platform: string;
  status: string;
  language: string;
}

interface Props {
  filters: CalendarFilterState;
  onChange: (next: CalendarFilterState) => void;
  availablePlatforms: string[];
  availableLanguages: string[];
}

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STATUSES: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
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

export function CalendarFilters({ filters, onChange, availablePlatforms, availableLanguages }: Props) {
  const hasActive =
    filters.day !== "all" ||
    filters.platform !== "all" ||
    filters.status !== "all" ||
    filters.language !== "all";

  return (
    <div className="print:hidden">
      <div className="glass px-card py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        {/* Day */}
        <SegmentedGroup label="Day">
          <Segment active={filters.day === "all"} onClick={() => onChange({ ...filters, day: "all" })}>
            All
          </Segment>
          {DAYS.map((d) => (
            <Segment
              key={d}
              active={filters.day === d}
              onClick={() => onChange({ ...filters, day: d })}
              ariaLabel={d}
            >
              {d.slice(0, 3)}
            </Segment>
          ))}
        </SegmentedGroup>

        {/* Platform */}
        <SegmentedGroup label="Platform">
          <Segment
            active={filters.platform === "all"}
            onClick={() => onChange({ ...filters, platform: "all" })}
          >
            All
          </Segment>
          {availablePlatforms.map((p) => (
            <PlatformSegment
              key={p}
              platform={p}
              active={filters.platform === p}
              onClick={() => onChange({ ...filters, platform: p })}
            />
          ))}
        </SegmentedGroup>

        {/* Status */}
        <SegmentedGroup label="Status">
          {STATUSES.map((s) => (
            <Segment
              key={s.value}
              active={filters.status === s.value}
              onClick={() => onChange({ ...filters, status: s.value })}
            >
              {s.label}
            </Segment>
          ))}
        </SegmentedGroup>

        {/* Language — only when more than one available */}
        {availableLanguages.length > 1 && (
          <SegmentedGroup label="Language">
            <Segment
              active={filters.language === "all"}
              onClick={() => onChange({ ...filters, language: "all" })}
            >
              All
            </Segment>
            {availableLanguages.map((l) => (
              <Segment
                key={l}
                active={filters.language === l}
                onClick={() => onChange({ ...filters, language: l })}
              >
                <span className="uppercase">{l}</span>
              </Segment>
            ))}
          </SegmentedGroup>
        )}

        {/* Clear filters action — appears only when filters are active */}
        {hasActive && (
          <Button variant="ghost" size="sm" onClick={() => onChange(DEFAULT_FILTERS)}>
            <X /> Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
