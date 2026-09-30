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
  const png = await svgToPng(composed.svg, input.width, [regular, bold], family);
  return { png, fontSize: composed.fontSize, lines: composed.lines };
}

/** Bytes of a public or signed image as a data URL, so the SVG is self-contained for the rasteriser. */
export async function asDataUrl(url: string): Promise<string> {
  if (url.startsWith('data:')) return url;
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`An image for the render could not be fetched [${res.status}]`);
  const type = res.headers.get('content-type') || 'image/png';
  const bytes = new Uint8Array(await res.arrayBuffer());
  let out = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  return `data:${type};base64,${btoa(out)}`;
}
