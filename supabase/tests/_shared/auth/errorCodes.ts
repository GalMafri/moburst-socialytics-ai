// Every `error:` value a bridge answers with, read from its index.ts and its handler.ts when it has one.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { functionsDir } from "../../paths.ts";

export function errorValues(fn: string): Array<{ kind: string; text: string }> {
  const out: Array<{ kind: string; text: string }> = [];
  for (const name of ["index.ts", "handler.ts"]) {
    const file = join(functionsDir, fn, name);
    if (existsSync(file)) collect(file, out);
  }
  return out;
}

function collect(file: string, out: Array<{ kind: string; text: string }>): void {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "error") {
      const v = node.initializer;
      out.push({ kind: ts.isStringLiteral(v) ? "literal" : ts.SyntaxKind[v.kind], text: v.getText(source) });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
