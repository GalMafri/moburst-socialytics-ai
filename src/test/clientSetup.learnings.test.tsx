/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

// What the brand's memory learned, in Client setup (notes on regenerate,
// Lital 3 Nov 2026): Brief labels a preference learned from a rewrite note,
// and Designs lists the learned design preferences with their source, date
// and Remove.

const f = vi.hoisted(() => ({ deletes: [] as any[] }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true, isMoburstStaff: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children }: any) => <main>{children}</main> }));
vi.mock('@/components/onboarding/DesignSettingsCard', () => ({ DesignSettingsCard: () => <div>Design settings</div> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  rpc: async () => ({ data: null, error: null }),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: 'select' | 'delete' = 'select';
    const answer = () => {
      if (op === 'delete') { f.deletes.push({ table, filters: { ...filters } }); return { data: null, error: null }; }
      if (table === 'clients') return { data: { id: 'c1', name: 'Bader Law', timezone: 'America/New_York', field_sources: {} }, error: null };
      if (table === 'brand_voice_learnings') return { data: [
        { id: 'v1', pattern_type: 'tone', pattern_description: 'Calm and plain.', times_confirmed: 1, source: 'rewrite_note' },
        { id: 'v2', pattern_type: 'length', pattern_description: 'Short captions.', times_confirmed: 2, source: 'copy_edit' },
      ], error: null };
      if (table === 'design_learnings') return { data: [
        { id: 'd1', pattern_type: 'avoid', pattern_description: 'Never show people.', source: 'regenerate_note', created_at: '2026-11-03T10:00:00Z' },
        { id: 'd2', pattern_type: 'prefer', pattern_description: 'Dark backgrounds.', source: 'feedback', created_at: '2026-10-20T10:00:00Z' },
      ], error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q, in: () => q, is: () => q,
      eq: (k: string, v: unknown) => { filters[k] = v; return q; },
      delete: () => { op = 'delete'; return q; },
      maybeSingle: async () => answer(), single: async () => answer(),
      then: (resolve: any, reject: any) => Promise.resolve(answer()).then(resolve, reject),
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.deletes = []; });

function mount(tab: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/clients/c1/setup?tab=${tab}`]}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
}

it('labels a writing preference learned from a rewrite note', async () => {
  mount('brief');
  const calm = (await screen.findByText('Calm and plain.')).closest('.glass-inner') as HTMLElement;
  expect(within(calm).getByText(/From a rewrite note/)).toBeInTheDocument();
  const short = screen.getByText('Short captions.').closest('.glass-inner') as HTMLElement;
  expect(within(short).getByText(/From a copy edit/)).toBeInTheDocument();
});

it('lists the learned design preferences with their source and date, and Remove takes one out', async () => {
  mount('designs');
  expect(await screen.findByText('Learned design preferences')).toBeInTheDocument();
  const note = screen.getByText('Never show people.').closest('.glass-inner') as HTMLElement;
  expect(within(note).getByText('Avoid')).toBeInTheDocument();
  expect(within(note).getByText(/From a regenerate note · Nov 3, 2026/)).toBeInTheDocument();
  const feedback = screen.getByText('Dark backgrounds.').closest('.glass-inner') as HTMLElement;
  expect(within(feedback).getByText('Prefer')).toBeInTheDocument();
  expect(within(feedback).getByText(/From Not right · Oct 20, 2026/)).toBeInTheDocument();
  fireEvent.click(within(note).getByRole('button', { name: 'Remove this design preference' }));
  await waitFor(() => expect(f.deletes).toEqual([{ table: 'design_learnings', filters: { id: 'd1' } }]));
});
