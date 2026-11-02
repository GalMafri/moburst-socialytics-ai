/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The Content strategy tab (spec: docs/superpowers/specs/2026-11-02-content-
// strategy-tab-design.md, "The tab"): a person's version wherever one exists,
// with who wrote it; saves sent again quietly; empty text hands a section back;
// staff only.

const f = vi.hoisted(() => ({
  role: 'staff' as 'staff' | 'client',
  strategy: null as any,
  edits: [] as any[],
  rpcs: [] as any[],
  rpcErrors: [] as any[],
  reads: { edits: 0 },
}));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    isLoading: false, isAuthenticated: true, isMoburstStaff: f.role === 'staff', isClient: f.role === 'client', isAdmin: false,
    canManageClients: f.role === 'staff', user: { name: 'Neria', email: 'neria@moburst.com' }, isGosSession: false,
  }),
}));
vi.mock('@/components/layout/AppLayout', () => ({
  AppLayout: ({ title, meta, actions, back, nav, children }: any) => <main><h1>{title}</h1>{back}<div data-testid="meta">{meta}</div>{actions}{nav}{children}</main>,
}));
vi.mock('@/lib/quietSend', async (original) => {
  const actual = await original<typeof import('@/lib/quietSend')>();
  // Sent again at once in tests: the waits are the real module's concern.
  return { ...actual, sendQuietly: vi.fn((send: any, opts: any = {}) => actual.sendQuietly(send, { ...opts, wait: async () => {} })) };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  rpc: async (name: string, args: any) => {
    f.rpcs.push({ name, ...args });
    const error = f.rpcErrors.shift() ?? null;
    // As strategy_section_save does: the saved row back, or null when the section is handed back.
    let data: any = null;
    if (!error && name === 'strategy_section_save') {
      f.edits = f.edits.filter((e) => e.section_key !== args.p_key);
      if (args.p_text.trim()) {
        data = { section_key: args.p_key, text: args.p_text.trim(), editor_name: 'Neria Cohen', edited_at: '2026-11-04T09:00:00Z' };
        f.edits.push(data);
      }
    }
    return { data, error };
  },
  from: (table: string) => {
    const answer = () => {
      if (table === 'content_strategies') return { data: f.strategy, error: null };
      if (table === 'content_strategy_edits') { f.reads.edits++; return { data: f.edits, error: null }; }
      if (table === 'clients') return { data: [{ id: 'c1', name: 'Pay The Pyper', logo_url: null, hub_company_name: null }, { id: 'c2', name: 'Bader Law', logo_url: null, hub_company_name: null }], error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, eq: () => q, is: () => q, order: () => q, in: () => q,
      maybeSingle: async () => {
        const a = answer();
        return { ...a, data: Array.isArray(a.data) ? a.data[0] ?? null : a.data };
      },
      then: (resolve: any, reject: any) => Promise.resolve(answer()).then(resolve, reject),
    };
    return q;
  },
} }));

import ClientStrategy from '@/pages/ClientStrategy';
import StrategyIndex from '@/pages/StrategyIndex';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { SidebarProvider } from '@/components/ui/sidebar';
import { StaffOnlyRoute } from '@/components/StaffOnlyRoute';
import { activeNavigationSection } from '@/lib/navigationSection';
import { sendQuietly } from '@/lib/quietSend';

const STRATEGY = {
  client_id: 'c1',
  written_at: '2026-11-02T10:00:00Z',
  sources: ['brief', 'website', 'posts'],
  pillars: [{ name: 'Beer League Truths', description: '', share: 50 }, { name: 'Captain Life', description: '', share: 50 }],
  platforms: [
    { platform: 'Instagram', key: 'instagram', state: 'posting', handle: 'paythepyper', profile_reason: null, reason: null, suggested: false,
      cadence: { per_week: 2.4, source: 'published_8w' }, baseline: { posts: 31, posts_per_week: 2.41, median_engagement: 42, engagement_rate: 0.031 } },
    { platform: 'TikTok', key: 'tiktok', state: 'new', handle: null, profile_reason: null, reason: null, suggested: false, cadence: { per_week: 3, source: 'competitors' }, baseline: null },
    { platform: 'YouTube', key: 'youtube', state: 'not_now', handle: null, profile_reason: null, reason: 'Long video is costly to make.', suggested: true, cadence: null, baseline: null },
  ],
  sections: {
    goals: 'Grow saves on Instagram, because saved checklists bring captains back.',
    audience: 'Rec league captains who run the money.',
    positioning: "The one app built around the captain's week.",
    'pillar:Beer League Truths': 'Carousels of league truths.',
    'pillar:Captain Life': 'Checklists and reminders.',
    'platform:instagram:posting': 'The home base: carousels and reels.',
    'platform:tiktok:new': 'Launch with captain POV skits.',
    not_now: 'YouTube: Long video is costly to make.',
    avoid: 'Office photos.',
    measures: 'Instagram: median engagement per post above 42.',
  },
};

const clients: QueryClient[] = [];
function mount(path = '/clients/c1/strategy', element: React.ReactNode = <ClientStrategy />, route = '/clients/:id/strategy') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(qc);
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path={route} element={element} />
    <Route path="/" element={<p>Dashboard</p>} />
  </Routes></MemoryRouter></QueryClientProvider>);
}
const section = (id: string) => document.getElementById(id) as HTMLElement;

beforeEach(() => {
  f.role = 'staff';
  f.strategy = structuredClone(STRATEGY);
  f.edits = [
    { section_key: 'audience', text: 'Captains and their co-captains.', editor_name: 'Neria Cohen', edited_at: '2026-11-03T09:00:00Z' },
    { section_key: 'pillar:Old pillar', text: 'A pillar that left the strategy.', editor_name: 'Sinead', edited_at: '2026-10-01T09:00:00Z' },
  ];
  f.rpcs = []; f.rpcErrors = []; f.reads.edits = 0;
  vi.mocked(sendQuietly).mockClear();
});
afterEach(() => { cleanup(); clients.forEach((c) => c.clear()); clients.length = 0; });

describe('a client strategy', () => {
  it("shows a person's version and who wrote it, and the product's version and what it was written from", async () => {
    mount();
    expect(await screen.findByText('Captains and their co-captains.')).toBeInTheDocument();
    expect(screen.queryByText('Rec league captains who run the money.')).toBeNull();
    expect(within(section('strategy-audience')).getByText('Edited by Neria on Nov 3. Kept when the strategy is rewritten.')).toBeInTheDocument();
    expect(within(section('strategy-goals')).getByText('Written on Nov 2 from the brief, the website and 90 days of posts.')).toBeInTheDocument();
    expect(screen.getByTestId('meta')).toHaveTextContent('Written on Nov 2, 2026');
    // An edit whose pillar left the strategy is kept, and hidden.
    expect(screen.queryByText('A pillar that left the strategy.')).toBeNull();
  });

  it('shows each pillar with its share, each platform with its state and code cadence, not now as a list, and the baselines', async () => {
    mount();
    const pillars = within(await screen.findByTestId('strategy-pillars-grid'));
    expect(pillars.getByText('Beer League Truths')).toBeInTheDocument();
    expect(pillars.getAllByText('50% of posts')).toHaveLength(2);
    const platforms = within(section('strategy-platforms'));
    expect(platforms.getByText('Posting now')).toBeInTheDocument();
    expect(platforms.getByText('New')).toBeInTheDocument();
    expect(platforms.getByText("2.4 posts a week, the client's pace over the last 8 weeks.")).toBeInTheDocument();
    expect(platforms.getByText("3 posts a week, its tracked competitors' median.")).toBeInTheDocument();
    expect(platforms.getByText('Launch with captain POV skits.')).toBeInTheDocument();
    expect(platforms.getByText('Not now')).toBeInTheDocument();
    expect(platforms.getByText(/Long video is costly to make\./)).toBeInTheDocument();
    const measures = within(within(section('strategy-measures')).getByRole('table'));
    for (const figure of ['2.41', '42', '3.1%']) expect(measures.getByText(figure)).toBeInTheDocument();
  });

  it('saves through sendQuietly, sending again quietly when the connection drops', async () => {
    f.rpcErrors = [{ message: 'Failed to fetch' }];
    mount();
    const goals = within(await screen.findByTestId('strategy-goals-text').then(() => section('strategy-goals')));
    fireEvent.click(goals.getByRole('button', { name: 'Edit Goals' }));
    fireEvent.change(goals.getByRole('textbox', { name: 'Goals' }), { target: { value: 'Win the playoffs season.' } });
    fireEvent.click(goals.getByRole('button', { name: 'Save' }));
    expect(await goals.findByText(/^Edited by Neria on Nov 4\./)).toBeInTheDocument();
    expect(goals.queryByRole('textbox')).toBeNull();
    expect(goals.getByText('Win the playoffs season.')).toBeInTheDocument();
    expect(sendQuietly).toHaveBeenCalled();
    expect(f.rpcs).toEqual([
      { name: 'strategy_section_save', p_client: 'c1', p_key: 'goals', p_text: 'Win the playoffs season.' },
      { name: 'strategy_section_save', p_client: 'c1', p_key: 'goals', p_text: 'Win the playoffs season.' },
    ]);
  });

  it("hands a section back when saved empty, and with Use the product's version", async () => {
    mount();
    const audience = within(await screen.findByTestId('strategy-audience-text').then(() => section('strategy-audience')));
    fireEvent.click(audience.getByRole('button', { name: 'Edit Audience' }));
    fireEvent.change(audience.getByRole('textbox', { name: 'Audience' }), { target: { value: '   ' } });
    fireEvent.click(audience.getByRole('button', { name: 'Save' }));
    expect(await audience.findByText(/^Written on Nov 2/)).toBeInTheDocument();
    expect(audience.getByText('Rec league captains who run the money.')).toBeInTheDocument();
    expect(f.rpcs.at(-1)).toEqual({ name: 'strategy_section_save', p_client: 'c1', p_key: 'audience', p_text: '' });

    f.edits.push({ section_key: 'avoid', text: 'Anything that mocks other apps.', editor_name: 'Neria', edited_at: '2026-11-03T09:00:00Z' });
    cleanup();
    mount();
    const avoid = within(await screen.findByTestId('strategy-avoid-text').then(() => section('strategy-avoid')));
    expect(avoid.getByText('Anything that mocks other apps.')).toBeInTheDocument();
    fireEvent.click(avoid.getByRole('button', { name: "Use the product's version" }));
    expect(await avoid.findByText('Office photos.')).toBeInTheDocument();
    expect(avoid.queryByRole('button', { name: "Use the product's version" })).toBeNull();
    expect(f.rpcs.at(-1)).toEqual({ name: 'strategy_section_save', p_client: 'c1', p_key: 'avoid', p_text: '' });
  });

  it('keeps the text and says it is not saved yet, never that saving failed', async () => {
    f.rpcErrors = [{ code: '42501', message: 'Only Moburst staff can change the content strategy.' }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount();
    const goals = within(await screen.findByTestId('strategy-goals-text').then(() => section('strategy-goals')));
    fireEvent.click(goals.getByRole('button', { name: 'Edit Goals' }));
    fireEvent.change(goals.getByRole('textbox', { name: 'Goals' }), { target: { value: 'Mine.' } });
    fireEvent.click(goals.getByRole('button', { name: 'Save' }));
    expect(await goals.findByText('Your changes are kept here and are not saved yet.')).toBeInTheDocument();
    expect(goals.getByRole('textbox', { name: 'Goals' })).toHaveValue('Mine.');
    expect(screen.queryByText(/failed|Try again|Only Moburst staff/)).toBeNull();
    warn.mockRestore();
  });

  it('states when the strategy is written before the first write', async () => {
    f.strategy = null;
    mount();
    expect(await screen.findByText('No strategy yet')).toBeInTheDocument();
    expect(screen.getByText("Written once the client's brief and trend profile are ready.")).toBeInTheDocument();
  });
});

describe('staff only', () => {
  it('has no sidebar item for client users, and one after Reports for staff', () => {
    const sidebar = () => render(<MemoryRouter><SidebarProvider><AppSidebar /></SidebarProvider></MemoryRouter>);
    f.role = 'client';
    sidebar();
    expect(screen.queryByRole('link', { name: /Strategy/ })).toBeNull();
    cleanup();
    f.role = 'staff';
    sidebar();
    const labels = screen.getAllByRole('link').map((a) => a.textContent?.trim()).filter(Boolean);
    expect(labels.indexOf('Strategy')).toBe(labels.indexOf('Reports') + 1);
    expect(screen.getByRole('link', { name: /Strategy/ })).toHaveAttribute('href', '/strategy');
  });

  it('has no route for client users', async () => {
    const app = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
    expect(app).toContain('<Route path="/strategy" element={<StaffOnlyRoute><StrategyIndex /></StaffOnlyRoute>} />');
    expect(app).toContain('<Route path="/clients/:id/strategy" element={<StaffOnlyRoute><ClientStrategy /></StaffOnlyRoute>} />');
    f.role = 'client';
    mount('/clients/c1/strategy', <StaffOnlyRoute><ClientStrategy /></StaffOnlyRoute>);
    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.queryByText('Office photos.')).toBeNull();
  });

  it('keeps the sidebar on Strategy on both pages', () => {
    expect(activeNavigationSection('/strategy')).toBe('/strategy');
    expect(activeNavigationSection('/clients/c1/strategy')).toBe('/strategy');
    expect(activeNavigationSection('/clients/c1/setup')).toBe('/');
  });

  it('lists the active clients, each opening its strategy', async () => {
    mount('/strategy', <StrategyIndex />, '/strategy');
    expect(await screen.findByRole('button', { name: 'View the strategy for Pay The Pyper' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View the strategy for Bader Law' })).toBeInTheDocument();
  });
});
