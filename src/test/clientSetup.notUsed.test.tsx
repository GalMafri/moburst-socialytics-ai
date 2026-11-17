/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

// The setup page says what happened to an account that was set aside because
// the client held two on one network: a quiet "Not used" group, with the
// reason in plain words and a way to add it back (invented brand).

const f = vi.hoisted(() => ({ parked: [] as any[], upserts: [] as any[], deletes: [] as any[], updates: [] as any[] }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions }: any) => <main>{actions}{children}</main> }));
const LISTED = [
  { id: 7020, name: 'Harbor Wax', native_name: 'harborwax', network_type: 'fb_instagram_account' },
  { id: 7021, name: 'Harbor Wax', native_name: 'harborwax', network_type: 'facebook' },
  { id: 7011, name: 'Harbor Wax (Lakeside)', native_name: 'harborwaxlakeside', network_type: 'facebook' },
];
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  rpc: async () => ({ data: null, error: null }),
  functions: { invoke: async (name: string) => (name === 'sprout-profiles' ? { data: { profiles: LISTED }, error: null } : { data: {}, error: null }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: 'select' | 'update' | 'delete' | 'upsert' = 'select';
    let payload: any = null;
    const answer = () => {
      if (op === 'update') { f.updates.push({ table, payload }); return { data: null, error: null }; }
      if (op === 'delete') { f.deletes.push({ table, filters: { ...filters } }); return { data: null, error: null }; }
      if (op === 'upsert') { f.upserts.push({ table, payload }); return { data: null, error: null }; }
      if (table === 'clients') return { data: { id: 'c1', name: 'Harbor Wax', website_url: 'https://harborwax.example', timezone: 'America/New_York', primary_platforms: ['Instagram', 'Facebook'], field_sources: {} }, error: null };
      if (table === 'client_lifecycle_steps') return { data: { status: 'done', attempted_at: '2026-11-18T10:00:00Z', done_at: '2026-11-18T10:00:00Z' }, error: null };
      // The page asks for the accounts in use, and separately for the ones that are switched off.
      if (table === 'sprout_profiles') return { data: filters.is_active === false ? f.parked : [
        { sprout_profile_id: 7020, profile_name: 'Harbor Wax', native_name: 'harborwax', network_type: 'fb_instagram_account', is_active: true, parked_at: null, parked_reason: null },
        { sprout_profile_id: 7021, profile_name: 'Harbor Wax', native_name: 'harborwax', network_type: 'facebook', is_active: true, parked_at: null, parked_reason: null },
      ], error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q, in: (k: string, v: unknown) => { filters[k] = v; return q; },
      eq: (k: string, v: unknown) => { filters[k] = v; return q; },
      is: (k: string, v: unknown) => { filters[k] = v; return q; },
      update: (p: any) => { op = 'update'; payload = p; return q; },
      delete: () => { op = 'delete'; return q; },
      upsert: (p: any) => { op = 'upsert'; payload = p; return q; },
      maybeSingle: async () => answer(),
      single: async () => answer(),
      then: (resolve: any, reject: any) => Promise.resolve(answer()).then(resolve, reject),
    };
    return q;
  },
} }));

const clients: QueryClient[] = [];
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(qc);
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/clients/c1/setup?tab=sprout']}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
}
const LAKESIDE = { sprout_profile_id: 7011, profile_name: 'Harbor Wax (Lakeside)', native_name: 'harborwaxlakeside', network_type: 'facebook', native_link: null, is_active: false, parked_at: '2026-11-18T09:00:00Z', parked_reason: 'The brand\'s own Facebook account is "Harbor Wax".' };
const SENTENCE = 'Not used: the brand\'s own Facebook account is "Harbor Wax". Add it back to use this one instead.';
beforeEach(() => { f.parked = [LAKESIDE]; f.upserts = []; f.deletes = []; f.updates = []; });
afterEach(() => { cleanup(); clients.forEach((c) => c.clear()); clients.length = 0; });

it('shows an account that was set aside in a "Not used" group, with why in plain words and a way to add it back', async () => {
  const { container } = mount();
  const group = (await screen.findByText('Not used')).closest('div')!;
  expect(within(group).getByText('Harbor Wax (Lakeside)')).toBeInTheDocument();
  expect(within(group).getByText('@harborwaxlakeside')).toBeInTheDocument();
  expect(within(group).getByText(SENTENCE)).toBeInTheDocument();
  expect(within(group).getByRole('button', { name: 'Add Harbor Wax (Lakeside) back' })).toHaveTextContent('Add it back');
  // The accounts in use are listed as before, and the one set aside is not among them.
  const connected = screen.getByText('Connected').closest('div')!;
  expect(within(connected).getAllByText('Harbor Wax')).toHaveLength(2);
  expect(within(connected).queryByText('Harbor Wax (Lakeside)')).toBeNull();
  // Nothing of how it is stored reaches the page.
  expect(container.textContent).not.toMatch(/parked|is_active|sprout_profile|lifecycle step/i);
});

it('adds the account back when a person asks: it joins the accounts in use and is saved with the page', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Add Harbor Wax (Lakeside) back' }));
  await waitFor(() => expect(screen.queryByText('Not used')).toBeNull());
  expect(within(screen.getByText('Connected').closest('div')!).getByText('Harbor Wax (Lakeside)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() => expect(f.upserts.filter((u) => u.table === 'sprout_profiles')).toHaveLength(1));
  // The row is switched on again. What the server wrote on it stays, so the server knows a person chose this one.
  expect(f.upserts.find((u) => u.table === 'sprout_profiles').payload).toEqual([
    { client_id: 'c1', sprout_profile_id: 7011, profile_name: 'Harbor Wax (Lakeside)', native_name: 'harborwaxlakeside', network_type: 'facebook', native_link: undefined, is_active: true },
  ]);
  expect(f.deletes).toEqual([]);
});

it('shows no such group for a client with no account set aside, nor for an account a person switched off', async () => {
  f.parked = [{ ...LAKESIDE, parked_at: null, parked_reason: null }];
  mount();
  expect(await screen.findByText('Connected')).toBeInTheDocument();
  await screen.findByRole('checkbox', { name: 'Assign Harbor Wax (Lakeside)' });
  expect(screen.queryByText('Not used')).toBeNull();
  expect(screen.queryByText(/Add it back/)).toBeNull();
});
