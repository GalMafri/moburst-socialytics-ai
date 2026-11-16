// supabase/functions/_shared/picture/headers.ts
//
// Picture sizes read from a file's header alone, so a worker can learn a
// picture's dimensions without decoding it (12 Nov 2026: the decoding now
// happens in the picture service). Imports nothing, so both the Deno workers
// and the Node server can use it. pngSize moved here from canva/jobs.ts,
// which still re-exports it.

/** A PNG's pixel size from its header; `source` names the file in the error when it is not a PNG. */
export function pngSize(bytes: Uint8Array, source = "The logo"): [number, number] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 24 || v.getUint32(0) !== 0x89504e47) throw new Error(`${source} must be a PNG file.`);
  return [v.getUint32(16), v.getUint32(20)];
}

/**
 * A JPEG's pixel size from its start-of-frame segment; `source` names the file in the
 * error when it is not a JPEG or has no frame. Walks the segments from just after the
 * start-of-image marker, skipping each by its own length.
 */
export function jpegSize(bytes: Uint8Array, source = "The still"): [number, number] {
  const fail = () => new Error(`${source} must be a JPEG file.`);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 2;
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) throw fail();
    const marker = bytes[pos + 1];
    if (marker === 0xff) { pos += 1; continue; } // fill byte before a marker
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { pos += 2; continue; } // markers with no length
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (pos + 9 > bytes.length) throw fail();
      return [v.getUint16(pos + 7), v.getUint16(pos + 5)];
    }
    pos += 2 + v.getUint16(pos + 2);
  }
  throw fail();
}
