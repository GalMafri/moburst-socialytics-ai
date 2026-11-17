// supabase/functions/_shared/design/shape.ts
//
// A page's shape in words, for the prompts that name it (17 Nov 2026,
// spec docs/superpowers/specs/2026-11-17-platform-sizes-design.md). A design
// is drawn on a page in its platform's own shape, so "4:5" is no longer the
// only shape a prompt can name. Imports nothing, so the image brief, the
// planner and the picture service's shared files can all read it.

export interface Size { width: number; height: number }

/** Two rectangles of exactly the same proportions. */
export const sameShape = (a: Size, b: Size): boolean => a.width * b.height === a.height * b.width;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** A page's shape as a prompt names it: "4:5", "1:1", "16:9"; a shape with no small ratio as "1.91:1" or "1:1.91". */
export function shapeLabel(page: Size): string {
  const g = gcd(page.width, page.height) || 1;
  const a = page.width / g, b = page.height / g;
  if (a <= 21 && b <= 21) return `${a}:${b}`;
  return page.width >= page.height ? `${(page.width / page.height).toFixed(2)}:1` : `1:${(page.height / page.width).toFixed(2)}`;
}

/** The same shape in a word. */
export function shapeWord(page: Size): "square" | "wide" | "tall" {
  return page.width === page.height ? "square" : page.width > page.height ? "wide" : "tall";
}
