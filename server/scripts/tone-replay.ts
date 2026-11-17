// server/scripts/tone-replay.ts
//
// The tone replay (16 Nov 2026): the proof, with no model call and nothing
// written, of what the logo set gives for real clients. For every client in
// the manifest it reads the stored logo, makes the set's files with the
// service's own logoSet, reads each of the client's posts with postLogo,
// makes the choice with chooseSet, builds a job's logos from that set the
// way a design job reads them (jobLogos, locatePlan), and runs the service's
// locate with templates on each stored design, followed by the worker's own
// decision (locateRefusal: the match is the logo at a size the client uses,
// and a file that may be stamped shows on the picture's ground). Every row
// has an expected result, and the script exits 1 when any differs:
//   the files of the set, the canvas file, its ground and where the ground
//   came from; each post's found or not and the file it shows; each
//   design's pass or fail and the file that would be stamped (all compared
//   exactly); each template's score (within 0.01).
// Expected values are never edited to fit a run: a row that differs is a
// finding to report with its cause. (For a logo the posts chose, a design's
// score is recorded but not compared: it moves with the placement the rule
// gives, which the pick row pins exactly.)
//
// Since 17 Nov 2026 it also replays the logo the client's posts show
// (_shared/design/logoPick.ts; spec section 12). For an entry with
// `candidates` (the marks the client's homepage ties to its own brand,
// converted by supabase/tests/tools/site-logos.ts), each candidate is looked
// for on the client's posts the way the lifecycle step does it, the posts
// are counted (postsCarrying: the logo the client has counts every post it
// is found on; a candidate counts a post only where it is found, scores
// higher than the client's logo and is the candidate that matches the post
// best), the choice is made with chooseLogo, and one more row says which
// mark was chosen and how many posts count for each. When a candidate is
// chosen, everything after it runs on the chosen file: its placement comes
// from the rectangles of the posts that count for it (measuredPlacement),
// its background from the entry's brand colors (pickBackground), its posts,
// set and designs are replayed with those, and each design is searched at
// that placement, as a job started from the new settings would send it. A
// row a person set, a logo a person gave and a website that is a page on
// another client's site are never looked at, as in the step (`no_pick` says
// which).
//
// Since 17 Nov 2026 (rule 2) the replay also has a settings row for a client
// whose row the lifecycle wrote, when the manifest gives its brand colors:
// the background the lifecycle writes for the stored file (pickBackground,
// held to the file's weakest whole part), compared exactly with the one
// expected. The set is then chosen and the job started against that
// background, in the order the lifecycle step works: settings first, then
// the set.
//
// Since the second pass of 17 Nov an entry may also hold the client's live
// row as it is before the lifecycle's look (`live`: its background and its
// stored set, of rule 1). The replay then has a window row: what a design
// that starts in that window starts from (the still start of jobs.ts:
// jobLogos, with the file's whole parts read from its pixels for a set of
// rule 1, else the one file where it rests), compared exactly with the one
// expected, and each of `window_designs` through locate as such a job would
// send it. A design may be a picture drawn for the replay (`design` then
// says so): a real logo file laid on a flat color with noise, to prove what
// locate answers for a picture no client has had yet.
//
// The manifest is a JSON array, one entry per client, exported read-only
// and never committed:
//   { client, source, logo_path, logo_local?, placement, background,
//     candidates?: [{ from, local }], spot?, no_pick?,
//     brand_colors?: [primary, secondary, accent],
//     posts:   [{ path, local? }],
//     designs: [{ job, design, design_path, local?, placement, background }],
//     live?:   { background, logo_set },
//     window_designs?: [{ job, design, design_path, local?, placement, background }],
//     expect:  { background?: "#RRGGBB",
//                pick?: { chosen: <from> | null, current, candidates: [found, ...], placement? },
//                files: { other: "made" | null, white: boolean },
//                canvas: { file, ground, from },
//                posts: [{ path, found, shows? }],
//                designs: [{ job, design, pass, file?, lost?, scores: [number, number | null] }],
//                window?: { file, ground, second: { file, ground } | null },
//                window_designs?: [{ job, design, pass, file?, lost?, scores }] } }
// `lost` is true for a design whose match is the logo and that is made again
// because no file that may be stamped shows on the picture's own ground.
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
import { locatePlan, locateRefusal } from "../../supabase/functions/_shared/design/logoChoice.ts";
import { LOGO_SCALES, logoFound } from "../../supabase/functions/_shared/design/logoMatch.ts";
import { chooseLogo, measuredPlacement, postsCarrying, type FoundAt } from "../../supabase/functions/_shared/design/logoPick.ts";
import { chooseSet, jobLogos, postSearchPlan, restGround, wholeInks, type CompareIn, type JobLogos, type LogoSet, type SetPaths, type TemplateIn } from "../../supabase/functions/_shared/design/logoTone.ts";
import { logoNormalization, pickBackground, placementFor, weakestContrast, type LogoSpot } from "../../supabase/functions/_shared/lifecycle/designSettings.ts";
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
  /** The marks the client's homepage serves, converted as the design path converts them, in page order. Absent: the choice is not replayed. */
  candidates?: Array<{ from: string; local: string }>;
  /** The stored read of where the client's posts carry the logo (derived.logo_read). */
  spot?: LogoSpot | null;
  /** Why the step never looks for another logo: a person gave this one, or the website is a page on another client's site. */
  no_pick?: "person_logo" | "not_own_site";
  /** The brand colors, for the settings background of a row the lifecycle wrote. */
  brand_colors?: Array<string | null>;
  posts: Array<{ path: string; local?: string }>;
  designs: DesignIn[];
  live?: { background: string; logo_set: unknown };
  window_designs?: DesignIn[];
  expect: {
    background?: string;
    pick?: { chosen: string | null; current: number; candidates: number[]; placement?: Placement } | { kept: string };
    files: { other: "made" | null; white: boolean };
    canvas: { file: LogoFileName; ground: string; from: string };
    posts: Array<{ path: string; found: boolean; shows?: LogoFileName }>;
    designs: DesignWant[];
    window?: { file: LogoFileName; ground: string; second: { file: LogoFileName; ground: string } | null };
    window_designs?: DesignWant[];
  };
};
type DesignIn = { job: string; design: string; design_path: string; local?: string; placement: Placement; background: string };
type DesignWant = { job: string; design: string; pass: boolean; file?: LogoFileName; lost?: boolean; scores?: [number, number | null] };

type RowOut = { client: string; kind: "settings" | "pick" | "set" | "post" | "design" | "window" | "window design"; what: string; expected: unknown; got: unknown; same: boolean; ms?: number };

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
/** Two places are the same when anchor, left, top and width are: the order the fields were written in does not matter. */
const samePlace = (a: Placement | undefined, b: Placement | undefined) => !!a && !!b && a.anchor === b.anchor && a.left === b.left && a.top === b.top && a.width === b.width;

/** One logo file read on the client's posts as the lifecycle step reads it: the files of its set, and what each post gave. */
type LogoRead = { path: string; facts: ReturnType<typeof logoSet>["result"]; paths: SetPaths; rasters: Map<string, Raster>; posts: Array<PostLogo | null>; ms: number[] };
/** The logo a replayed job has: its file, where it sits, the color behind it, and its read. `picked` says the posts chose it (logoPick.ts). */
type LogoInUse = { path: string; raster: Raster; placement: Placement; background: string; read: LogoRead; picked: boolean };
/** The colors of the whole parts of each file of a read logo's set. */
const inksFor = (read: LogoRead): Partial<Record<LogoFileName, Rgb[]>> => ({ stored: read.facts.inks.stored.map((i) => i.color), other: read.facts.inks.other?.map((i) => i.color), white: read.facts.inks.white?.map((i) => i.color) });

function readLogo(path: string, raster: Raster, placement: Placement, pictures: Array<Raster | null>): LogoRead {
  const made = logoSet(raster, [], null);
  const facts = made.result;
  // Labels for the two copies: nothing is stored by the replay.
  const paths: SetPaths = { other: made.other ? `${path}#other` : null, white: made.white ? `${path}#white` : null, site: null, person: null };
  const rasters = new Map<string, Raster>([[path, raster]]);
  if (made.other && paths.other) rasters.set(paths.other, made.other);
  if (made.white && paths.white) rasters.set(paths.white, made.white);
  const plan = postSearchPlan(path, facts, paths);
  const searches: TemplateIn[] = plan.searches.map((s) => ({ file: s.file, raster: rasters.get(s.path)!, ground: s.ground, fixed: s.fixed }));
  const compare: CompareIn[] = plan.compare.map((c) => ({ file: c.file, raster: rasters.get(c.path)! }));
  const posts: Array<PostLogo | null> = [];
  const ms: number[] = [];
  for (const picture of pictures) {
    const t = performance.now();
    posts.push(picture ? postLogo(picture, searches, compare, placement, LOGO_SCALES) : null);
    ms.push(Math.round(performance.now() - t));
  }
  return { path, facts, paths, rasters, posts, ms };
}

async function replayClient(entry: Entry): Promise<{ rows: RowOut[]; set: LogoSet }> {
  const rows: RowOut[] = [];
  const stored = asStored(await decodeRaster(await read("generated-media", entry.logo_path, entry.logo_local)));
  // The client's posts, decoded once. A post that cannot be read is null in its place, as in the step.
  const pictures: Array<Raster | null> = [];
  for (const p of entry.posts) {
    try {
      pictures.push(await decodeRaster(await read("design-references", p.path, p.local)));
    } catch {
      pictures.push(null);
    }
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

  // The logo the client has, read on its posts as the lifecycle step reads it.
  const has = readLogo(entry.logo_path, stored, entry.placement, pictures);
  let logo: LogoInUse = { path: entry.logo_path, raster: stored, placement: entry.placement, background, read: has, picked: false };

  // The logo the client's posts show (logoPick.ts): only for a row the lifecycle wrote and a logo the lifecycle chose.
  if (entry.candidates) {
    const kept = entry.source === "person" ? "person_row" : entry.no_pick ?? null;
    if (kept) {
      const got = { kept };
      rows.push({ client: entry.client, kind: "pick", what: "the logo the posts show", expected: entry.expect.pick ?? null, got, same: sameText(entry.expect.pick ?? null, got) });
    } else {
      const t = performance.now();
      const candidates: Array<{ id: string; from: string; path: string; raster: Raster; place: Placement; read: LogoRead; found: number }> = [];
      for (const [k, c] of entry.candidates.entries()) {
        const raster = asStored(await decodeRaster(new Uint8Array(await readFile(c.local))));
        const place = placementFor(entry.spot ?? null, raster.width / Math.max(1, raster.height)).placement;
        const path = `${entry.logo_path}#candidate${k}`;
        candidates.push({ id: String(k), from: c.from, path, raster, place, read: readLogo(path, raster, place, pictures), found: 0 });
      }
      // The logo the client has counts every post it is found on. A candidate counts a post only where it is found,
      // scores higher than the client's logo and is the candidate that matches the post best.
      const carried = postsCarrying([logo.read.posts, ...candidates.map((c) => c.read.posts)]);
      const current = carried.counts[0];
      candidates.forEach((c, k) => { c.found = carried.counts[k + 1]; });
      const chosen = candidates.find((c) => c.id === chooseLogo(current, candidates.map((c) => ({ id: c.id, found: c.found })))) ?? null;
      const currentScores = logo.read.posts.map((p) => (p ? round(p.score, 3) : null));
      let placement: Placement | undefined;
      if (chosen) {
        // Its place, from the rectangles of the posts that count for it, each as shares of its own post.
        const index = candidates.indexOf(chosen) + 1;
        const at: FoundAt[] = [];
        chosen.read.posts.forEach((p, i) => { if (carried.by[i] === index && p?.found && pictures[i]) at.push({ rect: p.rect, frame: [pictures[i]!.width, pictures[i]!.height] }); });
        placement = measuredPlacement(at) ?? chosen.place;
        // Its background, by the rule every lifecycle row gets: held to the chosen file's weakest whole part.
        const whole = wholeInks(chosen.raster);
        const ground = pickBackground(entry.brand_colors ?? [], whole.inks.length ? whole.inks : null, whole.own).hex;
        const path = `${entry.logo_path}#picked`;
        logo = { path, raster: chosen.raster, placement, background: ground, read: readLogo(path, chosen.raster, placement, pictures), picked: true };
      }
      const want = entry.expect.pick && "chosen" in entry.expect.pick ? entry.expect.pick : null;
      const got = { chosen: chosen?.from ?? null, current, candidates: candidates.map((c) => c.found), ...(placement ? { placement } : {}) };
      rows.push({
        client: entry.client, kind: "pick", what: "the logo the posts show", expected: want,
        got: {
          ...got, ...(chosen ? { background: logo.background, searched_at: chosen.place } : {}),
          // Which mark each post matches best (0 is the logo the client has, null when that mark is not found there),
          // how many posts each mark is found on before the scores are compared, and every score.
          by: carried.by, found_on: [logo.read, ...candidates.map((c) => c.read)].map((r) => r.posts.filter((p) => p?.found === true).length),
          current_scores: currentScores, scores: candidates.map((c) => c.read.posts.map((p) => (p ? round(p.score, 3) : null))), own: candidates.map((c) => c.read.facts.own),
        },
        same: !!want && want.chosen === got.chosen && want.current === got.current && sameText(want.candidates, got.candidates) && (!want.placement || samePlace(want.placement, got.placement)),
        ms: Math.round(performance.now() - t),
      });
    }
  }

  const { facts, paths, posts } = logo.read;

  // The posts, for the logo in use.
  entry.posts.forEach((p, i) => {
    const got = posts[i];
    const want = entry.expect.posts.find((e) => e.path === p.path);
    const expected = want ? { found: want.found, ...(want.found ? { shows: want.shows } : {}) } : null;
    const seen = got ? { found: got.found, ...(got.found ? { shows: got.shows } : {}) } : null;
    rows.push({
      client: entry.client, kind: "post", what: p.path, expected,
      got: got ? { ...seen, score: round(got.score, 3), ...(got.found ? { matched: got.matched, ground: hexOf(got.ground), flat: round(got.flat, 3), gaps: roundGaps(got.gaps) } : {}) } : null,
      same: sameText(expected, seen), ms: logo.read.ms[i],
    });
  });

  // The choice.
  const set = chooseSet({ of: logo.path, source: entry.source, background: logo.background, facts, paths, posts, at: new Date(0).toISOString() });
  const gotFiles = { other: set.other?.from ?? null, white: !!set.white };
  rows.splice(rows.findIndex((r) => r.kind === "post") < 0 ? rows.length : rows.findIndex((r) => r.kind === "post"), 0, {
    client: entry.client, kind: "set", what: "files, canvas and ground",
    expected: { files: entry.expect.files, canvas: entry.expect.canvas },
    got: { files: gotFiles, canvas: set.canvas, own: set.own, both: set.both, posts: set.posts, made: { other: facts.made.other ? round(facts.made.other.turned, 3) : null, white: facts.made.white ? round(facts.made.white.turned, 3) : null } },
    same: sameText(entry.expect.files, gotFiles) && sameText(entry.expect.canvas, set.canvas),
  });
  rows.unshift(...settings);

  // One design through locate, as a job with these logos on this background would send it, then the worker's decision.
  // `of` is the logo the job has: the logo in use for a stored design, the live row's own logo for a design that starts in the window.
  async function locateRow(kind: "design" | "window design", d: DesignIn, want: DesignWant | undefined, start: { logo_path: string; background: string; logos: JobLogos | null }, of: LogoInUse): Promise<RowOut> {
    const rasterAt = (path: string): Raster => {
      const r = of.read.rasters.get(path);
      if (!r) throw new Error(`No file at ${path}.`);
      return r;
    };
    const inksOf = inksFor(of.read);
    const sent = locatePlan({ logo_path: start.logo_path, generate: { background: start.background }, logos: start.logos });
    const templates: TemplateIn[] = sent.shape === "set"
      ? sent.templates.map((t) => ({ file: t.file, raster: rasterAt(t.path), ground: t.ground, fixed: t.fixed, names: t.names }))
      : [{ file: "stored", raster: of.raster, ground: sent.background }];
    const compared: CompareIn[] = sent.shape === "set" ? sent.compare.map((c) => ({ file: c.file, raster: rasterAt(c.path) })) : [];
    const design = await decodeRaster(await read("generated-media", d.design_path, d.local));
    const t = performance.now();
    // A chosen logo is searched where its new settings put it; any other design at the placement its own job had.
    const found = locateTemplates(design, templates, compared, of.picked ? of.placement : d.placement, LOGO_SCALES);
    const ms = Math.round(performance.now() - t);
    const refusal = locateRefusal(found);
    const pass = refusal === null;
    const lost = logoFound(found, found.usual.width) && found.lost === true;
    const scores: [number, number | null] = [round(found.scores![0], 3), found.scores!.length > 1 ? round(found.scores![1], 3) : null];
    const expected = want ? { pass: want.pass, ...(want.pass ? { file: want.file } : {}), ...(want.lost ? { lost: true } : {}), ...(want.scores ? { scores: want.scores } : {}) } : null;
    // A picture drawn for the replay has no scores to keep: its pass, file and lost are what is expected of it.
    // A chosen logo is searched where the rule's own placement puts it, so a score moves with that placement: the pick row pins the placement exactly, and a design's pass, fail and file are compared exactly.
    const scoresSame = !!want && (of.picked || !want.scores || want.scores.every((s, i) => (s === null ? scores[i] === null : scores[i] !== null && Math.abs((scores[i] as number) - s) <= SCORE_ROOM)));
    // How the file that is stamped, or the matched file of a design that is made again, shows on the picture's own ground.
    const shown = (found.file ?? found.matched) as LogoFileName;
    const weakest = found.ground && inksOf[shown]?.length ? round(weakestContrast(inksOf[shown]!, found.ground), 2) : null;
    return {
      client: entry.client, kind, what: `${d.job} ${d.design}`, expected,
      got: {
        pass, ...(pass ? { file: found.file } : {}), ...(lost ? { lost: true } : {}), scores, matched: found.matched,
        templates: templates.map((t) => `${t.file} on ${hexOf(t.ground)}`), names: templates.map((t) => t.names ?? null), scale: round(found.width / found.usual.width, 2), gaps: roundGaps(found.gaps ?? {}),
        ground: found.ground ? hexOf(found.ground) : null, weakest_on_ground: weakest, ...(refusal ? { made_again: refusal } : {}),
      },
      same: !!want && want.pass === pass && (!pass || want.file === found.file) && !!want.lost === lost && scoresSame, ms,
    };
  }

  // The stored designs, through locate as a job started from this set would send it.
  const job = jobLogos({ logo_path: logo.path, background: logo.background, source: entry.source, logo_set: set });
  for (const d of entry.designs) {
    const want = entry.expect.designs.find((e) => e.job === d.job && e.design === d.design);
    rows.push(await locateRow("design", d, want, job ? { logo_path: job.logo_path, background: job.background, logos: job.logos } : { logo_path: logo.path, background: logo.picked ? logo.background : d.background, logos: null }, logo));
  }

  // The window between the release and the lifecycle's look at this client: what a design starts from on the live row as it is (jobs.ts, stillStart).
  // The live row names the logo the client has, so the window is replayed on that file, whatever the posts chose above.
  if (entry.live) {
    const whole = wholeInks(stored);
    const row = { logo_path: entry.logo_path, background: entry.live.background, source: entry.source, logo_set: entry.live.logo_set };
    const fromSet = jobLogos(row) ?? (whole.inks.length ? jobLogos(row, whole) : null);
    const start = fromSet
      ? { logo_path: fromSet.logo_path, background: fromSet.background, logos: fromSet.logos as JobLogos | null }
      : { logo_path: entry.logo_path, background: whole.inks.length ? restGround(whole.inks, entry.live.background, whole.own, entry.source === "person").ground : entry.live.background, logos: null };
    // The live set's own files (its copies as the lifecycle stored them), read from storage once.
    for (const path of Object.values(start.logos?.files ?? {})) {
      if (path && !has.rasters.has(path)) has.rasters.set(path, await decodeRaster(await read("generated-media", path)));
    }
    const got = { file: start.logos?.canvas ?? "stored", ground: start.background.toUpperCase(), second: start.logos?.second ?? null };
    const inks = inksFor(has)[got.file] ?? [];
    rows.push({
      client: entry.client, kind: "window", what: "what a design starts from before the lifecycle's look",
      expected: entry.expect.window ?? null,
      got: { ...got, one_file: !start.logos, weakest: inks.length ? round(weakestContrast(inks, hexRgb(got.ground)), 2) : null },
      same: !!entry.expect.window && sameText(entry.expect.window, got),
    });
    const live: LogoInUse = { path: entry.logo_path, raster: stored, placement: entry.placement, background: entry.live.background, read: has, picked: false };
    for (const d of entry.window_designs ?? []) {
      const want = (entry.expect.window_designs ?? []).find((e) => e.job === d.job && e.design === d.design);
      rows.push(await locateRow("window design", d, want, start, live));
    }
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
  const designs = all.filter((r) => r.kind === "design" || r.kind === "window design");
  const posts = all.filter((r) => r.kind === "post");
  const picks = all.filter((r) => r.kind === "pick");
  const summary = {
    clients: manifest.length,
    picks_looked_at: picks.filter((r) => "chosen" in (r.got as object)).length,
    logos_changed: picks.filter((r) => (r.got as { chosen?: string | null }).chosen).length,
    settings: all.filter((r) => r.kind === "settings").length,
    posts: posts.length,
    posts_found: posts.filter((r) => (r.got as { found?: boolean } | null)?.found).length,
    windows: all.filter((r) => r.kind === "window").length,
    designs: designs.length,
    designs_pass: designs.filter((r) => (r.got as { pass: boolean }).pass).length,
    designs_lost: designs.filter((r) => (r.got as { lost?: boolean }).lost).length,
    rows_that_differ: differ.length,
    slowest_locate_ms: Math.max(0, ...designs.map((r) => r.ms ?? 0)),
    slowest_post_ms: Math.max(0, ...posts.map((r) => r.ms ?? 0)),
  };
  console.log(`\n${JSON.stringify(summary)}`);
  if (outFile) await writeFile(outFile, JSON.stringify({ summary, rows: all }, null, 1));
  if (differ.length) process.exit(1);
}

await main();
