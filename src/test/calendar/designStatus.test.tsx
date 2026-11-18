/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { DesignRequestsProvider } from '@/components/reports/calendar/DesignRequestsContext';
import { DesignRequestsDockItems } from '@/components/reports/calendar/DesignRequestsDock';
import { endedWithoutDesign, notMadeLine, stageLine } from '@/lib/designRequests';

// The person who asked for a design sees where it stands from the press until
// its end (18 Nov 2026: a video that ended without a design took its progress
// card away with no word, and the post's Design tab went back to how it was,
// so the press looked like it did nothing). The card and the tab now say the
// video is filmed, or that it was not made and can be made again, and never why.

const f = vi.hoisted(() => ({ requests: [] as any[] }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }), getUser: async () => ({ data: { user: { id: 'me' } } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q,
      maybeSingle: async () => ({ data: table === 'design_brand_settings' ? { confirmed_at: '2026-10-20T10:00:00Z' } : null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: table === 'design_requests' ? f.requests : [], error: null }).then(resolve),
    };
    return q;
  },
} }));
// Each test hands its worker back before the next one.
afterEach(async () => { cleanup(); localStorage.clear(); f.requests = []; await new Promise((r) => setTimeout(r, 0)); });

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const WHY = "The opening shot could not be drawn to the brand's rules.";
const request = (id: string, over: any = {}) => ({
  id, client_id: 'c1', calendar_post_key: 'post:v1', platform: 'YouTube', post_copy: 'Game day with the Harbor Kites', status: 'preparing', stage: 'designing', kind: 'video',
  options_wanted: 1, options_ready: 0, requested_by: 'me', batch_id: null, error: null, end_reason: null, created_at: ago(3), started_at: ago(3), updated_at: ago(1), ended_at: null, ...over,
});
const notMade = (id: string, over: any = {}) => request(id, { status: 'closed', end_reason: 'no_design', error: WHY, ended_at: ago(1), ...over });
const filmed = (id: string, over: any = {}) => request(id, { status: 'needs_filming', stage: 'ready', options_wanted: 0, on_camera: 'it needs the coach talking to camera', created_at: ago(4), ...over });

function dock() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
        <DesignRequestsDockItems />
      </DesignRequestsProvider>
    </QueryClientProvider>,
  );
  // What the page's next look at the server brings back.
  return async (rows: any[]) => { f.requests = rows; await act(async () => { await qc.invalidateQueries({ queryKey: ['design-requests', 'c1'] }); }); };
}

function panel(iterations: any[], post: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
        <PostPanel open onOpenChange={() => {}} post={post} postIterations={iterations} clientId="c1" clientContext={{ client_name: 'Harbor Kites' } as any} clientTimezone="UTC" initialTab="design" />
      </DesignRequestsProvider>
    </QueryClientProvider>,
  );
}

describe('the words', () => {
  it('a request that ended without a design is named as not made, whatever kind it is', () => {
    expect(endedWithoutDesign(notMade('a'))).toBe(true);
    expect(endedWithoutDesign(notMade('a', { end_reason: 'no_progress' }))).toBe(true);
    // Ended for another reason (the post was removed, footage arrived), stopped by the person, or still going: not this.
    expect(endedWithoutDesign(notMade('a', { end_reason: 'post_removed' }))).toBe(false);
    expect(endedWithoutDesign(notMade('a', { end_reason: 'filmed' }))).toBe(false);
    expect(endedWithoutDesign(request('a', { status: 'canceled' }))).toBe(false);
    expect(endedWithoutDesign(request('a'))).toBe(false);
    expect(stageLine(notMade('a') as any)).toBe('Video not made');
    expect(stageLine(notMade('a', { kind: 'carousel' }) as any)).toBe('Carousel not made');
    expect(stageLine(notMade('a', { kind: 'single' }) as any)).toBe('Design not made');
    expect(stageLine(filmed('a') as any)).toBe('This video is filmed');
    expect(notMadeLine({ kind: 'video' }, false)).toBe("The last video asked for this post wasn't made. You can make it again.");
    expect(notMadeLine({ kind: 'carousel' }, true)).toBe("The new carousel asked for this post wasn't made. This one stays, and you can make a new one again.");
  });
});

describe('the progress card of a request the person made', () => {
  it('stays when the video ends without a design, and says it was not made', async () => {
    f.requests = [request('v2')];
    const next = dock();
    expect(await screen.findByText('Preparing your video')).toBeInTheDocument();
    await next([notMade('v2')]);
    expect(await screen.findByText('Video not made')).toBeInTheDocument();
    expect(screen.getByText('You can make it again from the post.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
    // Never why, and no bar for something that is not in progress.
    expect(screen.queryByText(/opening shot|brand's rules/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('says a video is filmed when the press comes back with that answer', async () => {
    f.requests = [filmed('v1', { updated_at: ago(0) })];
    dock();
    expect(await screen.findByText('This video is filmed')).toBeInTheDocument();
    expect(screen.getByText('Upload the filmed clip, or make it from your posts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open/ })).toBeEnabled();
  });

  it('is one card per post: the filmed answer, then the video being prepared, then how it ended', async () => {
    f.requests = [filmed('v1')];
    const next = dock();
    expect(await screen.findByText('This video is filmed')).toBeInTheDocument();
    await next([request('v2'), filmed('v1')]);
    expect(await screen.findByText('Preparing your video')).toBeInTheDocument();
    expect(screen.queryByText('This video is filmed')).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    await next([notMade('v2'), filmed('v1')]);
    expect(await screen.findByText('Video not made')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('keeps a carousel on screen through every look at the server until it is ready', async () => {
    const carousel = (over: any = {}) => request('c1', { calendar_post_key: 'post:c1', kind: 'carousel', platform: 'LinkedIn', options_wanted: 1, ...over });
    f.requests = [carousel({ stage: 'planning' })];
    const next = dock();
    expect(await screen.findByText('Preparing your carousel')).toBeInTheDocument();
    for (const stage of ['designing', 'designing', 'finishing', 'finishing']) {
      await next([carousel({ stage, updated_at: ago(0) })]);
      expect(screen.getByText('Preparing your carousel')).toBeInTheDocument();
    }
    await next([carousel({ status: 'ready', stage: 'ready', options_ready: 1, updated_at: ago(0), ended_at: ago(0) })]);
    expect(await screen.findByText('Carousel ready')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /View carousel/ })).toBeEnabled();
  });

  it('is there again after a reload, for a while, and only for the person who asked', async () => {
    f.requests = [
      notMade('recent'),
      notMade('old', { calendar_post_key: 'post:old', post_copy: 'An older post', ended_at: ago(300), updated_at: ago(300), created_at: ago(310) }),
      notMade('theirs', { calendar_post_key: 'post:theirs', post_copy: 'Someone else asked', requested_by: 'someone-else' }),
    ];
    dock();
    expect(await screen.findByText('Video not made')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByText(/Game day with the Harbor Kites/)).toBeInTheDocument();
  });
});

describe("the post's Design tab", () => {
  const videoPost = { _calendarPostKey: 'post:v1', _calendarPostId: 'v1', platform: 'YouTube', format: 'Long video', copy: 'Game day with the Harbor Kites', date_label: '2026-11-25' };

  it('says the video was not made, above the two ways to make it', async () => {
    f.requests = [notMade('v2', { video_route: 'posts' }), filmed('v1')];
    panel([], videoPost);
    expect(await screen.findByText("The last video asked for this post wasn't made. You can make it again.")).toBeInTheDocument();
    expect(screen.getByText("The last video asked for this post wasn't made. You can make it again.").closest('[role=status]')).not.toBeNull();
    expect(screen.getByRole('button', { name: /Make this video/ })).toBeEnabled();
    expect(screen.getByText(/This video is filmed: it needs the coach talking to camera/)).toBeInTheDocument();
    expect(screen.queryByText(/opening shot|brand's rules/)).toBeNull();
  });

  it('says nothing of the kind while a new one is being prepared, or when none ended that way', async () => {
    f.requests = [request('v3'), notMade('v2', { created_at: ago(20) }), filmed('v1', { created_at: ago(30) })];
    panel([], videoPost);
    expect(await screen.findByText('Preparing your video')).toBeInTheDocument();
    expect(screen.queryByText(/wasn't made/)).toBeNull();
  });

  it('keeps the design in place and says the new one was not made', async () => {
    const post = { _calendarPostKey: 'post:p1', _calendarPostId: 'p1', platform: 'Instagram', format: 'Single image', copy: 'Join us Friday!', date_label: '2026-11-25' };
    const design = { id: 'it-1', calendar_post_key: 'post:p1', platform: 'Instagram', post_copy: 'Join us Friday!', variant_angle: 'Design option 1', media_urls: ['https://project.supabase.co/storage/v1/object/public/generated-media/c1/a.png'], is_selected: true, created_at: ago(600), variant_group_id: 'req-0' };
    f.requests = [notMade('p2', { calendar_post_key: 'post:p1', kind: 'single', platform: 'Instagram', post_copy: 'Join us Friday!' })];
    panel([design], post);
    expect(await screen.findByText("The new design asked for this post wasn't made. This one stays, and you can make a new one again.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Regenerate/ })[0]).toBeEnabled());
  });
});
