/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientOverview } from "@/components/dashboard/ClientOverview";

const f = vi.hoisted(() => ({
  competitive: [] as any[],
  posts: [] as any[],
  iterationRows: 0,
  iterationError: false,
  iterationRanges: [] as Array<[number, number]>,
}));

vi.mock("@/lib/openTopics", () => ({ fetchOpenTopics: async () => [] }));
vi.mock("@/lib/nextRun", () => ({ fetchNextRun: async () => null }));
vi.mock("../../supabase/functions/_shared/reports/shownFields", () => ({ readShownInsights: async () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({
  buildCompetitiveContext: () => ({ share_of_voice_pct: 31, competitors: [{ name: "Rival" }], benchmark_dimensions: [] }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const q: any = {};
      for (const m of ["select", "eq", "is", "not", "gte", "order", "limit"]) q[m] = () => q;
      q.range = (from: number, to: number) => { q.window = [from, to]; if (table === "post_iterations") f.iterationRanges.push([from, to]); return q; };
      q.maybeSingle = async () => ({
        data: table === "clients" ? { id: "c", name: "Alpha", timezone: "UTC" }
          : table === "reports" ? { id: "r1", date_range_start: "2026-10-01", date_range_end: "2026-10-31", created_at: "2026-11-02T00:00:00Z",
            report_data: [{ sprout_performance: { month_comparison: { changes: { impressions: { current: 1969952, previous: 1000000, percent: 97 }, shares: { current: 2, previous: 0, percent: null } } } } }] }
          : null,
        error: null,
      });
      q.then = (ok: any, no: any) => Promise.resolve({
        data: table === "competitive_reports" ? f.competitive.slice(...(([a, b]) => [a, b + 1])(q.window ?? [0, 999])) : table === "calendar_posts" ? f.posts
          : table === "post_iterations" ? Array.from({ length: f.iterationRows }, (_, i) => ({ calendar_post_key: `k${i}`, is_selected: false, is_approved: false, media_urls: [] })).slice(...(([a, b]) => [a, b + 1])(f.iterationRanges.at(-1) ?? [0, 999]))
          : [],
        error: table === "post_iterations" && f.iterationError ? { message: "page 1 did not answer" } : null,
      }).then(ok, no);
      return q;
    },
  },
}));

function mount() {
  return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ClientOverview clientId="c" isStaff /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => { f.competitive = []; f.posts = []; f.iterationRows = 0; f.iterationError = false; f.iterationRanges = []; });
afterEach(() => cleanup());

describe("a client's overview", () => {
  it("keeps loading when a read page does not answer, instead of removing the overview", async () => {
    f.iterationError = true;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(<QueryClientProvider client={qc}><MemoryRouter><ClientOverview clientId="c" isStaff /></MemoryRouter></QueryClientProvider>);
    await waitFor(() => expect(qc.getQueryState(["client-overview", "c", true])?.status).toBe("error"));
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByText(/Loading the overview/)).toBeInTheDocument();
    expect(screen.queryByText(/could not|failed|try again|went wrong/i)).not.toBeInTheDocument();
    // The next try answers: the overview fills in.
    f.iterationError = false;
    await qc.refetchQueries({ queryKey: ["client-overview"] });
    expect(await screen.findByText("Performance")).toBeInTheDocument();
  });

  it("lays its tiles out in a grid that wraps instead of three squeezed columns", async () => {
    mount();
    const tile = (await screen.findByText("Performance")).closest("section")!;
    const grid = tile.parentElement!;
    expect(grid.className).not.toContain("md:grid-cols-3");
    expect(grid.getAttribute("style")).toMatch(/auto-fit/);
    // The figures inside a tile wrap the same way.
    expect(tile.querySelector("[style*='auto-fit']")).not.toBeNull();
  });

  it("names the competitor figure as the report pages do, and links the newest ready report when a newer one is held", async () => {
    f.competitive = [
      { id: "held", created_at: "2026-11-05T00:00:00Z", report_data: { provider_status: 0 } },
      { id: "ready", created_at: "2026-10-05T00:00:00Z", report_data: {} },
    ];
    mount();
    expect(await screen.findByText("share of voice")).toBeInTheDocument();
    expect(screen.queryByText(/share of the posts/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the competitive report/ })).toHaveAttribute("href", "/clients/c/competitive/reports/ready");
  });

  it("finds the ready report behind any number of held ones, reading only as many rows as it needs", async () => {
    f.competitive = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `held${i}`, created_at: `2026-11-${String(20 - i).padStart(2, "0")}T00:00:00Z`, report_data: { provider_status: 0 } })),
      { id: "ready", created_at: "2026-10-05T00:00:00Z", report_data: {} },
    ];
    mount();
    expect(await screen.findByRole("link", { name: /Open the competitive report/ })).toHaveAttribute("href", "/clients/c/competitive/reports/ready");
  });

  it("shows the report's period short, a compact figure with two decimals from a million, and counts every measure with a previous value", async () => {
    mount();
    expect(await screen.findByText("Oct 2026 vs. the month before")).toBeInTheDocument();
    expect(screen.getByText("1.97M")).toBeInTheDocument();
    expect(screen.getByText("2 of 2 measures rose.")).toBeInTheDocument();
  });

  it("counts the week's posts and Stories apart, as the calendar does", async () => {
    const day = new Date().toISOString().slice(0, 10);
    f.posts = [
      { id: "1", post_key: "a", post_date: day, platform: "Instagram", source: "plan", copy: "x", format: "post" },
      { id: "2", post_key: "b", post_date: day, platform: "Instagram", source: "plan", copy: "x", format: "story" },
    ];
    mount();
    expect(await screen.findByText("1 post and 1 Story this week")).toBeInTheDocument();
  });

  it("reads every design page by page, not just the first thousand", async () => {
    f.iterationRows = 2300;
    mount();
    await screen.findByText("Performance");
    expect(f.iterationRanges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
});
