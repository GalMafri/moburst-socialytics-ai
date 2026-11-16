import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
import { PostVisual } from "@/components/competitive/PostVisual";

afterEach(() => cleanup());

// A compact tile is the small side thumbnail on Analytics and the report. When no
// creative could be had it says so in two words, so a grey square is not a mystery.
it("a compact tile with no source says No image", () => {
  render(<PostVisual url="https://www.linkedin.com/feed/update/1" platform="linkedin" compact />);
  expect(screen.getByText("No image")).toBeTruthy();
});

it("a full tile with no source names the platform", () => {
  render(<PostVisual url="https://www.linkedin.com/feed/update/1" platform="linkedin" />);
  expect(screen.getByText(/No preview from LinkedIn/)).toBeTruthy();
});

it("a compact tile is the documented square, a full tile the 4:5 frame, and a caller's frame wins", () => {
  const { container, rerender } = render(<PostVisual url="https://x.test/1" compact />);
  expect(container.querySelector("[data-post-visual]")!.className).toContain("aspect-square");
  rerender(<PostVisual url="https://x.test/1" />);
  expect(container.querySelector("[data-post-visual]")!.className).toContain("aspect-[4/5]");
  rerender(<PostVisual url="https://x.test/1" compact frame="aspect-video" />);
  expect(container.querySelector("[data-post-visual]")!.className).toContain("aspect-video");
});

// The report's small tile is 64px square. The placeholder there is the label alone,
// on one line, with no large icon that would collide with the type pill.
it("a 64px compact tile with no source holds the label only, on one line", () => {
  const { container } = render(<PostVisual url="https://x.test/1" compact className="w-16" />);
  const ph = container.querySelector("[data-post-placeholder]")!;
  expect(ph.textContent).toBe("No image");
  // 13px type is about 6.5px a character: eight characters sit inside 64px, where "No preview" (about 65px) did not.
  expect(ph.textContent!.length * 6.5).toBeLessThan(64);
  expect(ph.querySelector("svg")).toBeNull();
  expect(ph.querySelector("span")!.className).toContain("t-label");
  expect(ph.querySelector("span")!.className).toContain("truncate");
  expect(container.querySelector("[data-post-visual]")!.className).toContain("aspect-square");
});
