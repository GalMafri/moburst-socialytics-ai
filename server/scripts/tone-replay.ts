// server/scripts/tone-replay.ts
//
// The tone replay (16 Nov 2026): the proof, with no model call and nothing
// written, of what the logo set gives for real clients. For every client in
// the manifest it reads the stored logo, makes the set's files with the
// service's own logoSet, reads each of the client's posts with postLogo,
// makes the choice with chooseSet, builds a job's logos from that set the
// way a design job reads them (jobLogos, locatePlan), and runs the service's
// locate with templates on each stored design, followed by the worker's one
// test (logoFound). Every row has an expected result, and the script exits
// 1 when any differs:
//   the files of the set, the canvas file, its ground and where the ground
//   came from; each post's found or not and the file it shows; each
//   design's pass or fail and the file that would be stamped (all compared
//   exactly); each template's score (within 0.01).
// Expected values are never edited to fit a run: a row that differs is a
// finding to report with its cause.
//
// Since 17 Nov 2026 (rule 2) the replay also has a settings row for a client
// whose row the lifecycle wrote, when the manifest gives its brand colors:
// the background the lifecycle writes for the stored file (pickBackground,
// held to the file's weakest whole part), compared exactly with the one
// expected. The set is then chosen and the job started against that
// background, in the order the lifecycle step works: settings first, then
// the set.
//
// The manifest is a JSON array, one entry per client, exported read-only
// and never committed:
//   { client, source, logo_path, logo_local?, placement, background,
//     brand_colors?: [primary, secondary, accent],
//     posts:   [{ path, local? }],
//     designs: [{ job, design, design_path, local?, placement, background }],
//     expect:  { background?: "#RRGGBB",
//                files: { other: "made" | null, white: boolean },
//                canvas: { file, ground, from },
//                posts: [{ path, found, shows? }],
//                designs: [{ job, design, pass, file?, scores: [number, number | null] }] } }
// A file is read from `local` when the entry has one, else from the
// product's storage by path (the logo and designs from generated-media, the
// posts from design-references). `job` is a label: the job's id, or its
// first 8 characters when the full id is not known; no result depends on
// it. A design's own `placement` is the one its job had. Its `background`
// is kept for the record only: the first template is laid over the set's
// canvas ground, as a job started from that set would send it. `design` is
// a label too: "design-2" for a design the model made, "final" for a
// picture as it was delivered.
//
// The logo is trimmed to its ink the way the lifecycle stores it
// (logoNormalization, then resampleRGBA when its long side is over 1,200)
// before anything else, so a logo stored padded is measured as it will be
// used.
//
// Run from the repository root:
//   npx tsx server/scripts/tone-replay.ts <manifest.json> [--out <result.json>]

import { readFile, writeFile } from "node:fs/promises";
import { PUBLIC_DEFAULTS } from "../../public-env.ts";
import { resampleRGBA } from "../../supabase/functions/_shared/canva/brief.ts";
import { locatePlan } from "../../supabase/functions/_shared/design/logoChoice.ts";
import { LOGO_SCALES, logoFound } from "../../supabase/functions/_shared/design/logoMatch.ts";
import { chooseSet, jobLogos, postSearchPlan, wholeInks, type CompareIn, type LogoSet, type SetPaths, type TemplateIn } from "../../supabase/functions/_shared/design/logoTone.ts";
import { logoNormalization, pickBackground, weakestContrast } from "../../supabase/functions/_shared/lifecycle/designSettings.ts";
import type { LogoFileName, Placement, PostLogo, Rgb } from "../../supabase/functions/_shared/picture/contract.ts";
import { decodeRaster, type Raster } from "../src/picture/raster.ts";
import { locateTemplates, logoSet, postLogo } from "../src/picture/tone.ts";

const STORAGE = `${PUBLIC_DEFAULTS.VITE_SUPABASE_URL}/storage/v1/object/public/`;
const SCORE_ROOM = 0.01;

type Entry = {
  client: string;
  source: "lifecycle" | "person";
  logo_path: string;
  logo_local?: string;
  placement: Placement;
  background: string;
  brand_colors?: Array<string | null>;
  posts: Array<{ path: string; local?: string }>;
  designs: Array<{ job: string; design: string; design_path: string; local?: string; placement: Placement; background: string }>;
  expect: {
    background?: string;
    files: { other: "made" | null; white: boolean };
    canvas: { file: LogoFileName; ground: string; from: string };
    posts: Array<{ path: string; found: boolean; shows?: LogoFileName }>;
    designs: Array<{ job: string; design: string; pass: boolean; file?: LogoFileName; scores: [number, number | null] }>;
  };
};

type RowOut = { client: string; kind: "settings" | "set" | "post" | "design"; what: string; expected: unknown; got: unknown; same: boolean; ms?: number };

async function read(bucket: string, path: string, local?: string): Promise<Uint8Array> {
  if (local) return new Uint8Array(await readFile(local));
  const res = await fetch(`${STORAGE}${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${bucket}/${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** The logo as the lifecycle stores it: the box of its ink, its long side at most 1,200 pixels. */
function asStored(r: Raster): Raster {
  const n = logoNormalization(r.data, r.width, r.height);
  if (!n || !n.changed) return r;
  const b = n.box;
  const cut = new Uint8ClampedArray(b.width * b.height * 4);
  for (let y = 0; y < b.height; y++) cut.set(r.data.subarray(((y + b.y) * r.width + b.x) * 4, ((y + b.y) * r.width + b.x + b.width) * 4), y * b.width * 4);
  if (n.size[0] === b.width && n.size[1] === b.height) return { width: b.width, height: b.height, data: cut };
  return { width: n.size[0], height: n.size[1], data: resampleRGBA(cut, b.width, b.height, n.size[0], n.size[1]) };
}

function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const sameText = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function replayClient(entry: Entry): Promise<{ rows: RowOut[]; set: LogoSet }> {
  const rows: RowOut[] = [];
  const stored = asStored(await decodeRaster(await read("generated-media", entry.logo_path, entry.logo_local)));
  const made = logoSet(stored, [], null);
  const facts = made.result;
  // Labels for the two copies: nothing is stored by the replay.
  const paths: SetPaths = { other: made.other ? `${entry.logo_path}#other` : null, white: made.white ? `${entry.logo_path}#white` : null, site: null, person: null };
  const rasters = new Map<string, Raster>([[entry.logo_path, stored]]);
  if (made.other && paths.other) rasters.set(paths.other, made.other);
  if (made.white && paths.white) rasters.set(paths.white, made.white);
  const rasterAt = (path: string): Raster => {
    const r = rasters.get(path);
    if (!r) throw new Error(`No file at ${path}.`);
    return r;
  };

  // The posts, as the lifecycle step reads them.
  const plan = postSearchPlan(entry.logo_path, facts, paths);
  const searches: TemplateIn[] = plan.searches.map((s) => ({ file: s.file, raster: rasterAt(s.path), ground: s.ground, fixed: s.fixed }));
  const compare: CompareIn[] = plan.compare.map((c) => ({ file: c.file, raster: rasterAt(c.path) }));
  const posts: Array<PostLogo | null> = [];
  for (const p of entry.posts) {
    const t = performance.now();
    let got: PostLogo | null = null;
    try {
      got = postLogo(await decodeRaster(await read("design-references", p.path, p.local)), searches, compare, entry.placement, LOGO_SCALES);
    } catch {
      got = null;
    }
    posts.push(got);
    const want = entry.expect.posts.find((e) => e.path === p.path);
    const expected = want ? { found: want.found, ...(want.found ? { shows: want.shows } : {}) } : null;
    const seen = got ? { found: got.found, ...(got.found ? { shows: got.shows } : {}) } : null;
    rows.push({
      client: entry.client, kind: "post", what: p.path, expected,
      got: got ? { ...seen, score: round(got.score, 3), ...(got.found ? { matched: got.matched, ground: hexOf(got.ground), flat: round(got.flat, 3), gaps: roundGaps(got.gaps) } : {}) } : null,
      same: sameText(expected, seen), ms: Math.round(performance.now() - t),
    });
  }

  // The settings background, as the lifecycle writes it for a row it owns: held to the stored file's weakest whole part.
  let background = entry.background;
  const settings: RowOut[] = [];
  if (entry.source === "lifecycle" && entry.brand_colors) {
    const whole = wholeInks(stored);
    const picked = pickBackground(entry.brand_colors, whole.inks.length ? whole.inks : null, whole.own);
    const weakest = (hex: string) => round(weakestContrast(whole.inks, hexRgb(hex)), 2);
    background = picked.hex;
    settings.push({
      client: entry.client, kind: "settings", what: "background",
      expected: entry.expect.background ?? null,
      got: { background: picked.hex, from: picked.from, weakest: weakest(picked.hex), was: entry.background.toUpperCase(), weakest_was: weakest(entry.background), inks: whole.inks.map(hexOf) },
      same: entry.expect.background !== undefined && entry.expect.background.toUpperCase() === picked.hex,
    });
  }

  // The choice.
  const set = chooseSet({ of: entry.logo_path, source: entry.source, background, facts, paths, posts, at: new Date(0).toISOString() });
  const gotFiles = { other: set.other?.from ?? null, white: !!set.white };
  rows.unshift({
    client: entry.client, kind: "set", what: "files, canvas and ground",
    expected: { files: entry.expect.files, canvas: entry.expect.canvas },
    got: { files: gotFiles, canvas: set.canvas, own: set.own, both: set.both, posts: set.posts, made: { other: facts.made.other ? round(facts.made.other.turned, 3) : null, white: facts.made.white ? round(facts.made.white.turned, 3) : null } },
    same: sameText(entry.expect.files, gotFiles) && sameText(entry.expect.canvas, set.canvas),
  });
  rows.unshift(...settings);

  // The stored designs, through locate as a job started from this set would send it.
  const job = jobLogos({ logo_path: entry.logo_path, background, source: entry.source, logo_set: set });
  for (const d of entry.designs) {
    const want = entry.expect.designs.find((e) => e.job === d.job && e.design === d.design);
    const input = job ? { logo_path: job.logo_path, generate: { background: job.background }, logos: job.logos } : { logo_path: entry.logo_path, generate: { background: d.background } };
    const sent = locatePlan(input);
    const templates: TemplateIn[] = sent.shape === "set"
      ? sent.templates.map((t) => ({ file: t.file, raster: rasterAt(t.path), ground: t.ground, fixed: t.fixed, names: t.names }))
      : [{ file: "stored", raster: stored, ground: sent.background }];
    const compared: CompareIn[] = sent.shape === "set" ? sent.compare.map((c) => ({ file: c.file, raster: rasterAt(c.path) })) : [];
    const design = await decodeRaster(await read("generated-media", d.design_path, d.local));
    const t = performance.now();
    const found = locateTemplates(design, templates, compared, d.placement, LOGO_SCALES);
    const ms = Math.round(performance.now() - t);
    const pass = logoFound(found, found.usual.width);
    const scores: [number, number | null] = [round(found.scores![0], 3), found.scores!.length > 1 ? round(found.scores![1], 3) : null];
    const expected = want ? { pass: want.pass, ...(want.pass ? { file: want.file } : {}), scores: want.scores } : null;
    const scoresSame = !!want && want.scores.every((s, i) => (s === null ? scores[i] === null : scores[i] !== null && Math.abs((scores[i] as number) - s) <= SCORE_ROOM));
    rows.push({
      client: entry.client, kind: "design", what: `${d.job} ${d.design}`, expected,
      got: {
        pass, ...(pass ? { file: found.file } : {}), scores, matched: found.matched,
        templates: templates.map((t) => `${t.file} on ${hexOf(t.ground)}`), names: templates.map((t) => t.names ?? null), scale: round(found.width / found.usual.width, 2), gaps: roundGaps(found.gaps ?? {}),
      },
      same: !!want && want.pass === pass && (!pass || want.file === found.file) && scoresSame, ms,
    });
  }
  return { rows, set };
}

function hexOf(c: readonly number[]): string {
  return `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

function roundGaps(gaps: Partial<Record<LogoFileName, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, round(v as number, 1)]));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const outFile = outAt >= 0 ? args[outAt + 1] : null;
  const manifestFile = args.find((a, i) => !a.startsWith("--") && (outAt < 0 || i !== outAt + 1));
  if (!manifestFile) {
    console.error("usage: npx tsx server/scripts/tone-replay.ts <manifest.json> [--out <result.json>]");
    process.exit(2);
  }
  const manifest = JSON.parse(await readFile(manifestFile, "utf8")) as Entry[];
  const all: RowOut[] = [];
  for (const entry of manifest) {
    const { rows } = await replayClient(entry);
    for (const r of rows) {
      console.log(`${r.same ? "same  " : "DIFFER"} ${r.client} | ${r.kind} ${r.what}${r.ms !== undefined ? ` (${r.ms} ms)` : ""}\n         got ${JSON.stringify(r.got)}${r.same ? "" : `\n         expected ${JSON.stringify(r.expected)}`}`);
    }
    all.push(...rows);
  }
  const differ = all.filter((r) => !r.same);
  const designs = all.filter((r) => r.kind === "design");
  const posts = all.filter((r) => r.kind === "post");
  const summary = {
    clients: manifest.length,
    settings: all.filter((r) => r.kind === "settings").length,
    posts: posts.length,
    posts_found: posts.filter((r) => (r.got as { found?: boolean } | null)?.found).length,
    designs: designs.length,
    designs_pass: designs.filter((r) => (r.got as { pass: boolean }).pass).length,
    rows_that_differ: differ.length,
    slowest_locate_ms: Math.max(0, ...designs.map((r) => r.ms ?? 0)),
    slowest_post_ms: Math.max(0, ...posts.map((r) => r.ms ?? 0)),
  };
  console.log(`\n${JSON.stringify(summary)}`);
  if (outFile) await writeFile(outFile, JSON.stringify({ summary, rows: all }, null, 1));
  if (differ.length) process.exit(1);
}

await main();
