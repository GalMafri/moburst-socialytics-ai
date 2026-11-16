import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeWeeks } from "@/components/trends/TrendThemes";
import type { TrendTheme } from "@/hooks/useTrendThemes";

const theme: TrendTheme = {
  id: "t1", week_start: "2026-11-02", title: "Quiet launches", happening: "Brands ship without a countdown.", why_it_matters: "Less noise.", angle: "Show the product first.",
  platforms: ["instagram"],
  posts: [{ id: "p1", platform: "instagram", author: "a", text: "A post", url: "https://example.com/p", likes: 3, comments: 0, shares: 0, views: 0, format: "image", posted_at: "2026-11-03T10:00:00Z" } as any],
};

describe("theme cards", () => {
  it("link to the post as View original, in sentence case", () => {
    render(<ThemeWeeks themes={[theme]} staff={false} />);
    expect(screen.getByRole("link", { name: "View original" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/View Original/);
  });
  it("show Dismiss to staff only where a dismiss action is given", () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<ThemeWeeks themes={[theme]} staff={false} onDismiss={onDismiss} />);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    unmount();
    const second = render(<ThemeWeeks themes={[theme]} staff={true} />);
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    second.unmount();
    render(<ThemeWeeks themes={[theme]} staff={true} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith(theme);
  });
});
