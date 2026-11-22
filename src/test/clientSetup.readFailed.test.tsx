/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P18-02: when the client row cannot be read, Client setup shows an empty,
// editable form for an existing client, and typing into it never turns Save on.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

const f = vi.hoisted(() => ({ reads: 0 }));
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
      // The read of the client row does not get through (a dropped connection).
      if (table === 'clients') { f.reads += 1; return { data: null, error: { message: 'Failed to fetch', code: '' } }; }
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

it('does not present an unread client as an empty form whose Save never turns on', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/clients/c1/setup']}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(f.reads).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 50));
  const name = screen.queryByLabelText('Client name *');
  if (name) {
    // The person fills in what looks like a blank client.
    fireEvent.change(name, { target: { value: 'Bader Law' } });
    fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://baderlaw.com' } });
    // As it is: the typing never turns Save on (nothing was loaded to compare with).
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  }
  // Expected: a load/retry state (as other pages show with LoadRetry), not a blank form for an existing client.
  expect(name).toBeNull();
});
