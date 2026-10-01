// resvg (WASM) for the edge runtime: one initialisation per isolate. The
// binary is kept in the project's own storage after the first fetch, the
// same way brand fonts are, so a render never depends on a package CDN.
import { Resvg, initWasm } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2';

const WASM_URL = 'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
const CACHE_BUCKET = 'brand-assets';
const CACHE_PATH = 'runtime/resvg-2.6.2.wasm';
let ready: Promise<void> | null = null;

async function wasmBytes(db: any): Promise<ArrayBuffer> {
  try {
    const { data } = await db.storage.from(CACHE_BUCKET).download(CACHE_PATH);
    if (data) return await data.arrayBuffer();
  } catch { /* not cached yet */ }
  const res = await fetch(WASM_URL, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`The renderer could not be loaded [${res.status}]`);
  const bytes = await res.arrayBuffer();
  await db.storage.from(CACHE_BUCKET).upload(CACHE_PATH, new Blob([bytes], { type: 'application/wasm' }), { contentType: 'application/wasm', upsert: true }).catch(() => null);
  return bytes;
}

export async function ensureResvg(db: any): Promise<void> {
  if (!ready) ready = (async () => { await initWasm(await wasmBytes(db)); })().catch((e) => { ready = null; throw e; });
  await ready;
}

/** Rasterise an SVG document to PNG bytes with the given font files. */
export async function svgToPng(db: any, svg: string, width: number, fonts: Uint8Array[], defaultFamily: string): Promise<Uint8Array> {
  await ensureResvg(db);
  const r = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: defaultFamily, loadSystemFonts: false }, fitTo: { mode: 'width', value: width } });
  return r.render().asPng();
}

/** Draw one image at exactly width x height (cover fit) and return PNG bytes: the canvas-sized hero and its small copy. */
export async function imageToPng(db: any, href: string, width: number, height: number): Promise<Uint8Array> {
  await ensureResvg(db);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image href="${href}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/></svg>`;
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: width } });
  return r.render().asPng();
}
