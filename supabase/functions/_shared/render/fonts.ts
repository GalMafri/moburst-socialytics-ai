// Brand fonts for the renderer: Google Fonts TTFs, fetched once and kept in the
// brand-assets bucket so a render never depends on Google being reachable.
const CACHE_BUCKET = 'brand-assets';

function slug(family: string): string { return family.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'); }

async function googleTtfUrl(family: string, weight: number): Promise<string> {
  // An old user agent makes Google return TTF rather than woff2, which resvg cannot read.
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weight}&display=swap`, { headers: { 'User-Agent': 'Mozilla/4.0' }, signal: AbortSignal.timeout(15000) });
  if (!css.ok) throw new Error(`Google Fonts has no ${family} ${weight} [${css.status}]`);
  const text = await css.text();
  const m = text.match(/url\((https:[^)]+\.ttf)\)/);
  if (!m) throw new Error(`Google Fonts returned no TTF for ${family} ${weight}`);
  return m[1];
}

/** The TTF bytes for one family and weight; cached in storage after the first fetch. */
export async function fontBytes(db: any, family: string, weight: number): Promise<Uint8Array> {
  const path = `fonts/${slug(family)}-${weight}.ttf`;
  try {
    const { data } = await db.storage.from(CACHE_BUCKET).download(path);
    if (data) return new Uint8Array(await data.arrayBuffer());
  } catch { /* not cached yet */ }
  const url = await googleTtfUrl(family, weight);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`The font file for ${family} ${weight} could not be fetched [${res.status}]`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await db.storage.from(CACHE_BUCKET).upload(path, new Blob([bytes], { type: 'font/ttf' }), { contentType: 'font/ttf', upsert: true }).catch(() => null);
  return bytes;
}

/** Whether Google Fonts knows this family at all (so the design system can name a real face). */
export async function fontAvailable(family: string): Promise<boolean> {
  try { await googleTtfUrl(family, 400); return true; } catch { return false; }
}
