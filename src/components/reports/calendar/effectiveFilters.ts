import { normalizePlatform } from "@/lib/platform";
import type { CalendarFilterState } from "./CalendarFilters";

/**
 * The filters as the board applies them. The platform choices are the networks
 * with posts in the shown week, so moving to a week without the chosen network
 * leaves no segment for it; the choice then counts as All, on the board and in
 * the segments alike, and comes back when a week has that network again.
 */
export function effectiveFilters(filters: CalendarFilterState, availablePlatforms: string[]): CalendarFilterState {
  if (filters.platform === "all") return filters;
  const offered = availablePlatforms.some((p) => normalizePlatform(p) === normalizePlatform(filters.platform));
  return offered ? filters : { ...filters, platform: "all" };
}
