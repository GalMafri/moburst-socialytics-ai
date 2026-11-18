// supabase/functions/_shared/video/videoSizeDb.ts
//
// The size a new video request reads for its post (18 Nov 2026): the
// platform_sizes row for the post's platform and video format, kept on the
// request (design_requests.upload_size) so its clip, title, logo and MP4,
// and the price approved for its clip, are all in one shape. Which row, and
// whether its size can be made, is decided in videoSize.ts; this only reads.

import { checkVideoSize, videoSizeKey, type VideoUploadSize } from "./videoSize.ts";

/**
 * The row for a video post, or null: no row for its platform and format, a
 * row whose size fails the check, or a read that failed. Null is never an
 * error: the video is then made vertical, as every video was before.
 */
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readVideoSize(admin: any, post: { platform?: string | null; format?: string | null }): Promise<VideoUploadSize | null> {
  const key = videoSizeKey(post);
  if (!key) return null;
  try {
    const { data, error } = await admin.from("platform_sizes").select("platform, format, width, height, usable")
      .eq("platform", key.platform).eq("format", key.format).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.usable === false) return null;
    if (!checkVideoSize({ width: data.width, height: data.height }).ok) return null;
    return { platform: key.platform, format: key.format, width: data.width, height: data.height };
  } catch (e) {
    console.error("[platform-sizes] could not read the video's size; it is made vertical:", e instanceof Error ? e.message : e);
    return null;
  }
}
