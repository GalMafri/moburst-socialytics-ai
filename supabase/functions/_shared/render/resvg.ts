// resvg (WASM) for the edge runtime: one initialisation per isolate.
import { Resvg, initWasm } from 'https://esm.sh/@resvg/resvg-wasm@2.6.2';

const WASM_URL = 'https://unpkg.com/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
let ready: Promise<void> | null = null;

export async function ensureResvg(): Promise<void> {
  if (!ready) ready = (async () => {
    const res = await fetch(WASM_URL, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`The renderer could not be loaded [${res.status}]`);
    await initWasm(await res.arrayBuffer());
  })().catch((e) => { ready = null; throw e; });
  await ready;
}

/** Rasterise an SVG document to PNG bytes with the given font files. */
export async function svgToPng(svg: string, width: number, fonts: Uint8Array[], defaultFamily: string): Promise<Uint8Array> {
  await ensureResvg();
  const r = new Resvg(svg, { font: { fontBuffers: fonts, defaultFontFamily: defaultFamily, loadSystemFonts: false }, fitTo: { mode: 'width', value: width } });
  return r.render().asPng();
}
