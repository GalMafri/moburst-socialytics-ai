// supabase/functions/_shared/notes/read.ts
//
// A client note's file as something the reading call can take (client notes
// design, section 3): its text, with no model call, for TXT, MD and CSV
// (decoded here), DOCX (its XML, docx.ts), XLSX (its XML, xlsx.ts, one CSV
// per sheet) and a PDF with a text layer (unpdf); the file itself, as a document or
// image block, for a scan or a screenshot. Long text is read in parts cut at
// paragraph breaks, and text past 400,000 characters is not read.
//
// The readers (parsers.ts) stand behind the Parsers boundary: unpdf comes
// from the network, and the DOCX and XLSX readers import fflate as Deno does.
// This module and the screen never load them; the notes_read job loads them
// only when a file needs one, and the tests run the DOCX and XLSX readers as
// they are.

import { clipText } from "../text/clip.ts";
import type { NoteFileType } from "./notes.ts";

/** What each library is asked for. parsers.ts is the real one. */
export interface Parsers {
  /** docx.ts: the document's text, a paragraph a line, then its footnotes and endnotes. */
  docxText(bytes: Uint8Array): Promise<string>;
  /** xlsx.ts: each sheet's name and its CSV, in the workbook's order. */
  xlsxSheets(bytes: Uint8Array): Promise<Array<{ name: string; csv: string }>>;
  /** unpdf: the text layer of every page, and how many pages there are. */
  pdfText(bytes: Uint8Array): Promise<{ pages: number; text: string }>;
}

export type NoteSource =
  /** chars: the whole text's length, when more was there than is kept. */
  | { kind: "text"; text: string; chars: number }
  | { kind: "document"; data: string; pages: number }
  | { kind: "image"; mediaType: "image/png" | "image/jpeg"; data: string }
  | { kind: "nothing"; why: string };

/** Text past this is not read; the note says how much was. */
export const NOTE_READ_MAX_CHARS = 400_000;
/** One reading call's part. */
export const PART_CHARS = 60_000;
/** The largest image one reading call takes. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** The most pages of a scan one reading call takes. */
export const PDF_MAX_PAGES = 100;

/** Text in UTF-8, or UTF-16 when the file starts with its byte order mark; the mark itself dropped. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

/** Line breaks made plain, spaces at line ends and runs of blank lines taken out. */
function tidy(text: string): string {
  return String(text ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * A PDF whose text layer is almost empty: under 80 letters a page, about one
 * line. A scan read as text would lose what it says; a short text PDF read as
 * a document only costs a little more.
 */
export function isScan(text: string, pages: number): boolean {
  return String(text ?? "").replace(/\s+/g, "").length < 80 * Math.max(1, pages);
}

export function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** The text that is read: the whole of it, or up to the last paragraph break before NOTE_READ_MAX_CHARS. */
export function noteText(full: string): { text: string; chars: number } {
  if (full.length <= NOTE_READ_MAX_CHARS) return { text: full, chars: full.length };
  const cut = clipText(full, NOTE_READ_MAX_CHARS);
  const para = cut.lastIndexOf("\n\n");
  return { text: (para > NOTE_READ_MAX_CHARS * 0.75 ? cut.slice(0, para) : cut).trimEnd(), chars: full.length };
}

/** A piece longer than `max`, cut at line breaks, else at the last space, else where it must. */
function cutLong(piece: string, max: number): string[] {
  const out: string[] = [];
  let rest = piece;
  while (rest.length > max) {
    const head = clipText(rest, max);
    const at = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
    const end = at > max / 2 ? at : head.length;
    out.push(rest.slice(0, end).trimEnd());
    rest = rest.slice(end).replace(/^[\n ]/, "");
  }
  if (rest) out.push(rest);
  return out;
}

/** Text in parts of at most `max` characters, each made of whole paragraphs where a paragraph fits. */
export function splitParts(text: string, max = PART_CHARS): string[] {
  const parts: string[] = [];
  let current = "";
  for (const para of text.split("\n\n")) {
    for (const piece of para.length > max ? cutLong(para, max) : [para]) {
      if (current && current.length + 2 + piece.length > max) {
        parts.push(current);
        current = "";
      }
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

const asText = (text: string): NoteSource => {
  const clean = tidy(text);
  return clean ? { kind: "text", ...noteText(clean) } : { kind: "nothing", why: "The file has no text." };
};

/**
 * What one file holds for the reading call. A parser that cannot open the
 * file opens it no better the next time, so that is nothing to read, not a
 * reason to try again.
 */
export async function readNoteFile(bytes: Uint8Array, type: NoteFileType, parsers: Parsers): Promise<NoteSource> {
  try {
    switch (type) {
      case "txt":
      case "md":
      case "csv":
        return asText(decodeText(bytes));
      case "docx":
        return asText(await parsers.docxText(bytes));
      case "xlsx": {
        const sheets = (await parsers.xlsxSheets(bytes)).filter((s) => tidy(s.csv));
        return asText(sheets.map((s) => `Sheet "${s.name}":\n${tidy(s.csv)}`).join("\n\n"));
      }
      case "pdf": {
        const { pages, text } = await parsers.pdfText(bytes);
        if (!isScan(text, pages)) return asText(text);
        if (pages > PDF_MAX_PAGES) return { kind: "nothing", why: `A scan of ${pages} pages is more than one reading takes.` };
        return { kind: "document", data: base64(bytes), pages };
      }
      case "png":
      case "jpg":
        if (bytes.length > IMAGE_MAX_BYTES) return { kind: "nothing", why: "The image is larger than one reading takes." };
        return { kind: "image", mediaType: type === "png" ? "image/png" : "image/jpeg", data: base64(bytes) };
    }
  } catch (e) {
    return { kind: "nothing", why: `The file could not be opened: ${e instanceof Error ? e.message : String(e)}` };
  }
  return { kind: "nothing", why: `No reader takes ${type} files.` };
}
