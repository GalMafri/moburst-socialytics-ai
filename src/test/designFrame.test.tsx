// A design is drawn in the size its platform is uploaded in, so the frame
// around it takes the picture's own shape once it has loaded: 4:5 for an
// Instagram post, square for LinkedIn, wide for X. Until then it has the
// shape it was given.
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { DesignFrame } from "@/components/calendar/DesignFrame";
import { naturalRatio } from "@/lib/naturalRatio";

afterEach(cleanup);

/** The picture loads with this natural size. */
function load(img: HTMLImageElement, width: number, height: number) {
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: height });
  fireEvent.load(img);
}

describe("a loaded picture's shape", () => {
  it("is its width over its height, and nothing for a picture with no size", () => {
    expect(naturalRatio({ naturalWidth: 1200, naturalHeight: 1200 })).toBe(1);
    expect(naturalRatio({ naturalWidth: 1080, naturalHeight: 1350 })).toBe(0.8);
    expect(naturalRatio({ naturalWidth: 0, naturalHeight: 0 })).toBeNull();
  });
});

describe("DesignFrame", () => {
  it("has the given shape until the picture loads, then the picture's own", () => {
    const { container } = render(<DesignFrame src="https://example.test/a.png" fallback="aspect-[4/5]" className="rounded-[8px]" />);
    const frame = container.querySelector("[data-design-frame]") as HTMLElement;
    const img = container.querySelector("img") as HTMLImageElement;
    expect(frame.className).toContain("aspect-[4/5]");
    expect(frame.style.aspectRatio || "").toBe("");
    expect(img.className).toContain("object-contain");

    load(img, 1600, 900);
    expect(frame.className).not.toContain("aspect-[4/5]");
    expect(frame.className).toContain("rounded-[8px]");
    expect(Number(frame.style.aspectRatio)).toBeCloseTo(16 / 9, 6);
  });

  it("follows the picture when another one takes its place", () => {
    const { container, rerender } = render(<DesignFrame src="https://example.test/a.png" fallback="aspect-[4/5]" />);
    const frame = container.querySelector("[data-design-frame]") as HTMLElement;
    load(container.querySelector("img") as HTMLImageElement, 1080, 1350);
    expect(Number(frame.style.aspectRatio)).toBeCloseTo(0.8, 6);
    rerender(<DesignFrame src="https://example.test/b.png" fallback="aspect-[4/5]" />);
    load(container.querySelector("img") as HTMLImageElement, 1200, 1200);
    expect(Number(frame.style.aspectRatio)).toBe(1);
  });

  it("keeps the given shape for a picture that reports no size", () => {
    const { container } = render(<DesignFrame src="https://example.test/a.png" fallback="aspect-[9/16]" />);
    load(container.querySelector("img") as HTMLImageElement, 0, 0);
    expect((container.querySelector("[data-design-frame]") as HTMLElement).className).toContain("aspect-[9/16]");
  });
});
