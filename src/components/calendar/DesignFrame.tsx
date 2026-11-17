/**
 * A still design in a frame of its own shape. A design is drawn in the size
 * its platform is uploaded in (17 Nov 2026: 4:5 for Instagram and Facebook,
 * square for LinkedIn, wide for X), so no frame can assume one shape: until
 * the picture has loaded the frame has the shape given (`fallback`, a
 * Tailwind aspect class), and from then on the picture's own. The whole
 * design is always shown, never cropped.
 */

import { type ReactNode } from "react";
import { useNaturalRatio } from "@/lib/naturalRatio";

export function DesignFrame({ src, alt = "", fallback, className = "", imgClassName = "", lazy = false, children }: {
  src: string;
  alt?: string;
  /** The frame's shape until the picture has loaded, e.g. "aspect-[4/5]". */
  fallback: string;
  className?: string;
  imgClassName?: string;
  lazy?: boolean;
  /** Anything laid over the picture. */
  children?: ReactNode;
}) {
  const { ratio, onLoad } = useNaturalRatio();
  return (
    <div className={`${ratio ? "" : fallback} ${className}`.trim()} style={ratio ? { aspectRatio: String(ratio) } : undefined} data-design-frame>
      <img src={src} alt={alt} className={`w-full h-full object-contain ${imgClassName}`.trim()} loading={lazy ? "lazy" : undefined} onLoad={onLoad} />
      {children}
    </div>
  );
}
