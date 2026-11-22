/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P06-3, same pattern): the client dashboard's "Latest report" card said "No reports
// available yet" when the reports read failed. It says so only once the read has answered.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClientDashboard } from '@/components/dashboard/ClientDashboard';

const f = vi.hoisted(() => ({ reportsFail: true }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: false, isClient: true, user: { company: null }, isGosSession: true }) }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/components/dashboard/ClientOverview', () => ({ ClientOverview: () => null }));
vi.mock('@/components/clients/ClientLogo', () => ({ ClientLogo: () => null }));
vi.mock('@/lib/telemetry', () => ({ track: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, range: () => q, gte: () => q, lte: () => q, gt: () => q,
      maybeSingle: async () => (table === 'reports' && f.reportsFail
        ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
        : { data: null, error: null }),
      then: (ok: any) => Promise.resolve({ data: table === 'clients' ? [{ id: 'a', name: 'Alpha Legal', hub_company_name: null, logo_url: null, archived_at: null, timezone: 'UTC' }] : [], error: null }).then(ok),
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.reportsFail = true; });

const mount = () => render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}><ClientDashboard /></QueryClientProvider></MemoryRouter>);

it('does not say there are no reports when the reports read failed', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mount();
  expect(await screen.findByText('Loading the latest report')).toBeInTheDocument();
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.queryByText('No reports available yet')).toBeNull();
});

it('says there are no reports once the read answers with none', async () => {
  f.reportsFail = false;
  mount();
  expect(await screen.findByText('No reports available yet')).toBeInTheDocument();
});
