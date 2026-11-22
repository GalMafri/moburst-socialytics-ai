// Render one still: fonts from the cache, compose, rasterise, return PNG bytes.
import { compose, type ComposeInput } from './compose.ts';
import { fontBytes } from './fonts.ts';
import { parseFaces } from './measure.ts';
import { svgToPng } from './resvg.ts';

export async function renderStill(db: any, input: ComposeInput): Promise<{ png: Uint8Array; fontSize: number; lines: number }> {
  const family = input.system.tokens.font.family;
  // QA 22 Nov 2026: a family Google serves at one weight (Bebas Neue, Anton)
  // passes the design-system check, which asks for 400 only; the missing 700
  // failed every render. Its bold is drawn from the 400 file.
  const regular = await fontBytes(db, family, 400);
  const bold = await fontBytes(db, family, 700).catch(() => regular);
  const face = parseFaces(regular, bold);
  const composed = compose(face, input);
  const png = await svgToPng(db, composed.svg, input.width, bold === regular ? [regular] : [regular, bold], family);
  return { png, fontSize: composed.fontSize, lines: composed.lines };
}
