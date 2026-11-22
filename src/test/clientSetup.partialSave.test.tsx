/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// P18-04: Save writes the client row, then the Sprout account change is
// refused. The page says "not saved yet" for everything, keeps the saved
// fields marked as unsaved, and does not read the row again.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

const f = vi.hoisted(() => ({ client: null as any, updates: [] as any[], upserts: 0 }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions, meta }: any) => <main>{meta}{actions}{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  rpc: async () => ({ data: [], error: null }),
  functions: { invoke: async () => ({ data: { profiles: [{ id: 11, name: 'Bader IG', network_type: 'instagram' }] }, error: null }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    let op = 'select'; let payload: any = null;
    const answer = async () => {
      if (op === 'update' && table === 'clients') { f.updates.push(payload); f.client = { ...f.client, ...payload }; return { data: null, error: null }; }
      // A refusal (a foreign key), which is not sent again.
      if (op === 'upsert' && table === 'sprout_profiles') { f.upserts += 1; return { data: null, error: { code: '23503', message: 'violates foreign key constraint' } }; }
      if (table === 'clients') return { data: f.client, error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q, in: () => q, eq: () => q, is: () => q,
      update: (p: any) => { op = 'update'; payload = p; return q; },
      upsert: (p: any) => { op = 'upsert'; payload = p; return q; },
      maybeSingle: () => answer(), single: () => answer(),
      then: (res: any, rej: any) => answer().then(res, rej),
    };
    return q;
  },
} }));

afterEach(() => cleanup());

it('does not call a saved name "not saved yet" when only the account change was refused', async () => {
  f.client = { id: 'c1', name: 'Bader Law', website_url: 'https://baderlaw.com' };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/clients/c1/setup']}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
  const name = await screen.findByLabelText('Client name *');
  await waitFor(() => expect(name).toHaveValue('Bader Law'));
  fireEvent.change(name, { target: { value: 'Bader Law Firm' } });
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Sprout Social' }), { button: 0 });
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Assign Bader IG' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(f.upserts).toBe(1));
  await waitFor(() => expect(f.updates).toEqual([{ name: 'Bader Law Firm' }])); // the name landed
  // Expected: the page does not tell the person the saved name is unsaved (or says which part was not saved).
  // The line says which part is not saved: the accounts, never the name that landed.
  expect(await screen.findByText("The client details are saved. The Sprout account changes are kept here and are not saved yet.")).toBeInTheDocument();
  expect(screen.queryByText("Your changes are kept here and are not saved yet.")).toBeNull();
  expect(screen.getByLabelText('Client name *')).toHaveValue('Bader Law Firm');
  // The accounts are still to save, so Save stays on for them.
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
});
