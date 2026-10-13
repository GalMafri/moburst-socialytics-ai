// supabase/functions/_shared/canva/brief.ts
//
// The instruction the image model gets when it designs a post. Free of Deno
// and network imports so it can be tested.
//
// What the model is given (proven on Bader, LegaBot and Moburst, 13 Oct 2026):
//   - a canvas: the client's background colour with the client's logo file
//     already placed at the client's habitual spot, locked by a mask shaped
//     like the logo's letters;
//   - three of the client's own posts as its visual language;
//   - the picture as a positive description in the client's own visual
//     vocabulary (naming what to avoid invites it);
//   - the post's copy, to be spelled exactly.
// Its drawn logo and lettering are replaced afterwards with exact layers in
// Canva (canva-finish), so nothing here has to be relied on for exactness.

export interface GenerateInput {
  brand_name: string;
  platform: string;
  /** The picture, described positively in the client's own visual vocabulary. */
  concept: string;
  /** Background colour of the canvas behind the locked logo, e.g. "#0B0E1A". */
  background: string;
  /** Paths in the design-references bucket: the client's own posts. */
  refs: string[];
}

export interface SlideContext {
  /** 0 for the cover. */
  index: number;
  count: number;
  /** Whether the cover is passed as the second image (every slide after the first). */
  withCover: boolean;
}

export function designPrompt(g: Pick<GenerateInput, "brand_name" | "platform" | "concept">, copy: string[], refCount: number, slide?: SlideContext): string {
  const lines = [`Headline, spelled exactly: "${copy[0]}"`, ...copy.slice(1).map((t) => `Second line, spelled exactly: "${t}"`)].join(" ");
  const refsWord = refCount === 1 ? "the other image, which is" : `the other ${numberWord(refCount)} images, which are`;
  if (!slide) {
    return `The first image is the canvas for a new ${g.brand_name} ${g.platform} post (4:5). Its logo is final: keep it exactly as it is, where it is. ` +
      `Design the whole post around it in the visual language of ${refsWord} ${g.brand_name}'s own posts. The picture shows ${g.concept}. ` +
      `${lines} Add no other text and no other logo.`;
  }
  const which = slide.index === 0 ? `the cover, slide 1 of ${slide.count}` : `slide ${slide.index + 1} of ${slide.count}`;
  const cover = slide.withCover
    ? `The second image is slide 1 of this same carousel: keep its background, palette, type and layout so the slides read as one series. `
    : "";
  const refs = slide.withCover
    ? (refCount === 1 ? "the last image, which is" : `the last ${numberWord(refCount)} images, which are`)
    : refsWord;
  return `The first image is the canvas for ${which} of a new ${g.brand_name} ${g.platform} carousel (4:5). Its logo is final: keep it exactly as it is, where it is. ` +
    cover +
    `Design the slide around the logo in the visual language of ${refs} ${g.brand_name}'s own posts. The picture shows ${g.concept}. ` +
    `${lines} Add no other text, no slide numbers and no other logo.`;
}

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
