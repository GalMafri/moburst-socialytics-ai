/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P09): PostPanel stays mounted between posts and resets its per-post state in the layout effect at
// PostPanel.tsx:92, but pendingClip / clipNote (lines 166-167) are not reset. A filmed clip that did not go up
// for post A is offered on post B's Design tab ("a.mp4 is not uploaded yet." + Upload), and Upload sends post
// A's clip as post B's footage.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const f = vi.hoisted(() => ({ uploads: [] as string[] }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: false, isClient: true }) }));
vi.mock('@/lib/designRequests', async (original) => {
  const actual = await original<typeof import('@/lib/designRequests')>();
  return { ...actual, uploadFilmedClip: async (a: any) => { f.uploads.push(`${a.file.name} -> ${a.post._calendarPostKey}`); throw new Error('not uploaded'); } };
});
const filmed = (key: string) => ({ id: `r-${key}`, client_id: 'c1', calendar_post_key: key, platform: 'Instagram', status: 'needs_filming', stage: 'ready', kind: 'video', options_wanted: 0, options_ready: 0, on_camera: 'it needs the coach on camera', created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z' });
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q,
      maybeSingle: async () => ({ data: table === 'design_brand_settings' ? { confirmed_at: '2026-10-20T10:00:00Z' } : null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: table === 'design_requests' ? [filmed('post:a'), filmed('post:b')] : [], error: null }).then(resolve) };
    return q;
  },
} }));

import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';
afterEach(cleanup);

const reel = (key: string) => ({ _calendarPostKey: key, platform: 'Instagram', format: 'Reel', copy: `Copy for ${key}`, date_label: '2026-11-24' });

it('does not carry a clip that failed for one post over to the next post opened', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const ui = (post: any) => <QueryClientProvider client={qc}><DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
    <PostPanel open onOpenChange={() => {}} post={post} postIterations={[]} clientId="c1" initialTab="design" />
  </DesignRequestsProvider></QueryClientProvider>;
  const { rerender } = render(ui(reel('post:a')));
  fireEvent.change(await screen.findByLabelText('Filmed clip'), { target: { files: [new File(['x'], 'a.mp4', { type: 'video/mp4' })] } });
  expect(await screen.findByText('a.mp4 is not uploaded yet.')).toBeInTheDocument();
  rerender(ui(reel('post:b'))); // the person opens another post; the panel stays mounted
  await screen.findByText(/This video is filmed/);
  if (screen.queryByText('a.mp4 is not uploaded yet.')) {
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    await waitFor(() => expect(f.uploads.length).toBe(2));
  }
  // Expected: post B's Design tab knows nothing of post A's clip. Actual: it offers it, and Upload sends it as B's footage.
  expect(f.uploads).toEqual(['a.mp4 -> post:a']);
  // Back on post A, its clip is still waiting there.
  rerender(ui(reel('post:a')));
  expect(await screen.findByText('a.mp4 is not uploaded yet.')).toBeInTheDocument();
});
