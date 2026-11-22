// A company card's "Filter report by platform" buttons (QA 22 Nov 2026, P19-3): on a report without
// by_channel data they did nothing, since the filter knows only the platforms by_channel lists.
import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CompetitiveReportView from '@/pages/CompetitiveReportView';

const fx = vi.hoisted(() => ({ data: null as any }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true }) }));
vi.mock('@/hooks/useInsightFeedback', () => ({ useInsightFeedback: () => ({ rows: [], verdictFor: () => null, vote: vi.fn(), editFor: () => null, saveEdit: vi.fn(), resetEdit: vi.fn() }), useCompetitiveLearnings: () => ({ learnings: [], remove: vi.fn() }), partitionGaps: () => ({ visible: [], hidden: [] }) }));
vi.mock('@/components/competitive/PostVisual', async () => { const p = await vi.importActual<any>('@/lib/platform'); return { usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, normalizePlatform: p.normalizePlatform, platformLabel: p.platformLabel }; });
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/components/reports/ReportActions', () => ({ ReportActions: () => null }));
vi.mock('@/components/reports/ExportPdfButton', () => ({ ExportPdfButton: () => null }));
vi.mock('@/components/reports/ReportDecks', () => ({ ReportDecks: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  let single = false;
  const q: any = { select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q, maybeSingle() { single = true; return q; },
    then(res: any) {
      if (table === 'clients') return Promise.resolve({ data: { name: 'QA client' } }).then(res);
      if (!single) return Promise.resolve({ data: [] }).then(res);
      return Promise.resolve({ data: { id: 'report', status: 'complete', created_at: '2026-09-23T00:00:00Z', date_range_start: '2026-08-24', date_range_end: '2026-09-22', report_data: fx.data } }).then(res);
    } };
  return q;
} } }));

let client: QueryClient;
beforeEach(() => { client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); });

const post = { url: 'https://example.com/p', text: 'Creative', engagement: 4, channel: 'instagram', reach: 1000 };
const bucket = { post_count: 1, cadence_per_week: 0.2, engagement_rate_avg: 0.01, engagement_avg: 4, impressions_total: 20, top_posts: [post], media_type_mix: [], top_hashtags: [], by_weekday: {}, by_hour: {} };
const mount = () => render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/clients/c/r']}><Routes><Route path='/clients/:id/:reportId' element={<CompetitiveReportView />} /></Routes></MemoryRouter></QueryClientProvider>);

it('offers no platform buttons that cannot filter, on a report made before per-platform figures', async () => {
  // channel_mix, no by_channel: the platform filter has nothing to filter by.
  fx.data = { period: { start: '2026-08-24', end: '2026-09-22' }, aggregates: { companies: [{ ...bucket, company_id: 'rival', name: 'Example Rival', channel_mix: [{ key: 'instagram', count: 1 }], rivaliq_metrics: { posts: { current: 1 } } }] }, ai_analysis: {} };
  mount();
  await screen.findAllByText(/Example Rival/);
  expect(screen.queryByRole('button', { name: /Instagram · 1 analyzed/i })).toBeNull();
  expect(screen.queryByText('Filter report by platform')).toBeNull();
});

it('pressing a company card platform button filters the report when the report has per-platform figures', async () => {
  fx.data = { period: { start: '2026-08-24', end: '2026-09-22' }, aggregates: { companies: [{ ...bucket, company_id: 'rival', name: 'Example Rival', channel_mix: [{ key: 'instagram', count: 1 }], by_channel: { instagram: bucket }, rivaliq_metrics: { posts: { current: 1 } } }] }, ai_analysis: {} };
  mount();
  const button = await screen.findByRole('button', { name: /Instagram · 1 analyzed/i });
  await act(async () => { fireEvent.click(button); });
  expect(screen.queryAllByText(/Instagram only/i).length).toBeGreaterThan(0);
});
