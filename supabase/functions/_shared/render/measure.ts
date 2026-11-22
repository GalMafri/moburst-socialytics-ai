// Text measurement with the real font, so wrapping and fitting are exact.
import { opentype } from './opentype.ts';

export interface Face { regular: any; bold: any }

export function parseFaces(regular: Uint8Array, bold: Uint8Array): Face {
  return { regular: opentype.parse(regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength)), bold: opentype.parse(bold.buffer.slice(bold.byteOffset, bold.byteOffset + bold.byteLength)) };
}

export function advance(face: Face, text: string, size: number, bold: boolean): number {
  return (bold ? face.bold : face.regular).getAdvanceWidth(text, size);
}

export interface Word { text: string; em: boolean }

/**
 * Where the emphasis phrase stands in the headline as whole words, or null.
 * QA 22 Nov 2026: a plain indexOf found "art" inside "Restart" and drew the
 * word split in two with half of it highlighted. Matched case-insensitively
 * on the headline itself, so the slice is the text that was matched.
 */
export function emphasisAt(headline: string, emphasis?: string | null): { at: number; length: number } | null {
  const phrase = String(emphasis ?? '').trim();
  if (!phrase) return null;
  const quoted = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${quoted}(?![\\p{L}\\p{N}])`, 'iu').exec(headline);
  return m ? { at: m.index, length: m[0].length } : null;
}

/** Split a headline into words, marking the emphasis phrase. */
export function wordsOf(headline: string, emphasis?: string | null): Word[] {
  const out: Word[] = [];
  const push = (s: string, em: boolean) => s.split(/\s+/).filter(Boolean).forEach((t) => out.push({ text: t, em }));
  const found = emphasisAt(headline, emphasis);
  if (!found) push(headline, false);
  else { push(headline.slice(0, found.at), false); push(headline.slice(found.at, found.at + found.length), true); push(headline.slice(found.at + found.length), false); }
  return out;
}

// What makes up an emoji: pictographs, skin tones, flags' letters, keycaps, and the joiners and selectors between them.
const EMOJI_PART = /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u20E3]/u;
const JOINERS = /[\u200D\uFE0E\uFE0F]/u;

/**
 * The text with the emoji the face cannot draw taken out. The renderer has
 * only the brand's font files (no system or emoji font), so such a glyph
 * comes out as the face's empty box, and a variation selector was measured
 * as a whole box's width while drawing nothing. QA 22 Nov 2026. A face that
 * carries the glyph (a star, a check, a copyright sign) keeps it; letters of
 * any script are left alone.
 */
export function drawable(text: string, fonts: any[]): string {
  const usable = fonts.filter((f) => typeof f?.charToGlyphIndex === 'function');
  if (!usable.length) return text;
  const out = [...text].filter((ch) => !JOINERS.test(ch) && !(EMOJI_PART.test(ch) && usable.some((f) => !f.charToGlyphIndex(ch)))).join('');
  return out === text ? text : out.replace(/[ \t]{2,}/g, ' ').trim();
}

const RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/u;
/** Whether a text is written right to left: it holds Hebrew or Arabic letters. */
export function rightToLeft(text: string): boolean {
  return RTL.test(text);
}

/** Greedy word wrap at one size; the emphasis words measure in bold. */
export function wrap(face: Face, words: Word[], size: number, maxWidth: number, bodyBold: boolean): Word[][] {
  const lines: Word[][] = []; let line: Word[] = []; let w = 0;
  const space = advance(face, ' ', size, bodyBold);
  for (const word of words) {
    const ww = advance(face, word.text, size, word.em || bodyBold);
    const gap = line.length ? space : 0;
    if (line.length && w + gap + ww > maxWidth) { lines.push(line); line = [word]; w = ww; }
    else { line.push(word); w += gap + ww; }
  }
  if (line.length) lines.push(line);
  return lines;
}
