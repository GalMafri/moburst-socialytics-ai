// supabase/functions/_shared/video/hook.ts
//
// The hook a video carries on screen, drawn by the image model on a
// transparent layer the size of the frame, in the type of the client's own
// posts (as described by the planner, who sees them). Its words are read back
// and must be the hook's exactly (_shared/design/pipeline.ts), as for a still
// design. Free of Deno and network imports so it can be tested.
//
// 12 Nov 2026: hookBoxOf turns the picture service's title-read answer into
// the lettering's box and its layer's size (the pixel scan moved to the service).

import type { Rect, Size, TitleReadResult } from "../picture/contract.ts";
import { VERTICAL, type VideoFrame } from "./videoSize.ts";

/** The instruction for the hook layer, in the video's shape (vertical when not given, videoSize.ts). */
export function hookPrompt(brand: string, headline: string[], textStyle: string, frame: VideoFrame = VERTICAL): string {
  const lines = headline.map((l, i) => `${i === 0 ? "First line" : "Second line"}, spelled exactly: "${l}"`).join(". ");
  return `The on-screen title of a ${frame.word} (${frame.label}) social video by ${brand}, drawn alone on a fully transparent background. ` +
    `${lines}. ${textStyle}. The letters are crisp and in sharp focus, with enough glow or shadow to read over moving footage. ` +
    "Nothing else in the image: no logo, no other text, no shapes, panels or background.";
}

/** Where the lettering sits on its layer, from the picture service's title-read answer. */
export function hookBoxOf(result: TitleReadResult): { box: Rect; layer: Size } {
  if (!result.box) throw new Error("The title came back empty.");
  return { box: result.box, layer: result.layer };
}
