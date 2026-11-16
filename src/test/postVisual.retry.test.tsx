import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
import { PostVisual } from "@/components/competitive/PostVisual";

// Storage throttles a page that asks for many pictures at once; the same picture loads a moment later.
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

// The waits before each of the three tries, in PostVisual.
const RETRY_WAITS_MS = [800, 2000, 4500];
const sharp = (c: HTMLElement) => c.querySelector("img[loading='lazy']") as HTMLImageElement | null;

it("an image that errors once then loads renders the image", () => {
  const { container } = render(<PostVisual url="https://x.test/1" image="https://cdn.test/a.jpg" />);
  const first = sharp(container)!;
  fireEvent.error(first);
  act(() => { vi.advanceTimersByTime(5000); });
  const img = sharp(container);
  expect(img).not.toBeNull();
  expect(img).not.toBe(first);
  expect(img!.getAttribute("src")).toBe("https://cdn.test/a.jpg");
  fireEvent.load(img!);
  expect(container.textContent).not.toContain("No preview");
});

it("shows the labelled placeholder during the wait, never a blank tile, and clears it when the picture loads", () => {
  const { container } = render(<PostVisual url="https://x.test/1" image="https://cdn.test/a.jpg" />);
  expect(container.textContent).not.toContain("No preview");
  fireEvent.error(sharp(container)!);
  expect(container.textContent).toContain("No preview");
  act(() => { vi.advanceTimersByTime(800); });
  expect(container.textContent).toContain("No preview");
  fireEvent.load(sharp(container)!);
  expect(container.textContent).not.toContain("No preview");
});

it("the blurred backdrop reloads together with the picture after a retry", () => {
  const { container } = render(<PostVisual url="https://x.test/1" image="https://cdn.test/a.jpg" />);
  const backdrop = () => container.querySelector("img[aria-hidden]") as HTMLImageElement;
  const first = backdrop();
  fireEvent.error(sharp(container)!);
  act(() => { vi.advanceTimersByTime(800); });
  expect(backdrop()).not.toBe(first);
});

it("tries the same source three times with growing waits, then hands over to the placeholder", () => {
  const { container } = render(<PostVisual url="https://x.test/1" image="https://cdn.test/a.jpg" />);
  for (const wait of RETRY_WAITS_MS) {
    const before = sharp(container)!;
    fireEvent.error(before);
    act(() => { vi.advanceTimersByTime(wait - 1); });
    expect(sharp(container)).toBe(before);
    act(() => { vi.advanceTimersByTime(1); });
    expect(sharp(container)).not.toBe(before);
    expect(sharp(container)!.getAttribute("src")).toBe("https://cdn.test/a.jpg");
  }
  expect(RETRY_WAITS_MS[1]).toBeGreaterThan(RETRY_WAITS_MS[0]);
  expect(RETRY_WAITS_MS[2]).toBeGreaterThan(RETRY_WAITS_MS[1]);
  fireEvent.error(sharp(container)!);
  expect(sharp(container)).toBeNull();
  expect(container.textContent).toContain("No preview");
});

it("a source that keeps failing hands over to the next one only after its tries", () => {
  const { container } = render(<PostVisual url="https://x.test/1" preview={{ url: "u", platform: null, media_type: null, image_url: "https://store.test/a.jpg", title: null, status: "ok" }} image="https://cdn.test/b.jpg" />);
  for (let i = 0; i < 3; i++) { fireEvent.error(sharp(container)!); act(() => { vi.advanceTimersByTime(20000); }); expect(sharp(container)!.getAttribute("src")).toBe("https://store.test/a.jpg"); }
  fireEvent.error(sharp(container)!);
  act(() => { vi.advanceTimersByTime(20000); });
  expect(sharp(container)!.getAttribute("src")).toBe("https://cdn.test/b.jpg");
});
