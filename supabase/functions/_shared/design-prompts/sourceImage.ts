export async function sourceImage(db: any, path: string) {
  const { data, error } = await db.storage.from('design-references').download(path);
  if (error || !data || data.size > 4 * 1024 * 1024) throw new Error('The brand source image could not be loaded.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  let binary = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  const mime = /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: mime, data: btoa(binary) } };
}

