// Shared reading of the app's source for the guard tests (displayGuard,
// designTokens, fieldLabels, unusedFiles). The source is parsed with the
// TypeScript compiler, so comments, imports, type names and console calls are
// never mistaken for what a person reads, and a quote inside JSX text ("don't")
// cannot swallow the code after it.

import ts from "typescript";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, resolve } from "path";

export const SRC = join(__dirname, "..");

/** Every .ts and .tsx file under a directory, as absolute paths. */
export function walk(dir: string, keep: (name: string, path: string) => boolean = () => true): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, keep);
    return /\.tsx?$/.test(name) && keep(name, path) ? [path] : [];
  });
}

/** A source file of the app: not a test, not a type declaration. */
export const isAppSource = (name: string) => !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);

/** The app's source files under src, as src-relative paths, the test folder left out. */
export function appFiles(): string[] {
  return walk(SRC, (name, path) => isAppSource(name) && !relative(SRC, path).startsWith("test/")).map((p) => relative(SRC, p));
}

const parse = (path: string, text: string) =>
  ts.createSourceFile(path, text, ts.ScriptTarget.ES2020, true, /\.tsx$/.test(path) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** Where a piece of readable text sits: JSX text, or a string in code. */
export type Piece = { line: number; text: string; kind: "jsx" | "string"; attr?: string; staffGated: boolean; decl: string | null };

const lineOf = (sf: ts.SourceFile, node: ts.Node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;


/** A condition that only Moburst staff or an admin pass: `isMoburstStaff`, `isStaff`, `isAdmin`. */
const STAFF_CONDITION = /\b(?:isMoburstStaff|isStaff|isAdmin|staff|canManageClients|canRunAnalysis)\b/;
/** The routes' own wrappers, which let only staff or an admin through. */
const STAFF_WRAPPERS = new Set(["StaffOnlyRoute", "AdminOnlyRoute"]);

/** Whether the branch of a condition (when it is true, or when it is false) is one only staff reach: `isStaff`, `!isClient`. */
function gatesBranch(cond: string, truthy: boolean): boolean {
  const neg = /^\s*!(?!!)/.test(cond);
  if (STAFF_CONDITION.test(cond)) return truthy !== neg;
  if (/\bisClient\b/.test(cond)) return truthy === neg;
  return false;
}

/**
 * Whether a node sits where only staff can reach it: inside a staff wrapper
 * element, in the right side of `staff && ...`, in the branch of a ternary or
 * `if` that a staff condition opens (or the other branch of its negation).
 */
export function underStaffGate(sf: ts.SourceFile, node: ts.Node): boolean {
  const pickers = staffPickers(sf);
  for (let child: ts.Node = node, p = node.parent; p; child = p, p = p.parent) {
    if (ts.isJsxElement(p) && STAFF_WRAPPERS.has(p.openingElement.tagName.getText(sf)) && child !== p.openingElement) return true;
    if (ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && child === p.right && gatesBranch(p.left.getText(sf), true)) return true;
    if (ts.isConditionalExpression(p) && (child === p.whenTrue || child === p.whenFalse) && gatesBranch(p.condition.getText(sf), child === p.whenTrue)) return true;
    // `const vendor = (staffText, clientText) => (isMoburstStaff ? staffText : clientText)`: the first argument is for staff.
    if (ts.isCallExpression(p) && ts.isIdentifier(p.expression) && pickers.has(p.expression.text) && child === p.arguments[0]) return true;
    if (ts.isIfStatement(p) && (child === p.thenStatement || child === p.elseStatement) && gatesBranch(p.expression.getText(sf), child === p.thenStatement)) return true;
  }
  return false;
}

const pickerCache = new WeakMap<ts.SourceFile, Set<string>>();
/** Local functions `(a, b) => (staffCondition ? a : b)`, which hand the first argument to staff and the second to everyone else. */
function staffPickers(sf: ts.SourceFile): Set<string> {
  const cached = pickerCache.get(sf);
  if (cached) return cached;
  const found = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isArrowFunction(n.initializer) && n.initializer.parameters.length >= 2) {
      let body: ts.Node = n.initializer.body;
      while (ts.isParenthesizedExpression(body)) body = body.expression;
      const [a] = n.initializer.parameters;
      if (ts.isConditionalExpression(body) && ts.isIdentifier(body.whenTrue) && ts.isIdentifier(a.name) && body.whenTrue.text === a.name.text && gatesBranch(body.condition.getText(sf), true)) found.add(n.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  pickerCache.set(sf, found);
  return found;
}

/** The name of the top-level declaration a node sits in (a component, a function, a constant), or null at module level. */
export function topDeclOf(node: ts.Node): string | null {
  for (let n: ts.Node = node; n.parent; n = n.parent) {
    if (!ts.isSourceFile(n.parent)) continue;
    if (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) return n.name?.text ?? "default";
    if (ts.isVariableStatement(n)) {
      const d = n.declarationList.declarations.find((x) => node.pos >= x.pos && node.end <= x.end);
      return d && ts.isIdentifier(d.name) ? d.name.text : null;
    }
    return null;
  }
  return null;
}

/** A component that returns nothing (or a redirect) for a viewer who is not staff: wherever it is mounted, only staff see it. */
export function selfGated(text: string): boolean {
  return /if\s*\(\s*!\s*(?:isMoburstStaff|isAdmin|isStaff)\b[^)]*\)\s*return\s*(?:null|<Navigate)/.test(text);
}

/**
 * Text that can reach a person: JSX text and string literals (template pieces
 * included). Import and export paths, type names, console calls, class names
 * and keys are not text a person reads and are left out.
 */
export function readable(path: string, text: string, opts: { allAttributes?: boolean } = {}): Piece[] {
  const sf = parse(path, text);
  const out: Piece[] = [];
  const SKIP_ATTR = /^(?:className|class|key|id|htmlFor|href|src|to|path|name|type|variant|size|role|style|context|data-[\w-]+|viewBox|d|fill|stroke|xmlns|rel|target|accept|autoComplete|inputMode|side|align|mode|as|asChild|loading|crossOrigin|referrerPolicy|sandbox|method|action|encType|width|height|color)$/;
  const gated = (node: ts.Node) => underStaffGate(sf, node);
  const visit = (node: ts.Node, attr?: string) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node) || ts.isImportTypeNode(node)) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      if (/^console\./.test(callee) || callee === "require" || node.expression.kind === ts.SyntaxKind.ImportKeyword) return;
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      if (!opts.allAttributes && SKIP_ATTR.test(name)) return;
      if (node.initializer) visit(node.initializer, name);
      return;
    }
    if (ts.isJsxText(node)) {
      const t = node.getText(sf);
      if (/\p{L}/u.test(t)) out.push({ line: lineOf(sf, node) + (t.length - t.trimStart().length ? t.slice(0, t.length - t.trimStart().length).split("\n").length - 1 : 0), text: t.replace(/\s+/g, " ").trim(), kind: "jsx", staffGated: gated(node), decl: topDeclOf(node) });
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
      if (ts.isCaseClause(node.parent) || ts.isElementAccessExpression(node.parent)) return;
      out.push({ line: lineOf(sf, node), text: node.text, kind: "string", attr, staffGated: gated(node), decl: topDeclOf(node) });
      return;
    }
    if (ts.isTemplateExpression(node)) {
      out.push({ line: lineOf(sf, node), text: [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("\u0000"), kind: "string", attr, staffGated: gated(node), decl: topDeclOf(node) });
      node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, (c) => visit(c, attr));
  };
  visit(sf);
  return out;
}

/** A string a person could read as words: JSX text, a string with a space in it, or one that starts with a capital. */
export function isProse(p: Piece): boolean {
  if (p.kind === "jsx") return true;
  return (/\s/.test(p.text.trim()) && /\p{L}/u.test(p.text)) || /^\p{Lu}\p{L}+/u.test(p.text);
}

/** The files a source file imports, as src-relative paths (static, re-exported and dynamic imports). */
export function importsOf(file: string, known: Set<string>): string[] {
  const text = readFileSync(join(SRC, file), "utf8");
  const sf = parse(file, text);
  const specs: string[] = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specs.push(node.moduleSpecifier.text);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) specs.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const out: string[] = [];
  for (const spec of specs) {
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? relative(SRC, resolve(dirname(join(SRC, file)), spec)) : null;
    if (base === null) continue;
    const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => known.has(c));
    if (hit) out.push(hit);
  }
  return out;
}

/** The import graph of the app's source: src-relative file to the files it imports. */
export function importGraph(): Map<string, string[]> {
  const files = appFiles();
  const known = new Set(files);
  return new Map(files.map((f) => [f, importsOf(f, known)]));
}

/** Everything reachable from the roots, the roots included. */
export function reachable(graph: Map<string, string[]>, roots: string[], skipEdge: (from: string, to: string) => boolean = () => false): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f) || !graph.has(f)) continue;
    seen.add(f);
    for (const to of graph.get(f)!) if (!skipEdge(f, to)) stack.push(to);
  }
  return seen;
}

export const exists = (rel: string) => existsSync(join(SRC, rel));

type Binding = { local: string; from: string };

/** The names an import brings in, with the file each comes from (type-only imports leave no code behind and are left out). */
function bindingsOf(sf: ts.SourceFile, file: string, known: Set<string>): Binding[] {
  const out: Binding[] = [];
  for (const node of sf.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.importClause?.isTypeOnly) continue;
    const spec = node.moduleSpecifier.text;
    const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? relative(SRC, resolve(dirname(join(SRC, file)), spec)) : null;
    if (base === null) continue;
    const from = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => known.has(c));
    if (!from) continue;
    const c = node.importClause;
    if (!c) { out.push({ local: "", from }); continue; }
    if (c.name) out.push({ local: c.name.text, from });
    if (c.namedBindings && ts.isNamespaceImport(c.namedBindings)) out.push({ local: c.namedBindings.name.text, from });
    if (c.namedBindings && ts.isNamedImports(c.namedBindings)) for (const el of c.namedBindings.elements) if (!el.isTypeOnly) out.push({ local: el.name.text, from });
  }
  return out;
}

/** The files a source file imports only to use them where staff alone can reach (inside a staff route, `isMoburstStaff && <X />`). */
function staffOnlyEdges(file: string, known: Set<string>): Set<string> {
  const text = readFileSync(join(SRC, file), "utf8");
  const sf = parse(file, text);
  const uses = new Map<string, boolean[]>();
  const bindings = bindingsOf(sf, file, known);
  const names = new Map(bindings.filter((b) => b.local).map((b) => [b.local, b.from]));
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n)) return;
    if (ts.isIdentifier(n) && names.has(n.text) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)) {
      const from = names.get(n.text)!;
      uses.set(from, [...(uses.get(from) ?? []), underStaffGate(sf, n)]);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return new Set([...uses].filter(([, gates]) => gates.length > 0 && gates.every(Boolean)).map(([from]) => from));
}

/**
 * The app's source a client user can reach: everything imported from main.tsx
 * except what is only imported to be used behind a staff gate (a staff route in
 * App.tsx, `isMoburstStaff && <Dialog />`) or that gates itself.
 */
export function clientReachable(graph: Map<string, string[]> = importGraph()): Set<string> {
  const known = new Set(graph.keys());
  const gated = new Map<string, Set<string>>();
  for (const f of graph.keys()) gated.set(f, staffOnlyEdges(f, known));
  const selfGate = new Set([...graph.keys()].filter((f) => selfGated(readFileSync(join(SRC, f), "utf8"))));
  const seen = reachable(graph, ["main.tsx"], (from, to) => gated.get(from)!.has(to) || selfGate.has(to));
  return seen;
}

/**
 * The top-level declarations (`file#name`) that client-reachable code uses only
 * behind a staff gate, directly or through another such declaration: a staff
 * label table read as `isStaff && LABELS[x]`, a dialog mounted under `!isClient`.
 * What they print is for staff, whatever file they live in.
 */
export function staffOnlyDeclarations(reach: Set<string>): Set<string> {
  const known = new Set(appFiles());
  type Ref = { target: string; gated: boolean; container: string | null };
  const refs: Ref[] = [];
  const declared = new Set<string>();
  for (const file of reach) {
    const sf = parse(file, readFileSync(join(SRC, file), "utf8"));
    const own = new Set<string>();
    const alias = new Map<string, string>();
    for (const st of sf.statements) {
      if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) own.add(st.name.text);
      if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) own.add(d.name.text);
      for (const name of own) declared.add(`${file}#${name}`);
      if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) alias.set("default", st.expression.text);
      if (ts.isFunctionDeclaration(st) && st.name && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) alias.set("default", st.name.text);
    }
    const imported = new Map<string, string>();
    for (const node of sf.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.importClause?.isTypeOnly) continue;
      const spec = node.moduleSpecifier.text;
      const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? relative(SRC, resolve(dirname(join(SRC, file)), spec)) : null;
      const from = base === null ? undefined : [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => known.has(c));
      if (!from) continue;
      const c = node.importClause;
      if (c?.name) imported.set(c.name.text, `${from}#default`);
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) for (const el of c.namedBindings.elements) imported.set(el.name.text, `${from}#${(el.propertyName ?? el.name).text}`);
    }
    const visit = (n: ts.Node) => {
      if (ts.isImportDeclaration(n)) return;
      if (ts.isIdentifier(n) && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)
        && !((ts.isVariableDeclaration(n.parent) || ts.isFunctionDeclaration(n.parent) || ts.isParameter(n.parent)) && n.parent.name === n)) {
        const target = imported.get(n.text) ?? (own.has(n.text) ? `${file}#${n.text}` : null);
        if (target) {
          const c = topDeclOf(n);
          refs.push({ target, gated: underStaffGate(sf, n), container: c ? `${file}#${c}` : null });
        }
      }
      ts.forEachChild(n, visit);
    }
    ;visit(sf);
    // `export default Name`: a default import is that declaration.
    for (const r of refs) if (r.target.startsWith(`${file}#default`) && alias.has("default")) r.target = `${file}#${alias.get("default")}`;
  }
  // A default import of a file points at that file's default declaration.
  const defaults = new Map<string, string>();
  for (const file of reach) {
    const sf = parse(file, readFileSync(join(SRC, file), "utf8"));
    for (const st of sf.statements) {
      if (ts.isExportAssignment(st) && ts.isIdentifier(st.expression)) defaults.set(`${file}#default`, `${file}#${st.expression.text}`);
      if (ts.isFunctionDeclaration(st) && st.name && st.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) defaults.set(`${file}#default`, `${file}#${st.name.text}`);
    }
  }
  for (const r of refs) r.target = defaults.get(r.target) ?? r.target;
  // A declaration no client-reachable code uses at all is used by staff-only files (or by nothing).
  const gated = new Set([...declared, ...refs.map((r) => r.target)]);
  for (let changed = true; changed;) {
    changed = false;
    for (const r of refs) {
      if (r.container === r.target) continue;
      if (gated.has(r.target) && !r.gated && !(r.container && gated.has(r.container))) { gated.delete(r.target); changed = true; }
    }
  }
  return gated;
}
