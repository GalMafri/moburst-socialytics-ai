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
