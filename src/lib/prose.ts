// Text shaping for AI-written passages. Pure string work, no React, so the
// tests can import it directly.

/**
 * Abbreviations whose full stop ends a word, not a sentence. Matched against
 * the text up to and including the stop.
 */
const ABBREVIATION = /(?:e\.g|i\.e|etc|vs|approx|est|Inc|Ltd|Co|Corp|Dr|Mr|Mrs|Ms|Prof|Jr|Sr|St|No|Fig|Vol|U\.S|a\.m|p\.m)\.$/i;

/**
 * Splits a paragraph into sentences.
 *
 * A break needs a full stop, question or exclamation mark, optional closing
 * quotes or brackets, whitespace, and then something that can open a sentence.
 * Decimals ("0.00135") and ratios never match because they carry no space, and
 * a stop that ends a known abbreviation is skipped.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /([.!?])(["'’”)\]]*)\s+(?=["'“(]?[A-Z0-9])/g;
  let start = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const head = text.slice(0, m.index + 1);
    if (ABBREVIATION.test(head)) continue;
    const sentence = text.slice(start, m.index + 1 + m[2].length).trim();
    if (sentence) out.push(sentence);
    start = re.lastIndex;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** Sentences gathered into blocks of roughly `target` characters. */
export function groupSentences(sentences: string[], target = 260): string[] {
  const out: string[] = [];
  let current = "";
  for (const s of sentences) {
    current = current ? `${current} ${s}` : s;
    if (current.length >= target) {
      out.push(current);
      current = "";
    }
  }
  if (current) {
    // A short trailing remainder reads better appended than stranded alone.
    if (out.length > 0 && current.length < 80) out[out.length - 1] += ` ${current}`;
    else out.push(current);
  }
  return out;
}

/**
 * One unbroken slab of prose is unreadable and, in a multi-column flow, cannot
 * break across columns — it sits in the first one and leaves the rest of the
 * card empty. Long paragraphs are regrouped on sentence boundaries; every word
 * is kept, only paragraph breaks are added. Anything shorter is left alone.
 */
export function reflowParagraph(paragraph: string, { min = 300, target = 220 } = {}): string[] {
  if (paragraph.length <= min) return [paragraph];
  const sentences = splitSentences(paragraph);
  // Two sentences of 250 characters each are two paragraphs, not one: the
  // floor used to be three, which left the densest passages in one block.
  if (sentences.length < 2) return [paragraph];
  const grouped = groupSentences(sentences, target);
  return grouped.length > 1 ? grouped : [paragraph];
}

/**
 * Drops the raw links an analysis carries inline.
 *
 * These passages cite their evidence as bare URLs — "…hit 41,317 engagements
 * (https://www.instagram.com/reel/DaT12VAOWPf/)" — which is a line and a half
 * of unreadable text for something the page already offers as a thumbnail you
 * can click. The punctuation left behind is tidied up so the sentence still
 * reads.
 */
export function withoutUrls(text: string): string {
  return text
    .replace(/\s*\((?:see\s+)?https?:\/\/[^\s)]+\)/gi, "")
    .replace(/\s*https?:\/\/[^\s)]+/gi, "")
    .replace(/\(\s*[;,]?\s*\)/g, "")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
