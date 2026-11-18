import { useCallback, useState, type SyntheticEvent } from "react";

/** A loaded picture's shape (width over height), or null when it has none to read. */
export function naturalRatio(image: { naturalWidth: number; naturalHeight: number }): number | null {
  return image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : null;
}

/**
 * The shape of a picture once it has loaded, so the frame around it can take
 * the picture's own proportions. `onLoad` goes on the img element; `ratio`
 * is null until then, and follows the picture when its source changes.
 */
export function useNaturalRatio(): { ratio: number | null; onLoad: (e: SyntheticEvent<HTMLImageElement>) => void } {
  const [ratio, setRatio] = useState<number | null>(null);
  const onLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const next = naturalRatio(e.currentTarget);
    if (next) setRatio(next);
  }, []);
  return { ratio, onLoad };
}

/** A loaded video's shape (width over height), or null when it has none to read yet. */
export function videoRatio(video: { videoWidth: number; videoHeight: number }): number | null {
  return video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : null;
}

/**
 * The shape of a video once its metadata has loaded, so the frame around it
 * takes the video's own proportions (18 Nov 2026: a video is made in its
 * platform's upload size, landscape for a YouTube video). `onLoadedMetadata`
 * goes on the video element; `ratio` is null until then.
 */
export function useVideoRatio(): { ratio: number | null; onLoadedMetadata: (e: SyntheticEvent<HTMLVideoElement>) => void } {
  const [ratio, setRatio] = useState<number | null>(null);
  const onLoadedMetadata = useCallback((e: SyntheticEvent<HTMLVideoElement>) => {
    const next = videoRatio(e.currentTarget);
    if (next) setRatio(next);
  }, []);
  return { ratio, onLoadedMetadata };
}

/**
 * The frame a video design is shown in before it has loaded, from the size
 * the post's platform is uploaded in (design_requests.upload_size): 16:9 for
 * a landscape size, and otherwise 9:16, the frame every video had before
 * 18 Nov 2026. Only a landscape video changes the frame.
 */
export function videoAspectClass(size: { width?: unknown; height?: unknown } | null | undefined): string {
  const w = Number(size?.width), h = Number(size?.height);
  return w > 0 && h > 0 && w > h ? "aspect-video" : "aspect-[9/16]";
}
