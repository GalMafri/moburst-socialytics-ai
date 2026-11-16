// What a brand book may be, said once for the setup screen (which checks a
// file before it uploads) and for extract-brand-from-file (which reads it), so
// the two never disagree about what is too big.

/** The most bytes a brand book may have. */
export const BRAND_BOOK_MAX_BYTES = 10 * 1024 * 1024;

/** The size as people read it. */
export const BRAND_BOOK_MAX_TEXT = `${BRAND_BOOK_MAX_BYTES / (1024 * 1024)} MB`;

/** The file types a brand book may be, by extension, with the media type each is sent as. */
export const BRAND_BOOK_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

// The upload limit above is what a person may keep. What a model request can
// carry is smaller, and differs by destination, so each limit is written here
// next to it and the readers ask these functions instead of keeping numbers.

/** The most bytes an image brand book may have in a style-learning request (the model refuses an image over 5 MB). */
export const BRAND_BOOK_MODEL_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** The most bytes one request may carry in all, as sent (base64). Both model calls that read the book stay under it. */
export const MODEL_REQUEST_MAX_BYTES = 20 * 1024 * 1024;

/** Room left in a request for its text and structure. */
const REQUEST_TEXT_RESERVE_BYTES = 512 * 1024;

/** The bytes a file takes in a request once it is base64. */
export function base64Bytes(rawBytes: number): number {
  return Math.ceil(rawBytes / 3) * 4;
}

/**
 * Whether the brand book goes into a request that already carries
 * `usedEncodedBytes` (as sent): an image book sent where the model limits image
 * size (`imageLimited`) must be within that limit, and the book plus what the request carries must fit the request.
 * A book that does not fit is left out and the request goes on without it.
 */
export function brandBookFitsRequest(book: { bytes: number; imageLimited: boolean }, usedEncodedBytes: number): boolean {
  if (book.bytes > BRAND_BOOK_MAX_BYTES) return false;
  if (book.imageLimited && book.bytes > BRAND_BOOK_MODEL_IMAGE_MAX_BYTES) return false;
  return usedEncodedBytes + base64Bytes(book.bytes) + REQUEST_TEXT_RESERVE_BYTES <= MODEL_REQUEST_MAX_BYTES;
}
