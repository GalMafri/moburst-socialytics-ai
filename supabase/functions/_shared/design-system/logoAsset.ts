// The client's logo as a transparent asset, cut once from a reference post:
// crop the measured box with a margin, make the edge-connected backdrop
// transparent, keep only ink connected to the measured box, trim, store.
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

export interface LogoBox { x: number; y: number; width: number; height: number }

export async function cutLogo(sourceBytes: Uint8Array, box: LogoBox): Promise<{ png: Uint8Array; width: number; height: number }> {
  const src = await Image.decode(sourceBytes);
  const m = 0.06;
  const x0 = Math.max(0, Math.round((box.x - m) * src.width)), y0 = Math.max(0, Math.round((box.y - m) * src.height));
  const x1 = Math.min(src.width, Math.round((box.x + box.width + m) * src.width)), y1 = Math.min(src.height, Math.round((box.y + box.height + m) * src.height));
  const crop = src.clone().crop(x0, y0, Math.max(2, x1 - x0), Math.max(2, y1 - y0));
  const W = crop.width, H = crop.height;
  const px = (x: number, y: number) => crop.getPixelAt(x + 1, y + 1);
  const rgb = (c: number) => [(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255];
  const border: number[][] = [];
  for (let x = 0; x < W; x++) { border.push(rgb(px(x, 0)), rgb(px(x, H - 1))); }
  for (let y = 0; y < H; y++) { border.push(rgb(px(0, y)), rgb(px(W - 1, y))); }
  const med = (i: number) => border.map((c) => c[i]).sort((a, b) => a - b)[Math.floor(border.length / 2)];
  const bg = [med(0), med(1), med(2)];
  const dist = (c: number[]) => Math.sqrt((c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2);
  const T = 60;
  const alpha = new Uint8Array(W * H).fill(255);
  const seen = new Uint8Array(W * H); const stack: number[] = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);
  while (stack.length) {
    const at = stack.pop()!; if (seen[at]) continue; seen[at] = 1;
    const x = at % W, y = Math.floor(at / W);
    if (dist(rgb(px(x, y))) > T) continue;
    alpha[at] = 0;
    if (x > 0) stack.push(at - 1); if (x < W - 1) stack.push(at + 1); if (y > 0) stack.push(at - W); if (y < H - 1) stack.push(at + W);
  }
  // Keep only ink components that touch the measured box; the margin may have caught decorations.
  const core = { left: Math.round(m * src.width), top: Math.round(m * src.height), right: W - Math.round(m * src.width), bottom: H - Math.round(m * src.height) };
  const comp = new Uint8Array(W * H);
  for (let start = 0; start < W * H; start++) {
    if (comp[start] || alpha[start] === 0) continue;
    const queue = [start]; const members: number[] = []; comp[start] = 1; let touches = false;
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i]; members.push(at); const x = at % W, y = Math.floor(at / W);
      if (x >= core.left && x <= core.right && y >= core.top && y <= core.bottom) touches = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (comp[n] || alpha[n] === 0) continue; comp[n] = 1; queue.push(n); }
    }
    if (!touches) for (const at of members) alpha[at] = 0;
  }
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const at = y * W + x; if (!alpha[at]) continue;
    const d = dist(rgb(px(x, y)));
    alpha[at] = Math.min(255, Math.round(Math.max(0, d - T * 0.5) / (T * 0.5) * 255));
    if (alpha[at] > 16) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  }
  if (maxX < 0) throw new Error('No logo ink was found inside the measured box.');
  const out = new Image(maxX - minX + 1, maxY - minY + 1);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) { const c = px(x, y); out.setPixelAt(x - minX + 1, y - minY + 1, (((c >>> 8) << 8) | alpha[y * W + x]) >>> 0); }
  return { png: await out.encode(), width: out.width, height: out.height };
}
