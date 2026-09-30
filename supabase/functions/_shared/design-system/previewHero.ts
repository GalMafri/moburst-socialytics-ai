// A stand-in hero for design-system previews: the brand's background with a
// soft accent glow, so a preview shows tokens, type, logo and layout without
// spending an image generation. Real posts get a generated hero.
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export async function placeholderHero(width: number, height: number, background: string, accent: string, glowAt: { x: number; y: number }): Promise<Uint8Array> {
  const bg = hexRgb(background), ac = hexRgb(accent);
  const img = new Image(width, height);
  const cx = width * glowAt.x, cy = height * glowAt.y, radius = Math.max(width, height) * 0.55;
  const vignette = Math.hypot(width, height) / 2;
  img.fill((x, y) => {
    const d = Math.hypot(x - cx, y - cy) / radius;
    const glow = Math.max(0, 1 - d) ** 2 * 0.55;
    const edge = 1 - Math.min(1, Math.hypot(x - width / 2, y - height / 2) / vignette) * 0.35;
    const r = Math.round((bg[0] * (1 - glow) + ac[0] * glow) * edge);
    const g = Math.round((bg[1] * (1 - glow) + ac[1] * glow) * edge);
    const b = Math.round((bg[2] * (1 - glow) + ac[2] * glow) * edge);
    return Image.rgbaToColor(r, g, b, 255);
  });
  return await img.encode();
}

export function bytesToDataUrl(bytes: Uint8Array, type = 'image/png'): string {
  let out = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  return `data:${type};base64,${btoa(out)}`;
}
