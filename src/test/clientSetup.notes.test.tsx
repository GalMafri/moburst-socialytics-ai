/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClientSetup from '@/pages/ClientSetup';

// Client setup, Brief tab: "Client notes" sits above "Learned writing
// preferences" (client notes design, section 8) and shows what the copy
// follows now, the same selection the writers get.

const f = vi.hoisted(() => ({ client: null as any, tables: {} as Record<string, any[]> }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ canManageClients: true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions }: any) => <main>{actions}{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  rpc: async () => ({ data: null, error: null }),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/logo.png' } }) }) },
  from: (table: string) => {
    let rows = [...(f.tables[table] ?? [])];
    const answer = (one: boolean) => {
      if (table === 'clients') return { data: f.client, error: null };
      if (table === 'client_lifecycle_steps') return { data: { status: 'done', attempted_at: '2026-10-19T10:00:00Z', done_at: '2026-10-19T10:00:00Z' }, error: null };
      return { data: one ? rows[0] ?? null : rows, error: null };
    };
    const q: any = {
      select: () => q, order: () => q, limit: () => q, not: () => q, neq: () => q, in: () => q,
      eq: (k: string, v: unknown) => { rows = rows.filter((r) => r[k] === undefined || r[k] === v); return q; },
      is: (k: string, v: unknown) => { rows = rows.filter((r) => (r[k] ?? null) === v); return q; },
      range: (a: number, b: number) => { rows = rows.slice(a, b + 1); return q; },
      maybeSingle: async () => answer(true),
      single: async () => answer(true),
      then: (resolve: any, reject: any) => Promise.resolve(answer(false)).then(resolve, reject),
    };
    return q;
  },
} }));

const clients = new Set<QueryClient>();
function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.add(qc);
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/clients/c1/setup?tab=brief']}><Routes><Route path="/clients/:id/setup" element={<ClientSetup />} /></Routes></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  f.client = {
    id: 'c1', name: 'Bader Law', website_url: 'https://baderlaw.com', timezone: 'America/New_York', geo: 'US', language: 'en',
    primary_platforms: ['Instagram'], content_pillars: [], social_keywords: [], brand_identity: {}, brief_text: 'We help', brand_notes: 'No slang.', field_sources: {},
  };
  f.tables = {
    brand_voice_learnings: [{ id: 'l1', client_id: 'c1', status: 'active', pattern_type: 'tone', pattern_description: 'Plain words.', times_confirmed: 2, source: 'copy_edit', last_confirmed_at: '2026-10-20T00:00:00Z' }],
    client_notes: [{ id: 'n1', client_id: 'c1', kind: 'typed', title: 'Call Oct 28', file_type: null, text_chars: null, parts_done: 1, note_date: '2026-10-28', date_set_by: 'app', state: 'learned', added_by_name: 'Sinead', created_at: '2026-10-28T10:00:00Z', read_at: null }],
    client_note_points: [{ id: 'p1', client_id: 'c1', note_id: 'n1', kind: 'avoid', text: 'Never say "cheap".', platform: null, said_on: null, until: null, part: 1, removed_at: null, created_at: '2026-10-28T10:05:00Z' }],
    client_note_links: [],
  };
});
afterEach(() => { cleanup(); clients.forEach((c) => c.clear()); clients.clear(); });

it('shows the client notes on the Brief tab, above the learned writing preferences', async () => {
  mount();
  const notes = await screen.findByRole('heading', { name: 'Client notes' });
  const learned = await screen.findByRole('heading', { name: 'Learned writing preferences' });
  expect(notes.compareDocumentPosition(learned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const follows = await screen.findByRole('region', { name: 'What the copy follows now' });
  expect(within(follows).getByText('Never say "cheap".')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Call Oct 28' })).toBeInTheDocument();
});
