// A check by hand of the real file parsers, which Vitest cannot load. Run
// from the repository root (it fetches the three libraries):
//
//   deno run --allow-read --allow-net --allow-import --allow-env supabase/functions/_shared/notes/parsers_smoke.ts
//
// It reads each fixture the way the notes_read job does and prints what
// read.ts makes of it: the two DOCX files, the XLSX and notes.pdf as text,
// scan.pdf as a document for the model.

import { PARSERS } from "./parsers.ts";
import { readNoteFile } from "./read.ts";
import type { NoteFileType } from "./notes.ts";

const files: Array<[string, NoteFileType]> = [["meeting.docx", "docx"], ["rich.docx", "docx"], ["plan.xlsx", "xlsx"], ["notes.pdf", "pdf"], ["scan.pdf", "pdf"]];
for (const [name, type] of files) {
  const out = await readNoteFile(await Deno.readFile(new URL(`./fixtures/${name}`, import.meta.url)), type, PARSERS);
  const what = out.kind === "text" ? JSON.stringify(out.text) : out.kind === "nothing" ? out.why : `${out.data.length} base64 characters`;
  console.log(`${name}: ${out.kind}: ${what}`);
}
