import React from 'react';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import CompetitiveReportView from '@/pages/CompetitiveReportView';

const fixture = vi.hoisted(() => ({ status: 'running', reads: 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true }) }));
vi.mock('@/hooks/useInsightFeedback', () => ({ useInsightFeedback: () => ({ rows: [], verdictFor: () => null, vote: vi.fn() }), partitionGaps: () => ({ visible: [], hidden: [] }) }));
vi.mock('@/components/competitive/PostVisual', () => ({ usePostPreviews: () => ({ previews: {} }), PostVisual: () => null, normalizePlatform: (x: string) => x, platformLabel: (x: string) => x }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/components/reports/ReportActions', () => ({ ReportActions: () => null }));
vi.mock('@/components/reports/ExportPdfButton', () => ({ ExportPdfButton: () => <button>Export PDF</button> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  let single = false;
  const query: any = { select: () => query, eq: () => query, neq: () => query, order: () => query, limit: () => query,
    maybeSingle() { single = true; return query; },
    then(resolve: any) {
      if (table === 'clients') return Promise.resolve({ data: { name: 'QA client' } }).then(resolve);
      if (!single) return Promise.resolve({ data: [] }).then(resolve);
      fixture.reads++;
      return Promise.resolve({ data: { id: 'report', status: fixture.status, created_at: new Date().toISOString(), date_range_start: '2026-08-24', date_range_end: '2026-09-22', report_data: fixture.status === 'failed' ? { error: 'Observed provider failure' } : {} } }).then(resolve);
    },
  }; return query;
} } }));
let client: QueryClient;
beforeEach(() => { vi.useFakeTimers(); fixture.status = 'running'; fixture.reads = 0; client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { cleanup(); client.clear(); vi.useRealTimers(); });
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function mount() { render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/clients/client/report']}><Routes><Route path='/clients/:id/:reportId' element={<CompetitiveReportView />} /></Routes></MemoryRouter></QueryClientProvider>); }
it.each(['complete', 'failed'])('refreshes a running report into %s without a page reload and then stops polling', async (status) => {
  mount(); await tick(20);
  expect(screen.getByText(/Competitive analysis in progress/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Export PDF' })).toBeNull();
  fixture.status = status; await tick(5100);
  expect(screen.queryByText(/Competitive analysis in progress/)).toBeNull();
  if (status === 'failed') expect(screen.getByText('Observed provider failure')).toBeInTheDocument();
  else expect(screen.getByRole('heading', { name: 'QA client vs. the field' })).toBeInTheDocument();
  const reads = fixture.reads; await tick(15000); expect(fixture.reads).toBe(reads);
});
