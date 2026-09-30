/** Copy a provider's rendered image into the client's generated-media storage; returns the public URL. */
export async function storeRemoteImage(db: any, clientId: string, url: string, name: string): Promise<string> {
  const prefix = db.storage.from('generated-media').getPublicUrl('').data.publicUrl;
  if (url.startsWith(prefix)) return url;
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`The rendered image could not be fetched [${response.status}].`);
  const type = response.headers.get('content-type') || 'image/png';
  const ext = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png';
  const path = `${clientId}/${Date.now()}-${name}.${ext}`;
  const blob = await response.blob();
  const { error } = await db.storage.from('generated-media').upload(path, blob, { contentType: type, upsert: false });
  if (error) throw new Error(`The rendered image could not be stored: ${error.message}`);
  return db.storage.from('generated-media').getPublicUrl(path).data.publicUrl;
}
