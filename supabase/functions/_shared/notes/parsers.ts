// supabase/functions/_shared/notes/parsers.ts
//
// The file parsers behind read.ts's Parsers boundary. Only the notes_read
// job loads this module, with a dynamic import when a file needs reading
// (run-scheduled-jobs/index.ts), so the minute worker boots without these
// libraries and a library that does not load holds up only the notes.
// DOCX is read by docx.ts, which Vitest runs on the fixtures as it is.
// Vitest cannot load SheetJS and unpdf from the network: read.test.ts tests
// read.ts around them with the fixtures in ./fixtures, and parsers_smoke.ts
// runs all three parsers on the same fixtures under Deno.

// SheetJS, as its Deno documentation imports it: from the SheetJS CDN, which
// it names the authoritative source (docs.sheetjs.com, "Deno").
// @deno-types="https://cdn.sheetjs.com/xlsx-0.20.3/package/types/index.d.ts"
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs";
// unpdf gives no Deno instructions; it is imported from esm.sh at a fixed
// version, as this repo imports npm packages in edge functions.
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@2.1.0";
import { docxText } from "./docx.ts";
import type { Parsers } from "./read.ts";

export const PARSERS: Parsers = {
  docxText(bytes) {
    return Promise.resolve(docxText(bytes));
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
