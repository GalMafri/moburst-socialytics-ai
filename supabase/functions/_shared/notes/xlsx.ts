// supabase/functions/_shared/notes/xlsx.ts
//
// An XLSX note's sheets, read as what the file is: an Office Open XML zip
// (client notes design, section 3), through ooxml.ts as docx.ts reads a
// document. Each sheet becomes CSV, one block per sheet in the workbook's
// order (read.ts writes 'Sheet "Name":' above each):
//   * xl/workbook.xml gives the sheets' names and order (and date1904), and
//     its relationships give each sheet's part, the shared strings and the
//     styles;
//   * a cell is its shared string (t="s", rich text runs joined, phonetic
//     guides left out), its inline text (t="inlineStr"), its formula's text
//     result (t="str"), TRUE or FALSE (t="b"), nothing for an error (t="e"),
//     else its number as written;
//   * a number in a date format (built-in ids 14 to 22 and 45 to 47, or a
//     custom format with day, month or year outside quotes and brackets) is
//     written as a date, "Nov 1, 2026", counted in the 1900 system (with its
//     Feb 29, 1900) or the 1904 one; a time with no day stays a number;
//   * rows in order, empty rows left out, each line starting at the sheet's
//     first used column, empty cells that end a row dropped, and a field with
//     a comma, a quote or a line break quoted with its quotes doubled.

import { attr, decodeXml, localName, mainPart, readParts, relationships, relsOf, TOKENS } from "./ooxml.ts";

/** Built-in number formats that are dates or times (ECMA-376, 18.8.30). */
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
/** No sheet is read past this much CSV: read.ts reads no more of a note's text than its 400,000 characters. */
const ENOUGH_CHARS = 400_000;
/** Dec 31, 9999, the last day a workbook can hold. */
const LAST_SERIAL = 2_958_465;
const DAY_MS = 86_400_000;

/** Excel writes control characters in text as _xHHHH_. */
const text = (raw: string) => decodeXml(raw).replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/** A custom number format that writes a date: a day, month or year outside quotes, brackets and escapes (an "m" beside hours or seconds is minutes). */
export function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "").replace(/[_*]./g, "").toLowerCase();
  return /[dy]/.test(bare) || (/m/.test(bare) && !/[hs]/.test(bare));
}

/** A date serial as "Nov 1, 2026"; null for a time with no day, or a number no date has. */
function serialDate(serial: number, date1904: boolean): string | null {
  const days = Math.floor(serial);
  if (!Number.isFinite(serial) || days < 0 || days > LAST_SERIAL || (!date1904 && days === 0)) return null;
  // The 1900 system counts Feb 29, 1900, which never was: day 60 is that day, and every day after it is one later.
  if (!date1904 && days === 60) return "Feb 29, 1900";
  const start = date1904 ? Date.UTC(1904, 0, 1) : days < 60 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  return new Date(start + days * DAY_MS).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The shared strings, each with its rich text runs joined and its phonetic guide left out. */
function sharedStrings(xml: string | undefined): string[] {
  const out: string[] = [];
  let current: string[] | null = null;
  let inText = false;
  let phonetic = 0;
  for (const [, close, name, , self, chars] of String(xml ?? "").matchAll(TOKENS)) {
    if (chars !== undefined) {
      if (current && inText && !phonetic) current.push(chars);
      continue;
    }
    const local = localName(name);
    if (self) {
      if (local === "si" && !close) out.push("");
      continue;
    }
    if (local === "si") {
      if (close && current) out.push(text(current.join("")));
      current = close ? null : [];
    } else if (local === "t") inText = !close;
    else if (local === "rPh") phonetic += close ? -1 : 1;
  }
  return out;
}

/** Which cell styles write dates: cellXfs in order, by their number format. */
function dateStyles(xml: string | undefined): boolean[] {
  const custom = new Map<number, string>();
  const styles: boolean[] = [];
  let inCellXfs = false;
  for (const [, close, name, attrs] of String(xml ?? "").matchAll(TOKENS)) {
    const local = localName(name ?? "");
    if (local === "cellXfs") inCellXfs = !close;
    else if (local === "numFmt" && !close) custom.set(Number(attr(attrs, "numFmtId")), String(attr(attrs, "formatCode") ?? ""));
    else if (local === "xf" && !close && inCellXfs) {
      const id = Number(attr(attrs, "numFmtId") ?? 0);
      styles.push(custom.has(id) ? isDateFormat(custom.get(id)!) : DATE_IDS.has(id));
    }
  }
  return styles;
}

/** "AB12" as its column (from 1) and row. */
function cellRef(ref: string | null): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/i.exec(String(ref ?? "").replace(/\$/g, ""));
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

const quoted = (field: string) => (/[",\n\r]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field);

/** One worksheet's cells with a value, by row and column. */
function sheetCells(xml: string, strings: string[], dates: boolean[], date1904: boolean): Map<number, Map<number, string>> {
  const rows = new Map<number, Map<number, string>>();
  let row = 0;
  let col = 0;
  let cell: { col: number; type: string; style: number } | null = null;
  let value: string[] = [];
  let inline: string[] = [];
  let inValue = false;
  let inInline = false;
  let inText = false;
  let phonetic = 0;
  const put = (c: number, v: string) => {
    if (!v) return;
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row)!.set(c, v);
  };
  const cellValue = (c: { col: number; type: string; style: number }): string => {
    const v = value.join("").trim();
    switch (c.type) {
      case "s": return strings[Number(v)] ?? "";
      case "inlineStr": return text(inline.join(""));
      case "str": return text(value.join(""));
      case "b": return v === "1" ? "TRUE" : v === "0" ? "FALSE" : "";
      case "e": return "";
      case "d": return v;
      default: return dates[c.style] && v ? serialDate(Number(v), date1904) ?? v : v;
    }
  };
  for (const [, close, name, attrs, self, chars] of xml.matchAll(TOKENS)) {
    if (chars !== undefined) {
      if (inValue) value.push(chars);
      else if (inInline && inText && !phonetic) inline.push(chars);
      continue;
    }
    const local = localName(name);
    if (local === "row" && !close) {
      row = Number(attr(attrs, "r")) || row + 1;
      col = 0;
    } else if (local === "c" && !close) {
      const ref = cellRef(attr(attrs, "r"));
      if (ref) row = ref.row;
      col = ref?.col ?? col + 1;
      cell = { col, type: String(attr(attrs, "t") ?? "n"), style: Number(attr(attrs, "s") ?? 0) };
      value = [];
      inline = [];
      if (self) cell = null;
    } else if (local === "c" && close) {
      if (cell) put(cell.col, cellValue(cell));
      cell = null;
    } else if (!self && local === "v") inValue = !close && !!cell;
    else if (!self && local === "is") inInline = !close;
    else if (!self && local === "t") inText = !close;
    else if (!self && local === "rPh") phonetic += close ? -1 : 1;
  }
  return rows;
}

/** A sheet's cells as CSV, at most `budget` characters of it. */
function csvOf(rows: Map<number, Map<number, string>>, budget: number): string {
  let first = Infinity;
  for (const cells of rows.values()) for (const c of cells.keys()) first = Math.min(first, c);
  const lines: string[] = [];
  let used = 0;
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const cells = rows.get(r)!;
    const last = Math.max(...cells.keys());
    const fields: string[] = [];
    for (let c = first; c <= last; c++) fields.push(quoted(cells.get(c) ?? ""));
    const line = fields.join(",");
    lines.push(line);
    used += line.length + 1;
    if (used > budget) break;
  }
  return lines.join("\n");
}

/** Each sheet of an XLSX file, in the workbook's order, as CSV. Throws when the file is not a zip. */
export function xlsxSheets(bytes: Uint8Array): Array<{ name: string; csv: string }> {
  const book = mainPart(readParts(bytes, (name) => name === "_rels/.rels")["_rels/.rels"], "xl/workbook.xml");
  const top = readParts(bytes, (name) => name === book || name === relsOf(book));
  if (!top[book]) return [];
  const links = relationships(top[relsOf(book)], book);
  const partOf = (type: string, otherwise: string) => links.find((l) => l.type === type)?.part ?? otherwise;
  const stringsPart = partOf("sharedStrings", "xl/sharedStrings.xml");
  const stylesPart = partOf("styles", "xl/styles.xml");
  const shared = readParts(bytes, (name) => name === stringsPart || name === stylesPart);
  const strings = sharedStrings(shared[stringsPart]);
  const dates = dateStyles(shared[stylesPart]);

  let date1904 = false;
  const sheets: Array<{ name: string; part: string | null }> = [];
  for (const [, close, name, attrs] of top[book].matchAll(TOKENS)) {
    const local = localName(name ?? "");
    if (close) continue;
    if (local === "workbookPr") date1904 = ["1", "true"].includes(String(attr(attrs, "date1904") ?? "").toLowerCase());
    if (local === "sheet") {
      const id = attr(attrs, "*:id");
      sheets.push({ name: String(attr(attrs, "name") ?? ""), part: links.find((l) => l.id === id && l.type === "worksheet")?.part ?? null });
    }
  }

  const out: Array<{ name: string; csv: string }> = [];
  let left = ENOUGH_CHARS;
  for (const sheet of sheets) {
    const xml = sheet.part && left > 0 ? readParts(bytes, (name) => name === sheet.part)[sheet.part] : undefined;
    const csv = xml ? csvOf(sheetCells(xml, strings, dates, date1904), left) : "";
    left -= csv.length;
    out.push({ name: sheet.name, csv });
  }
  return out;
}
