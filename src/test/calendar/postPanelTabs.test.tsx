/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';

// A post's panel makes designs and videos one way only: the design request.
// The older Video and Design generators are not offered from it, the Video
// tab only lists the videos a post already has, and the format shows as the
// label the cards use.

const f = vi.hoisted(() => ({ staff: true, settings: true, invokes: [] as any[], preview: null as any }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }), getUser: async () => ({ data: { user: { id: 'me' } } }) },
  functions: { invoke: async (name: string, opts: any) => {
    f.invokes.push({ name, ...opts.body });
    if (opts.body?.action === 'week_preview') return { data: f.preview, error: null };
    return { data: {}, error: null };
  } },
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q,
      maybeSingle: async () => ({ data: table === 'design_brand_settings' && f.settings ? { confirmed_at: '2026-10-20T10:00:00Z' } : null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.staff = true; f.settings = true; f.invokes = []; f.preview = null; });

const post = (over: any = {}) => ({ _calendarPostKey: 'post:p1', _calendarPostId: 'p1', platform: 'Instagram', format: 'Single image', copy: 'Join us Friday!', date_label: '2026-11-05', ...over });
const OLD_FUNCTIONS = ['generate-post-video', 'adapt-creative-prompt', 'propose-design-angles', 'generate-post-image'];

function panel(over: any = {}, iterations: any[] = []) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
        <PostPanel open onOpenChange={() => {}} post={post(over)} postIterations={iterations} clientId="c1" clientContext={{ client_name: 'Pay The Pyper' } as any} clientTimezone="UTC" initialTab="design" />
      </DesignRequestsProvider>
    </QueryClientProvider>,
  );
}

describe('the post panel', () => {
  it('offers staff no Video tab or Video button on a still post, and never starts the older generators', async () => {
    panel();
    expect(await screen.findByRole('button', { name: 'Create design' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Video' })).toBeNull();
    expect(screen.queryByRole('button', { name: /video/i })).toBeNull();
    expect(screen.queryByText(/generated on the Video tab|account team adds|Reject and learn/)).toBeNull();
    expect(f.invokes.filter((i) => OLD_FUNCTIONS.includes(i.name))).toEqual([]);
  });

  it('keeps the Video tab only as the list of videos a post already has, with no button', async () => {
    panel({}, [{ id: 'v1', created_at: '2026-11-04T10:00:00Z', variant_group_id: 'g', media_urls: ['https://project.supabase.co/storage/v1/object/public/generated-media/c1/v.mp4'], is_selected: true, variant_angle: 'Video 1' }]);
    expect(await screen.findByRole('tab', { name: 'Video' })).toBeInTheDocument();
    expect(screen.getByText('1 video')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Create|Make|Generate)/i })).toBeTruthy(); // Create design on the Design tab only
    expect(screen.queryByRole('button', { name: /video/i })).toBeNull();
  });

  it("tells staff what a client's design setup still waits for, with no dialog button", async () => {
    f.settings = false;
    f.preview = { code: 'not_set_up', waiting_for: 'logo_file', client_name: 'Pay The Pyper' };
    panel();
    expect(await screen.findByText("Designs start once Pay The Pyper's logo file is found on its website.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /design|video/i })).toBeNull();
  });

  it("shows the format as the cards do, not the planner's own words", async () => {
    panel({ format: 'video (animated text on soft designed background)', platform: 'Instagram' });
    await screen.findByRole('tablist');
    expect(screen.getByText('Video', { selector: '.t-badge' })).toBeInTheDocument();
    expect(screen.queryByText(/animated text on soft/)).toBeNull();
    await waitFor(() => expect(screen.queryByText(/planned as a/)).toBeNull());
  });
});
