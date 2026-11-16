import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditButton, type SectionEditor } from "@/components/strategy/StrategySection";

const editor = (fields: unknown[]) => ({ fields, start: vi.fn() }) as unknown as SectionEditor;

describe("strategy edit button", () => {
  // The app's one icon-button size (icon-sm, 36 px), never a hand-written size.
  it("has the standard icon-button size", () => {
    render(<EditButton e={editor([{}])} label="audience" />);
    const button = screen.getByRole("button", { name: "Edit audience" });
    expect(button.className).toMatch(/\bh-9\b/);
    expect(button.className).toMatch(/\bw-9\b/);
    expect(button.className).not.toMatch(/\bh-8\b|\bw-8\b/);
  });
  it("shows nothing for a card with no fields to edit", () => {
    const { container } = render(<EditButton e={editor([])} label="audience" />);
    expect(container.firstChild).toBeNull();
  });
});
