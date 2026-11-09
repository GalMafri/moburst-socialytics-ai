/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// Analytics' "Across the reports in this window" counts each report's trend
// recommendations as its report page lists them (reportTrends): the stored
// themes' angles for a report whose period has stored themes, the report's
// own TikTok and Instagram opportunities for one without. One themes read
// covers every report's period; each report keeps the weeks whose Monday
// falls inside its own. Until the read answers, nothing it changes shows.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AIDeepInsights } from "@/components/analytics/AIDeepInsights";

const f = vi.hoisted(() => ({ themes: [] as any[], hang: false, rpcs: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => {
      f.rpcs.push({ name, ...args });
      return f.hang ? new Promise(() => {}) : Promise.resolve({ data: { collected: true, themes: f.themes }, error: null });
    },
  },
}));

const theme = (id: string, week_start: string, angle: string) => ({ id, week_start, title: `Theme ${id}`, happening: "", why_it_matters: "", angle, platforms: ["tiktok"], posts: [] });
const opps = (tiktok: string[], instagram: string[]) => ({
  tiktok_trends_analysis: { opportunities_for_client: tiktok },
  instagram_trends_analysis: { opportunities_for_client: instagram },
});
// September: no stored theme starts in it. October: two stored themes start in it.
const reports = [
  { id: "sep", client_id: "c1", date_range_start: "2026-09-01", date_range_end: "2026-09-30", report_data: { ai_analysis: opps(["a"], ["b"]) } },
  { id: "oct", client_id: "c1", date_range_start: "2026-10-01", date_range_end: "2026-10-31", report_data: { ai_analysis: opps(["c", "d"], ["e"]) } },
];
const chartData = [
  { date: "Sep 30", impressions: 100, reactions: 1, link_clicks: 0, video_views: 0, engagements: 10, engagement_rate: 1 },
  { date: "Oct 31", impressions: 200, reactions: 2, link_clicks: 0, video_views: 0, engagements: 20, engagement_rate: 1 },
];

let qc: QueryClient;
function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><AIDeepInsights clientId="c1" reports={reports} chartData={chartData} /></QueryClientProvider>);
}
async function settle() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
const tile = (label: string) => screen.getByText(label).closest("p")!.nextElementSibling as HTMLElement;

beforeEach(() => {
  f.hang = false; f.rpcs = [];
  // The week of Mon 31 Aug overlaps September but is August's: it is on neither report.
  f.themes = [theme("t1", "2026-10-26", "Angle one."), theme("t2", "2026-10-12", "Angle two."), theme("t0", "2026-08-31", "Angle from August.")];
});
afterEach(() => { cleanup(); qc?.clear(); });

describe("Analytics: report trend counts", () => {
  it("reads the themes once, for the span of the reports' periods", async () => {
    mount(); await settle();
    expect(f.rpcs).toEqual([{ name: "trend_themes_in_range", p_client: "c1", p_from: "2026-09-01", p_to: "2026-10-31" }]);
  });

  it("counts each report's trend recommendations as its page lists them", async () => {
    mount();
    // September: its own 2 opportunities. October: its 2 themes' angles, not its own 3 opportunities.
    await waitFor(() => expect(tile("Recommendations")).toHaveTextContent("4"));
    expect(screen.getByText("Industry trends · 1 report")).toBeInTheDocument();
    expect(screen.getByText("TikTok · 1 report")).toBeInTheDocument();
    expect(screen.getByText("Instagram · 1 report")).toBeInTheDocument();
  });

  it("holds the figures the themes change until they are read", async () => {
    f.hang = true;
    mount(); await settle();
    expect(tile("Recommendations")).not.toHaveTextContent(/\d/);
    expect(screen.queryByText(/TikTok ·|Instagram ·|Industry trends ·/)).not.toBeInTheDocument();
    expect(screen.getByText("Peak impressions")).toBeInTheDocument();
  });
});
