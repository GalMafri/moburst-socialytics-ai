// Text measurement with the real font, so wrapping and fitting are exact.
import opentype from 'https://esm.sh/opentype.js@1.3.4';

export interface Face { regular: any; bold: any }

export function parseFaces(regular: Uint8Array, bold: Uint8Array): Face {
  return { regular: opentype.parse(regular.buffer.slice(regular.byteOffset, regular.byteOffset + regular.byteLength)), bold: opentype.parse(bold.buffer.slice(bold.byteOffset, bold.byteOffset + bold.byteLength)) };
}

export function advance(face: Face, text: string, size: number, bold: boolean): number {
  return (bold ? face.bold : face.regular).getAdvanceWidth(text, size);
}

export interface Word { text: string; em: boolean }

/** Split a headline into words, marking the emphasis phrase. */
export function wordsOf(headline: string, emphasis?: string | null): Word[] {
  const out: Word[] = [];
  const push = (s: string, em: boolean) => s.split(/\s+/).filter(Boolean).forEach((t) => out.push({ text: t, em }));
  const at = emphasis ? headline.toLowerCase().indexOf(emphasis.toLowerCase()) : -1;
  if (at < 0) push(headline, false);
  else { push(headline.slice(0, at), false); push(headline.slice(at, at + emphasis!.length), true); push(headline.slice(at + emphasis!.length), false); }
  return out;
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
