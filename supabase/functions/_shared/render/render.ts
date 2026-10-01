// Render one still: fonts from the cache, compose, rasterise, return PNG bytes.
import { compose, type ComposeInput } from './compose.ts';
import { fontBytes } from './fonts.ts';
import { parseFaces } from './measure.ts';
import { svgToPng } from './resvg.ts';

export async function renderStill(db: any, input: ComposeInput): Promise<{ png: Uint8Array; fontSize: number; lines: number }> {
  const family = input.system.tokens.font.family;
  const [regular, bold] = await Promise.all([fontBytes(db, family, 400), fontBytes(db, family, 700)]);
  const face = parseFaces(regular, bold);
  const composed = compose(face, input);
  const png = await svgToPng(db, composed.svg, input.width, [regular, bold], family);
  return { png, fontSize: composed.fontSize, lines: composed.lines };
}
