/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The Strategy tab, version 2 (spec: docs/superpowers/specs/2026-11-03-
// strategy-v2-design.md): six band sections in the wireframe's order, cards,
// lists and numbers, disclosures the PDF opens; a pencil opens a card's
// fields and the save sends them as value; a 2 Nov text edit keeps showing as
// text with its chip; the PDF and the Google Slides deck, which says plainly
// when Google is not connected yet; staff only.

const f = vi.hoisted(() => ({
  role: 'staff' as 'staff' | 'client',
  strategy: null as any,
  edits: [] as any[],
  exports: [] as any[],
  google: { ready: true, connected: true, account_email: 'ai@moburst.com', connected_at: '2026-11-01T00:00:00Z' } as any,
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
  AppLayout: ({ title, meta, actions, back, nav, children }: any) => <main><h1>{title}</h1>{back}<div data-testid="meta">{meta}</div><div data-testid="actions">{actions}</div>{nav}{children}</main>,
}));
vi.mock('@/lib/quietSend', async (original) => {
  const actual = await original<typeof import('@/lib/quietSend')>();
  // Sent again at once in tests: the waits are the real module's concern.
  return { ...actual, sendQuietly: vi.fn((send: any, opts: any = {}) => actual.sendQuietly(send, { ...opts, wait: async () => {} })) };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: async () => ({ data: f.google, error: null }) },
  rpc: async (name: string, args: any) => {
    f.rpcs.push({ name, ...args });
    const error = f.rpcErrors.shift() ?? null;
    let data: any = null;
    if (!error && name === 'strategy_section_save') {
      f.edits = f.edits.filter((e) => e.section_key !== args.p_key);
      if (args.p_text.trim() || args.p_value) {
        data = { section_key: args.p_key, text: args.p_text.trim(), value: args.p_value ?? null, editor_name: 'Neria Cohen', edited_at: '2026-11-04T09:00:00Z', source: 'app' };
        f.edits.push(data);
      }
    }
    if (!error && name === 'strategy_deck_request') {
      data = { id: 'e9', status: 'queued' };
      f.exports.unshift({ id: 'e9', status: 'queued', url: null, strategy_written_at: f.strategy.written_at, edits_at: null, made_at: null, created_at: '2026-11-04T09:00:00Z' });
    }
    return { data, error };
  },
  from: (table: string) => {
    const answer = () => {
      if (table === 'content_strategies') return { data: f.strategy, error: null };
      if (table === 'content_strategy_edits') { f.reads.edits++; return { data: f.edits, error: null }; }
      if (table === 'content_strategy_exports') return { data: f.exports, error: null };
      if (table === 'clients') return { data: [{ id: 'c1', name: 'Pay The Pyper', logo_url: null, hub_company_name: null }, { id: 'c2', name: 'Bader Law', logo_url: null, hub_company_name: null }], error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, eq: () => q, is: () => q, order: () => q, in: () => q, limit: () => q,
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
import { deckState } from '@/components/strategy/StrategyExports';

const fig = (platform: string, over: Record<string, unknown> = {}) => ({ platform, basis: 'public', posts: 31, posts_per_week: 2.41, median_engagement: 42, rate: null, rate_kind: null, followers: 1800, ...over });
const STRATEGY = {
  client_id: 'c1',
  shape: 2,
  written_at: '2026-11-03T10:00:00Z',
  sources: ['brief', 'website', 'posts'],
  pillars: [{ name: 'Beer League Truths', share: 50 }, { name: 'Captain Life', share: 50 }],
  platforms: [
    { platform: 'Instagram', key: 'instagram', state: 'posting', handle: 'paythepyper', reason: null, cadence: { per_week: 2.4, source: 'published_8w' },
      figures: fig('Instagram', { basis: 'measured', rate: 0.031, rate_kind: 'impression' }), competitors: [{ company: 'BenchApp', platform: 'Instagram', posts: 60, posts_per_week: 4.67, median_engagement: 18, followers: 9100 }] },
    { platform: 'TikTok', key: 'tiktok', state: 'new', handle: null, reason: null, cadence: { per_week: 3, source: 'competitors' }, figures: fig('TikTok', { basis: 'none', posts: 0, posts_per_week: 0, median_engagement: null, followers: null }), competitors: [] },
    { platform: 'LinkedIn', key: 'linkedin', state: 'posting', handle: null, reason: null, cadence: { per_week: 1, source: 'published_90d' }, figures: fig('LinkedIn', { followers: null }), competitors: [] },
    { platform: 'YouTube', key: 'youtube', state: 'not_now', handle: null, reason: 'Long video is costly to make.', cadence: null, figures: null, competitors: [] },
  ],
  sections: {
    goals: { items: [
      { title: 'Grow engagement per post on Instagram', why: 'Carousels beat the usual 2.7x.', platform: 'Instagram', metric: 'median_engagement', direction: 'above', baseline: 42, by: '2027-02-01' },
      { title: 'Launch TikTok at a steady pace', why: 'Captains watch short video.', platform: 'TikTok', metric: 'posts_per_week', direction: 'above', baseline: 0, by: '2027-02-01' },
    ] },
    audience: { who: 'Rec league captains who run the money.', wants: ['Less chasing', 'Fair splits', 'Time back'], where: ['Instagram', 'TikTok'] },
    positioning: { statement: "The one app built around the captain's week.", points: [{ vs: 'BenchApp', point: 'BenchApp posts memes; we post checklists.' }] },
    'pillar:Beer League Truths': { purpose: 'Make captains laugh.', formats: ['carousel', 'reel'], planned_share: 60, ideas: [{ hook: 'Lo que nadie dice', format: 'reel' }, { hook: 'El capitán', format: 'carousel' }] },
    'pillar:Captain Life': { purpose: 'Save captains time.', formats: ['carousel'], planned_share: 40, ideas: [{ hook: 'Tu checklist', format: 'carousel' }, { hook: 'Martes', format: 'reel' }] },
    'platform:instagram:posting': { role: 'Our home base.', post: ['Checklists', 'League truths', 'Reminders'], worked: [{ date: '2026-10-05', multiple: 2.7, metric: 'impressions', link: 'https://instagram.com/p/1', text: 'Our playoff checklist', format: 'carousel' }], checks: { day_30: 'Saves per post', day_90: 'Engagement per post' } },
    'platform:tiktok:new': { role: 'Reach new captains.', post: ['POV skits', 'Quick tips', 'Replies'], worked: [], first_30: ['Set up the account', 'Three skits', 'Reply videos', 'Review'], checks: { day_30: 'Views', day_90: 'Follows' } },
    'platform:linkedin:posting': { role: 'League organizers.', post: ['a', 'b', 'c'], worked: [], checks: { day_30: 'x', day_90: 'y' } },
    not_now: { items: [{ platform: 'YouTube', reason: 'Long video is costly to make.' }] },
    avoid: { items: [{ pattern: 'Office photos with no captain in them', source: 'posts' }, { pattern: 'Job ads', source: 'trend_profile' }] },
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
    { section_key: 'audience', text: 'Captains and their co-captains.', value: null, editor_name: 'Neria Cohen', edited_at: '2026-11-03T12:00:00Z' },
    { section_key: 'pillar:Old pillar', text: 'A pillar that left the strategy.', value: null, editor_name: 'Sinead', edited_at: '2026-10-01T09:00:00Z' },
  ];
  f.exports = [];
  f.google = { ready: true, connected: true, account_email: 'ai@moburst.com', connected_at: '2026-11-01T00:00:00Z' };
  f.rpcs = []; f.rpcErrors = []; f.reads.edits = 0;
  vi.mocked(sendQuietly).mockClear();
});
afterEach(() => { cleanup(); clients.forEach((c) => c.clear()); clients.length = 0; });

describe('a client strategy', () => {
  it('reads in the wireframe order: the header, then the plan, where we start, audience and positioning, pillars, platforms, what we avoid', async () => {
    mount();
    const header = await screen.findByTestId('strategy-header');
    expect(header).toHaveTextContent('Social strategy, 3 Nov 2026 to 1 Feb 2027');
    expect(header).toHaveTextContent('Written 3 Nov from the brief, the website and 90 days of posts');
    expect(header).toHaveTextContent('Data: Instagram from Sprout | TikTok: no public posts found | LinkedIn public posts, no follower count');
    const ids = [...document.querySelectorAll('section[id^="strategy-"]')].map((s) => s.id);
    expect(ids).toEqual(['strategy-plan', 'strategy-start', 'strategy-audience', 'strategy-pillars', 'strategy-platforms', 'strategy-avoid']);
    // One origin line for the page; no card repeats it.
    expect(screen.getAllByText(/^Written 3 Nov/)).toHaveLength(1);
  });

  it('shows the plan as tiles and goal cards, each with its figure today and its date', async () => {
    mount();
    const plan = within(await screen.findByTestId('strategy-goals').then(() => section('strategy-plan')));
    expect(plan.getByText('Platforms').closest('div')!.parentElement).toHaveTextContent('3');
    expect(plan.getByText('Grow engagement per post on Instagram')).toBeInTheDocument();
    expect(plan.getByText('42')).toBeInTheDocument();
    expect(plan.getAllByText('today, above it by 1 Feb 2027')).toHaveLength(2);
    expect(plan.getByText('Why: Carousels beat the usual 2.7x.')).toBeInTheDocument();
  });

  it('starts each platform from code numbers, the brand against its competitors, and the measures behind a disclosure', async () => {
    mount();
    const start = within(await screen.findByTestId('strategy-start-instagram'));
    for (const t of ['From Sprout', 'Followers', '1,800', '2.4', '42', 'Engagement', 'median per post', 'Rate', 'per impression', '3.1%']) expect(start.getAllByText(t).length).toBeGreaterThan(0);
    // The tiles, and the brand against its competitors on the same two measures.
    expect(start.getAllByText('Posts a week')).toHaveLength(2);
    expect(start.getByText('Engagement per post')).toBeInTheDocument();
    expect(within(screen.getByTestId('strategy-compare-instagram')).getAllByText('BenchApp').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('strategy-start-tiktok')).getByText('No public posts found')).toBeInTheDocument();
    const measures = screen.getByTestId('strategy-measures');
    expect(measures.tagName).toBe('DETAILS');
    expect(within(measures).getByText('How each platform is measured')).toBeInTheDocument();
  });

  it("shows a person's 2 Nov text version as text in its card with its chip, and hides an edit whose pillar left", async () => {
    mount();
    const audience = within(await screen.findByTestId('strategy-audience'));
    expect(audience.getByText('Captains and their co-captains.')).toBeInTheDocument();
    expect(audience.queryByText('Rec league captains who run the money.')).toBeNull();
    expect(audience.getByText('Edited by Neria, 3 Nov')).toBeInTheDocument();
    expect(screen.queryByText('A pillar that left the strategy.')).toBeNull();
  });

  it('keeps example posts, first 30 days and checks behind disclosures the PDF opens, and real posts that worked', async () => {
    mount();
    const pillar = await screen.findByTestId('strategy-pillar-Beer League Truths');
    expect(within(pillar).getByText('Example posts').closest('details')).not.toBeNull();
    expect(within(pillar).getByText('60% of posts planned')).toBeInTheDocument();
    const tiktok = screen.getByTestId('strategy-platform-tiktok');
    expect(within(tiktok).getByText('First 30 days').closest('details')).not.toBeNull();
    expect(within(tiktok).getByText('Checks at 30 and 90 days').closest('details')).not.toBeNull();
    const ig = screen.getByTestId('strategy-platform-instagram');
    expect(within(ig).getByText('Our playoff checklist')).toBeInTheDocument();
    expect(within(ig).getByText(/2\.7x the usual impressions/)).toBeInTheDocument();
    expect(within(ig).getByRole('link', { name: /Open the post/ })).toHaveAttribute('href', 'https://instagram.com/p/1');
    expect(within(screen.getByTestId('strategy-not-now')).getByText('Long video is costly to make.')).toBeInTheDocument();
    expect(within(screen.getByTestId('strategy-avoid')).getByText('Trend profile')).toBeInTheDocument();
    // Pencils and chips never reach the PDF.
    for (const b of screen.getAllByRole('button', { name: /^Edit / })) expect(b).toHaveAttribute('data-print', 'hide');
  });

  it("saves a card's fields as value through sendQuietly, sending again quietly when the connection drops", async () => {
    f.rpcErrors = [{ message: 'Failed to fetch' }];
    mount();
    const card = within(await screen.findByTestId('strategy-positioning'));
    fireEvent.click(card.getByRole('button', { name: 'Edit our position' }));
    const sheet = within(await screen.findByRole('dialog'));
    fireEvent.change(sheet.getByLabelText('Our position'), { target: { value: 'Payments and roster in one place.' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await card.findByText('Payments and roster in one place.')).toBeInTheDocument();
    expect(card.getByText('Edited by Neria, 4 Nov')).toBeInTheDocument();
    expect(sendQuietly).toHaveBeenCalled();
    const sent = { name: 'strategy_section_save', p_client: 'c1', p_key: 'positioning', p_text: 'Payments and roster in one place.\n- vs BenchApp: BenchApp posts memes; we post checklists.', p_value: { statement: 'Payments and roster in one place.', points: [{ vs: 'BenchApp', point: 'BenchApp posts memes; we post checklists.' }] } };
    expect(f.rpcs).toEqual([sent, sent]);
  });

  it("shows a version saved from Claude as its text with its chip, and a page save after it as the person's own", async () => {
    f.edits = [{ section_key: 'positioning', text: 'Payments first, memes never.', value: null, editor_name: 'Sinead Cronin', edited_at: '2026-11-03T15:00:00Z', source: 'claude' }];
    mount();
    const card = within(await screen.findByTestId('strategy-positioning'));
    expect(card.getByText('Payments first, memes never.')).toBeInTheDocument();
    expect(card.getByText('From Claude, by Sinead, 3 Nov')).toBeInTheDocument();
    fireEvent.click(card.getByRole('button', { name: 'Edit our position' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(sheet.getByText('The version saved from Claude')).toBeInTheDocument();
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    expect(await card.findByText('Edited by Neria, 4 Nov')).toBeInTheDocument();
    expect(card.queryByText(/From Claude/)).toBeNull();
  });

  it("moves a 2 Nov text edit to the new form from the sheet, and hands a card back with Use the product's version", async () => {
    mount();
    const card = within(await screen.findByTestId('strategy-audience'));
    fireEvent.click(card.getByRole('button', { name: 'Edit who we write for' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(sheet.getByText("Your team's earlier version")).toBeInTheDocument();
    expect(sheet.getByLabelText('Who we write for')).toHaveValue('Rec league captains who run the money.');
    fireEvent.click(sheet.getByRole('button', { name: "Use the product's version" }));
    expect(await card.findByText('Rec league captains who run the money.')).toBeInTheDocument();
    expect(f.rpcs.at(-1)).toEqual({ name: 'strategy_section_save', p_client: 'c1', p_key: 'audience', p_text: '', p_value: null });
  });

  it('keeps the form and says it is not saved yet, never that saving failed', async () => {
    f.rpcErrors = [{ code: '42501', message: 'Only Moburst staff can change the content strategy.' }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mount();
    const card = within(await screen.findByTestId('strategy-positioning'));
    fireEvent.click(card.getByRole('button', { name: 'Edit our position' }));
    const sheet = within(await screen.findByRole('dialog'));
    fireEvent.change(sheet.getByLabelText('Our position'), { target: { value: 'Mine.' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    expect(await sheet.findByText('Your changes are kept here and are not saved yet.')).toBeInTheDocument();
    expect(sheet.getByLabelText('Our position')).toHaveValue('Mine.');
    expect(screen.queryByText(/failed|Try again|Only Moburst staff/)).toBeNull();
    warn.mockRestore();
  });

  it('still reads a strategy written on 2 Nov, as text in each card', async () => {
    f.strategy = { ...STRATEGY, shape: 1, sections: { goals: 'Grow saves on Instagram.', audience: 'Rec league captains.', positioning: 'The captain app.', avoid: 'Office photos.', measures: 'Instagram: median engagement above 42.', 'pillar:Beer League Truths': 'Carousels.', 'pillar:Captain Life': 'Checklists.', 'platform:instagram:posting': 'The home base.', 'platform:tiktok:new': 'Launch.', 'platform:linkedin:posting': 'Organizers.', not_now: 'YouTube: costly.' },
      platforms: STRATEGY.platforms.map((p) => ({ ...p, figures: undefined, competitors: undefined, baseline: p.state === 'posting' ? { posts: 31, posts_per_week: 2.41, median_engagement: 42, engagement_rate: 0.031 } : null })) };
    f.edits = [];
    mount();
    expect(await screen.findByText('Grow saves on Instagram.')).toBeInTheDocument();
    for (const t of ['Office photos.', 'The home base.', 'Carousels.']) expect(screen.getByText(t)).toBeInTheDocument();
    expect(within(screen.getByTestId('strategy-measures')).getByText('Instagram: median engagement above 42.')).toBeInTheDocument();
    expect(within(screen.getByTestId('strategy-start-instagram')).getByText('3.1%')).toBeInTheDocument();
  });

  it('states when the strategy is written before the first write, also while the first write is under way', async () => {
    for (const before of [null, { client_id: 'c1', sections: {}, platforms: [], pillars: [], sources: [], written_at: null }]) {
      f.strategy = before;
      mount();
      expect(await screen.findByText('No strategy yet')).toBeInTheDocument();
      expect(screen.getByText("Written once the client's brief and trend profile are ready.")).toBeInTheDocument();
      cleanup();
    }
  });
});

describe('the exports', () => {
  it('has the PDF, and asks for a deck through sendQuietly, then says the deck is being made', async () => {
    mount();
    const actions = within(await screen.findByTestId('actions'));
    expect(await actions.findByRole('button', { name: /Export PDF/ })).toBeInTheDocument();
    fireEvent.click(await actions.findByRole('button', { name: /Google Slides deck/ }));
    expect(await actions.findByRole('button', { name: /Making the deck/ })).toBeDisabled();
    expect(f.rpcs).toContainEqual({ name: 'strategy_deck_request', p_client: 'c1' });
  });

  it('says plainly when Google is not connected yet, and the PDF still works', async () => {
    f.google = { ready: false, connected: false, account_email: null, connected_at: null };
    mount();
    const actions = within(await screen.findByTestId('actions'));
    expect(await actions.findByText('Google Slides is not connected yet. An admin connects it once in Settings. The PDF works now.')).toBeInTheDocument();
    expect(actions.getByRole('button', { name: /Google Slides deck/ })).toBeDisabled();
    expect(actions.getByRole('button', { name: /Export PDF/ })).toBeEnabled();
    // The strategy itself never asks anyone to connect anything.
    expect(screen.getByTestId('strategy-header')).not.toHaveTextContent(/connect/i);
  });

  it('opens the deck made on a date, and offers a new one once the strategy or a person changed it', () => {
    const done = { id: 'e1', status: 'done', url: 'https://docs.google.com/presentation/d/x/edit', strategy_written_at: '2026-11-03T10:00:00Z', edits_at: '2026-11-03T12:00:00Z', made_at: '2026-11-03T13:00:00Z', created_at: '2026-11-03T12:30:00Z' };
    expect(deckState({ connected: true, exports: [done], writtenAt: '2026-11-03T10:00:00Z', newestEdit: '2026-11-03T12:00:00Z' })).toEqual({ kind: 'made', url: done.url, on: 'made Nov 3' });
    expect(deckState({ connected: true, exports: [done], writtenAt: '2026-11-03T10:00:00Z', newestEdit: '2026-11-04T09:00:00Z' }).kind).toBe('stale');
    expect(deckState({ connected: true, exports: [done], writtenAt: '2026-12-03T10:00:00Z', newestEdit: null }).kind).toBe('stale');
    expect(deckState({ connected: true, exports: [{ ...done, status: 'making' }, done], writtenAt: done.strategy_written_at, newestEdit: null }).kind).toBe('making');
    expect(deckState({ connected: false, exports: [done], writtenAt: done.strategy_written_at, newestEdit: null })).toEqual({ kind: 'not_connected', url: done.url, on: 'made Nov 3' });
    expect(deckState({ connected: false, exports: [], writtenAt: done.strategy_written_at, newestEdit: null })).toEqual({ kind: 'not_connected' });
    expect(deckState({ connected: true, exports: [{ ...done, status: 'failed', url: null }], writtenAt: done.strategy_written_at, newestEdit: null }).kind).toBe('none');
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
