// supabase/functions/_shared/notes/parsers.ts
//
// The file parsers behind read.ts's Parsers boundary. Only the notes_read
// job loads this module, with a dynamic import when a file needs reading
// (run-scheduled-jobs/index.ts), so the minute worker boots without these
// libraries and a library that does not load holds up only the notes.
// DOCX and XLSX are read as Office Open XML by docx.ts and xlsx.ts, which
// Vitest runs on the fixtures as they are. Vitest cannot load unpdf from the
// network: read.test.ts tests read.ts around it with the fixtures in
// ./fixtures, and parsers_smoke.ts runs every parser on them under Deno.
// Every import here comes from a host the edge deploy allows (esm.sh, npm:).

// unpdf gives no Deno instructions; it is imported from esm.sh at a fixed
// version, as this repo imports npm packages in edge functions.
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@2.1.0";
import { docxText } from "./docx.ts";
import { xlsxSheets } from "./xlsx.ts";
import type { Parsers } from "./read.ts";

export const PARSERS: Parsers = {
  docxText(bytes) {
    return Promise.resolve(docxText(bytes));
  },
  xlsxSheets(bytes) {
    return Promise.resolve(xlsxSheets(bytes));
  },
  async pdfText(bytes) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    // One string per page, kept apart by a blank line so long text is cut between pages.
    const { totalPages, text } = await extractText(pdf, { mergePages: false });
    return { pages: totalPages, text: Array.isArray(text) ? text.join("\n\n") : String(text ?? "") };
  },
};
