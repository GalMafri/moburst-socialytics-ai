/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P09): a filmed video post whose shot brief was never written (the one best-effort write in
// design-request/index.ts:285/430 failed) shows staff "Writing the shot brief" with a spinner forever,
// polls design_shot_briefs every 5 s for as long as the panel is open, and never asks for the brief
// again (the design-request "shot_brief" action exists for that, index.ts:134, but nothing calls it).
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';

const f = vi.hoisted(() => ({ invokes: [] as any[], briefReads: 0, brief: null as any }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
const filmed = { id: 'r1', client_id: 'c1', calendar_post_key: 'post:p1', platform: 'Instagram', status: 'needs_filming', stage: 'ready', kind: 'video', options_wanted: 0, options_ready: 0, on_camera: 'it needs the coach talking to camera', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z' };
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
  functions: { invoke: async (name: string, opts: any) => { f.invokes.push({ name, ...opts.body }); return { data: opts.body?.action === 'shot_brief' && f.brief ? { brief: f.brief } : {}, error: null }; } },
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q,
      maybeSingle: async () => {
        if (table === 'design_shot_briefs') { f.briefReads++; return { data: null, error: null }; }
        return { data: table === 'design_brand_settings' ? { confirmed_at: '2026-10-20T10:00:00Z' } : null, error: null };
      },
      then: (resolve: any) => Promise.resolve({ data: table === 'design_requests' ? [filmed] : [], error: null }).then(resolve),
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('does not leave staff on "Writing the shot brief" forever when the brief was never written', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
    <PostPanel open onOpenChange={() => {}} post={{ _calendarPostKey: 'post:p1', _calendarPostId: 'p1', platform: 'Instagram', format: 'Reel', copy: 'Meet the coach', date_label: '2026-11-24' }} postIterations={[]} clientId="c1" clientTimezone="UTC" initialTab="design" />
  </DesignRequestsProvider></QueryClientProvider>);
  expect(await screen.findByText('Writing the shot brief')).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); }); // ten minutes with the panel open
  // The brief is asked for again once, and when that brings none the panel says so and stops reading.
  expect(screen.queryByText('Writing the shot brief')).toBeNull();
  expect(screen.getByText('No shot brief yet.')).toBeInTheDocument();
  expect(f.invokes.filter((i) => i.action === 'shot_brief')).toEqual([{ name: 'design-request', action: 'shot_brief', request_id: 'r1' }]);
  const reads = f.briefReads;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(f.briefReads).toBe(reads);
  // Ask again: a brief written now shows.
  f.brief = { title: 'Coach on camera' };
  fireEvent.click(screen.getByRole('button', { name: 'Ask for the shot brief again' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(f.invokes.filter((i) => i.action === 'shot_brief')).toHaveLength(2);
  expect(screen.queryByText('No shot brief yet.')).toBeNull();
});
