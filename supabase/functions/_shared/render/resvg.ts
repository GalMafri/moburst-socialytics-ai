// resvg (WASM) for the edge runtime: one initialisation per isolate. The
// binary ships with the function as a static file; the package CDN is only a
// fallback for a build that did not bundle it.
import { Resvg, initWasm } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2';

const WASM_URL = 'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
let ready: Promise<void> | null = null;

export async function ensureResvg(local?: URL): Promise<void> {
  if (!ready) ready = (async () => {
    if (local) {
      try { await initWasm(await Deno.readFile(local)); return; } catch (e) { console.warn('[resvg] bundled wasm unavailable, fetching', e instanceof Error ? e.message : e); }
    }
    const res = await fetch(WASM_URL, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`The renderer could not be loaded [${res.status}]`);
    await initWasm(await res.arrayBuffer());
  })().catch((e) => { ready = null; throw e; });
  await ready;
}

/** Rasterise an SVG document to PNG bytes with the given font files. */
export async function svgToPng(svg: string, width: number, fonts: Uint8Array[], defaultFamily: string, local?: URL): Promise<Uint8Array> {
  await ensureResvg(local);
  const r = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: defaultFamily, loadSystemFonts: false }, fitTo: { mode: 'width', value: width } });
  return r.render().asPng();
}
