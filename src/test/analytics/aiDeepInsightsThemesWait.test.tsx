/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P05-3): Analytics "Across the reports in this window" holds the
// Recommendations tile on a spinner for as long as the trend-themes read does
// not answer. The report page stops waiting after THEME_WAIT_MS (15 s) and
// shows the report's own figures; this tile has no such wait-out, so a read
// that keeps failing leaves it spinning for good.
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AIDeepInsights } from "@/components/analytics/AIDeepInsights";
import { THEME_WAIT_MS } from "@/hooks/useTrendThemes";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: null, error: { message: "upstream timeout", code: "57014" } }) },
}));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const reports = [{ id: "oct", client_id: "c1", date_range_start: "2026-10-01", date_range_end: "2026-10-31", report_data: { ai_analysis: { tiktok_trends_analysis: { opportunities_for_client: ["a", "b"] } } } }];
const chartData = [{ date: "Oct 31", impressions: 200, reactions: 2, link_clicks: 0, video_views: 0, engagements: 20, engagement_rate: 1 }];

describe("P05 AIDeepInsights waits on the themes forever", () => {
  it("shows the Recommendations count once the report page would have stopped waiting", async () => {
    vi.useFakeTimers();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><AIDeepInsights clientId="c1" reports={reports} chartData={chartData} /></QueryClientProvider>);
    await act(async () => { await vi.advanceTimersByTimeAsync(THEME_WAIT_MS * 4); });
    const tile = screen.getByText("Recommendations").closest("p")!.nextElementSibling as HTMLElement;
    expect(tile).toHaveTextContent(/\d/);
  });
});
