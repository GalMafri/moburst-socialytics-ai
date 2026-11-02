// supabase/functions/_shared/design/story.ts
//
// What a Story is, for the app and the functions alike (Lital, 2 Nov 2026:
// "the option to design STORIES for FB+IG, but these should not have the
// publish button"). Spec: docs/superpowers/specs/2026-11-02-stories-design.md
//
// A Story is a post whose format is Story, on Facebook or Instagram. It is one
// still frame, 9:16, designed like any still post and posted by hand: Sprout's
// Publishing API cannot create Story posts. Free of Deno and network imports,
// so the app imports it as it imports _shared/sprout/publishRules.ts.

import { outputSize, pictureSize, type Placement } from "../canva/finish.ts";

/** The format value a Story is stored with. */
export const STORY_FORMAT = "Story";

/** What a Story's design job tells the design worker it is drawing (GenerateInput.surface). */
export const STORY_SURFACE = "story" as const;

/** A format that names a Story and nothing else: "Story", "Stories", "Instagram Story". A Story video or a storyboard is not one. */
export function isStoryFormat(format: string | null | undefined): boolean {
  return /^\s*(?:(?:instagram|facebook|ig|fb)\s+)?stor(?:y|ies)\s*$/i.test(String(format ?? ""));
}

/** Stories are made for Facebook and Instagram only. */
export function canBeStory(platform: string | null | undefined): boolean {
  const p = String(platform ?? "").trim().toLowerCase();
  return /instagram|facebook/.test(p) || p === "ig" || p === "fb";
}

/** A post that is a Story: its format says so, on Facebook or Instagram. */
export function isStoryPost(post: { format?: string | null; platform?: string | null } | null | undefined): boolean {
  return !!post && isStoryFormat(post.format) && canBeStory(post.platform);
}

/**
 * The page a Story is drawn on: exactly 9:16, in multiples of 16. The model
 * draws it at 2160x3840 (pictureSize) and it is delivered at 1440x2560
 * (outputSize), Meta's recommended Story size on both networks.
 */
export const STORY_PAGE = { width: 1152, height: 2048 } as const;
export const STORY_PICTURE = pictureSize([STORY_PAGE.width, STORY_PAGE.height]);
export const STORY_OUTPUT = outputSize([STORY_PAGE.width, STORY_PAGE.height]);

/**
 * Where a Story's words and logo stay clear of, as shares of the frame: the
 * top 14% (the profile name and progress bar), the bottom 35% (the reply bar)
 * and 6% at each side, from Meta's Stories ad guides for Instagram and
 * Facebook. The picture fills the whole frame.
 */
export const STORY_SAFE = { top: 0.14, bottom: 0.35, left: 0.06, right: 0.06 } as const;

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/**
 * The client's own logo spot (its anchor and width), moved into the Story's
 * safe band: no higher than 14% from the top, low enough that the logo ends
 * above 65%, and at least 6% from the side it is anchored to. A logo wider
 * than the band is narrowed to fit it.
 */
export function storyLogoPlacement(placement: Placement, logoW: number, logoH: number): Placement {
  const width = round4(Math.min(placement.width, 1 - STORY_SAFE.left - STORY_SAFE.right));
  const tall = width * (STORY_PAGE.width / STORY_PAGE.height) * (logoH / Math.max(1, logoW));
  const lowest = Math.max(STORY_SAFE.top, 1 - STORY_SAFE.bottom - tall);
  const top = round4(Math.min(Math.max(placement.top, STORY_SAFE.top), lowest));
  if (placement.anchor === "center") return { anchor: "center", width, top };
  const side = placement.anchor === "left" ? STORY_SAFE.left : STORY_SAFE.right;
  return { anchor: placement.anchor, width, top, left: round4(Math.max(placement.left ?? 0, side)) };
}

/** The band every word of a Story sits in, in pixels of a frame of this size. */
export function storyTextBand(width: number, height: number): { x: number; y: number; width: number; height: number } {
  const x = Math.round(width * STORY_SAFE.left);
  const y = Math.round(height * STORY_SAFE.top);
  return { x, y, width: Math.round(width * (1 - STORY_SAFE.right)) - x, height: Math.round(height * (1 - STORY_SAFE.bottom)) - y };
}
