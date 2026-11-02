// An XLSX note read as what it is, an Office Open XML zip (client notes
// design, section 3): one CSV per sheet, in the workbook's order, the shape
// the reading call got before. The reader runs here exactly as in Deno:
// fflate comes from node_modules through the vitest.config.ts alias of its
// Deno import.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { strToU8, zipSync } from "fflate";
import { xlsxSheets } from "./xlsx";

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

/** A one-sheet workbook whose style 1 has the given number format. */
function book(cells: string, opts: { date1904?: boolean; format?: { id: number; code?: string } } = {}): Uint8Array {
  const fmt = opts.format ?? { id: 14 };
  const code = fmt.code?.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return zipSync({
    "xl/workbook.xml": strToU8(`<workbook ${NS}>${opts.date1904 ? '<workbookPr date1904="1"/>' : "<workbookPr/>"}<sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<styleSheet ${NS}>${code ? `<numFmts count="1"><numFmt numFmtId="${fmt.id}" formatCode="${code}"/></numFmts>` : ""}<cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="${fmt.id}"/></cellXfs></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet ${NS}><sheetData><row r="1">${cells}</row></sheetData></worksheet>`),
  });
}
const styled = (values: number[], opts: Parameters<typeof book>[1] = {}) =>
  xlsxSheets(book(values.map((v, i) => `<c r="${"ABCDEFGH"[i]}1" s="1"><v>${v}</v></c>`).join(""), opts))[0].csv;

describe("xlsxSheets", () => {
  it("reads plan.xlsx as before: each sheet in order, an empty one with no lines", () => {
    expect(xlsxSheets(fixture("plan.xlsx"))).toEqual([
      { name: "November", csv: "Date,Note\nNov 1,Holiday sale starts" },
      { name: "Empty", csv: "" },
    ]);
  });

  it("reads shared and inline strings, dates, numbers, booleans and formula text, in the workbook's sheet order", () => {
    expect(xlsxSheets(fixture("mixed.xlsx"))).toEqual([
      {
        name: "Plan, Nov",
        csv: [
          // A rich inline string's runs are joined.
          "Date,Note,Amount",
          // A built-in date format; a rich shared string; a number as written, not as its format shows it.
          '"Nov 1, 2026",Holiday sale,1200.5',
          // The row with a styled cell and no value is left out.
          // A custom date format; TRUE; an error cell is left empty, and empty cells that end a row go.
          '"Nov 30, 2026",TRUE',
          // A formula's text result; a format with no date in it ("Qty: "0) and a time format leave numbers as written.
          ",Total,3,0.75",
          // A field with a comma, a quote or a line break is quoted, quotes doubled.
          '"Say ""hi"", then go","Line one\nLine two",FALSE',
          // Entities decoded; the phonetic guide of a shared string is not text.
          "Café & bar",
        ].join("\n"),
      },
      { name: "Contacts", csv: "Name,Phone\nSinead,5550100" },
    ]);
  });

  it("writes a date serial as a date in the 1900 system, with its leap-year quirk", () => {
    expect(styled([59, 60, 61, 46327, 46327.75])).toBe('"Feb 28, 1900","Feb 29, 1900","Mar 1, 1900","Nov 1, 2026","Nov 1, 2026"');
  });

  it("counts from 1904 when the workbook says date1904", () => {
    expect(styled([0, 1, 44865], { date1904: true })).toBe('"Jan 1, 1904","Jan 2, 1904","Nov 1, 2026"');
  });

  it("knows a date by its built-in id or by day, month or year in a custom format outside quotes and brackets", () => {
    for (const id of [14, 15, 16, 17, 22]) expect(styled([46327], { format: { id } }), String(id)).toBe('"Nov 1, 2026"');
    for (const code of ["[$-409]mmmm d, yyyy", "yyyy", "mmm", "dd/mm/yy", 'd "of" mmmm']) expect(styled([46327], { format: { id: 170, code } }), code).toBe('"Nov 1, 2026"');
    for (const code of ["h:mm", "[h]:mm:ss", "mm:ss", '0.00" m"', '"Day "0', "0%", "@", "General", "#,##0.00"]) expect(styled([46327], { format: { id: 170, code } }), code).toBe("46327");
    for (const id of [0, 1, 2, 4, 9, 49]) expect(styled([46327], { format: { id } }), String(id)).toBe("46327");
  });

  it("leaves a time with no day in a date format as the number written", () => {
    expect(styled([0.5], { format: { id: 20 } })).toBe("0.5");
    expect(styled([0.5], { format: { id: 14 } })).toBe("0.5");
  });

  it("reads cells that do not name their column, and starts each line at the first column used", () => {
    const sheet = '<c t="inlineStr"><is><t>a</t></is></c><c t="inlineStr"><is><t>b</t></is></c>';
    expect(xlsxSheets(book(sheet))[0].csv).toBe("a,b");
    expect(xlsxSheets(book('<c r="C1" t="inlineStr"><is><t>x</t></is></c><c r="E1"><v>2</v></c>'))[0].csv).toBe("x,,2");
  });

  it("has no sheets for a package with no workbook, and throws for a file that is not a zip", () => {
    expect(xlsxSheets(zipSync({ "docProps/app.xml": strToU8("<Properties/>") }))).toEqual([]);
    expect(() => xlsxSheets(new TextEncoder().encode("not a zip"))).toThrow();
  });
});
