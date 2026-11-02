// supabase/functions/_shared/notes/ooxml.ts
//
// What docx.ts and xlsx.ts share in reading an Office Open XML package (a
// zip of XML parts that point to each other through relationships): the
// parts, the XML tokens, entities, attributes and relationships.
// fflate is imported as Deno imports an npm package (its README's Skypack
// line no longer serves 0.8.3); vitest.config.ts maps the same specifier to
// the same version in node_modules, so the tests run this code as it is.

import { strFromU8, unzipSync } from "npm:fflate@0.8.3";

/** A part larger than this is not read: a zip that unpacks to far more than any note. */
export const MAX_PART_BYTES = 64 * 1024 * 1024;

/** A tag (close slash, name, attributes with quoted values, self-closing slash) or a run of text. */
export const TOKENS = /<(\/?)([\w.-]+(?::[\w.-]+)?)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** The named parts of the package, as text; a part over MAX_PART_BYTES is left out. Throws when the file is not a zip. */
export function readParts(bytes: Uint8Array, wanted: (name: string) => boolean): Record<string, string> {
  const files = unzipSync(bytes, { filter: (f) => wanted(f.name) && f.originalSize <= MAX_PART_BYTES });
  return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
}

export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? all;
    const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
  });
}

/** An element's name without its namespace prefix. */
export const localName = (name: string) => name.slice(name.indexOf(":") + 1);

/** An attribute's value from a tag's attributes, by its name; `name` may be "*:id" for any prefix. */
export function attr(attrs: string, name: string): string | null {
  const pattern = name.startsWith("*:") ? `[\\w.-]+:${name.slice(2)}` : name.replace(/[.:-]/g, "\\$&");
  const m = new RegExp(`(?:^|\\s)${pattern}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? decodeXml(m[1] ?? m[2]) : null;
}

/** The relationships part of a part: xl/workbook.xml has xl/_rels/workbook.xml.rels. */
export function relsOf(part: string): string {
  const at = part.lastIndexOf("/");
  return `${part.slice(0, at + 1)}_rels/${part.slice(at + 1)}.rels`;
}

/** A relationship's target as a part name: from the package root when it starts with "/", else from the source part's folder. */
function resolve(source: string, target: string): string {
  const parts = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const piece of target.replace(/^\/+/, "").split("/")) {
    if (piece === "..") parts.pop();
    else if (piece && piece !== ".") parts.push(piece);
  }
  return parts.join("/");
}

/** A part's relationships: id, type (the last word of its URI) and the part it points to. */
export function relationships(rels: string | undefined, source: string): Array<{ id: string; type: string; part: string }> {
  const out: Array<{ id: string; type: string; part: string }> = [];
  for (const [tag] of String(rels ?? "").matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)) {
    const target = attr(tag, "Target");
    if (!target || attr(tag, "TargetMode") === "External") continue;
    out.push({ id: attr(tag, "Id") ?? "", type: String(attr(tag, "Type") ?? "").split("/").pop() ?? "", part: resolve(source, target) });
  }
  return out;
}

/** The package's main part (its officeDocument relationship in _rels/.rels), or `otherwise`. */
export function mainPart(packageRels: string | undefined, otherwise: string): string {
  return relationships(packageRels, "").find((r) => r.type === "officeDocument")?.part ?? otherwise;
}
