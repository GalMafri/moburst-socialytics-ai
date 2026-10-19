/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

// The setup page is a view of what the lifecycle produced, with edit
// controls (self-serve design, section 1, 19 Oct 2026).

const f = vi.hoisted(() => ({ runningStep: '' as string, updates: [] as any[], deletes: [] as any[], upserts: [] as any[], rpcs: [] as any[], invokes: [] as string[], client: null as any }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions }: any) => <main>{actions}{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  rpc: async (name: string, args: any) => { f.rpcs.push({ name, ...args }); if (name === 'lifecycle_request') f.runningStep = args.p_step; return { data: null, error: null }; },
  functions: { invoke: async (name: string) => { f.invokes.push(name); return name === 'sprout-profiles' ? { data: { profiles: [{ id: 11, name: 'Bader IG', native_name: 'baderlaw', network_type: 'fb_instagram_account' }, { id: 12, name: 'Bader FB', network_type: 'facebook' }, { id: 13, name: 'Someone else', network_type: 'facebook' }] }, error: null } : { data: {}, error: null }; } },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    const filters: Record<string, unknown> = {};
    let op: 'select' | 'update' | 'delete' | 'upsert' = 'select';
    let payload: any = null;
    const answer = () => {
      if (op === 'update') { f.updates.push({ table, payload, filters: { ...filters } }); return { data: null, error: null }; }
      if (op === 'delete') { f.deletes.push({ table, filters: { ...filters } }); return { data: null, error: null }; }
      if (op === 'upsert') { f.upserts.push({ table, payload }); return { data: null, error: null }; }
      if (table === 'clients') return { data: f.client, error: null };
      if (table === 'client_lifecycle_steps') return { data: filters.step === f.runningStep ? { status: 'running', attempted_at: new Date().toISOString(), done_at: '2026-10-19T10:00:00Z' } : { status: 'done', attempted_at: '2026-10-19T10:00:00Z', done_at: '2026-10-19T10:00:00Z' }, error: null };
      if (table === 'sprout_profiles') return { data: [{ sprout_profile_id: 11, profile_name: 'Bader IG', network_type: 'fb_instagram_account', is_active: true }, { sprout_profile_id: 12, profile_name: 'Bader FB', network_type: 'facebook', is_active: true }], error: null };
      if (table === 'report_schedules') return { data: [
        { id: 's1', report_kind: 'social', is_active: true, next_run_at: '2026-11-07T07:15:00Z', last_result: 'triggered social report 1c4f4805-0000-0000-0000-000000000000' },
        { id: 's2', report_kind: 'competitive', is_active: false, next_run_at: null, last_result: "Paused 12 Oct 2026 at Lital's request" },
      ], error: null };
      if (table === 'reports') return { data: { date_range_start: '2026-09-01', date_range_end: '2026-09-30', created_at: '2026-10-07T07:20:00Z' }, error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q, in: (k: string, v: unknown) => { filters[k] = v; return q; },
      eq: (k: string, v: unknown) => { filters[k] = v; return q; },
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

const client = new Map<string, QueryClient>();
function mount(tab = 'info') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  client.set(tab, qc);
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/clients/c1/setup?tab=${tab}`]}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  f.runningStep = ''; f.updates = []; f.deletes = []; f.upserts = []; f.rpcs = []; f.invokes = [];
  f.client = {
    id: 'c1', name: 'Bader Law', website_url: 'https://baderlaw.com', timezone: 'America/New_York', geo: 'US', language: 'en',
    primary_platforms: ['Instagram', 'Facebook'], content_pillars: [{ name: 'Injury law', description: 'Plain answers' }], social_keywords: ['car accident lawyer'],
    brand_identity: { primary_color: '#112233' }, brief_text: 'Drafted from the website on 2026-10-19:\n\nWe help', media_backend: 'higgsfield',
    field_sources: { timezone: { by: 'lifecycle' }, brand_identity: { by: 'lifecycle' }, content_pillars: { by: 'lifecycle' }, brief_text: { by: 'lifecycle' } },
    location: { source: 'schema.org', timezone: 'America/New_York' }, pillars_source: 'site', pillars_derived_at: '2026-10-19T10:00:00Z',
  };
});
afterEach(() => { cleanup(); client.forEach((c) => c.clear()); client.clear(); });

it('shows where the derived values came from, offers no setup step, and starts no paid work on opening', async () => {
  mount();
  expect(await screen.findByText('Worked out from the business address the website publishes. You can change it here.')).toBeInTheDocument();
  expect(screen.getByText(/Read from the website on Oct 19, 2026\. You can change any of it here\./)).toBeInTheDocument();
  for (const gone of [/Research Brand/, /Propose pillars/, /Implement/, /Remember to hit Save/, /No profile connected for/, /Google Doc ID/]) expect(screen.queryByText(gone)).toBeNull();
  await waitFor(() => expect(f.invokes).toEqual(['sprout-profiles']));
  expect(f.rpcs).toEqual([]);
});

it('saves only the field the person changed', async () => {
  mount();
  const name = await screen.findByLabelText('Client Name *');
  await waitFor(() => expect(name).toHaveValue('Bader Law'));
  fireEvent.change(name, { target: { value: 'Bader Law Firm' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() => expect(f.updates.filter((u) => u.table === 'clients')).toHaveLength(1));
  expect(f.updates.find((u) => u.table === 'clients').payload).toEqual({ name: 'Bader Law Firm' });
  expect(f.deletes).toEqual([]);
});

it('asks the lifecycle to read the website again, quietly, and says so while it runs', async () => {
  mount();
  await screen.findByText(/Worked out from the business address/);
  fireEvent.click(screen.getAllByRole('button', { name: 'Refresh' })[0]);
  await waitFor(() => expect(f.rpcs).toEqual([{ name: 'lifecycle_request', p_client: 'c1', p_step: 'brand_read' }]));
  expect(await screen.findByText('Reading the website')).toBeInTheDocument();
});

it('keeps the matched Sprout accounts, and removes only the one a person takes off', async () => {
  mount('sprout');
  expect(await screen.findByText(/Matched automatically from Sprout's brand names/)).toBeInTheDocument();
  const remove = await screen.findByRole('checkbox', { name: 'Assign Bader FB' });
  fireEvent.click(remove);
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() => expect(f.deletes).toHaveLength(1));
  expect(f.deletes[0]).toMatchObject({ table: 'sprout_profiles', filters: { client_id: 'c1', sprout_profile_id: [12] } });
  expect(f.upserts).toEqual([]);
  expect(f.updates.filter((u) => u.table === 'clients')).toEqual([]);
});

it("says where each schedule stands in plain words, never the scheduler's own note", async () => {
  mount('schedule');
  expect(await screen.findByText('Last report: Sep 2026, ran Oct 7, 2026.')).toBeInTheDocument();
  expect(screen.getByText('The next one runs on Nov 7, 2026.')).toBeInTheDocument();
  expect(screen.getByText('Paused.')).toBeInTheDocument();
  expect(screen.queryByText(/triggered social report|at Lital's request|Latest:/)).toBeNull();
});
