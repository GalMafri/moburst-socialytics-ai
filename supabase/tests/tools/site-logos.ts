// supabase/tests/tools/site-logos.ts
//
// The website logo proof (16 Nov 2026; 17 Nov: the marks the page ties to its
// own brand are also the candidates for the client's logo,
// _shared/design/logoPick.ts, and the replay reads the files written here,
// server/scripts/tone-replay.ts): what the lifecycle would take
// from each client's own website as a second logo file, run with the
// product's own functions before the lifecycle's runner is deployed. It
// calls no model and no paid provider and writes nothing to the product:
// the homepage is fetched directly (fetchSiteHtml with no scraping key), its
// logo and its other logo files are listed (logoOnPage, logoFilesOnPage),
// each is converted the way the design_settings step converts it (logoPng,
// into a store kept in memory), and the same-logo test is run against the
// client's stored logo (sameLogo).
//
// A file that passes becomes the client's second logo with no post needed
// to show it, so every file that passes is written beside the stored logo
// and is looked at at full size before the runner goes live. A pass that is
// not the client's logo stops the release.
//
// The manifest is a JSON array, one entry per client, exported read-only and
// never committed:
//   { client, website, logo_path, logo_local?, logo_url? }
// The stored logo is read from `logo_local` when the entry has one, else
// from the product's public storage by path. `logo_url` is the address the
// client's logo came from (clients.logo_url): a mark at that address is the
// logo the client has and is left out, as in the step; without it the
// page's own first logo is.
//
// Run with Deno from the repository root:
//   deno run --no-lock --allow-net --allow-read --allow-write --allow-env \
//     supabase/tests/tools/site-logos.ts <manifest.json> <out folder>
//
// For each client it prints one JSON line and writes, into the out folder,
// `<n>-stored.png`, `<n>-main.png` and `<n>-file<k>.png` (`-PASS` in the
// name of a file that passed), `<n>-page.html` (the page as it was read) and
// at the end `result.json`, where each file's `png` is the name it was
// written under and `candidate` says whether the page ties the mark to its
// own brand (research.ts, ownMarksOnPage), so that it can be the client's
// logo itself.

import { Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";
import { PUBLIC_DEFAULTS } from "../../../public-env.ts";
import { fetchSiteHtml, logoFilesOnPage, logoOnPage, normalizeWebsite, ownMarksOnPage, standaloneSvg } from "../../functions/_shared/brand/research.ts";
import { resampleRGBA } from "../../functions/_shared/canva/brief.ts";
import { ownGround, partsOf, sameLogo, SOLID_ALPHA, type Raster } from "../../functions/_shared/design/logoTone.ts";
import { logoNormalization } from "../../functions/_shared/lifecycle/designSettings.ts";
import { logoPng } from "../../functions/_shared/lifecycle/imaging.ts";
import { svgToPng } from "../../functions/_shared/render/resvg.ts";

type Entry = { client: string; website: string; logo_path: string; logo_local?: string; logo_url?: string };
/** The most website files the lifecycle keeps for one client (steps.ts, MAX_SITE_LOGOS). */
const MAX_SITE_LOGOS = 6;

const [manifestFile, out] = Deno.args;
if (!manifestFile || !out) {
  console.error("usage: deno run ... supabase/tests/tools/site-logos.ts <manifest.json> <out folder>");
  Deno.exit(2);
}
await Deno.mkdir(out, { recursive: true });
const manifest = JSON.parse(await Deno.readTextFile(manifestFile)) as Entry[];

// A store kept in memory stands in for the product's storage: what logoPng and the renderer write stays here.
const store = new Map<string, Uint8Array>();
const db = {
  storage: {
    from: (_bucket: string) => ({
      download: (path: string) => Promise.resolve(store.has(path) ? { data: new Blob([store.get(path)! as BlobPart]), error: null } : { data: null, error: { message: "missing" } }),
      upload: async (path: string, bytes: Uint8Array | Blob) => {
        store.set(path, bytes instanceof Blob ? new Uint8Array(await bytes.arrayBuffer()) : bytes);
        return { error: null };
      },
    }),
  },
};

async function raster(png: Uint8Array): Promise<Raster> {
  const image = await Image.decode(png);
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.bitmap) };
}
async function write(name: string, r: Raster): Promise<void> {
  const image = new Image(r.width, r.height);
  image.bitmap.set(r.data);
  await Deno.writeFile(`${out}/${name}`, await image.encode());
}
/** A logo as the lifecycle stores it: the box of its ink, its long side at most 1,200 pixels. */
function asStored(r: Raster): Raster {
  const n = logoNormalization(r.data, r.width, r.height);
  if (!n || !n.changed) return r;
  const b = n.box;
  const cut = new Uint8ClampedArray(b.width * b.height * 4);
  for (let y = 0; y < b.height; y++) cut.set(r.data.subarray(((y + b.y) * r.width + b.x) * 4, ((y + b.y) * r.width + b.x + b.width) * 4), y * b.width * 4);
  if (n.size[0] === b.width && n.size[1] === b.height) return { width: b.width, height: b.height, data: cut };
  return { width: n.size[0], height: n.size[1], data: resampleRGBA(cut, b.width, b.height, n.size[0], n.size[1]) };
}
/** The shapes of two files and the overlap of their solid ink, whatever their tones: is it the same drawing? */
function sameDrawing(a: Raster, b: Raster): { shape: number; overlap: number } {
  const ra = a.width / a.height, rb = b.width / b.height;
  const w = 256, h = Math.max(1, Math.round((a.height * w) / a.width));
  const x = resampleRGBA(a.data, a.width, a.height, w, h), y = resampleRGBA(b.data, b.width, b.height, w, h);
  let shared = 0, either = 0;
  for (let i = 3; i < x.length; i += 4) {
    const p = x[i] >= SOLID_ALPHA, q = y[i] >= SOLID_ALPHA;
    if (p || q) either++;
    if (p && q) shared++;
  }
  return { shape: Math.min(ra, rb) / Math.max(ra, rb), overlap: either ? shared / either : 0 };
}
/** One file of the page, converted as the step converts it. An inline SVG is drawn from its own text, as it is once stored. */
async function convert(id: string, file: { url: string } | { svg: string }): Promise<{ from: string; raster: Raster | null; why?: string }> {
  try {
    if ("svg" in file) return { from: "inline svg", raster: asStored(await raster(await svgToPng(db, standaloneSvg(file.svg), 1200, [], "Arial"))) };
    const got = await logoPng(db, id, file.url);
    if (!got) return { from: file.url, raster: null, why: "not a kind of file the design path uses" };
    return { from: file.url, raster: await raster(store.get(got.path)!) };
  } catch (e) {
    return { from: "url" in file ? file.url : "inline svg", raster: null, why: e instanceof Error ? e.message : String(e) };
  }
}

const results: unknown[] = [];
for (const [i, entry] of manifest.entries()) {
  const id = String(i).padStart(2, "0");
  const row: Record<string, unknown> = { n: id, client: entry.client, website: entry.website };
  try {
    const bytes = entry.logo_local
      ? await Deno.readFile(entry.logo_local)
      : new Uint8Array(await (await fetch(`${PUBLIC_DEFAULTS.VITE_SUPABASE_URL}/storage/v1/object/public/generated-media/${entry.logo_path.split("/").map(encodeURIComponent).join("/")}`)).arrayBuffer());
    const stored = asStored(await raster(bytes));
    const parts = partsOf(stored);
    await write(`${id}-stored.png`, stored);
    Object.assign(row, { stored: `${stored.width}x${stored.height}`, own: ownGround(parts) });

    // The address as the lifecycle reads it (a bare domain gets its scheme), fetched directly: no scraping service, no model.
    const website = normalizeWebsite(entry.website);
    const { html } = await fetchSiteHtml(website, {});
    await Deno.writeTextFile(`${out}/${id}-page.html`, html);
    const origin = new URL(website).origin;
    const main = logoOnPage(html, origin);
    if (main) {
      const c = await convert(id, main);
      if (c.raster) await write(`${id}-main.png`, c.raster);
      // The page's own logo against the stored one: when they are one drawing, the page is the one the stored logo came from.
      row.main = { from: c.from, why: c.why, size: c.raster ? `${c.raster.width}x${c.raster.height}` : null, ...(c.raster ? sameDrawing(stored, c.raster) : {}) };
    } else row.main = null;
    const keyOf = (file: { url: string } | { svg: string }) => ("url" in file ? file.url : file.svg);
    const mainKey = entry.logo_url ?? (main ? keyOf(main) : null);
    // The wide list and the brand's own marks, each cut at six as the step cuts them, listed once in page order.
    const cut = (marks: Array<{ url: string } | { svg: string }>) => marks.filter((f) => keyOf(f) !== mainKey).slice(0, MAX_SITE_LOGOS).map(keyOf);
    const wide = cut(logoFilesOnPage(html, origin)), brandOwn = cut(ownMarksOnPage(html, origin));
    const files: unknown[] = [];
    for (const file of logoFilesOnPage(html, origin)) {
      if (!wide.includes(keyOf(file)) && !brandOwn.includes(keyOf(file))) continue;
      const c = await convert(id, file);
      const same = c.raster ? sameLogo(stored, parts, c.raster) : null;
      const png = c.raster ? `${id}-file${files.length}${same?.same ? "-PASS" : ""}.png` : null;
      if (c.raster && png) await write(png, c.raster);
      files.push({
        k: files.length, from: c.from, why: c.why, png, candidate: brandOwn.includes(keyOf(file)), second_file: wide.includes(keyOf(file)), size: c.raster ? `${c.raster.width}x${c.raster.height}` : null,
        own: c.raster ? ownGround(partsOf(c.raster)) : null, shape: c.raster ? sameDrawing(stored, c.raster).shape : null, overlap: same?.overlap ?? null, passes: same?.same ?? false,
      });
    }
    row.files = files;
  } catch (e) {
    row.not_read = e instanceof Error ? e.message : String(e);
  }
  results.push(row);
  console.log(JSON.stringify(row));
}
await Deno.writeTextFile(`${out}/result.json`, JSON.stringify(results, null, 1));
