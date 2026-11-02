// supabase/functions/_shared/notes/parsers.ts
//
// The file parsers behind read.ts's Parsers boundary. Only the notes_read
// job loads this module, with a dynamic import when a file needs reading
// (run-scheduled-jobs/index.ts), so the minute worker boots without these
// libraries and a library that does not load holds up only the notes.
// Vitest cannot load network imports: read.test.ts tests read.ts with the
// fixtures in ./fixtures, and parsers_smoke.ts runs these parsers on the
// same fixtures under Deno.

// SheetJS, as its Deno documentation imports it: from the SheetJS CDN, which
// it names the authoritative source (docs.sheetjs.com, "Deno").
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
// mammoth and unpdf give no Deno instructions; they are imported from esm.sh
// at a fixed version, as this repo imports npm packages in edge functions.
import mammoth from "https://esm.sh/mammoth@1.13.0";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@2.1.0";
import { Buffer } from "node:buffer";
import type { Parsers } from "./read.ts";

export const PARSERS: Parsers = {
  async docxText(bytes) {
    // mammoth reads { buffer } in its Node build and { arrayBuffer } in its
    // browser build (its README); both are given, so either build reads it.
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    // deno-lint-ignore no-explicit-any
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes), arrayBuffer } as any);
    return String(value ?? "");
  },
  xlsxSheets(bytes) {
    const book = XLSX.read(bytes, { type: "array" });
    return Promise.resolve(book.SheetNames.map((name: string) => ({
      name,
      // Blank rows and the empty cells that end a row say nothing.
      csv: XLSX.utils.sheet_to_csv(book.Sheets[name], { blankrows: false, strip: true }),
    })));
  },
  async pdfText(bytes) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    // One string per page, kept apart by a blank line so long text is cut between pages.
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return { pages: totalPages, text: Array.isArray(text) ? text.join("\n\n") : String(text ?? "") };
  },
};
