/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// The monthly report's trends (Trends plan, Task 15; design
// docs/superpowers/specs/2026-10-28-trends-redesign-design.md, "Monthly
// report", Lital's option A): a report whose period has stored weekly themes
// shows one "Industry trends" section built from them, whichever engine wrote
// it, and its own TikTok and Instagram trends are not shown; "Where to act
// next" and Weekly highlights take their trend items from the themes' angles.
// A report's weeks are those whose Monday falls inside its period (one rule
// with the API and the in-app report). A report with no stored theme in its
// period keeps its own sections; while the themes are being read, or a read
// did not answer, every trend part stays loading and tries again quietly.
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ReportView from "@/pages/ReportView";
import { WeeklyHighlights } from "@/components/reports/calendar/WeeklyHighlights";
import { reportCounts, reportTrends, themesInPeriod } from "@/lib/reportFigures";

const f = vi.hoisted(() => ({ staff: false, report: null as any, themes: [] as any[], themesFail: false, themesHang: false, rpcs: [] as any[] }));
vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff, canRunAnalysis: f.staff, canDelete: false }) }));
vi.mock("@/hooks/useRealtimeReport", () => ({ useRealtimeReports: () => {} }));
vi.mock("@/hooks/useRealtimePostIterations", () => ({ useRealtimePostIterations: () => {} }));
vi.mock("@/hooks/useTrackView", () => ({ useTrackView: () => {} }));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock("@/hooks/useInsightFeedback", () => ({ useInsightFeedback: () => ({ verdictFor: () => null }) }));
vi.mock("@/components/competitive/PostVisual", () => ({ usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, postType: () => null }));
vi.mock("@/components/layout/AppLayout", () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock("@/components/reports/ReportActions", () => ({ ReportActions: () => null }));
vi.mock("@/components/reports/ExportPdfButton", () => ({ ExportPdfButton: () => null }));
vi.mock("@/components/reports/ReportDecks", () => ({ ReportDecks: () => null }));
vi.mock("@/components/competitive/CompetitiveSnapshot", () => ({ CompetitiveSnapshot: () => null }));
vi.mock("@/components/calendar/NewPostDialog", () => ({ NewPostDialog: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: any) => {
      f.rpcs.push({ name, ...args });
      if (f.themesHang) return new Promise(() => {});
      return Promise.resolve(f.themesFail
        ? { data: null, error: { message: "permission denied for function trend_themes_in_range", code: "42501" } }
        : { data: { collected: true, themes: f.themes }, error: null });
    },
    from: (table: string) => {
      let single = false;
      const q: any = {
        select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, range: () => q,
        maybeSingle() { single = true; return q; },
        then: (resolve: any, reject: any) => Promise.resolve({ data: table === "reports" && single ? f.report : single ? null : [], error: null, count: 0 }).then(resolve, reject),
      };
      return q;
    },
  },
}));

// Stored weekly themes for October, as trend_themes_in_range answers them: newest week first.
const post = (over: Record<string, unknown> = {}) => ({
  platform: "tiktok", url: "https://www.tiktok.com/@benchpro/video/1", author: "@benchpro", text: "POV: you are the captain and nobody RSVPs",
  posted_at: "2026-10-24T15:00:00Z", format: "short_video", views: 120000, likes: 1000, comments: 200, shares: 50, saves: 40, engagement: null, ...over,
});
const storedThemes = () => [
  {
    id: "t1", week_start: "2026-10-26", title: "Captain POV skits", happening: "Creators act out the group chat captain nobody answers.",
    why_it_matters: "Captains are the ones who sign a team up.", angle: "Show a captain chasing RSVPs the night before a game.",
    platforms: ["tiktok"], posts: [post()],
  },
  {
    id: "t2", week_start: "2026-10-19", title: "Lineup templates as carousels", happening: "Swipeable lineup cards are saved before game day.",
    why_it_matters: "Saves signal a tool people reuse.", angle: "Publish a printable lineup carousel.",
    platforms: ["instagram"],
    posts: [post({ platform: "instagram", url: "https://www.instagram.com/p/abc/", author: "@leaguelife", text: "Save this lineup template for Sunday", format: "carousel", views: 0, likes: 900, comments: 30, shares: 120 })],
  },
];

// The report's own trends, as n8n (and the in-app report before Task 16) wrote them.
const ownTrends = () => ({
  ai_analysis: {
    tiktok_trends_analysis: { overview: "TikTok overview from the report run.", opportunities_for_client: ["Old TikTok opportunity"], key_takeaways: ["Old TikTok takeaway"] },
    instagram_trends_analysis: { overview: "Instagram overview from the report run.", opportunities_for_client: ["Old Instagram opportunity"] },
  },
  tiktok_trends: { posts: [{ url: "https://www.tiktok.com/@old/video/9", author: "oldcreator", caption: "Old scraped TikTok caption", views: 5000, likes: 400, comments: 20, shares: 10, engagement_score: 54321 }] },
  instagram_trends: { posts: [{ url: "https://www.instagram.com/p/old/", author: "oldgram", caption: "Old scraped Instagram caption", likes: 300, comments: 5, engagement_score: 4321 }] },
  data_counts: { tiktok_trends: 1, instagram_trends: 1 },
});
const reportRow = (report_data: any) => ({
  id: "r1", client_id: "c1", status: "completed", report_type: "monthly", created_at: "2026-11-01T08:00:00Z",
  date_range_start: "2026-10-01", date_range_end: "2026-10-31", gamma_url: null, report_data, clients: { id: "c1", name: "Bench Co" },
});

// The client-facing words check of src/test/competitive/clientFacing.test.tsx, plus en dashes and spaced hyphens.
const banned = /\bAI\b|\b(prompts?|models?|scores?|pipelines?|gates?)\b|Socialytics -|Rival ?IQ|Sprout|Apify|—/i;
const failureWords = /permission|denied|42501|trend_themes_in_range|function|error|failed|could not|try again|refresh/i;

let qc: QueryClient;
function mount() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/clients/c1/reports/r1"]}>
        <Routes><Route path="/clients/:id/reports/:reportId" element={<ReportView />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
// The page has read what the test set up: the report always, and the themes
// unless the test keeps that read hanging or failing. A fixed number of ticks
// was not enough under the full parallel suite (9 Nov 2026).
async function settle() {
  await waitFor(() => {
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/Loading report/);
    if (!f.themesHang && !f.themesFail) expect(text).not.toMatch(/Loading (trends|recommendations)/);
  });
}
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
// What the PDF export prints: the panel without anything marked data-print="hide" (src/lib/exportPdf.ts).
function printed(el: HTMLElement) {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-print="hide"]').forEach((n) => n.remove());
  return copy.textContent ?? "";
}
// Every tab panel is in the page (for the PDF export); the one on screen is the active one.
const activePanel = () => document.querySelector<HTMLElement>('[role="tabpanel"][data-state="active"]')!;
async function openTab(name: string) {
  fireEvent.mouseDown(await screen.findByRole("tab", { name }), { button: 0, ctrlKey: false });
  await settle();
  return activePanel();
}

beforeEach(() => {
  f.staff = false; f.report = reportRow(ownTrends()); f.themes = storedThemes(); f.themesFail = false; f.themesHang = false; f.rpcs = [];
});
afterEach(() => { cleanup(); qc?.clear(); });

describe("report screen: the month's stored trends", () => {
  it("reads the stored themes for the report's own period", async () => {
    mount(); await settle();
    expect(f.rpcs).toEqual([{ name: "trend_themes_in_range", p_client: "c1", p_from: "2026-10-01", p_to: "2026-10-31" }]);
  });

  it("shows one Industry trends section from the stored themes, and not the report's own TikTok or Instagram sections", async () => {
    mount();
    const panel = await openTab("Trends");
    expect(within(panel).getByRole("heading", { name: "Industry trends" })).toBeInTheDocument();
    expect(within(panel).getByText("Captain POV skits")).toBeInTheDocument();
    expect(within(panel).getByText("Lineup templates as carousels")).toBeInTheDocument();
    expect(within(panel).getByText("Show a captain chasing RSVPs the night before a game.")).toBeInTheDocument();
    // Platform tags and the example posts behind each theme.
    expect(within(within(panel).getByRole("article", { name: "Captain POV skits" })).getByText("TikTok")).toBeInTheDocument();
    expect(within(panel).getByText(/POV: you are the captain and nobody RSVPs/)).toBeInTheDocument();
    expect(within(panel).getByText(/Save this lineup template for Sunday/)).toBeInTheDocument();
    // The report's own trend text and posts are not shown.
    expect(within(panel).queryByRole("heading", { name: /TikTok trends/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: /Instagram trends/ })).not.toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/Old scraped|overview from the report run|Old TikTok|Old Instagram/);
    // No way to dismiss a theme from a report.
    expect(within(panel).queryByRole("button", { name: /Dismiss/ })).not.toBeInTheDocument();
  });

  it("shows the report's industry trends analysis when it has one", async () => {
    f.report = reportRow({
      ...ownTrends(),
      ai_analysis: {
        industry_trends_analysis: {
          overview: "Captains drive the season's sign-ups.",
          themes: [{ title: "Captain POV skits", platforms: ["tiktok"], note: "Bench Co can play the captain everyone waits on." }],
          opportunities_for_client: ["Run a weekly captain series."],
          key_takeaways: ["Saves beat likes for templates."],
        },
      },
    });
    mount();
    const panel = await openTab("Trends");
    expect(within(panel).getByText("Captains drive the season's sign-ups.")).toBeInTheDocument();
    expect(within(panel).getByText("Bench Co can play the captain everyone waits on.")).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: /Opportunities for Bench Co/ })).toBeInTheDocument();
    expect(panel.textContent).toContain("Run a weekly captain series.");
    expect(panel.textContent).toContain("Saves beat likes for templates.");
  });

  it("keeps the TikTok and Instagram sections on a report with no stored theme in its period", async () => {
    f.themes = [];
    mount();
    const panel = await openTab("Trends");
    expect(within(panel).getByRole("heading", { name: /TikTok trends/ })).toBeInTheDocument();
    expect(within(panel).getByRole("heading", { name: /Instagram trends/ })).toBeInTheDocument();
    expect(within(panel).getByText("Old scraped TikTok caption")).toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: "Industry trends" })).not.toBeInTheDocument();
  });

  it("stays loading, with no failure text, while the themes do not answer, and fills in when a try answers", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      f.themesFail = true;
      const { container } = mount();
      await tick(50);
      fireEvent.mouseDown(screen.getByRole("tab", { name: "Trends" }), { button: 0, ctrlKey: false });
      await tick(50);
      let panel = activePanel();
      expect(within(panel).getByRole("status")).toHaveTextContent("Loading trends");
      // Never the trends the report wrote itself, and nothing failed on screen.
      expect(within(panel).queryByRole("heading", { name: /TikTok trends/ })).not.toBeInTheDocument();
      expect(panel.textContent).not.toMatch(/Old scraped|Old TikTok/);
      expect(container.textContent).not.toMatch(failureWords);
      // The team's console gets the cause.
      expect(warn).toHaveBeenCalled();
      f.themesFail = false;
      // The first quiet try comes after 3 seconds, as LoadRetry's does.
      await tick(3_000);
      await tick(50);
      panel = activePanel();
      expect(within(panel).getByRole("heading", { name: "Industry trends" })).toBeInTheDocument();
      expect(f.rpcs.length).toBeGreaterThanOrEqual(2);
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it("shows only the weeks whose Monday falls inside the report's period", async () => {
    // trend_themes_in_range answers by overlap (for Analytics): the week of Mon 29 Sep ends in October, and is September's.
    f.themes = [...storedThemes(), {
      id: "t0", week_start: "2026-09-29", title: "September carryover", happening: "Late summer leagues.", why_it_matters: "x",
      angle: "Post the last summer fixtures.", platforms: ["tiktok"], posts: [post({ url: "https://www.tiktok.com/@sept/video/2", text: "September post" })],
    }];
    mount();
    const panel = await openTab("Trends");
    expect(within(panel).getByText("Captain POV skits")).toBeInTheDocument();
    expect(within(panel).queryByText("September carryover")).not.toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/September post|Post the last summer fixtures/);
    const overview = await openTab("Overview");
    expect(overview.textContent).not.toMatch(/September carryover|Post the last summer fixtures/);
    expect(within(overview).getByText("Industry trends").nextSibling).toHaveTextContent("2");
    expect(themesInPeriod(f.themes, "2026-10-01", "2026-10-31").map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(themesInPeriod(f.themes, "2026-09-01", "2026-09-30").map((t) => t.id)).toEqual(["t0"]);
    // Both ends of the period are in it.
    expect(themesInPeriod([{ week_start: "2026-10-01" }, { week_start: "2026-10-31" }, { week_start: "2026-11-01" }], "2026-10-01", "2026-10-31")).toEqual([{ week_start: "2026-10-01" }, { week_start: "2026-10-31" }]);
  });

  it("shows neither kind of trend while the themes are still being read, and holds every figure that depends on them", async () => {
    f.themesHang = true;
    mount();
    const panel = await openTab("Trends");
    expect(within(panel).getByRole("status")).toHaveTextContent("Loading trends");
    expect(within(panel).queryByRole("heading", { name: /TikTok trends/ })).not.toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/Old scraped/);
    // The overview holds "Where to act next" and the counts that the themes change, rather than show a number that moves.
    const overview = await openTab("Overview");
    expect(overview.textContent).not.toMatch(/Old TikTok opportunity|Old Instagram opportunity/);
    const actions = within(overview).getByRole("heading", { name: /Where to act next/ }).closest("section")!;
    expect(within(actions).getByRole("status")).toHaveTextContent("Loading recommendations");
    expect(actions.textContent).not.toMatch(/\d+ recommendations?/);
    expect(within(overview).queryByText("Recommendations")).not.toBeInTheDocument();
    expect(within(overview).queryByText("TikTok trends")).not.toBeInTheDocument();
    expect(within(overview).queryByText("Industry trends")).not.toBeInTheDocument();
    // A loading row never prints.
    expect(printed(overview)).not.toMatch(/Loading|Where to act next/);
    expect(printed(panel)).not.toMatch(/Loading/);
  });
});

describe("report screen: printing", () => {
  it("never prints the platform filter, and prints which platform a filtered list shows", async () => {
    mount();
    const panel = await openTab("Trends");
    const filter = within(panel).getByRole("button", { name: "TikTok" });
    expect(filter.closest('[data-print="hide"]')).not.toBeNull();
    expect(printed(panel)).not.toMatch(/Showing .* only/);
    fireEvent.click(filter);
    expect(within(panel).getByText("Showing TikTok only.")).toBeInTheDocument();
    expect(printed(panel)).toContain("Showing TikTok only.");
    expect(printed(panel)).toContain("Captain POV skits");
    expect(printed(panel)).not.toContain("Lineup templates as carousels");
  });
});

describe("report screen: what a client sees", () => {
  it("shows a client measured engagements on the stored themes' posts, never the weighted score", async () => {
    f.themes[0].posts[0].engagement = 987654;
    mount();
    const panel = await openTab("Trends");
    expect(within(panel).getByText("1,250 engagements")).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/987,654|Score/);
  });

  it("shows a client measured engagements on the report's own trend posts, never engagement_score", async () => {
    f.themes = [];
    mount();
    const panel = await openTab("Trends");
    expect(within(panel).getByText("430 engagements")).toBeInTheDocument();
    expect(within(panel).getByText("305 engagements")).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/54,321|4,321|Score/);
  });

  it("shows staff the weighted score on a stored theme's post", async () => {
    f.staff = true;
    f.themes[0].posts[0].engagement = 5400;
    mount();
    const panel = await openTab("Trends");
    expect(within(panel).getByText("Score: 5,400")).toBeInTheDocument();
  });

  it("uses client-facing words only in the Industry trends section", async () => {
    f.report = reportRow({ ...ownTrends(), ai_analysis: { industry_trends_analysis: { overview: "Captains drive sign-ups.", themes: [], opportunities_for_client: ["Run a captain series."], key_takeaways: [] } } });
    mount();
    const panel = await openTab("Trends");
    expect(within(panel).getByRole("heading", { name: "Industry trends" })).toBeInTheDocument();
    expect(panel.textContent).not.toMatch(banned);
    expect(panel.textContent).not.toMatch(/[—–]| - /);
    expect(panel.textContent).not.toMatch(/\bt1\b|\bt2\b|engagement_score|week_start|industry_trends/);
  });
});

describe("report screen: trend recommendations come from the theme angles", () => {
  it("lists the themes' angles under Where to act next, not the report's own trend opportunities", async () => {
    mount(); await settle();
    const overview = activePanel();
    const actions = within(overview).getByRole("heading", { name: /Where to act next/ }).closest("section")!;
    expect(within(actions).getByText("Captain POV skits")).toBeInTheDocument();
    expect(within(actions).getByText("Show a captain chasing RSVPs the night before a game.")).toBeInTheDocument();
    expect(actions.textContent).not.toMatch(/Old TikTok opportunity|Old Instagram opportunity/);
    // The report's own counts of TikTok and Instagram trends give way to the themes.
    expect(within(overview).queryByText("TikTok trends")).not.toBeInTheDocument();
    expect(within(overview).getByText("Industry trends").nextSibling).toHaveTextContent("2");
  });

  it("lists the report's industry analysis opportunities when it has them, in place of the angles", async () => {
    f.report = reportRow({ ...ownTrends(), ai_analysis: { ...ownTrends().ai_analysis, industry_trends_analysis: { overview: "x", themes: [], opportunities_for_client: ["Run a weekly captain series."], key_takeaways: [] } } });
    mount(); await settle();
    const overview = activePanel();
    const actions = within(overview).getByRole("heading", { name: /Where to act next/ }).closest("section")!;
    expect(within(actions).getByText("Run a weekly captain series.")).toBeInTheDocument();
    expect(actions.textContent).not.toMatch(/Show a captain chasing RSVPs|Old TikTok opportunity/);
    const rd = f.report.report_data;
    expect(reportCounts(rd, null, reportTrends(rd.ai_analysis, storedThemes())).recommendations).toBe(1);
  });

  it("keeps the report's own trend opportunities on a report with no stored theme", async () => {
    f.themes = [];
    mount(); await settle();
    const overview = activePanel();
    const actions = within(overview).getByRole("heading", { name: /Where to act next/ }).closest("section")!;
    expect(within(actions).getByText("Old TikTok opportunity")).toBeInTheDocument();
    expect(within(overview).getByText("TikTok trends")).toBeInTheDocument();
    expect(within(overview).queryByText("Industry trends")).not.toBeInTheDocument();
  });

  it("shows the themes' angles in Weekly highlights on the Content ideas tab", async () => {
    // Highlights show on a report that wrote its own week of posts (reports before 19 Oct 2026).
    f.report = reportRow({ ...ownTrends(), content_calendar: [{ day: "Monday", posts: [{ copy: "A planned post", platform: "LinkedIn" }] }] });
    mount(); await settle();
    const panel = await openTab("Content ideas");
    fireEvent.click(within(panel).getByRole("button", { name: /Weekly highlights/ }));
    expect(within(panel).getByText(/Show a captain chasing RSVPs the night before a game\./)).toBeInTheDocument();
    expect(within(panel).queryByText("TikTok opportunities")).not.toBeInTheDocument();
    expect(panel.textContent).not.toMatch(/Old TikTok opportunity/);
  });

  it("Weekly highlights keep the report's own opportunities without stored themes, and show none while the themes are read", () => {
    const ai = ownTrends().ai_analysis;
    const { unmount } = render(<WeeklyHighlights aiAnalysis={ai} trends={reportTrends(ai, [])} />);
    fireEvent.click(screen.getByRole("button", { name: /Weekly highlights/ }));
    expect(screen.getByText("TikTok opportunities")).toBeInTheDocument();
    expect(screen.getByText(/Old Instagram opportunity/)).toBeInTheDocument();
    unmount();
    // Nothing else to show, and no trend item yet: no highlights card at all.
    const pending = render(<WeeklyHighlights aiAnalysis={ai} trends={reportTrends(ai, null, { pending: true })} />);
    expect(pending.container.textContent).not.toMatch(/Old TikTok opportunity|Old Instagram opportunity/);
    pending.unmount();
    // Held: the stored themes are not counted or listed until they are read.
    expect(reportTrends(ai, storedThemes(), { pending: true })).toMatchObject({ held: true, items: [] });
  });

  it("counts the themes' angles as the report's trend recommendations", () => {
    const rd = ownTrends();
    const themes = storedThemes();
    expect(reportCounts(rd).recommendations).toBe(2);
    expect(reportCounts(rd, null, reportTrends(rd.ai_analysis, themes)).recommendations).toBe(2);
    expect(reportCounts(rd, null, reportTrends(rd.ai_analysis, [themes[0]])).recommendations).toBe(1);
    expect(reportCounts(rd, null, reportTrends(rd.ai_analysis, themes)).industryTrends).toBe(2);
    // A theme without an angle is shown, and recommends nothing.
    expect(reportTrends(rd.ai_analysis, [{ ...themes[0], angle: "" }]).items).toEqual([]);
    expect(reportTrends(rd.ai_analysis, [{ ...themes[0], angle: "" }]).source).toBe("industry");
    // Same angle in two weeks: listed once.
    expect(reportTrends(rd.ai_analysis, [themes[0], { ...themes[0], id: "t9", week_start: "2026-10-12" }]).items).toEqual([{ text: "Show a captain chasing RSVPs the night before a game.", theme: "Captain POV skits" }]);
  });
});
