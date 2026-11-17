// supabase/functions/_shared/design/platformSizeDb.ts
//
// The size a new design request reads for its post (17 Nov 2026, spec
// docs/superpowers/specs/2026-11-17-platform-sizes-design.md): the
// platform_sizes row for the post's platform and format, kept on the request
// (design_requests.upload_size) so every option, slide and replacement of it
// is drawn in one size. Which row, and whether its size can be made, is
// decided in platformSize.ts; this only reads.

import { checkSize, uploadSizeKeys, type UploadSize } from "./platformSize.ts";

/**
 * The row for a post, or null: no row for its platform and format, a row
 * whose size fails a check, or a read that failed. Null is never an error:
 * the request is then designed as every request was before the table
 * existed. A carousel with no row of its own reads its platform's image
 * row.
 */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readUploadSize(admin: any, post: { platform?: string | null; format?: string | null }): Promise<UploadSize | null> {
  const keys = uploadSizeKeys(post);
  if (!keys.length) return null;
  try {
    const { data, error } = await admin.from("platform_sizes").select("platform, format, width, height, usable")
      .eq("platform", keys[0].platform).in("format", keys.map((k) => k.format));
    if (error) throw new Error(error.message);
    for (const key of keys) {
      const row = (data ?? []).find((r: { format: string }) => r.format === key.format);
      if (!row) continue;
      // A size the image model refused, with no drawn size to go back to: the design is made at the usual size.
      if (row.usable === false) return null;
      // The first row there is decides: one that cannot be made is not replaced by another shape.
      if (!checkSize({ width: row.width, height: row.height }, key.format).ok) return null;
      return { platform: key.platform, format: key.format, width: row.width, height: row.height };
    }
    return null;
  } catch (e) {
    console.error("[platform-sizes] could not read the upload size; the design is made at the usual size:", e instanceof Error ? e.message : e);
    return null;
  }
}
