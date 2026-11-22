/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P18-07, P18-08): Save on a new client makes its id once for
// the form, so a second press after an insert whose reply never came sends
// the same insert, never a second client; and a design style re-learn that
// was not asked for is not passed over in silence.
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

const f = vi.hoisted(() => ({ client: null as any, inserts: [] as any[], insertError: null as any, rpcs: [] as any[], rpcError: null as any }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions, meta }: any) => <main>{meta}{actions}{children}</main> }));
// The references card, reduced to the change it hands the page.
vi.mock('@/components/onboarding/DesignReferencesUpload', () => ({ DesignReferencesUpload: ({ onDesignReferencesChange }: any) => (
  <button type="button" onClick={() => onDesignReferencesChange([{ path: 'c1/ref-1.png', name: 'ref-1.png' }])}>Add a reference</button>
) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  rpc: async (name: string, args: any) => {
    if (name === 'strategy_only_clients') return { data: [], error: null };
    f.rpcs.push({ name, ...args });
    return name === 'lifecycle_request' && f.rpcError ? { data: null, error: f.rpcError } : { data: null, error: null };
  },
  functions: { invoke: async () => ({ data: { profiles: [] }, error: null }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    let op = 'select'; let payload: any = null;
    const answer = async () => {
      if (op === 'insert') { f.inserts.push(payload); return { data: null, error: f.insertError }; }
      if (op === 'update') { f.client = { ...f.client, ...payload }; return { data: null, error: null }; }
      if (table === 'clients') return { data: f.client, error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q, in: () => q, eq: () => q, is: () => q,
      insert: (p: any) => { op = 'insert'; payload = p; return q; },
      update: (p: any) => { op = 'update'; payload = p; return q; },
      maybeSingle: () => answer(), single: () => answer(),
      then: (res: any, rej: any) => answer().then(res, rej),
    };
    return q;
  },
} }));

const mount = (path: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
};
beforeEach(() => { f.client = null; f.inserts = []; f.insertError = null; f.rpcs = []; f.rpcError = null; });
afterEach(() => cleanup());

it('sends a new client with the same id on every Save of the form', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  // The first press is turned down after the row may have landed; the person presses Save again.
  f.insertError = { code: '42501', message: 'refused' };
  mount('/clients/new/setup');
  fireEvent.change(await screen.findByLabelText('Client name *'), { target: { value: 'Bader Law' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(f.inserts).toHaveLength(1));
  await screen.findByText('Your changes are kept here and are not saved yet.');
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(f.inserts).toHaveLength(2));
  expect(f.inserts[1].id).toBe(f.inserts[0].id);
});

it('says the design style is not set to be learned again when that request did not go through', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  f.client = { id: 'c1', name: 'Bader Law', website_url: 'https://baderlaw.com', design_references: [] };
  f.rpcError = { code: '42501', message: 'refused' };
  mount('/clients/c1/setup?tab=brief');
  fireEvent.click(await screen.findByRole('button', { name: 'Add a reference' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(f.rpcs).toContainEqual({ name: 'lifecycle_request', p_client: 'c1', p_step: 'design_refs' }));
  expect(await screen.findByText('Saved. The design style is not set to be learned again from the new references yet.')).toBeInTheDocument();
});
