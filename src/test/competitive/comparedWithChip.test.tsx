// The "Compared with" competitor chips in a competitive report header (QA 22 Nov 2026, P19-2): a chip did nothing for a competitor with no top posts.
import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

it('pressing a competitor in "Compared with" jumps to that competitor', async () => {
  const scroll = vi.fn();
  (Element.prototype as any).scrollIntoView = scroll;
  const post = { url: 'https://example.com/p', text: 'Creative', engagement: 4, channel: 'instagram', reach: 1000 };
  const bucket = { post_count: 1, cadence_per_week: 0.2, engagement_rate_avg: 0.01, engagement_avg: 4, impressions_total: 20, top_posts: [post], media_type_mix: [], top_hashtags: [], by_weekday: {}, by_hour: {} };
  const quiet = { ...bucket, post_count: 0, cadence_per_week: 0, top_posts: [] };
  fx.data = { period: { start: '2026-08-24', end: '2026-09-22' }, aggregates: { companies: [
    { ...bucket, company_id: 'me', name: 'QA client', is_client: true, channel_mix: [], rivaliq_metrics: { posts: { current: 1 } } },
    { ...quiet, company_id: 'quiet', name: 'Quiet Rival', is_client: false, channel_mix: [], rivaliq_metrics: { posts: { current: 0 } } },
  ] }, ai_analysis: {} };
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/clients/c/r']}><Routes><Route path='/clients/:id/:reportId' element={<CompetitiveReportView />} /></Routes></MemoryRouter></QueryClientProvider>);
  const chip = await screen.findByRole('button', { name: 'Quiet Rival' });
  await act(async () => { fireEvent.click(chip); });
  // No top posts, so no posts section: the chip goes to the rival's card in Company comparison.
  expect(scroll).toHaveBeenCalled();
  expect((scroll.mock.contexts[0] as HTMLElement).id).toBe('company-card-quiet');
});

it('a rival with top posts still jumps to its posts', async () => {
  const scroll = vi.fn();
  (Element.prototype as any).scrollIntoView = scroll;
  const post = { url: 'https://example.com/p', text: 'Creative', engagement: 4, channel: 'instagram', reach: 1000 };
  const bucket = { post_count: 1, cadence_per_week: 0.2, engagement_rate_avg: 0.01, engagement_avg: 4, impressions_total: 20, top_posts: [post], media_type_mix: [], top_hashtags: [], by_weekday: {}, by_hour: {} };
  fx.data = { period: { start: '2026-08-24', end: '2026-09-22' }, aggregates: { companies: [
    { ...bucket, company_id: 'me', name: 'QA client', is_client: true, channel_mix: [], rivaliq_metrics: { posts: { current: 1 } } },
    { ...bucket, top_posts: [{ ...post, url: 'https://example.com/loud' }], company_id: 'loud', name: 'Loud Rival', is_client: false, channel_mix: [], rivaliq_metrics: { posts: { current: 1 } } },
  ] }, ai_analysis: {} };
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/clients/c/r']}><Routes><Route path='/clients/:id/:reportId' element={<CompetitiveReportView />} /></Routes></MemoryRouter></QueryClientProvider>);
  // A plain DOM look-up: role and text queries over this full page outlast the wait.
  const chipOf = () => Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Loud Rival') ?? null;
  await waitFor(() => expect(chipOf()).not.toBeNull(), { timeout: 10_000 });
  await act(async () => { fireEvent.click(chipOf()!); });
  expect((scroll.mock.contexts[0] as HTMLElement).id).toBe('company-posts-loud');
});
