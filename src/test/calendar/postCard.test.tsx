// The calendar cards: no button inside another, and the format badge in the
// shared words (formatLabel), never the planner's raw text.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PostCard } from "@/components/reports/calendar/PostCard";

vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isLoading: false, isAuthenticated: true, isMoburstStaff: true, isClient: false, isAdmin: false }) }));

const feed = { platform: "LinkedIn", format: "video (animated text on soft designed background)", language: "en", posting_time: "18:45", copy: "Three things we changed in our paid social bidding this quarter.", pillar: "Thought leadership" };
const story = { platform: "Instagram", format: "Story", posting_time: "09:00", copy: "A message for the Story.", _storyFollows: true };
const designed = { id: "it-1", media_urls: ["https://x.test/a.png"], is_selected: true, is_approved: false };

afterEach(cleanup);

const nested = (root: HTMLElement) => Array.from(root.querySelectorAll("button")).filter((b) => b.parentElement?.closest("button"));

describe("a calendar card", () => {
  for (const [name, post, status] of [["a feed post", feed, "designed"], ["an approved feed post", feed, "approved"], ["a Story", story, "designed"]] as const) {
    it(`has no button inside a button, for ${name}`, () => {
      const { container } = render(<PostCard post={post} iteration={designed} status={status} onOpen={() => {}} onToggleApproved={() => {}} />);
      expect(nested(container)).toEqual([]);
      // The status chip is still a button of its own, beside the one that opens the post.
      expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(2);
    });
  }

  it("opens the post from the card and flips approval from the chip without opening it", () => {
    const onOpen = vi.fn();
    const onToggleApproved = vi.fn();
    render(<PostCard post={feed} iteration={designed} status="designed" onOpen={onOpen} onToggleApproved={onToggleApproved} />);
    fireEvent.click(screen.getByRole("button", { name: "Mark as approved" }));
    expect(onToggleApproved).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Open post/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("lets a click on a chip that is no button open the post, and gives clicks only to the chip button", () => {
    const takesClicks = (el: Element) => !!el.closest(".pointer-events-auto");
    // A draft's chip is a plain badge: it sits in the click-through layer.
    const { unmount } = render(<PostCard post={feed} iteration={null} status="draft" onOpen={() => {}} onToggleApproved={() => {}} />);
    expect(takesClicks(screen.getByText("Draft"))).toBe(false);
    unmount();
    render(<PostCard post={feed} iteration={designed} status="designed" onOpen={() => {}} onToggleApproved={() => {}} />);
    expect(takesClicks(screen.getByRole("button", { name: "Mark as approved" }))).toBe(true);
  });

  it("lets a click on a Story card's plain chip open the Story", () => {
    const takesClicks = (el: Element) => !!el.closest(".pointer-events-auto");
    render(<PostCard post={story} iteration={null} status="draft" onOpen={() => {}} onToggleApproved={() => {}} />);
    expect(takesClicks(screen.getByText("Draft"))).toBe(false);
  });

  it("says on the card, for staff, that Sprout did not confirm a send", () => {
    render(<PostCard post={feed} iteration={designed} status="scheduled" sendState="unconfirmed" onOpen={() => {}} />);
    expect(screen.getByText("Not confirmed by Sprout")).toBeTruthy();
    expect(screen.queryByText("Draft in Sprout")).toBeNull();
  });

  it("shows the format in the shared label, not the planner's raw text", () => {
    render(<PostCard post={feed} iteration={null} status="draft" onOpen={() => {}} />);
    expect(screen.queryByText(/animated text/)).toBeNull();
    expect(screen.getByText("Video")).toBeTruthy();
  });
});
