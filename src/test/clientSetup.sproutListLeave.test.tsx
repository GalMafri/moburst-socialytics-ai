/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P18-05: the Sprout profile list on Client setup is asked for again every
// minute while it fails. Leaving the tab or page while the first ask is still
// out does not stop it: the retry is scheduled after the cleanup ran.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

const f = vi.hoisted(() => ({ asks: 0, release: null as null | (() => void) }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions }: any) => <main>{actions}{children}</main> }));
const refused = () => ({ data: null, error: Object.assign(new Error('non-2xx'), { name: 'FunctionsHttpError', context: { status: 400 } }) });
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  rpc: async () => ({ data: [], error: null }),
  functions: { invoke: async (name: string) => {
    if (name !== 'sprout-profiles') return { data: {}, error: null };
    f.asks += 1;
    if (f.asks === 1) await new Promise<void>((r) => { f.release = r; });
    return refused();
  } },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    const answer = async () => (table === 'clients' ? { data: { id: 'c1', name: 'Bader Law' }, error: null } : { data: [], error: null });
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q, in: () => q, eq: () => q, is: () => q,
      maybeSingle: () => answer(), single: () => answer(), then: (res: any, rej: any) => answer().then(res, rej),
    };
    return q;
  },
} }));

afterEach(() => vi.useRealTimers());

it('stops asking Sprout for the profile list once the person has left', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/clients/c1/setup?tab=sprout']}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(f.release).not.toBeNull());
  view.unmount(); // the person leaves while the first ask is out
  vi.useFakeTimers();
  await act(async () => { f.release!(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(3 * 60_000 + 1_000); });
  // Expected: one ask in all. Actual: one more ask every minute, with no page open.
  expect(f.asks).toBe(1);
});
