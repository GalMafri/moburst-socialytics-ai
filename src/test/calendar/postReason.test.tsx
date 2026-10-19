import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PostReason } from "@/components/calendar/PostReason";
import type { PostReason as Reason } from "@/lib/calendarPosts";

afterEach(cleanup);

const evidence = { id: "C1", kind: "competitor" as const, text: "Captain meme", company: "BenchApp", platform: "Instagram", format: "video", date: "2026-10-14", link: "https://c/1", metric: "engagement per follower", multiple: 4, sample: 9 };

describe("PostReason", () => {
  it("words a planned post's reason from its stored parts, not its saved label", () => {
    const reason: Reason = { type: "competitor", label: "An older wording with C1 in it.", fit: "Captains live this every week.", evidence: [evidence], test: false };
    render(<PostReason reasons={[reason]} />);
    expect(screen.getByText("BenchApp's Instagram video from Oct 14 got 4x their usual engagement per follower. Captains live this every week.")).toBeInTheDocument();
    expect(screen.queryByText(/older wording/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View the post/ })).toHaveAttribute("href", "https://c/1");
  });

  it("words a seasonal post from its moment", () => {
    render(<PostReason reasons={[{ type: "seasonal", label: "Old", moment: "Halloween on Oct 31", fit: "Fits the team.", test: false }]} />);
    expect(screen.getByText("Halloween on Oct 31. Fits the team.")).toBeInTheDocument();
  });

  it("shows the saved label for a reason without its parts, and nothing without a reason", () => {
    render(<PostReason reasons={[{ type: "competitor", label: "From the competitor feed: playoff reminders" }]} />);
    expect(screen.getByText("From the competitor feed: playoff reminders")).toBeInTheDocument();
    cleanup();
    expect(render(<PostReason reasons={[]} />).container).toBeEmptyDOMElement();
  });
});
