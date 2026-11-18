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

describe("example posts", () => {
  const post = (n: number) => ({ id: `p${n}`, platform: "youtube", author: `author${n}`, text: `Post ${n}`, url: `https://example.com/${n}`, likes: 0, comments: 0, shares: 0, views: 1200, format: "long_video", posted_at: "2026-11-03T10:00:00Z" }) as any;
  const many: TrendTheme = { ...theme, id: "t2", posts: [1, 2, 3, 4, 5, 6, 7].map(post) };

  it("lists five, then all of them on Show all, and back", () => {
    render(<ThemeWeeks themes={[many]} staff={false} />);
    const shown = () => screen.getAllByRole("listitem").filter((li) => !li.classList.contains("hidden")).length;
    expect(shown()).toBe(5);
    fireEvent.click(screen.getByRole("button", { name: "Show all 7 posts" }));
    expect(shown()).toBe(7);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer posts" }));
    expect(shown()).toBe(5);
  });

  it("keeps the folded posts in the page for the PDF, marked to print", () => {
    render(<ThemeWeeks themes={[many]} staff={false} />);
    const folded = screen.getAllByRole("listitem").filter((li) => li.classList.contains("hidden"));
    expect(folded).toHaveLength(2);
    folded.forEach((li) => expect(li.getAttribute("data-print-show")).toBe("true"));
  });

  it("leaves a figure the platform does not give empty, never a misleading 0", () => {
    render(<ThemeWeeks themes={[{ ...theme, id: "t3", posts: [post(1)] }]} staff={false} />);
    const row = screen.getAllByRole("listitem")[0];
    expect(row.textContent).toContain("1.2K");
    expect(row.textContent).not.toMatch(/(^|\s)0(\s|$)/);
    expect(row.querySelector('[aria-label="likes not available"]')).not.toBeNull();
  });
});
