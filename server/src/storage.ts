// server/src/storage.ts
//
// Pictures in and out of Supabase storage through signed URLs (12 Nov 2026).
// The workers sign every URL; the service only GETs and PUTs bytes. A read
// is capped at PICTURE_MAX_INPUT_BYTES: refused from Content-Length before
// reading, or stopped as soon as a streamed body passes the cap, so a huge
// file never fills the function's memory. Every failure is a StorageError
// whose message is in the product's words, never the URL (signed URLs carry
// tokens). It is transient when storage could not serve or take the bytes
// right now (a network error, a 429 or a 5xx, an answer that did not come
// within the call's time limit, a redirect), so the route answers 503 and
// the worker's retry covers it; a 4xx (a missing or expired object, a
// refused upload) and a picture over the cap are not.
//
// The service reads and writes in one place only (16 Nov 2026): the
// product's own storage, PRODUCT_STORAGE, taken from the repository's public
// values. A link anywhere else is refused before anything is fetched
// (picture/schemas.ts) and no redirect is followed, so the service cannot be
// made to fetch from, or send a picture to, any other address, whoever
// opened the call.

import { PUBLIC_DEFAULTS } from "../../public-env.ts";
import { PICTURE_MAX_INPUT_BYTES } from "../../supabase/functions/_shared/picture/contract.ts";

export type Fetcher = typeof fetch;

/** The product's storage: every link the workers sign starts with it (the same address the app's stored picture links carry). */
export const PRODUCT_STORAGE = `${PUBLIC_DEFAULTS.VITE_SUPABASE_URL}/storage/v1/`;

/** How long one call's reads and writes may take together. It is shorter than the worker's own limit for the call (PICTURE_CALL_TIMEOUT_MS), so a storage that stalls ends as the service's own 503 with a reason, never as a call the worker gave up on. */
export const STORAGE_TIMEOUT_MS = 45_000;

/** True for an https link under the storage address: same host and port, no name or password in it, and a path that stays inside the storage folder once it is resolved. */
export function inStorage(link: string, storage: string): boolean {
  let url: URL;
  let base: URL;
  try {
    url = new URL(link);
    base = new URL(storage);
  } catch {
    return false;
  }
  return url.protocol === "https:" && url.origin === base.origin && !url.username && !url.password && url.pathname.startsWith(base.pathname);
}

export class StorageError extends Error {
  constructor(message: string, readonly transient = false) {
    super(message);
    this.name = "StorageError";
  }
}

/** Storage could not answer right now: worth the caller's retry. */
function unavailable(status: number): boolean {
  return status === 429 || status >= 500;
}

const NOT_READ = "A picture could not be read from storage.";
const TOO_LARGE = "A picture is larger than 64 MB.";
const NOT_STORED = "A picture could not be stored.";

/** GET a stored file. `limit` is the call's time limit; it also stops a body that stalls while it is read. */
export async function fetchBytes(url: string, fetchImpl: Fetcher, maxBytes = PICTURE_MAX_INPUT_BYTES, limit?: AbortSignal): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", redirect: "error", signal: limit });
  } catch {
    throw new StorageError(NOT_READ, true);
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw new StorageError(NOT_READ, unavailable(res.status));
  }
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new StorageError(TOO_LARGE);
  }
  if (!res.body) return new Uint8Array(0);

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new StorageError(TOO_LARGE);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof StorageError) throw err;
    // The body was cut off while it was read.
    throw new StorageError(NOT_READ, true);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** PUT with the headers Supabase signed upload URLs accept; x-upsert lets a retried call overwrite its own earlier upload. */
export async function putBytes(url: string, bytes: Uint8Array, contentType: string, fetchImpl: Fetcher, limit?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "PUT", headers: { "content-type": contentType, "x-upsert": "true" }, body: bytes, redirect: "error", signal: limit });
  } catch {
    throw new StorageError(NOT_STORED, true);
  }
  await res.body?.cancel().catch(() => {});
  if (!res.ok) throw new StorageError(NOT_STORED, unavailable(res.status));
}
