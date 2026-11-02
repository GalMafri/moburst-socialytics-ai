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

  it("shows Inspired by with the theme and a link to the example post", () => {
    const trend = {
      id: "N1", kind: "trend" as const, text: "POV: you are the captain and nobody RSVPs", theme: "Captain POV skits", company: "@benchpro", platform: "TikTok", format: "short_video",
      date: "2026-10-14", link: "https://t/1", metric: "engagement", value: 5400,
    };
    render(<PostReason reasons={[{ type: "trend", label: "Old label", fit: "Captains live this every week.", evidence: [trend], test: false }]} />);
    expect(screen.getByText(`Inspired by "Captain POV skits": @benchpro's TikTok short video from Oct 14. Captains live this every week.`)).toBeInTheDocument();
    expect(screen.getByText(`"POV: you are the captain and nobody RSVPs"`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View the post/ })).toHaveAttribute("href", "https://t/1");
    // The sentence already names who posted what and when; the list doesn't say it a second time, and shows no raw format name.
    expect(screen.queryByText(/short_video/)).not.toBeInTheDocument();
    expect(screen.queryByText(/usual/)).not.toBeInTheDocument();
  });

  it("names the theme, author, platform and date of a trend that comes after another piece of evidence", () => {
    const trend = {
      id: "N1", kind: "trend" as const, text: "POV: you are the captain and nobody RSVPs", theme: "Captain POV skits", company: "@benchpro", platform: "TikTok", format: "short_video",
      date: "2026-10-14", link: "https://t/1", metric: "engagement", value: 5400,
    };
    render(<PostReason reasons={[{ type: "competitor", label: "Old label", fit: "Captains live this every week.", evidence: [evidence, trend], test: false }]} />);
    // The reason's sentence words the first piece of evidence only; the trend's row says what the sentence doesn't.
    expect(screen.getByText("BenchApp's Instagram video from Oct 14 got 4x their usual engagement per follower. Captains live this every week.")).toBeInTheDocument();
    expect(screen.getByText(`Inspired by "Captain POV skits": @benchpro's TikTok short video from Oct 14`)).toBeInTheDocument();
    expect(screen.getByText(`"POV: you are the captain and nobody RSVPs"`)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /View the post/ }).map((a) => a.getAttribute("href"))).toEqual(["https://c/1", "https://t/1"]);
  });

  it("still shows a trend saved before themes (monthly report wording) as it was", () => {
    render(<PostReason reasons={[{ type: "trend", label: "Old", evidence: [{ id: "N5", kind: "trend", text: "Carousel education can support clicks: Publish 1 carousel weekly." }], test: false }]} />);
    expect(screen.getByText("Trend from the monthly report: Carousel education can support clicks.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
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
