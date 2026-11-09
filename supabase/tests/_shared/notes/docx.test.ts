// A DOCX note read as what it is, an Office Open XML zip (client notes
// design, section 3). The reader runs here exactly as in Deno: fflate comes
// from node_modules through the vitest.config.ts alias of its Deno import.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { strToU8, zipSync } from "fflate";
import { docxText } from "../../../functions/_shared/notes/docx";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "..", "..", "..", "fixtures", "notes", name)));
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

describe("docxText", () => {
  it("reads each paragraph as a line", () => {
    expect(docxText(fixture("meeting.docx"))).toBe('Meeting with Bader Law, Oct 28.\nNever say "cheap". Say "affordable".');
  });

  it("reads Word's own shapes in document order: tabs, breaks, entities, tracked changes, tables, fields, text boxes, then footnotes and endnotes", () => {
    expect(docxText(fixture("rich.docx"))).toBe([
      // A tab in the text; the tab stop in the paragraph's properties is not one.
      "Call with\tBader Law",
      "Line one\nLine two\nLine three",
      "Say \"affordable\" & never <cheap>, café’s",
      // The deleted word is skipped, the inserted one kept.
      "Use plain words.",
      // Cells end with a tab and rows with a line, as a CSV reads; a cell's two paragraphs stay in its cell.
      "Date\tNote",
      "Nov 1\tSale starts All stores",
      // The footnote reference itself has no text.
      "See the note.",
      // A text box is read once, not again from its fallback drawing.
      "Boxed text",
      "",
      // A field's code is not text; its result is.
      "Page 3",
      "",
      // Footnotes and endnotes after the body; their separators have no text.
      "Footnote: said on the Oct 28 call.",
      "",
      "Endnote text.",
    ].join("\n"));
  });

  it("finds the main part through the package's relationships when it is not word/document.xml", () => {
    const rels = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/word/document2.xml"/></Relationships>';
    expect(docxText(docx({ "_rels/.rels": rels, "word/document2.xml": `<w:document ${W}><w:body><w:p><w:r><w:t>Elsewhere.</w:t></w:r></w:p></w:body></w:document>` }))).toBe("Elsewhere.");
  });

  it("reads a self-closing paragraph as an empty line and a whole deleted paragraph as nothing", () => {
    const xml = `<w:document ${W}><w:body><w:p><w:r><w:t>One</w:t></w:r></w:p><w:p/><w:p><w:del w:id="1"><w:r><w:delText>Gone</w:delText></w:r></w:del></w:p><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:body></w:document>`;
    expect(docxText(docx({ "word/document.xml": xml }))).toBe("One\n\n\nTwo");
  });

  it("has no text for a package with no document, and throws for a file that is not a zip", () => {
    expect(docxText(docx({ "docProps/app.xml": "<Properties/>" }))).toBe("");
    expect(() => docxText(new TextEncoder().encode("not a zip"))).toThrow();
  });
});
