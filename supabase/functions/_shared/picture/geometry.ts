// supabase/functions/_shared/picture/geometry.ts
//
// The rectangles the design worker sends to the picture service, worked out
// in plain arithmetic so the worker never decodes a picture to learn them
// (12 Nov 2026: the decoding moved to the picture service). Imports only the
// contract's types, so both the Deno workers and the tests can use it.

import type { Rect, Size } from "./contract.ts";

/** A rectangle scaled by `k`, each field rounded to whole pixels. */
export function scaledRect(rect: Rect, k: number): Rect {
  return { x: Math.round(rect.x * k), y: Math.round(rect.y * k), width: Math.round(rect.width * k), height: Math.round(rect.height * k) };
}

/** The area verify reads around the logo on the delivered picture: 0.6 of the logo's height around its rectangle, clipped to the picture (design-worker verify, 11 Nov 2026). */
export function logoAreaRect(logoRect: Rect, frame: [number, number], final: Size): Rect {
  const k = final.width / frame[0];
  const m = Math.round(logoRect.height * k * 0.6);
  const x0 = Math.max(0, Math.round(logoRect.x * k) - m);
  const y0 = Math.max(0, Math.round(logoRect.y * k) - m);
  const x1 = Math.min(final.width, Math.round((logoRect.x + logoRect.width) * k) + m);
  const y1 = Math.min(final.height, Math.round((logoRect.y + logoRect.height) * k) + m);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
