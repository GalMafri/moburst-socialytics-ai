import { PlatformBadge } from "@/lib/platform-config";
import { X } from "lucide-react";

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
  { value: "all", label: "Any" },
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

/**
 * Filter group with caption label + a segmented control of chips inside a
 * glass container. Matches the Intercept Tabs pattern.
 */
function SegmentedGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-medium uppercase tracking-wider text-[#9ca3af] shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-1 p-1 rounded-[12px] bg-[rgba(0,0,0,0.25)] backdrop-blur-xl border border-[rgba(255,255,255,0.07)] shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.03)]">
        {children}
      </div>
    </div>
  );
}

function Segment({
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
      className={`px-3 py-1.5 rounded-[8px] text-[13px] font-medium tracking-[-0.2px] transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background
        ${
          active
            ? "bg-[#b9e045] text-black"
            : "text-[#9ca3af] hover:text-white hover:bg-[rgba(255,255,255,0.06)]"
        }`}
    >
      {children}
    </button>
  );
}

function PlatformSegment({
  active,
  platform,
  onClick,
}: {
  active: boolean;
  platform: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={platform}
      className={`px-2.5 py-1 rounded-[8px] transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background
        ${active ? "bg-[rgba(255,255,255,0.08)]" : "hover:bg-[rgba(255,255,255,0.06)]"}`}
    >
      <PlatformBadge
        platform={platform}
        size="sm"
        className={active ? "" : "opacity-70"}
      />
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
    <div className="sticky top-0 z-10 -mx-2 px-2 py-3 bg-background/80 backdrop-blur-xl print:hidden">
      <div className="flex flex-wrap items-center gap-4">
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
          <button
            type="button"
            onClick={() => onChange(DEFAULT_FILTERS)}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[13px] font-medium text-[#9ca3af] hover:text-white hover:bg-[rgba(255,255,255,0.06)] transition-colors
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
