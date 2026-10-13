// supabase/functions/_shared/video/hook.ts
//
// The hook a video carries on screen, drawn by the image model on a
// transparent layer the size of the frame, in the type of the client's own
// posts (as described by the planner, who sees them). Its words are read back
// and must be the hook's exactly (_shared/design/pipeline.ts), as for a still
// design. Free of Deno and network imports so it can be tested.

/** The instruction for the hook layer. */
export function hookPrompt(brand: string, headline: string[], textStyle: string): string {
  const lines = headline.map((l, i) => `${i === 0 ? "First line" : "Second line"}, spelled exactly: "${l}"`).join(". ");
  return `The on-screen title of a vertical (9:16) social video by ${brand}, drawn alone on a fully transparent background. ` +
    `${lines}. ${textStyle}. The letters are crisp and in sharp focus, with enough glow or shadow to read over moving footage. ` +
    "Nothing else in the image: no logo, no other text, no shapes, panels or background.";
}
