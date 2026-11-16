/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import CalendarIndex from '@/pages/CalendarIndex';

// The all-clients week shows each time with its client's own zone. The page
// reads the zone from the clients it already loads, so a client's row with a
// timezone is all it takes: nothing here passes a zone to the week by hand.

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
const who = vi.hoisted(() => ({ auth: { isMoburstStaff: true, isClient: false, user: null as any, isGosSession: false }, gte: [] as string[], ranges: [] as Array<[number, number]> }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => who.auth }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions }: any) => <main>{actions}{children}</main> }));
vi.mock('@/components/calendar/CalendarHeaderControls', () => ({ ALL_CLIENTS: 'all', ClientPicker: () => null, WeekNav: () => null }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn() }));

const tables = vi.hoisted(() => ({
  clients: [
    { id: 'c1', name: 'East Coast Co', hub_company_name: null, archived_at: null, timezone: 'America/New_York' },
    { id: 'c2', name: 'West Coast Co', hub_company_name: null, archived_at: null, timezone: 'America/Los_Angeles' },
  ] as any[],
  calendar_posts: [
    { id: 'p1', post_key: 'post:p1', client_id: 'c1', platform: 'LinkedIn', format: 'image', post_date: '2026-11-05', posting_time: '18:00', copy: 'East post', story_of: null, created_at: '2026-11-01T00:00:00Z' },
    { id: 'p2', post_key: 'post:p2', client_id: 'c2', platform: 'LinkedIn', format: 'image', post_date: '2026-11-05', posting_time: '18:00', copy: 'West post', story_of: null, created_at: '2026-11-01T00:00:00Z' },
  ] as any[],
}));
vi.mock('@/components/dashboard/ClientOverview', () => ({ ClientOverview: () => null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    let range: [number, number] | null = null;
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, not: () => q, gt: () => q, lte: () => q, order: () => q, limit: () => q, is: () => q,
      gte: (_c: string, v: string) => { if (table === 'calendar_posts') who.gte.push(v); return q; },
      range: (a: number, b: number) => { range = [a, b]; if (table === 'calendar_posts') who.ranges.push([a, b]); return q; },
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: any) => {
        const all = (tables as any)[table] ?? [];
        return Promise.resolve({ data: range ? all.slice(range[0], Math.min(range[1] + 1, range[0] + 1000)) : all, error: null }).then(resolve);
      },
    };
    return q;
  },
} }));
const staff = { isMoburstStaff: true, isClient: false, user: null as any, isGosSession: false };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); who.auth = staff; who.gte = []; who.ranges = []; });

function Where() { const l = useLocation(); return <output data-testid="where">{l.pathname}</output>; }
function mount(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <MemoryRouter initialEntries={[path]}><QueryClientProvider client={qc}>
      <Routes>
        <Route path="/calendar" element={<CalendarIndex />} />
        <Route path="/clients/:id/calendar" element={<div>Client calendar</div>} />
      </Routes>
      <Where />
    </QueryClientProvider></MemoryRouter>,
  );
}

describe('the Calendar tab for staff', () => {
  it("shows each post's time with its own client's zone, read from the client rows", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<MemoryRouter initialEntries={['/calendar?week=2026-11-02']}><QueryClientProvider client={qc}><CalendarIndex /></QueryClientProvider></MemoryRouter>);
    expect(await screen.findByRole('button', { name: /East Coast Co/ })).toHaveTextContent('6:00 PM EST');
    expect(screen.getByRole('button', { name: /West Coast Co/ })).toHaveTextContent('6:00 PM PST');
  });
});

describe('the Calendar tab for a client user', () => {
  const client = { isMoburstStaff: false, isClient: true, user: { company: null }, isGosSession: true };

  it('shows the dashboard\'s empty state when no client is linked, never a spinner that stays', async () => {
    who.auth = client;
    const saved = tables.clients.splice(0);
    try {
      mount('/calendar');
      expect(await screen.findByText('Your dashboard is being set up')).toBeInTheDocument();
      expect(screen.queryByText(/contact/i)).toBeNull();
      expect(screen.queryByText('Opening your calendar')).toBeNull();
    } finally { tables.clients.push(...saved); }
  });

  it('lets a client user with several clients choose between them, and does not redirect', async () => {
    who.auth = client;
    mount('/calendar');
    expect(await screen.findByRole('button', { name: /East Coast Co/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /West Coast Co/ })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/calendar$/);
  });

  it('opens straight in when there is exactly one client', async () => {
    who.auth = client;
    const saved = tables.clients.splice(1);
    try {
      mount('/calendar');
      expect(await screen.findByText('Client calendar')).toBeInTheDocument();
      expect(screen.getByTestId('where')).toHaveTextContent('/clients/c1/calendar');
    } finally { tables.clients.push(...saved); }
  });

  it('matches a client user of another kind of session on its company name', async () => {
    who.auth = { ...client, isGosSession: false, user: { company: 'West Coast Hub' } };
    tables.clients[1].hub_company_name = 'West Coast Hub';
    try {
      mount('/calendar');
      expect(await screen.findByText('Client calendar')).toBeInTheDocument();
      expect(screen.getByTestId('where')).toHaveTextContent('/clients/c2/calendar');
    } finally { tables.clients[1].hub_company_name = null; }
  });
});

describe('this week on the all-clients page', () => {
  it('comes from the viewer\'s own zone: Sunday evening in New York is still that week, though UTC has reached Monday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T00:30:00Z'));
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...real.call(this), timeZone: 'America/New_York' }; });
    mount('/calendar');
    await vi.waitFor(() => expect(who.gte).toContain('2026-11-02'));
    expect(who.gte).not.toContain('2026-11-09');
  });

  it('falls back to this week when the address holds a damaged week value', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
    mount('/calendar?week=abc');
    await vi.waitFor(() => expect(who.gte).toContain('2026-11-02'));
  });

  it('reads the week page by page until a page comes back short', async () => {
    const saved = tables.calendar_posts.splice(0);
    tables.calendar_posts.push(...Array.from({ length: 2500 }, (_, i) => ({ id: `x${i}`, post_key: `x${i}`, client_id: 'gone', platform: 'LinkedIn', format: 'image', post_date: '2026-11-05', posting_time: '09:00', copy: 'x', story_of: null, created_at: '2026-11-01T00:00:00Z' })));
    try {
      mount('/calendar?week=2026-11-02');
      await vi.waitFor(() => expect(who.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]));
    } finally { tables.calendar_posts.splice(0); tables.calendar_posts.push(...saved); }
  });

  it('words an empty week by what the person gets', async () => {
    const saved = tables.calendar_posts.splice(0);
    try {
      mount('/calendar?week=2026-11-02');
      expect(await screen.findByText('No posts planned for this week')).toBeInTheDocument();
      expect(screen.queryByText(/Monday before/)).toBeNull();
    } finally { tables.calendar_posts.push(...saved); }
  });
});
