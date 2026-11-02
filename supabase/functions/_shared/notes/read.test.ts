// Reading a note's file into text, with no model call for text (client notes
// design, section 3). SheetJS and unpdf are imported from the network in
// parsers.ts and cannot load under Vitest, so they stand behind the Parsers
// boundary: these tests give read.ts the real fixture files and parsers that
// answer as those libraries do, and check everything read.ts does around
// them. TXT, MD and CSV are decoded here for real, and DOCX is read by the
// real reader (docx.ts, tested on its own in docx.test.ts).

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { base64, decodeText, isScan, noteText, readNoteFile, splitParts, IMAGE_MAX_BYTES, NOTE_READ_MAX_CHARS, PART_CHARS, PDF_MAX_PAGES, type Parsers } from "./read";
import { docxText } from "./docx";

const PDF_TEXT = "Meeting notes, Oct 28: never say cheap. They asked for shorter captions on Instagram and no puns anywhere.";
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));
const startsWith = (bytes: Uint8Array, magic: string) => new TextDecoder("latin1").decode(bytes.slice(0, magic.length)) === magic;

/** The real DOCX reader, and parsers that answer as SheetJS and unpdf do and fail the test when handed anything but the file they read. */
function parsers(over: Partial<Parsers> = {}): Parsers {
  return {
    docxText: vi.fn(async (bytes: Uint8Array) => docxText(bytes)),
    xlsxSheets: vi.fn(async (bytes: Uint8Array) => {
      expect(startsWith(bytes, "PK")).toBe(true);
      return [{ name: "November", csv: "Date,Note\nNov 1,Holiday sale starts" }, { name: "Empty", csv: "" }];
    }),
    pdfText: vi.fn(async (bytes: Uint8Array) => {
      expect(startsWith(bytes, "%PDF")).toBe(true);
      return { pages: 1, text: PDF_TEXT };
    }),
    ...over,
  };
}

describe("readNoteFile", () => {
  it("decodes TXT, MD and CSV here, including a UTF-16 file", async () => {
    const txt = await readNoteFile(fixture("meeting.txt"), "txt", parsers());
    expect(txt).toMatchObject({ kind: "text", text: expect.stringContaining('They asked us to stop saying "cheap".') });
    expect(await readNoteFile(fixture("feedback.md"), "md", parsers())).toMatchObject({ kind: "text", text: expect.stringContaining("- No puns.") });
    expect(await readNoteFile(fixture("calendar.csv"), "csv", parsers())).toMatchObject({ kind: "text", text: expect.stringContaining("2026-11-01,Instagram,Holiday sale starts") });
    expect(await readNoteFile(fixture("utf16.txt"), "txt", parsers())).toMatchObject({ kind: "text", text: 'Never say "cheap".' });
  });

  it("reads a DOCX with the real reader, a paragraph a line", async () => {
    const p = parsers();
    const out = await readNoteFile(fixture("meeting.docx"), "docx", p);
    expect(p.docxText).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ kind: "text", text: 'Meeting with Bader Law, Oct 28.\nNever say "cheap". Say "affordable".', chars: 68 });
    // A table reads like the CSV path, and the footnotes come after the body.
    const rich = await readNoteFile(fixture("rich.docx"), "docx", p);
    expect(rich).toMatchObject({ kind: "text", text: expect.stringContaining("Date\tNote\nNov 1\tSale starts All stores") });
    expect((rich as { text: string }).text.endsWith("Footnote: said on the Oct 28 call.\n\nEndnote text.")).toBe(true);
  });

  it("reads an XLSX as one CSV per sheet, leaving out empty sheets", async () => {
    const out = await readNoteFile(fixture("plan.xlsx"), "xlsx", parsers());
    expect(out).toMatchObject({ kind: "text", text: 'Sheet "November":\nDate,Note\nNov 1,Holiday sale starts' });
  });

  it("reads a PDF's text layer with no model call", async () => {
    expect(await readNoteFile(fixture("notes.pdf"), "pdf", parsers())).toMatchObject({ kind: "text", text: PDF_TEXT });
  });

  it("hands a scan (a PDF with almost no text layer) to the model as the document itself", async () => {
    const bytes = fixture("scan.pdf");
    const out = await readNoteFile(bytes, "pdf", parsers({ pdfText: async () => ({ pages: 3, text: " 1 \n 2 \n 3 " }) }));
    expect(out).toEqual({ kind: "document", data: base64(bytes), pages: 3 });
    expect(atob((out as { data: string }).data).startsWith("%PDF")).toBe(true);
    // Past the pages one reading call takes, there is nothing it can read.
    expect(await readNoteFile(bytes, "pdf", parsers({ pdfText: async () => ({ pages: PDF_MAX_PAGES + 1, text: "" }) }))).toMatchObject({ kind: "nothing" });
  });

  it("hands a screenshot to the model as an image, within the size the model takes", async () => {
    expect(await readNoteFile(fixture("screenshot.png"), "png", parsers())).toEqual({ kind: "image", mediaType: "image/png", data: base64(fixture("screenshot.png")) });
    expect(await readNoteFile(fixture("screenshot.jpg"), "jpg", parsers())).toMatchObject({ kind: "image", mediaType: "image/jpeg" });
    expect(await readNoteFile(new Uint8Array(IMAGE_MAX_BYTES + 1), "png", parsers())).toMatchObject({ kind: "nothing" });
  });

  it("finds nothing in a file its parser cannot open, or one with no text", async () => {
    // A .docx that is not a zip: the real reader cannot open it.
    expect(await readNoteFile(new TextEncoder().encode("not a zip"), "docx", parsers())).toMatchObject({ kind: "nothing" });
    expect(await readNoteFile(new TextEncoder().encode(" \n\n "), "txt", parsers())).toMatchObject({ kind: "nothing" });
  });
});

describe("long text", () => {
  const paragraphs = Array.from({ length: 130 }, (_, i) => `Paragraph ${i}. ${"word ".repeat(198)}`.trim());
  const text = paragraphs.join("\n\n");

  it("is read in parts of at most 60,000 characters, cut at paragraph breaks", () => {
    const parts = splitParts(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(PART_CHARS);
    // No paragraph is cut: every part is whole paragraphs, and together they are the text.
    expect(parts.join("\n\n")).toBe(text);
    for (const p of parts) expect(p.split("\n\n").every((x) => paragraphs.includes(x))).toBe(true);
    expect(splitParts("Short note.")).toEqual(["Short note."]);
  });

  it("cuts a paragraph longer than a part at a line, else at a word", () => {
    const one = `${"a line of words\n".repeat(5000)}${"x ".repeat(40000)}`.trim();
    const parts = splitParts(one);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(PART_CHARS);
    expect(parts.join("").replace(/\s+/g, "")).toBe(one.replace(/\s+/g, ""));
  });

  it("stops at 400,000 characters and keeps how long the whole text was", () => {
    const long = Array.from({ length: 600 }, (_, i) => `P${i} ${"z".repeat(995)}`).join("\n\n");
    const out = noteText(long);
    expect(out.text.length).toBeLessThanOrEqual(NOTE_READ_MAX_CHARS);
    expect(out.text.length).toBeGreaterThan(NOTE_READ_MAX_CHARS - 1100);
    expect(out.chars).toBe(long.length);
    expect(long.startsWith(out.text)).toBe(true);
    expect(noteText("Short.")).toEqual({ text: "Short.", chars: 6 });
  });
});

describe("helpers", () => {
  it("tells a scan from a PDF with text", () => {
    expect(isScan("", 1)).toBe(true);
    expect(isScan("Page 1 Page 2", 2)).toBe(true);
    expect(isScan(PDF_TEXT, 1)).toBe(false);
    expect(isScan(`CONFIDENTIAL Bader Law page ${"x".repeat(10)}`, 1)).toBe(true);
  });

  it("decodes UTF-8 without its byte order mark", () => {
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe("hi");
  });
});
