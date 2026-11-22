/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P09): PostPanel.tsx:231-250 finishes "pending" reference-creative artwork. When finishing fails it
// forgets the row (line 246), and the effect depends on postIterations, which the caller rebuilds on every
// render (ContentIdeasTab.tsx activePostIterations = filter(...)). So a row that cannot be finished is tried
// again on every re-render of the board, with no cap and no wait.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';

const f = vi.hoisted(() => ({ planCalls: 0 }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
  functions: { invoke: async (name: string) => {
    if (name === 'get-creative-plan') { f.planCalls++; return { data: null, error: { message: 'plan gone' } }; }
    return { data: {}, error: null };
  } },
  from: () => {
    const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q,
      maybeSingle: async () => ({ data: { confirmed_at: '2026-10-20T10:00:00Z' }, error: null }),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve) };
    return q;
  },
} }));
afterEach(cleanup);

const pending = () => [{ id: 'it1', created_at: '2026-11-20T10:00:00Z', media_urls: ['https://x/a.png'], finishing: 'pending', variant_angle: 'Reference creative 11111111-2222-3333-4444-555555555555' }];

it('tries to finish an unfinishable row a bounded number of times, not once per render', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = (its: any[]) => <QueryClientProvider client={qc}><DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
    <PostPanel open onOpenChange={() => {}} post={{ _calendarPostKey: 'post:p1', platform: 'Instagram', format: 'Single image', copy: 'x' }} postIterations={its} clientId="c1" />
  </DesignRequestsProvider></QueryClientProvider>;
  const { rerender } = render(ui(pending()));
  await waitFor(() => expect(f.planCalls).toBe(1));
  for (let i = 1; i <= 10; i++) {
    rerender(ui(pending())); // the board re-renders (a refetch, a focus, a typed letter): a new array, same rows
    await new Promise((r) => setTimeout(r, 20));
  }
  // One try, and the next only after the wait: not one per render.
  expect(f.planCalls).toBe(1);
});

it('tries again after the wait, and stops after the last try', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.useFakeTimers({ shouldAdvanceTime: true });
  f.planCalls = 0;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
    <PostPanel open onOpenChange={() => {}} post={{ _calendarPostKey: 'post:p1', platform: 'Instagram', format: 'Single image', copy: 'x' }} postIterations={pending()} clientId="c1" />
  </DesignRequestsProvider></QueryClientProvider>);
  await waitFor(() => expect(f.planCalls).toBe(1));
  for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
  expect(f.planCalls).toBe(3);
  vi.useRealTimers();
});
