/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientDashboard } from '@/components/dashboard/ClientDashboard';
import AnalyticsIndex from '@/pages/AnalyticsIndex';
import CalendarIndex from '@/pages/CalendarIndex';
import { viewerClients } from '@/lib/activeClients';

// A client user can have several clients. The dashboard, the Calendar tab and
// the Analytics tab pick them the same way: one opens straight in, several are
// chosen between, none shows the dashboard's empty state (no client user exists
// yet, so these are fixtures).

const f = vi.hoisted(() => ({
  auth: { isMoburstStaff: false, isClient: true, user: { company: null as string | null }, isGosSession: true },
  clients: [] as any[],
}));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => f.auth }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/components/dashboard/ClientOverview', () => ({ ClientOverview: ({ clientId }: any) => <p>Overview of {clientId}</p> }));
vi.mock('@/components/clients/ClientLogo', () => ({ ClientLogo: () => null }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, range: () => q, gte: () => q, lte: () => q, gt: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      then: (ok: any) => Promise.resolve({ data: table === 'clients' ? f.clients : [], error: null }).then(ok),
    };
    return q;
  },
} }));

const two = [
  { id: 'a', name: 'Alpha Legal', hub_company_name: 'Alpha Group', logo_url: null, archived_at: null, timezone: 'UTC' },
  { id: 'b', name: 'Beta Legal', hub_company_name: 'Beta Group', logo_url: null, archived_at: null, timezone: 'UTC' },
];
afterEach(() => { cleanup(); f.clients = []; f.auth = { isMoburstStaff: false, isClient: true, user: { company: null }, isGosSession: true }; });

function Where() { return <output data-testid="where">{useLocation().pathname}</output>; }
function mount(node: React.ReactNode, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
      <Routes>
        <Route path="/" element={node} />
        <Route path="/analytics" element={node} />
        <Route path="/calendar" element={node} />
        <Route path="*" element={<div>Somewhere else</div>} />
      </Routes>
      <Where />
    </QueryClientProvider></MemoryRouter>,
  );
}

const sameCompany = [
  { id: 'a', name: 'Alpha Legal', hub_company_name: 'Shared Group', logo_url: null, archived_at: null, timezone: 'UTC' },
  { id: 'b', name: 'Beta Legal', hub_company_name: 'Shared Group', logo_url: null, archived_at: null, timezone: 'UTC' },
];

describe('a company-matched viewer whose clients share one company name', () => {
  const asCompany = () => { f.clients = sameCompany; f.auth = { ...f.auth, isGosSession: false, user: { company: 'shared group' } }; };
  it('tells the dashboard choices apart by client name and switches the overview', async () => {
    asCompany();
    mount(<ClientDashboard />);
    expect(await screen.findByRole('button', { name: 'Alpha Legal', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Shared Group' })).toBeInTheDocument();
    expect(screen.getByText('Overview of a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Beta Legal' }));
    expect(screen.getByText('Overview of b')).toBeInTheDocument();
    expect(screen.queryByText('Overview of a')).toBeNull();
  });
  it('shows one card per client name on the Calendar tab', async () => {
    asCompany();
    mount(<CalendarIndex />, '/calendar');
    expect(await screen.findByRole('button', { name: 'Open the calendar for Alpha Legal' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the calendar for Beta Legal' })).toBeInTheDocument();
  });
});

describe('a client user with two clients', () => {
  it('sees both on the dashboard and switches the overview between them', async () => {
    f.clients = two;
    mount(<ClientDashboard />);
    expect(await screen.findByRole('button', { name: 'Alpha Legal', pressed: true })).toBeInTheDocument();
    expect(screen.getByText('Overview of a')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Beta Legal' }));
    expect(screen.getByText('Overview of b')).toBeInTheDocument();
    expect(screen.queryByText('Overview of a')).toBeNull();
  });

  it('sees both on the Calendar tab and is not redirected', async () => {
    f.clients = two;
    mount(<CalendarIndex />, '/calendar');
    expect(await screen.findByRole('button', { name: /Alpha Legal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beta Legal/ })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/calendar');
  });

  it('sees both on the Analytics tab and is not redirected', async () => {
    f.clients = two;
    mount(<AnalyticsIndex />, '/analytics');
    expect(await screen.findByRole('button', { name: /Alpha Legal/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Beta Legal/ })).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/analytics');
  });

  it('is taken straight to the one client of its company when the session is matched by company name', async () => {
    f.clients = two;
    f.auth = { ...f.auth, isGosSession: false, user: { company: ' beta group ' } };
    mount(<AnalyticsIndex />, '/analytics');
    expect(await screen.findByText('Somewhere else')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/clients/b/analytics');
  });
});

describe('a client user with no client yet', () => {
  it('sees a plain status on the dashboard with no instruction to contact anyone', async () => {
    mount(<ClientDashboard />);
    expect(await screen.findByText('Your dashboard is being set up')).toBeInTheDocument();
    expect(screen.getByText('Your reports, competitive analyses and analytics appear here once your account is connected.')).toBeInTheDocument();
    expect(screen.queryByText(/contact/i)).toBeNull();
  });

  it('sees the same state on the Analytics tab', async () => {
    mount(<AnalyticsIndex />, '/analytics');
    expect(await screen.findByText('Your dashboard is being set up')).toBeInTheDocument();
    expect(screen.getByText('Your analytics appear here once your account is connected.')).toBeInTheDocument();
  });

  it('says the calendar appears on the Calendar tab', async () => {
    mount(<CalendarIndex />, '/calendar');
    expect(await screen.findByText('Your calendar appears here once your account is connected.')).toBeInTheDocument();
  });
});

describe('the one rule that picks a viewer\'s clients', () => {
  const rows = [{ id: 'a', hub_company_name: 'Alpha' }, { id: 'b', hub_company_name: 'Beta' }, { id: 'c', hub_company_name: 'Beta' }];
  it('takes a company match, else what the viewer can see, and every row for a company-scoped session', () => {
    expect(viewerClients(rows, { company: 'beta' }).map((c) => c.id)).toEqual(['b', 'c']);
    expect(viewerClients(rows, { company: 'Nobody' }).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(viewerClients(rows, { company: 'Alpha', isGosSession: true }).map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(viewerClients(undefined, { company: 'x' })).toEqual([]);
  });
});
