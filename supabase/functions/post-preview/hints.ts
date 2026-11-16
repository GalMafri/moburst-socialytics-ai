// What a caller's own image hint is allowed to do.
//
// The competitive and analytics pages pass the creative they already know as a
// hint. post-preview copies a hint into the public bucket and caches the
// result for everyone, so a hint from a client user could plant the preview
// every other viewer then sees for an uncached post. Only staff hints are
// stored; any other caller's hint answers that one request and is dropped.

export type Hint = { url: string; image?: string | null; media_type?: string | null };

/**
 * Whether a hint may be copied to storage and cached. A request with no image
 * in it plants nothing, so it always may; one that carries an image may only
 * when the caller is staff.
 */
export function hintMayPersist(hint: Hint, isStaff: boolean): boolean {
  return isStaff || !hint.image;
}
