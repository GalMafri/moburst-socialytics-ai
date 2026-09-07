// Draws the words onto a picture-only design.
//
// The image model draws pictures well and letters badly, so the picture comes
// back without words and the app sets them: the same typeface, colours and
// positions the editor uses, so a variant arrives looking like a post and the
// editor is for adjusting it, not finishing it. Everything here runs in the
// browser on a canvas; nothing is sent anywhere.

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
    const lines = wrap(ctx, ov.text, canvas.width * 0.84);
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

/**
 * The picture with the words on it, as a PNG data URL. Returns the original
 * URL untouched when there is nothing to draw or drawing fails — a variant
 * without words is still a variant; a lost one is not.
 */
export async function composeTextOnImage(imageUrl: string, overlays: ComposeOverlay[], fontFamily?: string | null): Promise<string> {
  const live = overlays.filter((o) => o.text.trim());
  if (live.length === 0) return imageUrl;
  try {
    await ensureBrandFont(fontFamily);
    const img = await loadImage(imageUrl);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return imageUrl;
    ctx.drawImage(img, 0, 0);
    drawOverlays(ctx, canvas, live, brandFontStack(fontFamily).stack);
    return canvas.toDataURL("image/png");
  } catch {
    return imageUrl;
  }
}
