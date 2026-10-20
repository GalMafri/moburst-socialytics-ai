import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CompetitiveReportView from '@/pages/CompetitiveReportView';
import CompetitiveReportHistory from '@/pages/CompetitiveReportHistory';
import { CompetitiveSnapshot } from '@/components/competitive/CompetitiveSnapshot';
import { LoadRetry } from '@/components/ui/load-error';
import { WATCH_LIMIT_MINUTES } from '@/lib/runWatch';

// What a client sees on the competitive screens: no vendor or landscape
// names, no raw statuses or errors, no internal wording, and a page that
// stops polling a run that outlived the sweep.
const fixture = vi.hoisted(() => ({ staff: false, status: 'complete', createdAt: '', data: null as any, fail: false, reads: 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: fixture.staff, canRunAnalysis: fixture.staff, canDelete: false }) }));
vi.mock('@/hooks/useInsightFeedback', () => ({ useInsightFeedback: () => ({ rows: [], verdictFor: () => null, vote: vi.fn(), editFor: () => null, saveEdit: vi.fn(), resetEdit: vi.fn() }), useCompetitiveLearnings: () => ({ learnings: [], remove: vi.fn() }), partitionGaps: (gaps: any[]) => ({ visible: gaps, hidden: [] }) }));
vi.mock('@/components/competitive/PostVisual', () => ({ usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, normalizePlatform: (x: string) => x, platformLabel: (x: string) => x }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/components/reports/ReportActions', () => ({ ReportActions: () => null }));
vi.mock('@/components/reports/ExportPdfButton', () => ({ ExportPdfButton: () => <button>Export PDF</button> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  let single = false;
  const row = () => ({ id: 'report', status: fixture.status, created_at: fixture.createdAt, date_range_start: '2026-09-01', date_range_end: '2026-09-30', duration_minutes: 12, report_data: fixture.data });
  const query: any = { select: () => query, eq: () => query, neq: () => query, order: () => query, limit: () => query,
    maybeSingle() { single = true; return query; },
    then(resolve: any) {
      if (table === 'clients') return Promise.resolve({ data: { id: 'client', name: 'QA client' }, error: null }).then(resolve);
      fixture.reads++;
      if (fixture.fail) return Promise.resolve({ data: null, error: Object.assign(new Error('permission denied for table competitive_reports (42501)'), { code: '42501' }) }).then(resolve);
      return Promise.resolve({ data: single ? row() : [row()], error: null }).then(resolve);
    },
  }; return query;
} } }));

const xPost = { channel: 'x', engagement: 3, engagement_rate: null, views: null, text: '', url: null, image: null, created: '2026-09-02', media_type: 'text', likely_boosted: true };
const bucket = { post_count: 6, cadence_per_week: 1.4, engagement_rate_avg: 0.012, engagement_avg: 40, impressions_total: 900, top_posts: [xPost], media_type_mix: [], top_hashtags: [], by_weekday: {}, by_hour: {} };
const metrics = { posts: { current: 6, previous: 5 }, audience: { current: 1200, previous: 1100 }, engagement: { current: 240, previous: 200 }, estimated_impressions: { current: 900, previous: 800 }, likely_boosted_facebook_posts: { current: 1, previous: 0 } };
const complete = () => ({
  period: { start: '2026-09-01', end: '2026-09-30' },
  landscape: { name: 'Socialytics - QA client - 2f1d7c1e-5b0a-4a51-9a51-7d1fbcd0e111' },
  aggregates: { companies: [
    { ...bucket, company_id: 'c1', name: 'QA client', url: null, is_client: true, in_confirmed_top3: false, channel_mix: [], rivaliq_metrics: metrics, linkedin_metrics: { provider: 'apify', profile_url: 'https://www.linkedin.com/company/qa', posts: 2, coverage: 'complete', engagement: 3, period: { start: '2026-09-01', end: '2026-09-30' } } },
    { ...bucket, company_id: 'c2', name: 'Competitor', url: null, is_client: false, in_confirmed_top3: true, channel_mix: [], rivaliq_metrics: metrics },
  ] },
  ai_analysis: { benchmark_scorecard: { client_score: 64 } },
});

let client: QueryClient;
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(fixture, { staff: false, status: 'complete', createdAt: new Date().toISOString(), data: complete(), fail: false, reads: 0 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); });
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function mount(element: React.ReactElement, path = '/clients/client/reports/report', route = '/clients/:id/reports/:reportId') {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter></QueryClientProvider>);
}
// Whole words, any case (so "aggregate" is not "gate"), plus the landscape name, data vendors and em dashes.
const banned = /\bAI\b|\b(prompts?|models?|scores?|pipelines?|gates?)\b|Socialytics -|Rival ?IQ|Sprout|Apify|—/i;

it('shows a client a plain status and no landscape, vendor or internal wording', async () => {
  mount(<CompetitiveReportView />); await tick(20);
  expect(screen.getByRole('heading', { name: 'QA client vs. the field' })).toBeInTheDocument();
  expect(screen.getByText('Ready')).toBeInTheDocument();
  expect(screen.queryByText('complete')).toBeNull();
  expect(screen.queryByText(/RivalIQ ·/)).toBeNull();
  expect(screen.queryByText(/Re-run|Run the analysis again/)).toBeNull();
  expect(document.body.textContent).not.toMatch(banned);
  expect(document.body.textContent).not.toMatch(/\bset avg\b/);
});

it('names no data vendor to a client, even where the figures come from one', async () => {
  mount(<CompetitiveReportView />); await tick(20);
  // The sections that used to name the provider are on the page.
  expect(screen.getAllByText('Est. impressions').length).toBeGreaterThan(0);
  expect(screen.getAllByText(/counted in the totals only/).length).toBeGreaterThan(0);
  expect(document.body.innerHTML).not.toMatch(/Rival ?IQ|Sprout/);
});

it('shows a client no held report at all, and staff the fact with its source named', async () => {
  fixture.data = { ...complete(), provider_status: 2 };
  mount(<CompetitiveReportView />); await tick(20);
  expect(screen.getByText('Report not available')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/still being collected|held/i);
  expect(document.body.textContent).not.toMatch(banned);
  cleanup(); fixture.staff = true;
  mount(<CompetitiveReportView />); await tick(20);
  expect(screen.getByText(/RivalIQ had not finished collecting/)).toBeInTheDocument();
});

it('still shows staff the landscape and sources', async () => {
  fixture.staff = true;
  mount(<CompetitiveReportView />); await tick(20);
  expect(screen.getByText(/RivalIQ · QA client$/)).toBeInTheDocument();
  expect(screen.getByText('LinkedIn · Apify')).toBeInTheDocument();
});

it('a report that did not load keeps loading quietly and tries again, instead of looking empty or failed', async () => {
  fixture.fail = true;
  mount(<CompetitiveReportView />); await tick(20);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/did not load|failed|try again/i);
  expect(screen.queryByText('Report not available')).toBeNull();
  // A client never sees the database's own words.
  expect(document.body.textContent).not.toMatch(/permission denied|42501/);
});

it('stops polling a run past the watch limit and says so plainly', async () => {
  fixture.staff = true; fixture.status = 'running'; fixture.data = {};
  fixture.createdAt = new Date(Date.now() - (WATCH_LIMIT_MINUTES + 1) * 60000).toISOString();
  mount(<CompetitiveReportView />); await tick(20);
  expect(screen.getByText(/stopped checking on its own/)).toBeInTheDocument();
  const reads = fixture.reads; await tick(30000); expect(fixture.reads).toBe(reads);
});

it('keeps polling a run inside the limit', async () => {
  fixture.status = 'running'; fixture.data = {};
  mount(<CompetitiveReportView />); await tick(20);
  const reads = fixture.reads; await tick(5100); expect(fixture.reads).toBeGreaterThan(reads);
});

it('history shows clients plain statuses and no landscape column', async () => {
  mount(<CompetitiveReportHistory />, '/clients/client/history', '/clients/:id/history'); await tick(20);
  expect(screen.getByText('Ready')).toBeInTheDocument();
  expect(screen.queryByText('Tracking')).toBeNull();
  expect(document.body.textContent).not.toMatch(banned);
  cleanup(); fixture.staff = true;
  mount(<CompetitiveReportHistory />, '/clients/client/history', '/clients/:id/history'); await tick(20);
  expect(screen.getByText('Tracking')).toBeInTheDocument();
});

it('snapshot shows measured figures against the competitors, with no score or internal wording', async () => {
  mount(<CompetitiveSnapshot clientId="client" takeaways={['A takeaway']} />, '/x', '/x'); await tick(20);
  expect(screen.getByText('Avg engagement')).toBeInTheDocument();
  expect(screen.getAllByText(/competitor average/).length).toBeGreaterThan(0);
  expect(screen.getByText('Drawn from the latest competitor analysis.')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(banned);
  expect(document.body.textContent).not.toMatch(/set average|synthesis/);
});

it('a snapshot that did not load keeps loading quietly, never "failed" and never "no analysis yet"', async () => {
  fixture.fail = true;
  mount(<CompetitiveSnapshot clientId="client" />, '/x', '/x'); await tick(20);
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(screen.queryByText('No competitive analysis yet')).toBeNull();
  expect(document.body.textContent).not.toMatch(/did not load|failed|try again/i);
});

it('LoadRetry shows only the loading state, never an error or a failure, and tries again on its own', async () => {
  vi.useFakeTimers();
  try {
    const onRetry = vi.fn();
    render(<LoadRetry error={new Error('JWT expired at 10:02')} label="Loading the reports" onRetry={onRetry} />);
    expect(screen.queryByText(/JWT/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Loading the reports/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/did not|failed|try again|refresh/i);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onRetry).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(onRetry).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000 + 60_000 * 2);
    expect(onRetry).toHaveBeenCalledTimes(5);
  } finally {
    vi.useRealTimers();
  }
});
