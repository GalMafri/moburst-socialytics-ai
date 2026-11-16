// Every input has a programmatic label. A field a screen reader cannot name is
// a field a person using one cannot fill. An <Input>, <Textarea>, <SelectTrigger>
// (or a bare input, textarea or select) is named when it has an aria-label or
// aria-labelledby, an id that a <Label htmlFor> in the same file points at, or
// a <label> around it. A hidden input has nothing to name, and an element that
// spreads its props leaves the name to whoever passes them.

import { describe, expect, it } from "vitest";
import ts from "typescript";
import { readFileSync } from "fs";
import { join } from "path";
import { appFiles, SRC } from "../guardSource";

const FIELDS = new Set(["Input", "Textarea", "SelectTrigger", "input", "textarea", "select"]);
const LABELS = new Set(["Label", "label", "FormLabel"]);

/** The fields in a source file that have no programmatic label, as "line: <Tag>". */
export function unlabeledFields(path: string, text: string): string[] {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TSX);
  const attr = (el: ts.JsxOpeningLikeElement, name: string) => el.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === name);
  const value = (a: ts.JsxAttribute | undefined) => (a?.initializer ? a.initializer.getText(sf).replace(/^\{|\}$/g, "") : null);
  const pointedAt = new Set<string>();
  const fields: ts.JsxOpeningLikeElement[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      const target = value(attr(n, "htmlFor"));
      if (target) pointedAt.add(target);
      if (FIELDS.has(tag)) fields.push(n);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const wrapped = (el: ts.Node) => {
    for (let p: ts.Node | undefined = el.parent; p; p = p.parent) if (ts.isJsxElement(p) && LABELS.has(p.openingElement.tagName.getText(sf))) return true;
    return false;
  };
  return fields
    .filter((el) => {
      if (el.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a))) return false;
      if (value(attr(el, "type"))?.replace(/["']/g, "") === "hidden") return false;
      if (attr(el, "aria-label") || attr(el, "aria-labelledby")) return false;
      const id = value(attr(el, "id"));
      if (id && pointedAt.has(id)) return false;
      return !wrapped(el);
    })
    .map((el) => `${sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1}: <${el.tagName.getText(sf)}>`);
}

describe("every input has a programmatic label", () => {
  const at = (source: string) => unlabeledFields("components/Sample.tsx", source);

  it("catches a field with a label that is not tied to it, or no label at all", () => {
    expect(at('const A = () => <div><Label>Name</Label><Input value={v} /></div>;')).toEqual(["1: <Input>"]);
    expect(at('const A = () => <><Label htmlFor="a">Name</Label><Input id="b" /></>;')).toEqual(["1: <Input>"]);
    expect(at('const A = () => <Textarea placeholder="Notes" />;')).toEqual(["1: <Textarea>"]);
    expect(at('const A = () => <Select><SelectTrigger><SelectValue placeholder="Pick" /></SelectTrigger></Select>;')).toEqual(["1: <SelectTrigger>"]);
    expect(at('const A = () => <input type="text" />;')).toEqual(["1: <input>"]);
  });

  it("leaves a field with an id a label points at, an aria-label, a wrapping label, a hidden input or spread props", () => {
    expect(at('const A = () => <><Label htmlFor="name">Name</Label><Input id="name" /></>;')).toEqual([]);
    expect(at("const A = () => <><Label htmlFor={`n-${i}`}>Name</Label><Input id={`n-${i}`} /></>;")).toEqual([]);
    expect(at('const A = () => <Input aria-label="Search clients" placeholder="Search" />;')).toEqual([]);
    expect(at('const A = () => <SelectTrigger aria-labelledby="x"><SelectValue /></SelectTrigger>;')).toEqual([]);
    expect(at("const A = () => <label>Name <input /></label>;")).toEqual([]);
    expect(at('const A = () => <input type="hidden" value="1" />;')).toEqual([]);
    expect(at("const A = (props) => <Input {...props} />;")).toEqual([]);
  });

  it("scans the pages and components that hold fields", () => {
    const scanned = appFiles().filter((f) => /^(?:pages|components)\//.test(f) && !f.startsWith("components/ui/") && f.endsWith(".tsx"));
    expect(scanned.length).toBeGreaterThan(100);
    expect(scanned.filter((f) => /<(?:Input|Textarea|SelectTrigger)\b/.test(readFileSync(join(SRC, f), "utf8"))).length).toBeGreaterThan(10);
  });

  it("finds no field in the pages and components without a label", () => {
    const hits = appFiles()
      .filter((f) => /^(?:pages|components)\//.test(f) && !f.startsWith("components/ui/") && f.endsWith(".tsx"))
      .flatMap((f) => unlabeledFields(f, readFileSync(join(SRC, f), "utf8")).map((h) => `${f}:${h}`));
    expect(hits).toEqual([]);
  });
});
