/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentIdeasTab } from '@/components/reports/calendar/ContentIdeasTab';
import { PostPanel } from '@/components/reports/calendar/PostPanel';
import { PostCard } from '@/components/reports/calendar/PostCard';
import { DesignRequestsProvider, designRequestsQuery, weekRunsQuery } from '@/components/reports/calendar/DesignRequestsContext';
import { DesignRequestsDockItems } from '@/components/reports/calendar/DesignRequestsDock';

// Where the progress cards are: everywhere the person can be on a client's
// calendar (18 Nov 2026). An open post panel covers the page, so the cards
// show inside it; a week with no posts keeps them; a card whose post is in
// another week still opens it; a sign-in that was not ready when the calendar
// opened still gets its cards; the board says when a post's design was not made.

const f = vi.hoisted(() => ({ requests: [] as any[], session: { user: { id: 'me' } } as any, authListeners: [] as Array<(event: string, session: any) => void>, unsubscribed: 0 }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn(), editDistancePct: () => 0 }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: {
    getSession: async () => ({ data: { session: f.session } }),
    getUser: async () => ({ data: { user: f.session?.user ?? null } }),
    onAuthStateChange: (cb: (event: string, session: any) => void) => { f.authListeners.push(cb); return { data: { subscription: { unsubscribe: () => { f.unsubscribed += 1; } } } }; },
  },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q, limit: () => q, is: () => q, gte: () => q,
      maybeSingle: async () => ({ data: table === 'design_brand_settings' ? { confirmed_at: '2026-10-20T10:00:00Z' } : null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: table === 'design_requests' ? f.requests : [], error: null }).then(resolve),
    };
    return q;
  },
} }));
// Each test hands its worker back before the next one.
afterEach(async () => { cleanup(); localStorage.clear(); f.requests = []; f.session = { user: { id: 'me' } }; f.authListeners = []; f.unsubscribed = 0; await new Promise((r) => setTimeout(r, 0)); });

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const request = (id: string, over: any = {}) => ({
  id, client_id: 'c1', calendar_post_key: 'post:a', platform: 'Instagram', post_copy: 'Monday with the Harbor Kites', status: 'preparing', stage: 'designing', kind: 'single',
  options_wanted: 1, options_ready: 0, requested_by: 'me', batch_id: null, error: null, end_reason: null, created_at: ago(3), started_at: ago(3), updated_at: ago(1), ended_at: null, ...over,
});
const postA = { _calendarPostKey: 'post:a', _calendarPostId: 'a', platform: 'Instagram', format: 'Single Image', copy: 'Monday with the Harbor Kites', date_label: '2026-11-23' };
const postB = { _calendarPostKey: 'post:b', _calendarPostId: 'b', platform: 'LinkedIn', format: 'Carousel', copy: 'Five plays worth knowing', date_label: '2026-11-24' };
const week = [{ day: 'Monday', date_label: 'Nov 23', posts: [postA] }, { day: 'Tuesday', date_label: 'Nov 24', posts: [postB] }];
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

function board(props: any = {}) {
  render(
    <QueryClientProvider client={client()}>
      <ContentIdeasTab mode="calendar" contentCalendar={week} aiAnalysis={null} sproutPerformance={null} clientId="c1" availablePlatforms={['Instagram', 'LinkedIn']} availableLanguages={['en']} {...props} />
    </QueryClientProvider>,
  );
}
function panel(post: any, tab: string) {
  render(
    <QueryClientProvider client={client()}>
      <DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
        <PostPanel open onOpenChange={() => {}} post={post} postIterations={[]} clientId="c1" clientContext={{ client_name: 'Harbor Kites' } as any} clientTimezone="UTC" initialTab={tab} />
      </DesignRequestsProvider>
    </QueryClientProvider>,
  );
}

describe('with a post panel open', () => {
  it("shows another post's card inside the panel, where the page's cards are covered", async () => {
    f.requests = [request('rb', { calendar_post_key: 'post:b', kind: 'carousel', platform: 'LinkedIn', post_copy: 'Five plays worth knowing' })];
    panel(postA, 'design');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Preparing your carousel')).toBeInTheDocument();
    expect(within(dialog).getByText(/Five plays worth knowing/)).toBeInTheDocument();
  });

  it("says the open post's own status in one line on its Copy tab, and leaves it to the Design tab there, with no card for it", async () => {
    // The Design tab is kept in the page while another tab shows; only the active tab is on screen.
    const onScreen = (text: string) => screen.queryAllByText(text).filter((el) => !el.closest('[role=tabpanel][data-state=inactive]'));
    f.requests = [request('ra')];
    panel(postA, 'copy');
    const line = await screen.findByText("This post's design is being prepared.");
    expect(line.closest('[role=dialog]')).not.toBeNull();
    expect(line.closest('[role=status]')).not.toBeNull();
    expect(onScreen('Preparing your design')).toHaveLength(0);
    cleanup();
    panel(postA, 'design');
    await screen.findAllByText('Preparing your design');
    expect(onScreen('Preparing your design')).toHaveLength(1);
    expect(onScreen('Preparing your design')[0].closest('[role=tabpanel]')).not.toBeNull();
    expect(screen.queryByText("This post's design is being prepared.")).toBeNull();
  });

  it('says on the Copy tab that the last design asked for was not made', async () => {
    f.requests = [request('ra', { status: 'closed', end_reason: 'no_design', error: 'Slide 3 failed the logo check.', ended_at: ago(1) })];
    panel(postA, 'copy');
    expect(await screen.findByText("The last design asked for this post wasn't made.")).toBeInTheDocument();
    expect(screen.queryByText(/logo check/)).toBeNull();
  });

  it("puts the cards after the panel's content, in its flow, so they cover nothing, and no wider than a narrow panel", async () => {
    f.requests = [request('rb', { calendar_post_key: 'post:b', kind: 'carousel', platform: 'LinkedIn', post_copy: 'Five plays worth knowing' })];
    panel(postA, 'design');
    const card = (await screen.findByText('Preparing your carousel')).closest('[role=status]') as HTMLElement;
    const column = card.parentElement as HTMLElement;
    expect(column.className).not.toMatch(/sticky|fixed|absolute/);
    expect(column.className).toContain('[&>*]:max-w-full');
    // After the tabs, as the last thing in the panel's own content.
    const tabs = screen.getByRole('tablist').parentElement as HTMLElement;
    expect(tabs.compareDocumentPosition(column) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(column.parentElement).toBe(tabs.parentElement);
  });

  it('moves the cards from the page into the panel when a post is opened, never both', async () => {
    f.requests = [request('rb', { calendar_post_key: 'post:b', kind: 'carousel', platform: 'LinkedIn', post_copy: 'Five plays worth knowing' })];
    board();
    const card = await screen.findByText('Preparing your carousel');
    expect(card.closest('[role=dialog]')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: /Open post: Monday with the Harbor Kites/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Preparing your carousel')).toBeInTheDocument();
    expect(screen.getAllByText('Preparing your carousel')).toHaveLength(1);
  });
});

describe('a week with no posts', () => {
  it('keeps the progress cards around its empty state, with no filters or board', async () => {
    f.requests = [request('rz', { calendar_post_key: 'post:z' })];
    board({ contentCalendar: [], empty: <p>No posts planned for this week</p> });
    expect(screen.getByText('No posts planned for this week')).toBeInTheDocument();
    expect(await screen.findByText('Preparing your design')).toBeInTheDocument();
    expect(screen.queryByText('Loading the calendar')).toBeNull();
  });
});

describe("a card whose post is not on the week shown", () => {
  it('hands its Open to the page, which goes to the post', async () => {
    const elsewhere = vi.fn();
    f.requests = [request('rz', { calendar_post_key: 'post:z' })];
    board({ onOpenElsewhere: elsewhere });
    const card = (await screen.findByText('Preparing your design')).closest('[role=status]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: /Open/ }));
    expect(elsewhere).toHaveBeenCalledWith('post:z');
  });

  it('opens on the Design tab when the page arrives with the post and that tab', async () => {
    board({ openPostKey: 'post:b', openPostTab: 'design' });
    expect((await screen.findByRole('tab', { name: /Carousel|Design/ })).getAttribute('aria-selected')).toBe('true');
  });
});

describe('who is signed in', () => {
  it('is learned when the session arrives after the calendar opened, and the cards show then', async () => {
    f.session = null;
    f.requests = [request('ra')];
    const view = render(
      <QueryClientProvider client={client()}>
        <DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}><DesignRequestsDockItems /></DesignRequestsProvider>
      </QueryClientProvider>,
    );
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByText('Preparing your design')).toBeNull();
    expect(f.authListeners).toHaveLength(1);
    act(() => f.authListeners[0]('SIGNED_IN', { user: { id: 'me' } }));
    expect(await screen.findByText('Preparing your design')).toBeInTheDocument();
    // Signed out: nobody's cards.
    act(() => f.authListeners[0]('SIGNED_OUT', null));
    expect(screen.queryByText('Preparing your design')).toBeNull();
    view.unmount();
    expect(f.unsubscribed).toBe(1);
  });
});

describe('the post card on the board', () => {
  const card = (post: any) => render(
    <QueryClientProvider client={client()}>
      <DesignRequestsProvider clientId="c1" onOpenPost={vi.fn()}>
        <PostCard post={post as any} iteration={null} status={'draft' as any} onOpen={() => {}} />
      </DesignRequestsProvider>
    </QueryClientProvider>,
  );

  it('says the design was not made when the last one asked for ended without one', async () => {
    f.requests = [request('rb', { calendar_post_key: 'post:b', kind: 'carousel', status: 'closed', end_reason: 'no_design', error: 'Slide 3 failed the logo check.', ended_at: ago(500) })];
    card(postB);
    expect(await screen.findByText('Carousel not made')).toBeInTheDocument();
    expect(screen.queryByText('No design yet')).toBeNull();
    expect(screen.queryByText(/logo check/)).toBeNull();
  });

  it('still says No design yet for a post nobody asked a design for', async () => {
    card(postA);
    expect(await screen.findByText('No design yet')).toBeInTheDocument();
  });
});

describe('looking again at the server', () => {
  it('goes on in a browser tab left in the background', () => {
    expect(designRequestsQuery('c1').refetchIntervalInBackground).toBe(true);
    expect(weekRunsQuery('c1').refetchIntervalInBackground).toBe(true);
  });
});
