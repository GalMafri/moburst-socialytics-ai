// A video is made in the size its platform is uploaded in (18 Nov 2026), so
// the frame around it takes the video's own shape once its metadata has
// loaded: wide for a YouTube video, tall for a Reel. Until then it has the
// shape the post's stored size gives, or 9:16.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { VideoFrame } from "@/components/calendar/VideoFrame";
import { videoAspectClass, videoRatio } from "@/lib/naturalRatio";

afterEach(cleanup);

function loadVideo(video: HTMLVideoElement, width: number, height: number) {
  Object.defineProperty(video, "videoWidth", { configurable: true, value: width });
  Object.defineProperty(video, "videoHeight", { configurable: true, value: height });
  fireEvent.loadedMetadata(video);
}

describe("a video's shape", () => {
  it("is its width over its height once known", () => {
    expect(videoRatio({ videoWidth: 1920, videoHeight: 1080 })).toBeCloseTo(16 / 9, 6);
    expect(videoRatio({ videoWidth: 0, videoHeight: 0 })).toBeNull();
  });

  it("before it loads, is 16:9 for a landscape stored size and 9:16, as always, for any other", () => {
    expect(videoAspectClass({ width: 1920, height: 1080 })).toBe("aspect-video");
    expect(videoAspectClass({ width: 1080, height: 1920 })).toBe("aspect-[9/16]");
    expect(videoAspectClass({ width: 1080, height: 1080 })).toBe("aspect-[9/16]");
    expect(videoAspectClass(null)).toBe("aspect-[9/16]");
  });
});

describe("VideoFrame", () => {
  it("has the given shape until the video loads, then the video's own", () => {
    const { container } = render(<VideoFrame src="https://example.test/v.mp4" fallback="aspect-[9/16]" video={{ muted: true }} />);
    const frame = container.querySelector("[data-video-frame]") as HTMLElement;
    expect(frame.className).toContain("aspect-[9/16]");
    loadVideo(container.querySelector("video")!, 1920, 1080);
    expect(frame.className).not.toContain("aspect-[9/16]");
    expect(Number(frame.style.aspectRatio)).toBeCloseTo(16 / 9, 6);
    expect(frame.hasAttribute("data-wide")).toBe(true);
  });

  it("keeps the frame it always had for a vertical video", () => {
    const { container } = render(<VideoFrame src="https://example.test/v.mp4" fallback="aspect-[4/5]" className="rounded-[8px]" />);
    const frame = container.querySelector("[data-video-frame]") as HTMLElement;
    loadVideo(container.querySelector("video")!, 1080, 1920);
    expect(frame.className).toBe("aspect-[4/5] rounded-[8px]");
    expect(frame.getAttribute("style")).toBeNull();
    expect(frame.hasAttribute("data-wide")).toBe(false);
  });
});
