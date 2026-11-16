// Platform keys and names come from the one display layer (src/lib/display.ts).
// These names stay so existing imports keep working; there is one implementation.
export { PLATFORM_NAMES as PLATFORM_LABELS, platformKey as normalizePlatform, platformName as platformLabel } from "./display";
// What a Story is, one rule with the edge functions (supabase/functions/_shared/design/story.ts).
export { STORY_FORMAT, canBeStory, isStoryFormat, isStoryPost } from "../../supabase/functions/_shared/design/story";
// What kind a format is and how it reads: one rule with the week planner (supabase/functions/_shared/calendar/reasonText.ts).
export { FORMAT_KINDS, FORMAT_LABELS, formatKind, formatLabel, type FormatKind } from "../../supabase/functions/_shared/calendar/reasonText";
import { formatKind } from "../../supabase/functions/_shared/calendar/reasonText";

/**
 * Whether a planned post is meant to be a moving clip rather than a still.
 * Drives which generator a post opens on: a "Reel" recommendation asks for a
 * video, and offering only the image designer there quietly produces the wrong
 * asset. The same kind rule the planner stores with, so every spelling counts.
 */
export function isVideoFormat(format: string | null | undefined, platform?: string | null): boolean {
  const kind = formatKind(format, platform);
  return kind === "video" || kind === "short video";
}

/** A post made of words alone (a text-only tweet, say): it has no design. */
export function isTextOnlyFormat(format: string | null | undefined): boolean {
  return formatKind(format) === "text";
}
