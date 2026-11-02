/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrendInsightsSection } from "@/components/analytics/TrendInsightsSection";

// Analytics "Trend insights": the weekly themes a client's industry produced,
// each with its example posts, read through trend_themes_in_range. Clients
// read them with measured figures and no way to dismiss; staff see the score
// and can dismiss a theme, which comes off the list at once.

const f = vi.hoisted(() => ({ staff: false, themes: [] as any[], collected: true, rpcs: [] as any[], loadFails: false, dismissFails: false }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: f.staff }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args: any) => {
      f.rpcs.push({ name, ...args });
      if (name === "trend_themes_in_range") {
        return f.loadFails
          ? { data: null, error: { message: 'permission denied for function trend_themes_in_range', code: "42501" } }
          : { data: { collected: f.collected, themes: f.themes }, error: null };
      }
      if (name === "trend_theme_dismiss") {
        if (f.dismissFails) return { data: null, error: { message: "Only Moburst staff can dismiss a trend.", code: "42501" } };
        f.themes = f.themes.filter((t) => t.id !== args.p_theme);
        return { data: null, error: null };
      }
      return { data: null, error: { message: "unexpected call", code: "XX000" } };
    },
  },
}));
import { toast } from "sonner";

const post = (over: Record<string, unknown> = {}) => ({
  platform: "tiktok", url: "https://www.tiktok.com/@benchpro/video/1", author: "@benchpro", text: "POV: you are the captain and nobody RSVPs",
  posted_at: "2026-10-24T15:00:00Z", format: "short_video", views: 120000, likes: 1000, comments: 200, shares: 50, saves: 40, engagement: null, ...over,
});
const carousel = post({
  platform: "instagram", url: "https://www.instagram.com/p/abc/", author: "@leaguelife", text: "Save this lineup template for Sunday",
  format: "carousel", views: 0, likes: 900, comments: 30, shares: 120, engagement: null,
});
const themes = () => [
  {
    id: "t1", week_start: "2026-10-26", title: "Captain POV skits", happening: "Creators act out the group chat captain nobody answers.",
    why_it_matters: "Captains are the ones who sign a team up.", angle: "Show a captain chasing RSVPs the night before a game.",
    platforms: ["tiktok"], posts: [post()],
  },
  {
    id: "t2", week_start: "2026-10-26", title: "Lineup templates as carousels", happening: "Swipeable lineup cards are saved before game day.",
    why_it_matters: "Saves signal a tool people reuse.", angle: "Publish a printable lineup carousel.",
    platforms: ["instagram"], posts: [carousel],
  },
  {
    id: "t3", week_start: "2026-10-19", title: "Rain-out recovery", happening: "Coaches share how they rebook a rained-out game.",
    why_it_matters: "Rain-outs are the busiest week for the app.", angle: "Walk through a rebook in three taps.",
    platforms: ["tiktok", "instagram"],
    posts: [
      post({ url: "https://www.tiktok.com/@coachk/video/9", author: "@coachk", text: "Rebooked in 30 seconds", likes: 10, comments: 2, shares: 1 }),
      post({ platform: "instagram", url: "https://www.instagram.com/p/rain/", author: "@rainproof", text: "Rain check checklist", format: "image", likes: 7, comments: 1, shares: 0 }),
    ],
  },
];

let qc: QueryClient;
function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TrendInsightsSection clientId="c1" from="2026-10-01" to="2026-10-31" />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  f.staff = false; f.themes = themes(); f.collected = true; f.rpcs = []; f.loadFails = false; f.dismissFails = false;
  vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear();
});
afterEach(() => { cleanup(); qc?.clear(); });

describe("TrendInsightsSection", () => {
  it("shows each week's themes with what is happening, why it matters, the angle and the example posts", async () => {
    mount();
    expect(await screen.findByText("Captain POV skits")).toBeInTheDocument();
    expect(f.rpcs[0]).toEqual({ name: "trend_themes_in_range", p_client: "c1", p_from: "2026-10-01", p_to: "2026-10-31" });
    expect(screen.getByText("Creators act out the group chat captain nobody answers.")).toBeInTheDocument();
    expect(screen.getByText("Captains are the ones who sign a team up.")).toBeInTheDocument();
    expect(screen.getByText("Show a captain chasing RSVPs the night before a game.")).toBeInTheDocument();
    // The newest week first, each week under its own heading.
    const weeks = screen.getAllByRole("heading", { name: /^Week of / }).map((h) => h.textContent);
    expect(weeks).toEqual(["Week of Oct 26, 2026", "Week of Oct 19, 2026"]);
    // An example post: who, what kind, the words, and a link that opens the post itself.
    expect(screen.getByText(/POV: you are the captain and nobody RSVPs/)).toBeInTheDocument();
    expect(screen.getAllByText(/@benchpro/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Short video/).length).toBeGreaterThan(0);
    const views = screen.getAllByRole("link", { name: /View/ }).map((a) => a.getAttribute("href"));
    expect(views).toContain("https://www.tiktok.com/@benchpro/video/1");
    expect(screen.getAllByRole("link", { name: /View/ })[0]).toHaveAttribute("target", "_blank");
    expect(screen.getAllByRole("link", { name: /View/ })[0].getAttribute("rel")).toMatch(/noopener/);
  });

  it("shows a client the measured engagements (likes, comments and shares), never the weighted score", async () => {
    // Even if an answer carried the weighted score, a client's screen does not show it.
    f.themes[0].posts[0].engagement = 987654;
    mount();
    await screen.findByText("Captain POV skits");
    expect(screen.getByText("1,250 engagements")).toBeInTheDocument();
    expect(screen.getByText("1,050 engagements")).toBeInTheDocument();
    expect(screen.queryByText(/987,654/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Score/)).not.toBeInTheDocument();
  });

  it("shows staff the weighted score instead", async () => {
    f.staff = true;
    f.themes[0].posts[0].engagement = 5400;
    mount();
    await screen.findByText("Captain POV skits");
    expect(screen.getByText("Score: 5,400")).toBeInTheDocument();
    expect(screen.queryByText("1,250 engagements")).not.toBeInTheDocument();
  });

  it("filters by platform: only themes and posts on the chosen platform stay", async () => {
    mount();
    await screen.findByText("Captain POV skits");
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "TikTok" }));
    expect(screen.getByText("Captain POV skits")).toBeInTheDocument();
    expect(screen.queryByText("Lineup templates as carousels")).not.toBeInTheDocument();
    expect(screen.queryByText(/Save this lineup template/)).not.toBeInTheDocument();
    // A theme on both platforms stays, with only its TikTok post.
    expect(screen.getByText("Rain-out recovery")).toBeInTheDocument();
    expect(screen.getByText(/Rebooked in 30 seconds/)).toBeInTheDocument();
    expect(screen.queryByText(/Rain check checklist/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Instagram" }));
    expect(screen.queryByText("Captain POV skits")).not.toBeInTheDocument();
    expect(screen.getByText("Lineup templates as carousels")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Captain POV skits")).toBeInTheDocument();
    expect(screen.getByText("Lineup templates as carousels")).toBeInTheDocument();
  });

  it("offers no filter when every theme is on one platform", async () => {
    f.themes = [f.themes[0]];
    mount();
    await screen.findByText("Captain POV skits");
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
  });

  it("gives a client no Dismiss", async () => {
    mount();
    await screen.findByText("Captain POV skits");
    expect(screen.queryByRole("button", { name: /Dismiss/ })).not.toBeInTheDocument();
  });

  it("lets staff dismiss a theme after a confirm: the answer is asked for again and the theme is gone", async () => {
    f.staff = true;
    mount();
    await screen.findByText("Captain POV skits");
    const card = screen.getByRole("article", { name: "Captain POV skits" });
    fireEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
    // Nothing is sent before the question is answered.
    expect(f.rpcs.some((r) => r.name === "trend_theme_dismiss")).toBe(false);
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(f.rpcs.filter((r) => r.name === "trend_theme_dismiss")).toEqual([{ name: "trend_theme_dismiss", p_theme: "t1" }]));
    await waitFor(() => expect(screen.queryByText("Captain POV skits")).not.toBeInTheDocument());
    expect(f.rpcs.filter((r) => r.name === "trend_themes_in_range").length).toBeGreaterThanOrEqual(2);
    expect(toast.success).toHaveBeenCalledWith("Dismissed. Next week's trends will leave it out.");
    expect(screen.getByText("Lineup templates as carousels")).toBeInTheDocument();
  });

  it("keeps a theme that was not dismissed, with no failure message: the list shows the true state", async () => {
    f.staff = true;
    f.dismissFails = true;
    // The team's console gets the cause; the screen gets no failure copy.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mount();
    await screen.findByText("Captain POV skits");
    fireEvent.click(within(screen.getByRole("article", { name: "Captain POV skits" })).getByRole("button", { name: "Dismiss" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(f.rpcs.filter((r) => r.name === "trend_theme_dismiss")).toHaveLength(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText("Captain POV skits")).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("says trends start after the first weekly collection when none has been collected", async () => {
    f.themes = [];
    f.collected = false;
    mount();
    expect(await screen.findByText("Trends show here after the first weekly collection.")).toBeInTheDocument();
    expect(screen.queryByText("No trends in this period.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
  });

  it("says no trends fall in the period when weeks were collected but none lands in it", async () => {
    f.themes = [];
    f.collected = true;
    mount();
    expect(await screen.findByText("No trends in this period.")).toBeInTheDocument();
    expect(screen.queryByText(/first weekly collection/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "All" })).not.toBeInTheDocument();
  });

  it("keeps loading quietly when the themes do not load, and fills in when a try answers", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      f.loadFails = true;
      const { container } = mount();
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(screen.getByRole("status")).toHaveTextContent("Loading trends");
      // No claim about the client's trends, no failure copy and nothing raw.
      expect(container.textContent).not.toMatch(/permission|denied|42501|trend_themes_in_range|function|could not|try again|refresh/i);
      expect(screen.queryByText("Trends show here after the first weekly collection.")).not.toBeInTheDocument();
      f.loadFails = false;
      // The first of the page's own tries comes after 3 seconds.
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(screen.getByText("Captain POV skits")).toBeInTheDocument();
      expect(f.rpcs.filter((r) => r.name === "trend_themes_in_range").length).toBeGreaterThanOrEqual(2);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("links only to web addresses and never writes a dash as punctuation", async () => {
    f.themes[0].posts[0].url = "javascript:alert(1)";
    const { container } = mount();
    await screen.findByText("Captain POV skits");
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(container.textContent).not.toMatch(/[—–]| - /);
  });

  it("shows a theme that has no kept posts without an empty list", async () => {
    f.themes[0].posts = [];
    mount();
    expect(await screen.findByText("Captain POV skits")).toBeInTheDocument();
    expect(screen.getByText("Creators act out the group chat captain nobody answers.")).toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Captain POV skits" });
    expect(within(card).queryByText("Example posts")).not.toBeInTheDocument();
  });
});
