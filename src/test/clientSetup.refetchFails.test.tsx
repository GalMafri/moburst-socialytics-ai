/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (regression R7 of P18-02): a client whose row has loaded, and whose form the person is editing,
// is replaced by "Loading the client" when a later read of the row (the
// refresh after a lifecycle step or a save) does not get through.
// Expected: the loaded form stays, with the person's edits.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

const f = vi.hoisted(() => ({ reads: 0, fail: false }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions, meta }: any) => <main>{meta}{actions}{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  rpc: async () => ({ data: [], error: null }),
  functions: { invoke: async () => ({ data: { profiles: [] }, error: null }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    const answer = async () => {
      if (table === 'clients') {
        f.reads += 1;
        if (f.fail) return { data: null, error: { message: 'Failed to fetch', code: '' } };
        return { data: { id: 'c1', name: 'Bader Law', website_url: 'https://baderlaw.com' }, error: null };
      }
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q, in: () => q, eq: () => q, is: () => q,
      maybeSingle: () => answer(), single: () => answer(),
      then: (res: any, rej: any) => answer().then(res, rej),
    };
    return q;
  },
} }));

afterEach(() => cleanup());

it('keeps a loaded client form on screen when a later read of the client does not get through', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/clients/c1/setup']}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
  const name = await screen.findByLabelText('Client name *');
  await waitFor(() => expect((name as HTMLInputElement).value).toBe('Bader Law'));
  fireEvent.change(name, { target: { value: 'Bader Law Group' } });
  // A refresh of the client row (as after a lifecycle step or a save) meets a dropped connection.
  f.fail = true;
  await act(async () => { await qc.refetchQueries({ queryKey: ['client', 'c1'] }); });
  await new Promise((r) => setTimeout(r, 50));
  // Expected: the form, with the person's edit, is still there.
  expect(screen.queryByText('Loading the client')).toBeNull();
  expect((screen.getByLabelText('Client name *') as HTMLInputElement).value).toBe('Bader Law Group');
});
