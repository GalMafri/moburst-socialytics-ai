/**
 * A video design in a frame of its own shape. A video is made in the size
 * its platform is uploaded in (18 Nov 2026: 9:16 for Reels, TikTok and
 * Shorts, 16:9 for a YouTube video). A vertical video keeps the frame it
 * always had (`fallback`, a Tailwind aspect class); a landscape video's frame
 * takes the video's own shape once its metadata has loaded. The whole video
 * is always shown, never cropped.
 */

import { type ReactNode, type VideoHTMLAttributes } from "react";
import { useVideoRatio } from "@/lib/naturalRatio";

export function VideoFrame({ src, fallback, className = "", videoClassName = "", video = {}, children }: {
  src: string;
  /** The frame's shape until the video's metadata has loaded, e.g. "aspect-[9/16]". */
  fallback: string;
  className?: string;
  videoClassName?: string;
  /** Attributes for the video element (controls, muted, loop, preload, aria-label). */
  video?: VideoHTMLAttributes<HTMLVideoElement>;
  children?: ReactNode;
}) {
  const { ratio: measured, onLoadedMetadata } = useVideoRatio();
  // Only a landscape video changes the frame.
  const ratio = measured !== null && measured > 1 ? measured : null;
  return (
    <div className={`${ratio ? "" : fallback} ${className}`.trim()} style={ratio ? { aspectRatio: String(ratio) } : undefined} data-video-frame data-wide={ratio !== null ? "" : undefined}>
      <video src={src} {...video} className={`w-full h-full object-contain ${videoClassName}`.trim()} onLoadedMetadata={onLoadedMetadata} />
      {children}
    </div>
  );
}
