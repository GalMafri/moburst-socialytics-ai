// @vitest-environment node
// Where the connector's service-role client can reach, read from the code
// itself: index.ts makes it, and hands it to three places only, the minute
// counter (mcp_rate_touch), the audit row (api_requests) and the saves'
// writer (writes.ts makeServiceWriter). No other connector module makes a
// client, reads the service key or writes anything; the writer's one
// instance goes to the saves and nowhere else. A change that lets any other
// module reach the service role fails here.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const dir = dirname(fileURLToPath(import.meta.url));
const modules = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort();
const source = (f: string) => ts.createSourceFile(f, readFileSync(join(dir, f), "utf8"), ts.ScriptTarget.Latest, true);
const code = (f: string) => readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

/** Every use of an identifier (not its declaration), as the text of the expression around it. */
function uses(file: ts.SourceFile, name: string): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)) {
      let around: ts.Node = node;
      // The call the identifier is part of: service.rpc("x", ...), service.from("x").insert(...), makeServiceWriter(service).
      while (around.parent && (ts.isPropertyAccessExpression(around.parent) || ts.isCallExpression(around.parent)) && !ts.isExpressionStatement(around.parent)) around = around.parent;
      out.push(around.getText(file).replace(/\s+/g, " "));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out;
}

describe("the connector's service role", () => {
  it("is made in index.ts only, and no other module makes a client or reads the service key", () => {
    expect(modules).toEqual(expect.arrayContaining(["index.ts", "reads.ts", "server.ts", "tools.ts", "writes.ts"]));
    for (const f of modules.filter((m) => m !== "index.ts")) {
      expect(code(f), f).not.toMatch(/SERVICE_ROLE|createClient\s*\(|Deno\.env/);
    }
    expect(code("index.ts").match(/SUPABASE_SERVICE_ROLE_KEY/g)).toHaveLength(1);
  });

  it("reaches the minute counter, the audit row and the saves' writer, and nothing else", () => {
    const index = source("index.ts");
    expect(uses(index, "service")).toEqual([
      "makeServiceWriter(service)",
      'service.rpc("mcp_rate_touch", { p_user: userId })',
      'service.from("api_requests").insert(row)',
    ]);
    // The one writer goes to the saves only.
    expect(uses(index, "writer")).toEqual(["writer"]);
    expect(code("index.ts")).toMatch(/writes: \(caller\) => \(\{ person: personChecks\(asPerson\(caller\)\), writer \}\)/);
  });

  it("is turned into a writer only by writes.ts, for index.ts", () => {
    for (const f of modules) {
      const has = /makeServiceWriter/.test(code(f));
      expect(has, f).toBe(f === "writes.ts" || f === "index.ts");
    }
  });

  it("writes through writes.ts alone: no other module inserts, updates, upserts, deletes, signs a file or calls a write function", () => {
    const WRITE = /\.(insert|update|upsert|delete|remove)\s*\(|\.storage\b|createSigned|\.rpc\(\s*["'](strategy_section_save|strategy_section_save_as|client_notes_queue_read)["']/;
    for (const f of modules.filter((m) => m !== "writes.ts")) {
      const found = code(f).split("\n").filter((l) => WRITE.test(l)).map((l) => l.trim());
      // index.ts writes its audit row, through the service role.
      expect(found, f).toEqual(f === "index.ts" ? ['const { error } = await service.from("api_requests").insert(row);'] : []);
    }
  });
});
