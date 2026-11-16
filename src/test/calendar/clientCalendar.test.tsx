/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientCalendar from '@/pages/ClientCalendar';

// A client's own calendar draws everything from that client's data: the week
// from its zone, the networks it offers from its own settings and posts, the
// count in the day headers' words. A client the viewer cannot see draws no week.

const f = vi.hoisted(() => ({
  client: null as any,
  posts: [] as any[],
  profiles: [] as any[],
  ranges: [] as Array<[number, number]>,
}));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions }: any) => <main><div>{actions}</div>{children}</main> }));
vi.mock('@/components/calendar/NewPostDialog', () => ({ NewPostDialog: (p: any) => <div data-testid="new-post">{p.platforms.join(',')}</div> }));
vi.mock('@/components/reports/calendar/ContentIdeasTab', () => ({ ContentIdeasTab: (p: any) => <div data-testid="week-board" data-filter={p.availablePlatforms.join(',')} /> }));
vi.mock('@/components/calendar/CalendarHeaderControls', async (orig) => ({ ...(await orig<any>()), ClientPicker: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    let range: [number, number] | null = null;
    const rows = () => {
      const all = table === 'calendar_posts' ? f.posts : table === 'sprout_profiles' ? f.profiles : [];
      return range ? all.slice(range[0], Math.min(range[1] + 1, range[0] + 1000)) : all;
    };
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, not: () => q, order: () => q, limit: () => q, gte: () => q, lte: () => q, gt: () => q,
      range: (a: number, b: number) => { range = [a, b]; if (table === 'calendar_posts') f.ranges.push([a, b]); return q; },
      maybeSingle: async () => ({ data: table === 'clients' ? f.client : null, error: null }),
      then: (ok: any, fail: any) => Promise.resolve({ data: rows(), error: null }).then(ok, fail),
    };
    return q;
  },
} }));

const post = (over: any) => ({ id: 'p', post_key: 'k', client_id: 'c1', report_id: null, post_date: '2026-11-04', posting_time: '09:00', platform: 'LinkedIn', format: 'Single image', copy: 'Copy', hashtags: [], reasons: [], source: 'plan', created_at: '2026-11-01T00:00:00Z', ...over });

const page = (path = '/clients/c1/calendar') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes><Route path="/clients/:id/calendar" element={<ClientCalendar />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
  f.client = { id: 'c1', name: 'Kitcaster', timezone: 'UTC', archived_at: null, primary_platforms: ['LinkedIn'] };
  f.posts = []; f.profiles = []; f.ranges = [];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('a client the viewer cannot see', () => {
  it('shows the not-available state and no week band, plan button or empty week', async () => {
    f.client = null;
    page();
    expect(await screen.findByText('That client is not available')).toBeInTheDocument();
    expect(screen.queryByText('No posts planned for this week')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Weeks' })).toBeNull();
    expect(screen.queryByTestId('new-post')).toBeNull();
    expect(screen.queryByRole('button', { name: /Plan/ })).toBeNull();
  });
});

describe('the networks a client offers', () => {
  it('are its own: set-up networks, connected profiles and the networks on its calendar, never five by default', async () => {
    f.posts = [post({})];
    page();
    expect(await screen.findByTestId('week-board')).toHaveAttribute('data-filter', 'LinkedIn');
    expect(screen.getByTestId('new-post')).toHaveTextContent(/^LinkedIn$/);
  });

  it('add a connected profile to New post, and the filter keeps only networks with posts that week', async () => {
    f.profiles = [{ network_type: 'fb_instagram_account' }];
    f.posts = [post({}), post({ id: 'p2', post_key: 'k2', platform: 'TikTok', post_date: '2026-11-20' })];
    page();
    expect(await screen.findByTestId('week-board')).toHaveAttribute('data-filter', 'LinkedIn');
    expect(screen.getByTestId('new-post')).toHaveTextContent('LinkedIn,Instagram,TikTok');
  });

  it('fall back to the five common networks only for a client with none of its own', async () => {
    f.client = { ...f.client, primary_platforms: [] };
    page();
    expect(await screen.findByTestId('new-post')).toHaveTextContent('Instagram,LinkedIn,TikTok,Facebook,X');
  });
});

describe('the week band', () => {
  it('counts feed posts and Stories apart, as the day headers do', async () => {
    f.posts = [
      ...Array.from({ length: 3 }, (_, i) => post({ id: `f${i}`, post_key: `f${i}` })),
      ...Array.from({ length: 2 }, (_, i) => post({ id: `s${i}`, post_key: `s${i}`, platform: 'Instagram', format: 'Story' })),
    ];
    page();
    expect(await screen.findByText('3 posts and 2 Stories this week')).toBeInTheDocument();
  });

  it('opens on this week when the address holds a damaged week value', async () => {
    page('/clients/c1/calendar?week=2026-13-45');
    expect(await screen.findByRole('heading', { name: 'Nov 2 to 8, 2026' })).toBeInTheDocument();
  });

  it('says what the person gets in an empty week, with no account of the planning schedule', async () => {
    page();
    expect(await screen.findByText('No posts planned for this week')).toBeInTheDocument();
    expect(screen.queryByText(/Monday before/)).toBeNull();
  });
});

describe('the posts read', () => {
  it('goes on page by page while a page comes back full', async () => {
    f.posts = Array.from({ length: 2500 }, (_, i) => post({ id: `p${i}`, post_key: `k${i}`, post_date: '2026-12-01' }));
    page();
    await vi.waitFor(() => expect(f.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]));
  });
});
