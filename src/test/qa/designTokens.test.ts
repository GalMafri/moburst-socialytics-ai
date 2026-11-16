// One palette, from the tokens. A component takes its colors from the design
// tokens (src/index.css, tailwind.config.ts: hsl(var(--primary)), text-success,
// glass-inner, ring-primary) and from the networks' own brand colors
// (src/lib/platform-config.tsx). A hex color typed in a component that is not
// one of those values, or a default Tailwind palette class (bg-gray-100,
// ring-blue-500), is a second palette that drifts from the first.

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { appFiles, readable, SRC } from "../guardSource";

const ROOT = join(SRC, "..");

/** A token file without its comments: a color quoted in a comment is not a token. */
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\w/])\/\/[^\n]*/g, "$1");

/** The hex colors in a piece of text, as lower-case six-digit values. */
function hexIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const [, h] of text.matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
    const six = h.length === 3 ? [...h].map((c) => c + c).join("") : h.slice(0, 6);
    out.add(`#${six.toLowerCase()}`);
  }
  return out;
}

/** The files that define the palette: they may hold any hex color. */
const TOKEN_FILES = ["src/index.css", "tailwind.config.ts", "src/lib/platform-config.tsx"];
const TOKENS = new Set(TOKEN_FILES.flatMap((f) => [...hexIn(withoutComments(readFileSync(join(ROOT, f), "utf8")))]));

/** Hex colors in a piece of text that are not a token value. */
export function strayHex(text: string, tokens: Set<string> = TOKENS): string[] {
  return [...hexIn(text)].filter((h) => !tokens.has(h));
}

const PALETTE = /\b(?:bg|text|border|ring|ring-offset|fill|stroke|from|via|to|outline|divide|shadow|decoration|accent|caret|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g;

/**
 * The type ramp is the .t-* classes in index.css: 30, 24, 20, 18, 15 and 13 px,
 * and t-hero for the one big figure. The radii are 8, 12, 16 and 20 px (20 is
 * --radius). A size or a radius typed in a class outside those sets is a third
 * scale. There is no list of exceptions.
 */
const RAMP_CLASSES = ["t-stat", "t-h1", "t-h2", "t-h3", "t-body", "t-label"];
const css = readFileSync(join(ROOT, "src/index.css"), "utf8");
const RAMP_SIZES = new Set(RAMP_CLASSES.map((c) => Number(new RegExp(`\\.${c}\\s*\\{[^}]*font-size:\\s*(\\d+)px`).exec(css)?.[1])));
const RADII = new Set([8, 12, 16, 20]);
const SIZE_OR_RADIUS = /(?<![\w-])(text|rounded(?:-(?:t|r|b|l|s|e|tl|tr|bl|br|ss|se|es|ee))?)-\[(\d+(?:\.\d+)?)(px|rem)\]/g;

/** The text sizes and radii typed in a class that are not in the ramp or the radius set. */
export function offScale(text: string, sizes: Set<number> = RAMP_SIZES, radii: Set<number> = RADII): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(SIZE_OR_RADIUS)) {
    const px = m[3] === "rem" ? Number(m[2]) * 16 : Number(m[2]);
    if (!(m[1] === "text" ? sizes : radii).has(px)) out.push(m[0]);
  }
  return out;
}

/** The screens and components. The primitives in components/ui build the tokens into classes and are left out, and src/lib holds colors as data (a stored background, a color drawn into a picture), not as styling. */
const components = () => appFiles().filter((f) => /^(?:pages|components)\//.test(f) && !f.startsWith("components/ui/"));
const stringsOf = (f: string) => readable(f, readFileSync(join(SRC, f), "utf8"), { allAttributes: true });

describe("one palette, from the design tokens", () => {
  it("reads the token values from the token files", () => {
    expect(TOKENS.has("#b9e045")).toBe(true);
    expect(TOKENS.has("#b1b7c1")).toBe(true);
    expect(TOKENS.size).toBeGreaterThan(8);
  });

  it("does not count a color quoted in a comment as a token", () => {
    expect(hexIn(withoutComments("/* text-[#10b981] */ a { color: #b9e045; } // #123456"))).toEqual(new Set(["#b9e045"]));
  });

  it("catches a hex color that is not a token, and leaves a token value alone", () => {
    expect(strayHex("text-[#ff00aa]")).toEqual(["#ff00aa"]);
    expect(strayHex("bg-[#123]")).toEqual(["#112233"]);
    expect(strayHex('style={{ color: "#FF00AA" }}')).toEqual(["#ff00aa"]);
    expect(strayHex("text-[#b9e045] bg-[#B1B7C1]")).toEqual([]);
    expect(strayHex("hsl(var(--chart-1)) text-success")).toEqual([]);
    expect(strayHex("#ff00aa", new Set(["#ff00aa"]))).toEqual([]);
  });

  it("catches a default Tailwind palette class, and leaves the token classes alone", () => {
    for (const bad of ["bg-gray-100", "ring-blue-500", "text-emerald-400", "border-red-500/30", "from-sky-500", "bg-violet-600", "text-teal-300", "text-rose-400", "bg-amber-500"]) {
      expect(bad.match(PALETTE), bad).not.toBeNull();
    }
    for (const fine of ["glass-inner", "ring-primary", "text-success", "bg-destructive/10", "text-warning", "text-muted-foreground", "bg-black", "text-white", "text-grayscale"]) {
      expect(fine.match(PALETTE), fine).toBeNull();
    }
  });

  it("takes no hex color in a component that is not a token value", () => {
    const hits = components().flatMap((f) => stringsOf(f).flatMap((p) => strayHex(p.text).map((h) => `${f}:${p.line}: ${h}`)));
    expect(hits).toEqual([]);
  });

  it("takes no default Tailwind palette class in a component", () => {
    const hits = components().flatMap((f) => stringsOf(f).flatMap((p) => (p.text.match(PALETTE) ?? []).map((c) => `${f}:${p.line}: ${c}`)));
    expect(hits).toEqual([]);
  });

  it("reads the type ramp and the radius set", () => {
    expect([...RAMP_SIZES].sort((a, b) => a - b)).toEqual([13, 15, 18, 20, 24, 30]);
    expect(css).toMatch(/--radius:\s*1\.25rem/);
    expect(css).toMatch(/\.t-hero\s*\{[^}]*font-size:\s*48px/);
  });

  it("catches a text size or a radius outside the ramp, and leaves the named ones alone", () => {
    for (const bad of ["text-[10px]", "text-[12px]", "text-[16px]", "md:text-[14px]", "rounded-[6px]", "rounded-[10px]", "rounded-bl-[6px]", "rounded-t-[14px]", "text-[0.75rem]"]) {
      expect(offScale(bad), bad).toEqual([bad.replace(/^md:/, "")]);
    }
    for (const fine of ["text-[13px]", "text-[15px]", "text-[18px]", "text-[20px]", "text-[24px]", "text-[30px]", "rounded-[8px]", "rounded-[12px]", "rounded-[16px]", "rounded-t-[20px]", "text-[#b9e045]", "h-[10px]", "leading-[10px]", "text-sm t-label rounded-lg"]) {
      expect(offScale(fine), fine).toEqual([]);
    }
    expect(offScale("text-[10px]", new Set([10]))).toEqual([]);
  });

  it("takes no text size or radius in a component that is outside the ramp", () => {
    const hits = components().flatMap((f) => stringsOf(f).flatMap((p) => offScale(p.text).map((c) => `${f}:${p.line}: ${c}`)));
    expect(hits).toEqual([]);
  });

  it("sets the placeholder in the input and the textarea to the label gray, not a translucent white", () => {
    for (const f of ["components/ui/input.tsx", "components/ui/textarea.tsx"]) {
      const text = readFileSync(join(SRC, f), "utf8");
      expect(text, f).not.toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0?\.4\s*\)/);
      expect(text, f).toContain("placeholder:text-[#b1b7c1]");
    }
  });
});
