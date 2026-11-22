// A held competitive report whose period read keeps failing (QA 22 Nov 2026, P19-1): it showed "Loading report" for good, read every 5 s.
import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CompetitiveReportView from '@/pages/CompetitiveReportView';

const fx = vi.hoisted(() => ({ listReads: 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true }) }));
vi.mock('@/hooks/useInsightFeedback', () => ({ useInsightFeedback: () => ({ rows: [], verdictFor: () => null, vote: vi.fn(), editFor: () => null, saveEdit: vi.fn(), resetEdit: vi.fn() }), useCompetitiveLearnings: () => ({ learnings: [], remove: vi.fn() }), partitionGaps: () => ({ visible: [], hidden: [] }) }));
vi.mock('@/components/competitive/PostVisual', () => ({ usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, normalizePlatform: (x: string) => x, platformLabel: (x: string) => x }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  let single = false;
  const q: any = { select: () => q, eq: () => q, neq: () => q, order: () => q, limit: () => q, maybeSingle() { single = true; return q; },
    then(res: any) {
      if (table === 'clients') return Promise.resolve({ data: { name: 'QA client' }, error: null }).then(res);
      if (single) return Promise.resolve({ data: { id: 'report', status: 'complete', created_at: new Date().toISOString(), date_range_start: '2026-08-24', date_range_end: '2026-09-22',
        report_data: { quality_check: { state: 'needs_review', reasons: ['Verify source period'] } } }, error: null }).then(res);
      // The period's runs (report_data for up to 8 rows) do not come back: a statement timeout, say.
      fx.listReads++;
      return Promise.resolve({ data: null, error: { message: 'canceling statement due to statement timeout', code: '57014' } }).then(res);
    } };
  return q;
} } }));

let client: QueryClient;
beforeEach(() => { vi.useFakeTimers(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); });
const tick = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

it('a held report whose period read keeps failing still shows where it stands', async () => {
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/clients/c/r']}><Routes><Route path='/clients/:id/:reportId' element={<CompetitiveReportView />} /></Routes></MemoryRouter></QueryClientProvider>);
  await tick(50);
  await tick(10 * 60_000);
  // Ten minutes on, the read has been sent again every 5 s with no end, and the page is still a spinner.
  expect.soft(fx.listReads).toBeLessThan(20);
  expect(screen.queryByText(/Loading report/)).toBeNull();
});
