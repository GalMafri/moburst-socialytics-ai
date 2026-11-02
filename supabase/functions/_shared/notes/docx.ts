// supabase/functions/_shared/notes/docx.ts
//
// A DOCX note's text, read as what the file is: an Office Open XML zip (client
// notes design, section 3). fflate unzips it; the main part (word/document.xml,
// or wherever the package's relationships point) is read in document order,
// then word/footnotes.xml and word/endnotes.xml when present:
//   * each paragraph (w:p) ends a line; w:t is text, w:tab a tab, w:br and
//     w:cr a line break; XML entities are decoded;
//   * deleted text (w:del, w:delText, w:moveFrom) is skipped and inserted text
//     kept, so a tracked document reads as it now stands;
//   * table cells (w:tc) end with a tab and rows (w:tr) with a line, so a
//     table reads like the CSV path; a cell's own paragraphs stay in its cell;
//   * tab stops (w:tabs), field codes (w:instrText), the fallback copy of a
//     drawing (mc:Fallback) and the separators of footnotes and endnotes are
//     not text.
// The package is read through ooxml.ts, as xlsx.ts reads a workbook.

import { decodeXml, mainPart, readParts, TOKENS } from "./ooxml.ts";

const NOTES_PARTS = ["word/footnotes.xml", "word/endnotes.xml"];
const SEPARATOR = /\bw:type\s*=\s*["'](?:separator|continuationSeparator|continuationNotice)["']/;

/** One WordprocessingML part's text, in document order. */
function partText(xml: string): string {
  const out: string[] = [];
  let text = false;
  let removed = 0;
  let fallback = 0;
  let tabStops = 0;
  let cells = 0;
  let separators = 0;
  const notes: boolean[] = [];
  const hidden = () => removed > 0 || fallback > 0 || separators > 0;
  const lineEnd = () => (cells > 0 ? " " : "\n");
  // Spaces that end the cell's last paragraph go; an empty chunk is dropped.
  const trimSpaces = () => {
    while (out.length) {
      const last = out[out.length - 1].replace(/ +$/, "");
      if (last) { out[out.length - 1] = last; return; }
      out.pop();
    }
  };
  for (const [, close, name, attrs, self, chars] of xml.matchAll(TOKENS)) {
    if (chars !== undefined) {
      if (text && !hidden()) out.push(decodeXml(chars));
      continue;
    }
    if (close) {
      switch (name) {
        case "w:t": text = false; break;
        case "w:del": case "w:moveFrom": removed--; break;
        case "mc:Fallback": fallback--; break;
        case "w:tabs": tabStops--; break;
        case "w:footnote": case "w:endnote": if (notes.pop()) separators--; break;
        case "w:p": if (!hidden()) out.push(lineEnd()); break;
        case "w:tc":
          cells--;
          if (!hidden()) { trimSpaces(); out.push("\t"); }
          break;
        case "w:tr":
          if (!hidden()) {
            if (out[out.length - 1] === "\t") out.pop();
            out.push(lineEnd());
          }
          break;
      }
      continue;
    }
    if (self) {
      switch (name) {
        case "w:p": if (!hidden()) out.push(lineEnd()); break;
        case "w:tab": case "w:ptab": if (!tabStops && !hidden()) out.push("\t"); break;
        case "w:br": case "w:cr": if (!hidden()) out.push(lineEnd()); break;
        case "w:noBreakHyphen": if (!hidden()) out.push("-"); break;
      }
      continue;
    }
    switch (name) {
      case "w:t": text = true; break;
      case "w:del": case "w:moveFrom": removed++; break;
      case "mc:Fallback": fallback++; break;
      case "w:tabs": tabStops++; break;
      case "w:tc": cells++; break;
      case "w:footnote": case "w:endnote": {
        const separator = SEPARATOR.test(attrs);
        notes.push(separator);
        if (separator) separators++;
        break;
      }
    }
  }
  return out.join("").replace(/^\n+/, "").replace(/\s+$/, "");
}

/** The text of a DOCX file: the document, then its footnotes and endnotes. Throws when the file is not a zip. */
export function docxText(bytes: Uint8Array): string {
  const main = mainPart(readParts(bytes, (name) => name === "_rels/.rels")["_rels/.rels"], "word/document.xml");
  const parts = readParts(bytes, (name) => name === main || NOTES_PARTS.includes(name));
  return [main, ...NOTES_PARTS]
    .map((name) => (parts[name] ? partText(parts[name]) : ""))
    .filter(Boolean)
    .join("\n\n");
}
