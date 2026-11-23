/**
 * Documents generated from the route table, so they cannot disagree with the
 * code: the committed OpenAPI snapshot, the markdown reference, and the
 * changelog. Each tool's scripts/api-gen.ts calls these and writes the files;
 * its api-docs test calls them again and fails when a committed file is stale
 * or a breaking change was not acknowledged.
 *
 * Breaking, for a consumer that already works (the portal, a demo screen, an
 * agent): an operation removed, a query parameter removed, a response field
 * removed, an enum value removed, or a request field made required. Adding
 * anything is not breaking; consumers ignore fields they do not know.
 *
 * Shared core: written in AdVisor, copied by scripts/sync-api-core.sh.
 */

type Json = Record<string, unknown>;
type Doc = { info?: Json; paths?: Record<string, Record<string, Json>>; components?: { schemas?: Record<string, Json> } };

/** JSON with keys sorted at every level, so a regenerated file only changes when the API does. */
export function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as Json).sort().map((k) => [k, sort((v as Json)[k])]));
    return v;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

const METHODS = ["get", "post", "put", "patch", "delete"];

function operations(doc: Doc): Array<{ key: string; method: string; path: string; op: Json }> {
  const out: Array<{ key: string; method: string; path: string; op: Json }> = [];
  for (const [path, ops] of Object.entries(doc.paths ?? {})) {
    for (const m of METHODS) if (ops[m]) out.push({ key: `${m.toUpperCase()} ${path}`, method: m.toUpperCase(), path, op: ops[m] });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

const schemaName = (ref: unknown): string | null => (typeof ref === "string" ? ref.replace("#/components/schemas/", "") : null);
const responseSchema = (op: Json): string | null => {
  const r = op.responses as Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }> | undefined;
  const ok = Object.entries(r ?? {}).find(([code]) => /^2/.test(code))?.[1];
  return schemaName(ok?.content?.["application/json"]?.schema?.$ref);
};
const bodySchema = (op: Json): string | null =>
  schemaName((op.requestBody as { content?: Record<string, { schema?: { $ref?: string } }> } | undefined)?.content?.["application/json"]?.schema?.$ref);
const queryParams = (op: Json): Array<{ name: string; schema?: Json; description?: string }> =>
  ((op.parameters as Array<{ in: string; name: string; schema?: Json; description?: string }> | undefined) ?? []).filter((p) => p.in === "query");

/** Every property path of a schema, following $refs, with its enum if it has one. */
function fields(doc: Doc, schema: Json | undefined, prefix = "", seen = new Set<string>()): Map<string, { required: boolean; enum?: unknown[] }> {
  const out = new Map<string, { required: boolean; enum?: unknown[] }>();
  if (!schema) return out;
  const ref = schemaName(schema.$ref);
  if (ref) {
    if (seen.has(ref)) return out;
    return fields(doc, doc.components?.schemas?.[ref], prefix, new Set([...seen, ref]));
  }
  if (schema.type === "array" || schema.items) return fields(doc, schema.items as Json, `${prefix}[]`, seen);
  const required = new Set((schema.required as string[] | undefined) ?? []);
  for (const [k, v] of Object.entries((schema.properties as Record<string, Json> | undefined) ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    const items = v.items as Json | undefined;
    out.set(path, { required: required.has(k), enum: (v.enum as unknown[] | undefined) ?? (items?.enum as unknown[] | undefined) });
    for (const [p, f] of fields(doc, v, path, seen)) out.set(p, f);
  }
  return out;
}

export interface ApiDiff {
  added: string[];
  removed: string[];
  breaking: string[];
  notes: string[];
}

export function diffOpenApi(before: Doc, after: Doc): ApiDiff {
  const d: ApiDiff = { added: [], removed: [], breaking: [], notes: [] };
  const a = new Map(operations(before).map((o) => [o.key, o]));
  const b = new Map(operations(after).map((o) => [o.key, o]));
  for (const k of b.keys()) if (!a.has(k)) d.added.push(k);
  for (const [k, old] of a) {
    const now = b.get(k);
    if (!now) {
      d.removed.push(k);
      d.breaking.push(`${k}: operation removed`);
      continue;
    }
    const newQuery = new Set(queryParams(now.op).map((p) => p.name));
    for (const p of queryParams(old.op)) if (!newQuery.has(p.name)) d.breaking.push(`${k}: query parameter ${p.name} removed`);
    const oldResp = fields(before, { $ref: `#/components/schemas/${responseSchema(old.op)}` });
    const newResp = fields(after, { $ref: `#/components/schemas/${responseSchema(now.op)}` });
    for (const [path, f] of oldResp) {
      const n = newResp.get(path);
      if (!n) d.breaking.push(`${k}: response field ${path} removed`);
      else if (f.enum && n.enum) for (const v of f.enum) if (!n.enum.includes(v)) d.notes.push(`${k}: response field ${path} no longer returns ${JSON.stringify(v)}`);
    }
    for (const path of newResp.keys()) if (!oldResp.has(path)) d.notes.push(`${k}: response field ${path} added`);
    const oldBody = bodySchema(old.op);
    const newBody = bodySchema(now.op);
    if (newBody) {
      const ob = oldBody ? fields(before, { $ref: `#/components/schemas/${oldBody}` }) : new Map();
      const nb = fields(after, { $ref: `#/components/schemas/${newBody}` });
      for (const [path, f] of nb) {
        const o = ob.get(path);
        if (f.required && !o?.required) d.breaking.push(`${k}: request field ${path} is now required`);
        if (o?.enum && f.enum) for (const v of o.enum) if (!f.enum.includes(v)) d.breaking.push(`${k}: request field ${path} no longer accepts ${JSON.stringify(v)}`);
      }
      for (const path of nb.keys()) if (!ob.has(path)) d.notes.push(`${k}: request field ${path} added`);
    }
  }
  return d;
}

/** Breaking changes not listed in BREAKING.md (lines that start with "- " and contain the change text). */
export function unacknowledged(diff: ApiDiff, breakingMd: string): string[] {
  const ack = breakingMd.split("\n").filter((l) => l.startsWith("- ")).join("\n");
  return diff.breaking.filter((b) => !ack.includes(b));
}

function typeOf(s: Json | undefined): string {
  if (!s) return "";
  const ref = schemaName(s.$ref);
  if (ref) return ref;
  if (s.enum) return (s.enum as unknown[]).map((v) => JSON.stringify(v)).join(" \\| ");
  const t = Array.isArray(s.type) ? (s.type as string[]).join(" \\| ") : String(s.type ?? "object");
  return t === "array" ? `${typeOf(s.items as Json)}[]` : t;
}

/** The markdown reference: every operation by tag, then every schema's fields. */
export function renderReference(doc: Doc, opts: { tool: string; regenerate: string }): string {
  const info = doc.info ?? {};
  const lines: string[] = [
    `# ${String(info.title ?? opts.tool)} reference`,
    "",
    `<!-- Generated from the route table by \`${opts.regenerate}\`. Do not edit by hand: change the routes and regenerate. -->`,
    "",
    String(info.description ?? ""),
    "",
    `Version ${String(info.version ?? "")}. The live copy of this document is \`GET /v1/openapi.json\` on the deployed API.`,
    "",
  ];
  const byTag = new Map<string, ReturnType<typeof operations>>();
  for (const o of operations(doc)) {
    const tag = ((o.op.tags as string[] | undefined) ?? ["Other"])[0];
    byTag.set(tag, [...(byTag.get(tag) ?? []), o]);
  }
  lines.push("## Operations", "");
  for (const tag of [...byTag.keys()].sort()) {
    lines.push(`### ${tag}`, "");
    for (const o of byTag.get(tag)!) {
      const scope = o.op["x-scope"] ? ` Scope: \`${String(o.op["x-scope"])}\`.` : o.op["x-auth"] === "admin" ? " Admin only." : o.op.security ? "" : " No key needed.";
      lines.push(`#### \`${o.method} ${o.path}\``, "", `${String(o.op.summary ?? "")}.${scope}`, "");
      const q = queryParams(o.op);
      if (q.length) {
        lines.push("| Query | Type | Description |", "|---|---|---|");
        for (const p of q) lines.push(`| \`${p.name}\` | ${typeOf(p.schema)} | ${(p.description ?? "").replace(/\|/g, "\\|")} |`);
        lines.push("");
      }
      const body = bodySchema(o.op);
      if (body) lines.push(`Body: [${body}](#${body.toLowerCase()})`, "");
      const resp = responseSchema(o.op);
      if (resp) lines.push(`Returns: [${resp}](#${resp.toLowerCase()})`, "");
    }
  }
  lines.push("## Schemas", "");
  for (const [name, s] of Object.entries(doc.components?.schemas ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`### ${name}`, "");
    if (s.description) lines.push(String(s.description), "");
    const f = fields(doc, s);
    if (!f.size) {
      lines.push(`\`${typeOf(s)}\``, "");
      continue;
    }
    lines.push("| Field | Required | Values |", "|---|---|---|");
    for (const [path, meta] of f) lines.push(`| \`${path}\` | ${meta.required ? "yes" : ""} | ${meta.enum ? meta.enum.map((v) => `\`${String(v)}\``).join(", ") : ""} |`);
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

/** One dated changelog entry, or null when nothing a consumer can see changed. */
export function renderChangeEntry(diff: ApiDiff, date: string): string | null {
  if (!diff.added.length && !diff.removed.length && !diff.breaking.length && !diff.notes.length) return null;
  const out = [`## ${date}`, ""];
  for (const a of diff.added) out.push(`- Added \`${a}\``);
  for (const r of diff.removed) out.push(`- Removed \`${r}\``);
  for (const b of diff.breaking.filter((x) => !x.endsWith("operation removed"))) out.push(`- Breaking: ${b}`);
  for (const n of diff.notes) out.push(`- ${n}`);
  return `${out.join("\n")}\n`;
}
