// server/scripts/replay.ts
//
// The replay (12 Nov 2026): the proof, before the picture service is
// released, that moving picture work from the edge workers (Deno,
// imagescript 1.3.0) to the service (Node, sharp) changes no delivered
// picture. For every design in the manifest it fetches the stored logo,
// design, logo-free picture and delivered PNG, and checks three things:
//   finish  the service's finishPicture, given the stored logo-free picture,
//           logo file, rectangle and frame, gives the delivered pixels exactly;
//   decode  sharp (decodeRaster) and imagescript read each stored logo,
//           design, logo-free picture and delivered PNG to the same bytes;
//   locate  the service's locateLogo on the stored design, beside the stored
//           rectangle (information only: rectangles stored before the 11 Nov
//           search change may differ).
// The manifest is a JSON array of done designs exported from canva_finish_jobs
// (job, client, page, logo_path, design_path, nologo_path, logo_rect,
// logo_frame, logo_score, final_path, placement, background); it is never
// committed. Jobs run one at a time to keep memory flat.
//
// Run from the repository root:
//   npx tsx server/scripts/replay.ts <manifest.json>
// Exit code 1 when any finish or decode differs.

import { readFile } from "node:fs/promises";
import { Image } from "imagescript";
import { decodeRaster, type Raster } from "../src/picture/raster.ts";
import { finishPicture } from "../src/picture/finish.ts";
import { locateLogo } from "../src/picture/locate.ts";
import { outputSize } from "../../supabase/functions/_shared/canva/finish.ts";
import { LOGO_SCALES } from "../../supabase/functions/_shared/design/logoMatch.ts";
import type { Placement, Rect, Rgb, Size } from "../../supabase/functions/_shared/picture/contract.ts";

const BASE = "https://rwouwxqggjjacbpbhqsn.supabase.co/storage/v1/object/public/generated-media/";

type Row = {
  job: string;
  client: string;
  page: Size;
  logo_path: string;
  design_path: string;
  nologo_path: string;
  logo_rect: Rect;
  logo_frame: [number, number];
  logo_score: number;
  final_path: string;
  placement: Placement;
  background: string;
};

function hexRgb(hex: string): Rgb {
  const n = parseInt(String(hex || "#000000").replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function fetchOnce(path: string): Promise<Uint8Array> {
  const res = await fetch(BASE + path.split("/").map(encodeURIComponent).join("/"));
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** One retry on a network error; an HTTP error status is not retried. */
async function fetchFile(path: string): Promise<Uint8Array> {
  try {
    return await fetchOnce(path);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("HTTP ")) throw e;
    return fetchOnce(path);
  }
}

/** Bit depth and color type from the PNG's IHDR (bytes 24 and 25), or "not-png". */
function pngKind(bytes: Uint8Array): string {
  const png = bytes.length > 25 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  return png ? `${bytes[24]}/${bytes[25]}` : "not-png";
}

function buf(a: Uint8Array | Uint8ClampedArray): Buffer {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength);
}

/** Bytes that differ; a length difference counts every byte past the shorter one. */
function diffBytes(a: Uint8Array | Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
  if (a.length === b.length && Buffer.compare(buf(a), buf(b)) === 0) return 0;
  const n = Math.min(a.length, b.length);
  let d = Math.abs(a.length - b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** RGBA pixels that differ; a size difference counts every pixel of the larger raster. */
function diffPixels(a: Raster, b: Raster): number {
  if (a.width !== b.width || a.height !== b.height) return Math.max(a.width * a.height, b.width * b.height);
  if (Buffer.compare(buf(a.data), buf(b.data)) === 0) return 0;
  let d = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) d++;
  }
  return d;
}

/** sharp's decode beside imagescript's: the sharp raster, the differing bytes and the ms sharp took. */
async function decodeBoth(bytes: Uint8Array): Promise<{ raster: Raster; diff: number; ms: number }> {
  const t = performance.now();
  const raster = await decodeRaster(bytes);
  const ms = performance.now() - t;
  const oracle = (await Image.decode(bytes)) as Image;
  const same = raster.width === oracle.width && raster.height === oracle.height;
  const diff = same ? diffBytes(raster.data, oracle.bitmap) : Math.max(raster.data.length, oracle.bitmap.length);
  return { raster, diff, ms };
}

const rectText = (r: Rect) => `${r.x},${r.y} ${r.width}x${r.height}`;

async function main(): Promise<void> {
  const manifest = process.argv[2];
  if (!manifest) {
    console.error("Usage: npx tsx server/scripts/replay.ts <manifest.json>");
    process.exit(2);
  }
  const rows = JSON.parse(await readFile(manifest, "utf8")) as Row[];
  let finishSame = 0, decodeSame = 0, decodeCount = 0, locateSame = 0, slowest = 0, slowestLocate = 0, failed = false;

  for (const row of rows) {
    const id = row.job.slice(0, 8);
    let counted = 0;
    try {
      const [logoBytes, designBytes, nologoBytes, finalBytes] = [
        await fetchFile(row.logo_path),
        await fetchFile(row.design_path),
        await fetchFile(row.nologo_path),
        await fetchFile(row.final_path),
      ];
      const decoded = [];
      for (const bytes of [logoBytes, designBytes, nologoBytes, finalBytes]) {
        const d = await decodeBoth(bytes);
        decoded.push(d);
        counted++;
        decodeCount++;
        if (d.diff === 0) decodeSame++;
        else failed = true;
      }
      const [logo, design, nologo, final] = decoded;
      const decodeMs = logo.ms + design.ms + nologo.ms + final.ms;

      const [ow, oh] = outputSize([row.page.width, row.page.height]);
      let t = performance.now();
      const out = finishPicture(nologo.raster, logo.raster, row.logo_rect, row.logo_frame, { width: ow, height: oh });
      const finishMs = performance.now() - t;
      slowest = Math.max(slowest, finishMs);
      const finishDiff = diffPixels(out, final.raster);
      if (finishDiff === 0) finishSame++;
      else failed = true;

      t = performance.now();
      const found = locateLogo(design.raster, logo.raster, row.placement, hexRgb(row.background), LOGO_SCALES);
      const locateMs = performance.now() - t;
      slowestLocate = Math.max(slowestLocate, locateMs);
      const s = row.logo_rect;
      const sameRect = found.x === s.x && found.y === s.y && found.width === s.width && found.height === s.height;
      if (sameRect) locateSame++;

      console.log(
        `${id} finish ${finishDiff}px | decode logo ${logo.diff} design ${design.diff} nologo ${nologo.diff} final ${final.diff} | ` +
          `png logo ${pngKind(logoBytes)} design ${pngKind(designBytes)} nologo ${pngKind(nologoBytes)} final ${pngKind(finalBytes)} | ` +
          `locate ${rectText(found)} score ${found.score.toFixed(3)} stored ${rectText(s)} score ${row.logo_score}${sameRect ? " same" : " DIFFERENT"} | ` +
          `ms decode ${Math.round(decodeMs)} finish ${Math.round(finishMs)} locate ${Math.round(locateMs)}`,
      );
    } catch (e) {
      failed = true;
      // Decodes not reached on this row count as not identical; those already counted stay as they were.
      decodeCount += 4 - counted;
      console.log(`${id} ERROR ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`finish: ${finishSame}/${rows.length} identical`);
  console.log(`decode: ${decodeSame}/${decodeCount} identical`);
  console.log(`locate: ${locateSame}/${rows.length} same rectangle`);
  console.log(`slowest finish: ${Math.round(slowest)} ms`);
  console.log(`slowest locate: ${Math.round(slowestLocate)} ms`);
  process.exit(failed ? 1 : 0);
}

await main();
