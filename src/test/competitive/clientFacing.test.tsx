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
const fixture = vi.hoisted(() => ({ staff: false, status: 'complete', createdAt: '', data: null as any, fail: false, reads: 0, insights: null as any, reportClient: 'client', prior: [] as Array<Record<string, unknown>>, verdict: null as string | null, hideAll: false, periodReads: 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: fixture.staff, canRunAnalysis: fixture.staff, canDelete: false }) }));
vi.mock('@/hooks/useInsightFeedback', () => ({ useInsightFeedback: () => ({ rows: [], verdictFor: () => fixture.verdict, vote: vi.fn(), editFor: () => null, saveEdit: vi.fn(), resetEdit: vi.fn() }), useCompetitiveLearnings: () => ({ learnings: [], remove: vi.fn() }), partitionGaps: (gaps: unknown[]) => (fixture.hideAll ? { visible: [], hidden: gaps } : { visible: gaps, hidden: [] }) }));
vi.mock('@/components/competitive/PostVisual', () => ({ usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, normalizePlatform: (x: string) => x, platformLabel: (x: string) => x }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/components/reports/ReportActions', () => ({ ReportActions: () => null }));
vi.mock('@/components/reports/ExportPdfButton', () => ({ ExportPdfButton: () => <button>Export PDF</button> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  let single = false;
  const filters: Array<['eq' | 'neq', string, unknown]> = [];
  const row = () => ({ id: 'report', client_id: fixture.reportClient, status: fixture.status, created_at: fixture.createdAt, date_range_start: '2026-09-01', date_range_end: '2026-09-30', duration_minutes: 12, report_data: fixture.data });
  // The rows a question about competitive_reports matches: its eq and neq filters are applied to the columns the rows have.
  const matching = () => [row(), ...fixture.prior].filter((r: Record<string, unknown>) => filters.every(([op, col, val]) => !(col in r) || (op === 'eq' ? r[col] === val : r[col] !== val)));
  let win: [number, number] | null = null;
  const query: any = { select: () => query, eq: (col: string, val: unknown) => { filters.push(['eq', col, val]); return query; }, neq: (col: string, val: unknown) => { filters.push(['neq', col, val]); return query; }, order: () => query, limit: (n: number) => { win = [0, n - 1]; return query; }, range: (from: number, to: number) => { win = [from, to]; return query; },
    maybeSingle() { single = true; return query; },
    then(resolve: any) {
      if (table === 'clients') return Promise.resolve({ data: { id: 'client', name: 'QA client' }, error: null }).then(resolve);
      if (table === 'report_insights') return Promise.resolve({ data: fixture.insights, error: null }).then(resolve);
      fixture.reads++;
      if (filters.some(([, col]) => col === 'date_range_start')) fixture.periodReads++;
      if (fixture.fail) return Promise.resolve({ data: null, error: Object.assign(new Error('permission denied for table competitive_reports (42501)'), { code: '42501' }) }).then(resolve);
      return Promise.resolve({ data: single ? (matching()[0] ?? null) : (win ? matching().slice(win[0], win[1] + 1) : matching()), error: null }).then(resolve);
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
  Object.assign(fixture, { staff: false, status: 'complete', createdAt: new Date().toISOString(), data: complete(), fail: false, reads: 0, insights: null, reportClient: 'client', prior: [], verdict: null, hideAll: false, periodReads: 0 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); });
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function mount(element: React.ReactElement, path = '/clients/client/reports/report', route = '/clients/:id/reports/:reportId') {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={element} /></Routes></MemoryRouter></QueryClientProvider>);
}
// Whole words, any case (so "aggregate" is not "gate"), plus the landscape name, data vendors and em dashes.
const banned = /\bAI\b|\b(prompts?|models?|scores?|pipelines?|gates?)\b|Socialytics -|Rival ?IQ|Sprout|Apify|—/i;

/** A report_insights row (shown columns only): facts from both the client's profiles and the competitor tracking. */
const INSIGHTS = {
  report_id: 'report', confirmed_at: '2026-10-01T00:00:00Z',
  facts: [
    { id: 'F1', key: 'ranking|all|followers|QA client', kind: 'ranking', platform: 'all', metric: 'followers', company: 'QA client', unit: 'count', value: 1200, score: 2, numbers: [1200, 1200, 1200, 1, 2], sentence: '', basis: 'Followers: QA client 1,200, Competitor 1,200 (highest), median 1,200 across 2 companies', sources: ['sprout', 'rivaliq'] },
    { id: 'F2', key: 'change|all|engagements|QA client', kind: 'change', platform: 'all', metric: 'engagements', company: 'QA client', unit: 'count', value: 240, score: 1, numbers: [240, 200, 40, 20], sentence: '', basis: "QA client's engagements 240 in September against 200 in August, +20%", sources: ['sprout'] },
  ],
  fields: {
    kind: 'competitive',
    summary: [{ text: 'QA client ties Competitor on followers at 1,200.', facts: ['F1'] }, { text: "QA client's engagements rose 20% to 240.", facts: ['F2'] }],
    gaps: [{ gap: 'Followers are level with the field', platform: 'all', why_it_matters: 'Competitor has 1,200 too.', suggested_play: 'Test a weekly series.', facts: ['F1'] }],
  },
};

it('shows a client a report with insights: what each rests on, and no vendor, id or internal wording', async () => {
  fixture.insights = INSIGHTS;
  // The insights are read once the report is: a second tick for them to land.
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  // Prose sets each figure apart: the paragraph is read as text.
  expect(document.body.textContent).toContain('QA client ties Competitor on followers at 1,200.');
  expect(screen.getAllByText(`Based on ${INSIGHTS.facts[0].basis}.`).length).toBe(2);
  expect(screen.getByText('Followers are level with the field')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(banned);
  expect(document.body.textContent).not.toMatch(/\bF\d\b|–/);
  cleanup(); fixture.staff = true;
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  expect(screen.getAllByText(`Based on ${INSIGHTS.facts[0].basis}, from Sprout and RivalIQ.`).length).toBe(2);
  expect(screen.getByText(`Based on ${INSIGHTS.facts[1].basis}, from Sprout.`)).toBeInTheDocument();
});

it('a snapshot with insights shows a client their summary and gaps, with no vendor or internal wording', async () => {
  fixture.insights = INSIGHTS;
  mount(<CompetitiveSnapshot clientId="client" />, '/x', '/x'); await tick(20); await tick(20);
  expect(document.body.textContent).toContain("QA client's engagements rose 20% to 240.");
  expect(screen.getByText('Followers are level with the field')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(banned);
});

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
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  expect(screen.getByText('Report not available')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/still being collected|held/i);
  expect(document.body.textContent).not.toMatch(banned);
  cleanup(); fixture.staff = true;
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  expect(screen.getByText(/RivalIQ had not finished collecting/)).toBeInTheDocument();
});

it('still shows staff the landscape and sources', async () => {
  fixture.staff = true;
  mount(<CompetitiveReportView />); await tick(20);
  expect(screen.getByText(/RivalIQ · QA client$/)).toBeInTheDocument();
  expect(screen.getByText('LinkedIn collected')).toBeInTheDocument();
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

it('past the watch limit checks a run once a minute and never asks for a reload', async () => {
  fixture.staff = true; fixture.status = 'running'; fixture.data = {};
  fixture.createdAt = new Date(Date.now() - (WATCH_LIMIT_MINUTES + 1) * 60000).toISOString();
  mount(<CompetitiveReportView />); await tick(20);
  expect(screen.getByText(/taking longer than usual\. This page keeps checking/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/refresh|reload|stopped checking/i);
  const reads = fixture.reads; await tick(30000); expect(fixture.reads).toBe(reads);
  await tick(31000); expect(fixture.reads).toBeGreaterThan(reads);
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

/* eslint-disable @typescript-eslint/no-explicit-any */
// What a client's page says in its own words: what a figure is, never the pipeline that made it.
const PIPELINE_WORDS = /source totals|historical counts are unavailable|Dated audience snapshots|collected LinkedIn activity|source snapshots|from September 2, 2026 onward|have been corrected|on this landscape|hidden by the team|tracked accounts|calendar brief|Gaps to fill|landscape/i;
const earlier = () => ({ id: 'earlier', client_id: 'client', status: 'complete', created_at: '2026-09-01T00:00:00Z', date_range_start: '2026-08-01', date_range_end: '2026-08-31', report_data: { ...complete(), period: { start: '2026-08-01', end: '2026-08-31' } } });

it('a client reads a report with no pipeline, developer or internal-rule wording', async () => {
  fixture.prior = [earlier()]; fixture.insights = INSIGHTS; fixture.hideAll = true;
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  expect(screen.getByText('Since the last report')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(PIPELINE_WORDS);
  expect(document.body.textContent).toContain('QA client and 1 competitor');
  // The figures' description says what they are, in one short sentence.
  expect(document.body.textContent).toMatch(/Totals for the period[^.]*\. Followers are the latest count\./);
  expect(document.body.textContent).not.toMatch(/tracked accounts|competitors\b.*\bcompetitor\b/);
  // The empty list says there is nothing to show, not who hid what.
  expect(screen.getByText('No suggestions to show')).toBeInTheDocument();
});

it('a report with no per-platform data shows no note about when per-platform data began', async () => {
  mount(<CompetitiveReportView />); await tick(20);
  expect(document.body.textContent).not.toMatch(/September 2|per-platform breakdowns/i);
  cleanup(); fixture.staff = true;
  mount(<CompetitiveReportView />); await tick(20);
  expect(document.body.textContent).not.toMatch(/September 2|Run the analysis again/i);
});

it('a suggestion the team is implementing reads "In the content plan", on the report and on the snapshot', async () => {
  fixture.insights = INSIGHTS; fixture.verdict = 'up';
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  expect(screen.getByText('In the content plan')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/calendar brief/i);
  cleanup();
  mount(<CompetitiveSnapshot clientId="client" />, '/x', '/x'); await tick(20); await tick(20);
  expect(screen.getByText('In the content plan')).toBeInTheDocument();
  expect(screen.getByText('Suggested tests')).toBeInTheDocument();
  expect(screen.getByText(/Proposed test:/)).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Gaps to fill|calendar brief|Play:/);
});

it('a figure that is not there reads "No data", never a dash', async () => {
  fixture.data = { ...complete(), aggregates: { companies: complete().aggregates.companies.map((c: any) => ({ ...c, engagement_avg: null, engagement_rate_avg: null, rivaliq_metrics: undefined })) } };
  mount(<CompetitiveSnapshot clientId="client" />, '/x', '/x'); await tick(20);
  expect(document.body.textContent).toContain('No data');
  expect(document.body.textContent).not.toMatch(/[\u2013\u2014]/);
});

it('says "1 competitor" for one competitor, on the snapshot and on the report', async () => {
  mount(<CompetitiveSnapshot clientId="client" />, '/x', '/x'); await tick(20);
  expect(document.body.textContent).toContain('1 competitor');
  expect(document.body.textContent).not.toContain('1 competitors');
  cleanup();
  mount(<CompetitiveReportView />); await tick(20);
  expect(document.body.textContent).not.toContain('1 competitors');
  cleanup();
  const three = complete();
  three.aggregates.companies.push({ ...three.aggregates.companies[1], company_id: 'c3', name: 'Other' }, { ...three.aggregates.companies[1], company_id: 'c4', name: 'Third' });
  fixture.data = three;
  mount(<CompetitiveSnapshot clientId="client" />, '/x', '/x'); await tick(20);
  expect(document.body.textContent).toContain('3 competitors');
});

it('names the client of the page in the report question: a report of another client is not available', async () => {
  fixture.reportClient = 'someone-else';
  mount(<CompetitiveReportView />, '/clients/client/competitive/reports/report', '/clients/:id/competitive/reports/:reportId'); await tick(20);
  expect(screen.getByText('Report not available')).toBeInTheDocument();
  expect(screen.queryByText('QA client vs. the field')).toBeNull();
});

it('labels posting hours with the zone stored on the report, and with UTC only for a report with none', async () => {
  const withZone = complete(); (withZone.aggregates as any).time_zone = 'America/New_York';
  fixture.data = withZone;
  mount(<CompetitiveReportView />); await tick(20);
  expect(document.body.textContent).toMatch(/Hour, Eastern Time \(New York\)/);
  expect(document.body.textContent).not.toMatch(/UTC/);
  cleanup(); fixture.data = complete();
  mount(<CompetitiveReportView />); await tick(20);
  expect(document.body.textContent).toMatch(/Hour, UTC/);
});

it('a staff page names the network that was collected, not the vendor that collected it', async () => {
  fixture.staff = true;
  mount(<CompetitiveReportView />); await tick(20);
  expect(screen.getByText('LinkedIn collected')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/Apify/);
});

it('a held run made long ago reads "Not shared" to staff and says nothing about being redone', async () => {
  fixture.staff = true; fixture.data = { ...complete(), provider_status: 2 };
  fixture.createdAt = new Date(Date.now() - 30 * 86400000).toISOString();
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  expect(document.body.textContent).toMatch(/it is not shared\./);
  expect(document.body.textContent).not.toMatch(/once a day|redone/i);
});
it('a staff page prints no data vendor: no vendor name outside what the export hides', async () => {
  fixture.staff = true;
  mount(<CompetitiveReportView />); await tick(20);
  const printed = document.body.cloneNode(true) as HTMLElement;
  printed.querySelectorAll('[data-print="hide"]').forEach((el) => el.remove());
  printed.querySelectorAll('[title]').forEach((el) => el.removeAttribute('title'));
  expect(printed.textContent).not.toMatch(/Rival ?IQ|Sprout|Apify/i);
});

it('a held run a day and a few minutes old, whose redo has not started, still reads "Being redone"', async () => {
  fixture.staff = true; fixture.data = { ...complete(), provider_status: 2 };
  fixture.createdAt = new Date(Date.now() - (24 * 60 + 5) * 60000).toISOString();
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  expect(document.body.textContent).toMatch(/once a day/);
  expect(document.body.textContent).not.toMatch(/it is not shared\.\s*$/);
});
/* eslint-enable @typescript-eslint/no-explicit-any */

it('the snapshot with no competitor reads "No data" in place of the whole cadence average', async () => {
  const data = complete();
  fixture.data = { ...data, aggregates: { ...data.aggregates, companies: [data.aggregates.companies[0]] } };
  mount(<CompetitiveSnapshot clientId="client" />, '/x', '/x'); await tick(20);
  const text = document.body.textContent ?? '';
  expect(text).toContain('competitor average No data');
  expect(text).not.toMatch(/No data\/wk/);
  expect(text).toContain('6 of 6 posts');
});

// The snapshot reads like every other competitive screen: the newest ready analysis, however many newer held ones sit in front of it.
it('the snapshot shows the newest ready analysis behind a long run of newer held ones', async () => {
  const held = (i: number) => ({ id: `held${i}`, client_id: 'client', status: 'complete', created_at: `2026-09-${String(28 - i).padStart(2, '0')}T00:00:00Z`, date_range_start: '2026-08-01', date_range_end: '2026-08-31', report_data: { provider_status: 0, aggregates: { companies: [] } } });
  fixture.data = { provider_status: 0, aggregates: { companies: [] } };
  fixture.prior = [...Array.from({ length: 14 }, (_, i) => held(i)), { ...earlier(), id: 'ready', report_data: complete() }];
  mount(<CompetitiveSnapshot clientId="client" />, '/x', '/x'); await tick(20); await tick(20); await tick(20);
  expect(document.body.textContent).toContain('Full competitive report');
  expect(document.body.textContent).toContain('Avg engagement');
});

// Only a held report reads its period's other runs (it needs them to say whether a redo came): a ready one makes no such read.
it('a ready report makes no period-runs read, and a held one does', async () => {
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  expect(fixture.periodReads).toBe(0);
  cleanup(); client.clear();
  fixture.data = { provider_status: 0, aggregates: { companies: [] } };
  mount(<CompetitiveReportView />); await tick(20); await tick(20);
  expect(fixture.periodReads).toBeGreaterThan(0);
});
