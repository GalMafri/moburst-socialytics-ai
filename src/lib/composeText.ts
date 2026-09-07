// Draws the words onto a picture-only design.
//
// The image model draws pictures well and letters badly, so the picture comes
// back without words and the app sets them: the same typeface, colours and
// positions the editor uses, so a variant arrives looking like a post and the
// editor is for adjusting it, not finishing it. Everything here runs in the
// browser on a canvas; nothing is sent anywhere.

import { findCalmZone, inkFor, regionLuminance } from "@/lib/calmZone";

export interface ComposeOverlay {
  text: string;
  /** Horizontal centre, percent of width. */
  x: number;
  /** Vertical centre of the block, percent of height. */
  y: number;
  color: string;
  /** Size relative to an 800px-wide canvas, like the editor. */
  fontSize: number;
  fontWeight: "normal" | "bold";
  /** Wrap width, percent of the canvas. Default 84. */
  width?: number;
  /**
   * Set when the block was placed on a flat colour field the picture already
   * has, so no legibility band is painted behind it.
   */
  placed?: boolean;
}

/** The brand's own face if it is a Google font, else the app face. */
export function brandFontStack(fontFamily?: string | null): { family: string; stack: string } {
  const family = (fontFamily || "").split(",")[0].trim().replace(/['"]/g, "");
  const stack = family
    ? `"${family}", "Geist", ui-sans-serif, system-ui, sans-serif`
    : `"Geist", ui-sans-serif, system-ui, sans-serif`;
  return { family, stack };
}

/** Loads the brand face from Google Fonts once per page, and waits for it. */
export async function ensureBrandFont(fontFamily?: string | null): Promise<void> {
  const { family } = brandFontStack(fontFamily);
  if (!family) return;
  const id = `brand-font-${family.replace(/\s+/g, "-").toLowerCase()}`;
  if (!document.getElementById(id)) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;700&display=swap`;
    document.head.appendChild(link);
  }
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`700 40px "${family}"`), document.fonts.load(`400 40px "${family}"`)]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
    await (document as any).fonts?.ready;
  } catch {
    // Draw with the fallback face rather than fail.
  }
}

/** Breaks a line at word boundaries so it fits `maxWidth` at the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= maxWidth || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draws overlays onto a canvas that already holds the picture. Shared by the
 * editor's export and the automatic composite so both produce the same pixels.
 * A line that would run past 84% of the width wraps; the block stays centred
 * on its y.
 */
export function drawOverlays(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, overlays: ComposeOverlay[], fontStack: string): void {
  const scale = canvas.width / 800;
  // A soft dark band behind text that sits near an edge. The picture was
  // composed to keep those areas calm, but calm is not always dark, and white
  // type on a light wall needs more than a shadow.
  const live = overlays.filter((o) => o.text.trim() && !o.placed);
  if (live.some((o) => o.y <= 35)) {
    const g = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.42);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height * 0.42);
  }
  if (live.some((o) => o.y >= 70)) {
    const g = ctx.createLinearGradient(0, canvas.height * 0.62, 0, canvas.height);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.6)");
    ctx.fillStyle = g;
    ctx.fillRect(0, canvas.height * 0.62, canvas.width, canvas.height * 0.38);
  }
  for (const ov of overlays) {
    if (!ov.text.trim()) continue;
    ctx.save();
    const px = ov.fontSize * scale;
    ctx.font = `${ov.fontWeight} ${px}px ${fontStack}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ov.color;
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 8 * scale;
    ctx.shadowOffsetY = 2 * scale;
    const lines = wrap(ctx, ov.text, canvas.width * ((ov.width ?? 84) / 100));
    const lineHeight = px * 1.15;
    const startY = (ov.y / 100) * canvas.height - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((l, i) => ctx.fillText(l, (ov.x / 100) * canvas.width, startY + i * lineHeight));
    ctx.restore();
  }
}

/** Loads an image URL (or data URL) into an element the canvas can draw. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      fetch(url)
        .then((r) => r.blob())
        .then((blob) => {
          const retry = new Image();
          retry.onload = () => resolve(retry);
          retry.onerror = () => reject(new Error("Cannot load image"));
          retry.src = URL.createObjectURL(blob);
        })
        .catch(() => reject(new Error("Cannot fetch image")));
    };
    img.src = url;
  });
}

/** The picture as a small luminance grid, for finding the field to type into. */
function luminanceGrid(img: HTMLImageElement, cols = 48, rows = 64): Float32Array | null {
  const small = document.createElement("canvas");
  small.width = cols;
  small.height = rows;
  const ctx = small.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, cols, rows);
  const { data } = ctx.getImageData(0, 0, cols, rows);
  const lum = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    lum[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  }
  return lum;
}

/**
 * The largest type (in 800px-canvas units) at which the headline fits the
 * field: at most four lines, using no more than 70% of the field's height.
 * Estimated from an average glyph width, so it errs a little small rather
 * than a little large; the field's width sets the wrap, its height the cap.
 */
export function fitFontSize(text: string, widthPct: number, zoneHPct: number, canvasW: number, canvasH: number, base: number): number {
  const scale = canvasW / 800;
  const widthPx = (widthPct / 100) * canvasW;
  const zoneHPx = (zoneHPct / 100) * canvasH;
  const chars = text.length;
  for (let size = Math.max(base, 44); size >= 18; size -= 2) {
    const px = size * scale;
    const perLine = Math.max(1, Math.floor(widthPx / (px * 0.56)));
    const lines = Math.ceil(chars / perLine);
    if (lines <= 4 && lines * px * 1.15 <= zoneHPx * 0.7) return size;
  }
  return 18;
}

/**
 * Moves the headline onto the flat colour field the picture was composed
 * with, sized to fit it, in ink that reads against it; puts the call-to-action
 * inside the same field when the field reaches the bottom, else low on the
 * canvas as before. Overlays come back unchanged when no field is found.
 */
export function placeOverlays(img: HTMLImageElement, overlays: ComposeOverlay[]): ComposeOverlay[] {
  const cols = 48;
  const rows = Math.max(16, Math.round((cols * img.naturalHeight) / Math.max(1, img.naturalWidth)));
  const lum = luminanceGrid(img, cols, rows);
  if (!lum) return overlays;
  const zone = findCalmZone(lum, cols, rows);
  if (!zone) {
    // No field: keep the positions, but let the ink follow the picture.
    return overlays.map((o) => ({
      ...o,
      color: inkFor(regionLuminance(lum, cols, rows, { left: 10, right: 90, top: o.y - 8, bottom: o.y + 8 })),
    }));
  }
  const zoneW = zone.right - zone.left;
  const zoneH = zone.bottom - zone.top;
  const ink = inkFor(zone.luminance);
  const [headline, ...rest] = overlays;
  const out: ComposeOverlay[] = [];
  if (headline) {
    // Type fills the field's width with a margin, and the size follows the
    // width so a half-canvas block gets smaller type, not a broken line.
    const width = Math.max(30, Math.min(84, zoneW * 0.86));
    const fontSize = fitFontSize(headline.text, width, zoneH, img.naturalWidth, img.naturalHeight, headline.fontSize);
    out.push({ ...headline, x: zone.left + zoneW / 2, y: zone.top + zoneH * 0.42, width, fontSize, color: ink, placed: true });
  }
  for (const o of rest) {
    if (zone.bottom >= 88 && zoneH >= 22) {
      out.push({ ...o, x: zone.left + zoneW / 2, y: zone.bottom - 9, width: Math.max(30, Math.min(84, zoneW * 0.86)), color: ink, placed: true });
    } else {
      out.push({ ...o, color: inkFor(regionLuminance(lum, cols, rows, { left: 10, right: 90, top: o.y - 8, bottom: o.y + 8 })) });
    }
  }
  return out;
}

/**
 * The picture with the words on it, plus where the words went, so the editor
 * can open the same picture with the same words in the same places.
 */
export async function composePost(
  imageUrl: string,
  overlays: ComposeOverlay[],
  fontFamily?: string | null,
): Promise<{ url: string; overlays: ComposeOverlay[] }> {
  const live = overlays.filter((o) => o.text.trim());
  if (live.length === 0) return { url: imageUrl, overlays: live };
  try {
    await ensureBrandFont(fontFamily);
    const img = await loadImage(imageUrl);
    const placed = placeOverlays(img, live);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { url: imageUrl, overlays: live };
    ctx.drawImage(img, 0, 0);
    drawOverlays(ctx, canvas, placed, brandFontStack(fontFamily).stack);
    return { url: canvas.toDataURL("image/png"), overlays: placed };
  } catch {
    return { url: imageUrl, overlays: live };
  }
}

/**
 * The picture with the words on it, as a PNG data URL. Returns the original
 * URL untouched when there is nothing to draw or drawing fails — a variant
 * without words is still a variant; a lost one is not.
 */
export async function composeTextOnImage(imageUrl: string, overlays: ComposeOverlay[], fontFamily?: string | null): Promise<string> {
  return (await composePost(imageUrl, overlays, fontFamily)).url;
}
