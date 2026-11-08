// supabase/functions/_shared/sprout/media.ts
//
// Each image fitted to what its network takes through Sprout, before Sprout
// is asked. Sprout's "Image Requirements per Network with Sprout Publishing"
// (support.sproutsocial.com, read 8 Nov 2026) caps an image at 5 MB for
// LinkedIn and X, 8 MB for Facebook, Instagram and Threads, and 20 MB for
// Pinterest and TikTok. Designs are stored as large PNGs (6 to 7 MB from
// canva-finish), so on 3 Nov Sprout refused every slide of a LinkedIn
// carousel ("Unable to identify submitted media content").
//
// An image in the app's own storage that is over its network's limit is
// handed to Sprout through Supabase's image renderer instead: first the same
// image saved again, which is lossless (the 3 Nov slide went from 6.0 to
// 3.6 MB with every pixel the same), then 1080 pixels wide, the width the
// networks scale to. An image that still does not fit, or that is not in the
// app's storage, is not sent: the post is refused with the reason.

import { isVideoUrl, networkKey } from "./publishRules.ts";

const MB = 1_000_000;

/** What each network takes per image through Sprout. "5 MB" is read as 5,000,000 bytes, the stricter reading. */
export const SPROUT_IMAGE_LIMITS: Record<string, { name: string; maxBytes: number }> = {
  linkedin: { name: "LinkedIn", maxBytes: 5 * MB },
  x: { name: "X", maxBytes: 5 * MB },
  facebook: { name: "Facebook", maxBytes: 8 * MB },
  instagram: { name: "Instagram", maxBytes: 8 * MB },
  threads: { name: "Threads", maxBytes: 8 * MB },
  pinterest: { name: "Pinterest", maxBytes: 20 * MB },
  tiktok: { name: "TikTok", maxBytes: 20 * MB },
};

/** The renderer versions tried in order: the same pixels saved again, then 1080 pixels wide. */
export const RENDITIONS = ["format=origin", "width=1080&format=origin"];

const STORED = /\/storage\/v1\/object\/public\//;

/** An image over its network's limit that no version brings under it. */
export class ImageTooLarge extends Error {
  constructor(network: string, maxBytes: number) {
    super(`An image is larger than ${network} takes through Sprout (${maxBytes / MB} MB), even made smaller, so nothing was sent.`);
    this.name = "ImageTooLarge";
  }
}

/** A file's size and type from a HEAD request; null where the answer gives none. */
async function headOf(fetchImpl: typeof fetch, url: string): Promise<{ bytes: number | null; type: string }> {
  try {
    const r = await fetchImpl(url, { method: "HEAD" });
    if (!r.ok) return { bytes: null, type: "" };
    const n = Number(r.headers.get("content-length"));
    return { bytes: Number.isFinite(n) && n > 0 ? n : null, type: String(r.headers.get("content-type") ?? "").toLowerCase() };
  } catch {
    return { bytes: null, type: "" };
  }
}

/**
 * The address to hand Sprout for this file: the file itself when it fits or
 * is not an image, else a renderer version that fits. A file whose size the
 * storage does not give is sent as it is, and Sprout decides.
 */
export async function fitImage(fetchImpl: typeof fetch, url: string, network: string | null | undefined): Promise<string> {
  const limit = SPROUT_IMAGE_LIMITS[networkKey(network)];
  if (!limit || isVideoUrl(url)) return url;
  const file = await headOf(fetchImpl, url);
  if (file.bytes === null || file.bytes <= limit.maxBytes || (file.type && !file.type.startsWith("image/"))) return url;
  if (!STORED.test(url)) throw new ImageTooLarge(limit.name, limit.maxBytes);
  const rendered = url.replace(/[?#].*$/, "").replace(STORED, "/storage/v1/render/image/public/");
  for (const params of RENDITIONS) {
    const candidate = `${rendered}?${params}`;
    const version = await headOf(fetchImpl, candidate);
    if (version.bytes !== null && version.bytes <= limit.maxBytes) return candidate;
  }
  throw new ImageTooLarge(limit.name, limit.maxBytes);
}
