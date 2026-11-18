// @vitest-environment node
// No model call makes a model call a tool the model will not be made to call.
//
// Some models answer a forced tool choice (tool_choice of type "tool" or
// "any") with a 400: 'tool_choice: type "tool" and "any" are not supported
// for this model.' The read of the image sizes guide forced its tool on such
// a model and so failed every run from its first, on 18 Nov 2026
// (_shared/design/platformSizeRefresh.ts); its own test asserted the forced
// choice, so nothing here said so.
//
// The rule is strict on purpose, so that no spelling gets past it. In the
// functions and the server, wherever a file names the parameter (tool_choice
// or toolChoice, in code or in a comment), it is written out on the spot as
// a free choice:
//
//   tool_choice: { type: "auto" ... }     or     tool_choice: { type: "none" ... }
//
// Anything else fails: a forced choice, the keys in another order, a choice
// kept in a variable, a choice built elsewhere. The only other mentions
// allowed are in the files listed below, each with what it must hold. A call
// that needs its tool lets the model choose, asks for the call in the
// instruction, marks the tool strict and checks the answer in code, as the
// sizes read and the creative review (_shared/design-prompts/validateImage.ts)
// do.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { functionsDir } from "../paths.ts";

const root = join(functionsDir, "..", "..");

/**
 * The calls that force a tool, each on a model the API's documentation says
 * accepts it (18 Nov 2026). The file holds one request: its model is written
 * in the file as this text and nothing else, and its one mention of the
 * parameter is the forced choice. Moving one of these to another model
 * fails here first.
 */
const FORCED_CALLS: Record<string, string> = {
  "supabase/functions/build-design-system/index.ts": "claude-sonnet-4-6",
  "supabase/functions/_shared/design-prompts/measureLogo.ts": "claude-sonnet-4-6",
  "supabase/functions/_shared/design-prompts/referenceTemplate.ts": "claude-sonnet-4-6",
};
/** The models that accept a forced tool choice, of those a listed call may name. Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5.1 and 5.2 and Claude Mythos 5.1 and 5.2 refuse one. */
const ACCEPTS_FORCED = new Set(["claude-sonnet-4-6"]);
/** The one file that names the parameter and sends none: the list of parameters a request cannot lose. */
const NAMES_ONLY = "supabase/functions/_shared/anthropic.ts";

const NAMED = /tool_?choice/gi;
/** The parameter written out as a free choice, from its name on. */
const FREE = /^tool_choice["']?\s*:\s*\{\s*["']?type["']?\s*:\s*(["'`])(?:auto|none)\1\s*[,}]/;
/** The parameter written out as a forced choice of one named tool. */
const FORCED = /^tool_choice["']?\s*:\s*\{\s*["']?type["']?\s*:\s*(["'`])tool\1\s*,\s*["']?name["']?\s*:/;

/** Every place a text names the parameter, with the text from there on. */
const mentions = (text: string) => [...text.matchAll(NAMED)].map((m) => text.slice(m.index, m.index! + 160));
/** The places that are not the free choice written out. */
const notFree = (text: string) => mentions(text).filter((m) => !FREE.test(m));

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(p) && !/\.test\.[a-z]+$/.test(p)) out.push(p);
  }
  return out;
}
// Comments are read too: nothing is taken out of a file before it is searched.
const sources = [...walk(functionsDir), ...walk(join(root, "server"))]
  .map((file) => ({ rel: relative(root, file).split(sep).join("/"), text: readFileSync(file, "utf8") }));
const source = (rel: string) => sources.find((s) => s.rel === rel);

describe("a tool choice", () => {
  it("passes only as a free choice written out on the spot", () => {
    for (const ok of [
      `tool_choice: { type: "auto" },`,
      `tool_choice:{type:'auto'},`,
      `"tool_choice": { "type": "none" }`,
      `tool_choice: { type: "auto", disable_parallel_tool_use: true },`,
    ]) expect(notFree(ok), ok).toEqual([]);
    for (const bad of [
      `tool_choice: { type: "tool", name: EXTRACT_TOOL.name },`,
      `tool_choice:{type:'tool',name:'locate_logo'},`,
      `"tool_choice": { "type": "any" }`,
      // The keys in another order.
      `tool_choice:{name:"x",type:"tool"}`,
      `tool_choice: { disable_parallel_tool_use: true, type: "any" }`,
      // A choice kept somewhere else.
      `const c={type:"any"}; body = { tool_choice: c }`,
      `const tool_choice = { type: "any" }; body = { tools, tool_choice }`,
      `body.tool_choice = forced;`,
      `body["tool_choice"] = { type: "tool", name };`,
      `tool_choice: free ? { type: "auto" } : { type: "any" },`,
      // Another spelling of the parameter.
      `toolChoice: { type: "any" }`,
      `toolChoice: { type: "auto" }`,
      `TOOL_CHOICE: { type: "any" }`,
      // A type that only starts like a free one, or is not written out.
      `tool_choice: { type: "automatic" }`,
      `tool_choice: { type: mode }`,
    ]) expect(notFree(bad), bad).not.toEqual([]);
  });

  it("is looked for in every function and in the server", () => {
    expect(sources.filter((s) => s.rel.startsWith("supabase/functions/")).length).toBeGreaterThan(100);
    expect(sources.some((s) => s.rel.startsWith("server/src/"))).toBe(true);
    for (const rel of [...Object.keys(FORCED_CALLS), NAMES_ONLY, "supabase/functions/_shared/design/platformSizeRefresh.ts"]) expect(source(rel), rel).toBeDefined();
  });

  it("is a free choice written out, everywhere but the listed files", () => {
    const listed = new Set([...Object.keys(FORCED_CALLS), NAMES_ONLY]);
    const found = sources.filter((s) => !listed.has(s.rel)).flatMap((s) => notFree(s.text).map((m) => `${s.rel}: ${m.split("\n")[0].slice(0, 80)}`));
    expect(found, 'write the choice out as { type: "auto" } or { type: "none" } where it is sent; a forced choice is a 400 on current models').toEqual([]);
  });

  it.each(Object.entries(FORCED_CALLS))("%s forces its tool on %s, written in the file, and on nothing else", (rel, model) => {
    expect(ACCEPTS_FORCED.has(model), `${model} is not documented to accept a forced tool choice`).toBe(true);
    const text = source(rel)!.text;
    // One mention of the parameter, and it is the forced choice of a named tool.
    const named = mentions(text);
    expect(named).toHaveLength(1);
    expect(FORCED.test(named[0]), named[0].slice(0, 80)).toBe(true);
    // One request in the file, and its model is this text: not a constant, not another model.
    const models = [...text.matchAll(/\bmodel["']?\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim());
    expect(models).toHaveLength(1);
    expect(models[0]).toMatch(new RegExp(`^(["'])${model}\\1$`));
    expect([...new Set(text.match(/claude-[a-z0-9-]+/g) ?? [])]).toEqual([model]);
  });

  it("is only named, never sent, by the shared helper", () => {
    const named = mentions(source(NAMES_ONLY)!.text);
    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(/^tool_choice"\]\);/);
  });

  it("is free in the read of the sizes guide, whose model refuses a forced one", () => {
    const read = source("supabase/functions/_shared/design/platformSizeRefresh.ts")!;
    expect(read.text).toContain(`SIZES_MODEL = "claude-opus-5-5"`);
    expect(ACCEPTS_FORCED.has("claude-opus-5-5")).toBe(false);
    expect(mentions(read.text)).toHaveLength(1);
    expect(notFree(read.text)).toEqual([]);
  });
});
