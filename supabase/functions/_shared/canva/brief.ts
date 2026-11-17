// supabase/functions/_shared/canva/brief.ts
//
// The instruction the image model gets when it designs a post. Free of Deno
// and network imports so it can be tested.
//
// What the model is given (proven on Bader, LegaBot and Moburst, 13 Oct 2026):
//   - a canvas: the client's background colour with the client's logo file
//     already placed at the client's habitual spot, locked by a mask shaped
//     like the logo's letters;
//   - the client's own posts the planner chose, for their look alone: colors,
//     type treatment and layout style (17 Nov 2026; until then they were its
//     "visual language", and each design came back a close remake of one of
//     them: the same people, objects and composition);
//   - the picture as a positive description of a new scene;
//   - the post's copy, to be spelled exactly: its headline, and the labels
//     its planned visual calls for, when it has any.
// Its drawn logo and lettering are replaced afterwards with exact layers in
// Canva (canva-finish), so nothing here has to be relied on for exactness.

import { STORY_SAFE, STORY_SURFACE } from "../design/story.ts";

export interface GenerateInput {
  brand_name: string;
  platform: string;
  /** The picture, described positively in the client's own visual vocabulary. */
  concept: string;
  /** Background colour of the canvas behind the locked logo, e.g. "#0B0E1A". */
  background: string;
  /** Paths in the design-references bucket: the client's own posts. */
  refs: string[];
  /** The canvas size in pixels; 4:5 (1088x1360) when absent. Video cards and Stories are 9:16. */
  size?: { width: number; height: number };
  /** A video's opening or closing card, rather than a post or a carousel slide. */
  video_card?: "cover" | "end";
  /** "story": a Facebook or Instagram Story, seen full screen (_shared/design/story.ts). */
  surface?: typeof STORY_SURFACE;
  /** The note the person who asked for the design left on Regenerate (design_requests.note). */
  note?: string | null;
}

export interface SlideContext {
  /** 0 for the cover. */
  index: number;
  count: number;
  /** Whether the cover is passed as the second image (every slide after the first). */
  withCover: boolean;
}

export function designPrompt(g: Pick<GenerateInput, "brand_name" | "platform" | "concept" | "video_card" | "surface" | "note">, copy: string[], refCount: number, slide?: SlideContext, labels?: string[] | null, placing?: string | null): string {
  // The labels the planned visual calls for beyond the headline (canva/options.ts): each set once, where `placing` says. None for most designs, and then no placing either.
  const has = Array.isArray(labels) && labels.length > 0;
  const place = has ? String(placing ?? "").trim() : "";
  const labeled = has ? ` Labels, each set once and spelled exactly: ${labels!.map((l) => `"${l}"`).join("; ")}.${place ? ` Where the labels sit: ${place}.` : ""}` : "";
  const lines = [`Headline, spelled exactly: "${copy[0]}"`, ...copy.slice(1).map((t) => `Second line, spelled exactly: "${t}"`)].join(" ") + labeled;
  // The person's note, after the picture; the logo stays the brand's own file in its spot.
  const note = String(g.note ?? "").trim();
  const noted = note ? `Follow this note from the person who asked for the design, keeping the logo exactly as it is: "${note}". ` : "";
  const refsWord = refCount === 1 ? "the other image, which is" : `the other ${numberWord(refCount)} images, which are`;
  // The client's posts give the look alone; the picture is the planned one, drawn new.
  const look = lookOnly(refCount, g.brand_name);
  if (g.video_card) {
    // The cards open and close a vertical video; the end card follows the cover's look.
    const which = g.video_card === "cover" ? "the opening card" : "the closing card";
    const cover = slide?.withCover ? "The second image is this video's opening card: keep its background, palette, type and layout so the two cards read as a pair. " : "";
    const refs = slide?.withCover
      ? (refCount === 1 ? "the last image, which is" : `the last ${numberWord(refCount)} images, which are`)
      : refsWord;
    return `The first image is the canvas for ${which} of a new ${g.brand_name} ${g.platform} vertical video (9:16). Its logo is final: keep it exactly as it is, where it is. ` +
      cover +
      `Design the card around the logo in the look of ${refs} ${g.brand_name}'s own posts, filling the tall frame. ${look} The picture shows ${g.concept}. ${noted}` +
      `${lines} Add no other text and no other logo. ${SHARP}`;
  }
  if (g.surface === STORY_SURFACE) {
    // Seen full screen for a few seconds: the picture fills the tall frame, the words stay in Meta's band.
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    return `The first image is the canvas for a new ${g.brand_name} ${g.platform} Story (9:16), seen full screen on a phone. Its logo is final: keep it exactly as it is, where it is. ` +
      `Design the whole Story around it in the look of ${refsWord} ${g.brand_name}'s own posts, the picture filling the tall frame from edge to edge. ${look} The picture shows ${g.concept}. ${noted}` +
      `${lines} Every word sits inside the band that leaves out the top ${pct(STORY_SAFE.top)}, the bottom ${pct(STORY_SAFE.bottom)} and ${pct(STORY_SAFE.left)} at each side of the frame. Add no other text and no other logo. ${SHARP}`;
  }
  if (!slide) {
    return `The first image is the canvas for a new ${g.brand_name} ${g.platform} post (4:5). Its logo is final: keep it exactly as it is, where it is. ` +
      `Design the whole post around it in the look of ${refsWord} ${g.brand_name}'s own posts. ${look} The picture shows ${g.concept}. ${noted}` +
      `${lines} Add no other text and no other logo. ${SHARP}`;
  }
  const which = slide.index === 0 ? `the cover, slide 1 of ${slide.count}` : `slide ${slide.index + 1} of ${slide.count}`;
  const cover = slide.withCover
    ? `The second image is slide 1 of this same carousel: keep its background, palette, type and where the words sit so the slides read as one series. Its picture is not repeated: this slide has a picture of its own. `
    : "";
  const refs = slide.withCover
    ? (refCount === 1 ? "the last image, which is" : `the last ${numberWord(refCount)} images, which are`)
    : refsWord;
  return `The first image is the canvas for ${which} of a new ${g.brand_name} ${g.platform} carousel (4:5). Its logo is final: keep it exactly as it is, where it is. ` +
    cover +
    `Design the slide around the logo in the look of ${refs} ${g.brand_name}'s own posts. ${look} The picture shows ${g.concept}. ${noted}` +
    `${lines} Add no other text, no slide numbers${has ? " other than the labels given" : ""} and no other logo. ${SHARP}`;
}

/**
 * What the image model takes from the client's posts it is shown: their look
 * and nothing else. What must be new is the scene: a person, a place, props
 * and the composition of a past post are never reproduced; the client's own
 * product, packaging or app may appear as its posts show it.
 */
function lookOnly(refCount: number, brand: string): string {
  const [those, their, show] = refCount === 1 ? ["that post's", "its", "that post shows"] : ["those posts'", "their", "those posts show"];
  return `Take ${those} look and nothing else: ${their} colors, ${their} type treatment and ${their} layout style, which is how type and picture are arranged (where the headline sits, panels, margins), never the picture's own scene. ` +
    `The scene is a new one, drawn for this design: do not reproduce a person, a place, the props or the composition ${show}. ${brand}'s own product, packaging or app may appear as ${show} it, when the picture calls for it.`;
}

/**
 * Every part of the picture in focus. Out-of-focus foreground objects, copied
 * from the depth of field in a client's photos, read as blur on a phone
 * (Lital, 13 Oct: "no blurry images").
 */
const SHARP = "Every part of the picture is in sharp focus, with no blurred or out-of-focus objects.";

function numberWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"][n] ?? String(n);
}

/** Where the logo file sits on the canvas, in pixels. */
export function canvasLogoRect(placement: { anchor: "left" | "center" | "right"; width: number; top: number; left?: number }, logoW: number, logoH: number, pageW: number, pageH: number) {
  const width = Math.round(placement.width * pageW);
  const height = Math.round((logoH * width) / logoW);
  const x = placement.anchor === "center" ? Math.floor((pageW - width) / 2)
    : placement.anchor === "left" ? Math.round((placement.left ?? 0) * pageW)
    : pageW - Math.round((placement.left ?? 0) * pageW) - width;
  return { x, y: Math.round(placement.top * pageH), width, height };
}

/**
 * Downscale RGBA pixels by area averaging, with alpha premultiplied so a
 * logo's anti-aliased edges stay clean. (The image library only offers
 * nearest-neighbour, which leaves a downscaled logo's edges jagged.)
 */
export function resampleRGBA(src: ArrayLike<number>, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const fx = sw / dw, fy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * fy, y1 = y0 + fy;
    for (let x = 0; x < dw; x++) {
      const x0 = x * fx, x1 = x0 + fx;
      let r = 0, g = 0, b = 0, a = 0, area = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1) && sy < sh; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1) && sx < sw; sx++) {
          const w = (Math.min(sx + 1, x1) - Math.max(sx, x0)) * wy;
          const i = (sy * sw + sx) * 4;
          const al = src[i + 3] * w;
          r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; area += w;
        }
      }
      const o = (y * dw + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = area > 0 ? a / area : 0;
    }
  }
  return out;
}
