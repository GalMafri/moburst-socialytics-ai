/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P18-01: a change typed while Save is in flight is treated as saved and then
// replaced by the database value when the page reads the row again.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

const f = vi.hoisted(() => ({ client: null as any, updates: [] as any[], release: null as null | (() => void) }));
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
    let op = 'select'; let payload: any = null;
    const answer = async () => {
      if (op === 'update' && table === 'clients') {
        // The save is on its way: the person keeps typing until it lands.
        await new Promise<void>((r) => { f.release = r; });
        f.updates.push(payload); f.client = { ...f.client, ...payload };
        return { data: null, error: null };
      }
      if (table === 'clients') return { data: f.client, error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q, in: () => q, eq: () => q, is: () => q,
      update: (p: any) => { op = 'update'; payload = p; return q; },
      maybeSingle: () => answer(), single: () => answer(),
      then: (res: any, rej: any) => answer().then(res, rej),
    };
    return q;
  },
} }));

afterEach(() => cleanup());

it('keeps a change typed while the save was on its way', async () => {
  f.client = { id: 'c1', name: 'Bader Law', website_url: 'https://baderlaw.com', timezone: 'America/New_York' };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/clients/c1/setup']}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
  const name = await screen.findByLabelText('Client name *');
  await waitFor(() => expect(name).toHaveValue('Bader Law'));
  fireEvent.change(name, { target: { value: 'Bader Law Firm' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() => expect(f.release).not.toBeNull());
  // Typed while the save runs: not part of it.
  fireEvent.change(screen.getByLabelText('Website URL'), { target: { value: 'https://baderlaw.example' } });
  await act(async () => { f.release!(); });
  await waitFor(() => expect(f.updates).toEqual([{ name: 'Bader Law Firm' }]));
  await new Promise((r) => setTimeout(r, 50));
  // Expected: the typed website stays in the field and Save stays on for it.
  expect(screen.getByLabelText('Website URL')).toHaveValue('https://baderlaw.example');
  expect(screen.getByRole('button', { name: /Save/ })).toBeEnabled();
});
