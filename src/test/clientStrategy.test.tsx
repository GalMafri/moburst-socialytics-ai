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
  logo: null as string | null,
  calendar: [] as any[],
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
  AppLayout: ({ title, description, meta, actions, back, nav, children }: any) => <main><h1>{title}</h1><p data-testid="description">{description}</p>{back}<div data-testid="meta">{meta}</div><div data-testid="actions">{actions}</div>{nav}{children}</main>,
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
      if (table === 'content_strategies') return { data: f.strategy ? [f.strategy] : [], error: null };
      if (table === 'content_strategy_edits') { f.reads.edits++; return { data: f.edits, error: null }; }
      if (table === 'calendar_posts') return { data: f.calendar, error: null };
      if (table === 'content_strategy_exports') return { data: f.exports, error: null };
      if (table === 'clients') return { data: [{ id: 'c1', name: 'Pay The Pyper', logo_url: f.logo, hub_company_name: null }, { id: 'c2', name: 'Bader Law', logo_url: null, hub_company_name: null }], error: null };
      return { data: [], error: null };
    };
    const q: any = {
      select: () => q, eq: () => q, is: () => q, order: () => q, in: () => q, limit: () => q, gte: () => q, lte: () => q,
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
import { basisChip, COMPARABLE_MIN_POSTS, figure, goalFigure, percentOf, writtenFrom } from '@/lib/strategyView';
import { COMPETITOR_MIN_POSTS } from '../../supabase/functions/_shared/strategy/publicRead';
import { pillarShares } from '../../supabase/functions/_shared/strategy/pillarShares';

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

// The client's calendar posts of the last 8 weeks, as many under each pillar as given.
const posts = (beer: number, captain: number, other = 0) => [
  ...Array.from({ length: beer }, () => ({ pillar: 'Beer League Truths' })),
  ...Array.from({ length: captain }, () => ({ pillar: 'Captain Life' })),
  ...Array.from({ length: other }, () => ({ pillar: 'Old pillar' })),
];
beforeEach(() => {
  f.role = 'staff';
  f.strategy = structuredClone(STRATEGY);
  f.edits = [
    { section_key: 'audience', text: 'Captains and their co-captains.', value: null, editor_name: 'Neria Cohen', edited_at: '2026-11-03T12:00:00Z' },
    { section_key: 'pillar:Old pillar', text: 'A pillar that left the strategy.', value: null, editor_name: 'Sinead', edited_at: '2026-10-01T09:00:00Z' },
  ];
  f.exports = [];
  f.calendar = posts(5, 5);
  f.google = { ready: true, connected: true, account_email: 'ai@moburst.com', connected_at: '2026-11-01T00:00:00Z' };
  f.rpcs = []; f.rpcErrors = []; f.reads.edits = 0; f.logo = null;
  vi.mocked(sendQuietly).mockClear();
});
afterEach(() => { cleanup(); clients.forEach((c) => c.clear()); clients.length = 0; });

describe('a client strategy', () => {
  it('reads in the wireframe order: the header, then the plan, where we start, audience and positioning, pillars, platforms, what we avoid', async () => {
    mount();
    const header = await screen.findByTestId('strategy-header');
    expect(header).toHaveTextContent('Social strategy, Nov 3, 2026 to Feb 1, 2027');
    expect(header).toHaveTextContent('Written Nov 3 from the brief, the website and 90 days of posts');
    expect(header).toHaveTextContent('Instagram from your own account; LinkedIn from public posts; TikTok not measured yet');
    const ids = [...document.querySelectorAll('section[id^="strategy-"]')].map((s) => s.id);
    expect(ids).toEqual(['strategy-plan', 'strategy-start', 'strategy-audience', 'strategy-pillars', 'strategy-platforms', 'strategy-avoid']);
    // One origin line for the page; no card repeats it.
    expect(screen.getAllByText(/^Written Nov 3/)).toHaveLength(1);
  });

  it('shows the plan as tiles and goal cards, each with its figure today and its date', async () => {
    mount();
    const plan = within(await screen.findByTestId('strategy-goals').then(() => section('strategy-plan')));
    expect(plan.getByText('Platforms').closest('div')!.parentElement).toHaveTextContent('3');
    expect(plan.getByText('Grow engagement per post on Instagram')).toBeInTheDocument();
    expect(plan.getAllByTestId('goal-today')[0]).toHaveTextContent('42 median engagement per post today');
    expect(plan.getByText('Raise it above 42 by Feb 1, 2027')).toBeInTheDocument();
    expect(plan.getByText('Raise it above 0 by Feb 1, 2027')).toBeInTheDocument();
    expect(plan.getByText('Why: Carousels beat the usual 2.7x.')).toBeInTheDocument();
  });

  it('starts each platform from code numbers, the brand against its competitors, and the measures behind a disclosure', async () => {
    mount();
    const start = within(await screen.findByTestId('strategy-start-instagram'));
    for (const t of ['From connected accounts', 'Followers', '1,800', '2.4', '42', 'Engagement', 'median per post', 'Rate', 'per impression', '3.1%']) expect(start.getAllByText(t).length).toBeGreaterThan(0);
    // The tiles, and the brand against its competitors on the same two measures.
    expect(start.getByText('Posts')).toBeInTheDocument(); expect(start.getByText('a week, last 90 days')).toBeInTheDocument();
    expect(start.getByText('Posts a week')).toBeInTheDocument();
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
    expect(audience.getByText('Edited by Neria, Nov 3')).toBeInTheDocument();
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
    expect(within(screen.getByTestId('strategy-avoid')).getByText('Industry trends')).toBeInTheDocument();
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
    expect(card.getByText('Edited by Neria, Nov 4')).toBeInTheDocument();
    expect(sendQuietly).toHaveBeenCalled();
    const sent = { name: 'strategy_section_save', p_client: 'c1', p_key: 'positioning', p_text: 'Payments and roster in one place.\n- vs BenchApp: BenchApp posts memes; we post checklists.', p_value: { statement: 'Payments and roster in one place.', points: [{ vs: 'BenchApp', point: 'BenchApp posts memes; we post checklists.' }] } };
    expect(f.rpcs).toEqual([sent, sent]);
  });

  it("shows a version saved from the connector as its text with its chip, and a page save after it as the person's own", async () => {
    f.edits = [{ section_key: 'positioning', text: 'Payments first, memes never.', value: null, editor_name: 'Sinead Cronin', edited_at: '2026-11-03T15:00:00Z', source: 'claude' }];
    mount();
    const card = within(await screen.findByTestId('strategy-positioning'));
    expect(card.getByText('Payments first, memes never.')).toBeInTheDocument();
    expect(card.getByText('From the connector, by Sinead, Nov 3')).toBeInTheDocument();
    fireEvent.click(card.getByRole('button', { name: 'Edit our position' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(sheet.getByText('The version saved from the connector')).toBeInTheDocument();
    // Saving the written fields as they are would hand the card back; the person words their own.
    fireEvent.change(sheet.getByLabelText('Our position'), { target: { value: 'Payments first.' } });
    fireEvent.click(sheet.getByRole('button', { name: 'Save' }));
    expect(await card.findByText('Edited by Neria, Nov 4')).toBeInTheDocument();
    expect(card.queryByText(/From the connector/)).toBeNull();
  });

  it("moves a 2 Nov text edit to the new form from the sheet, and hands a card back with Go back to the written version", async () => {
    mount();
    const card = within(await screen.findByTestId('strategy-audience'));
    fireEvent.click(card.getByRole('button', { name: 'Edit who we write for' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(sheet.getByText("Your team's earlier version")).toBeInTheDocument();
    expect(sheet.getByLabelText('Who we write for')).toHaveValue('Rec league captains who run the money.');
    fireEvent.click(sheet.getByRole('button', { name: "Go back to the written version" }));
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
      expect(screen.getByText("The strategy appears here as soon as it is written.")).toBeInTheDocument();
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

  it('shows no Slides button and no note when Google is not connected yet, and the PDF still works', async () => {
    f.google = { ready: false, connected: false, account_email: null, connected_at: null };
    mount();
    const actions = within(await screen.findByTestId('actions'));
    await waitFor(() => expect(actions.queryByRole('button', { name: /Google Slides deck/ })).toBeNull());
    expect(actions.queryByText(/unavailable/i)).toBeNull();
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
    expect(deckState({ connected: true, exports: [{ ...done, status: 'failed', url: null }], writtenAt: done.strategy_written_at, newestEdit: null }).kind).toBe('failed');
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
    // One client's pages sit under /clients/:id (ClientAccessGate); its strategy page is staff-only.
    expect(app).toMatch(/<Route path="\/clients\/:id" element=\{<ClientAccessGate \/>\}>[\s\S]*<Route path="strategy" element=\{<StaffOnlyRoute><ClientStrategy \/><\/StaffOnlyRoute>\} \/>[\s\S]*<\/Route>/);
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

describe('the strategy page: labels, bars and states', () => {
  const edit = (change: (s: any) => void) => { change(f.strategy); };
  const widthOf = (root: HTMLElement, title: string) => {
    const bar = root.querySelector(`[title="${title}"]`) as HTMLElement;
    return parseFloat((bar.querySelector('[style*="width"]') as HTMLElement).style.width);
  };

  it('prints a goal as today\'s figure with what it measures, and the target as a sentence', async () => {
    edit((s) => { s.sections.goals.items[1] = { ...s.sections.goals.items[1], baseline: 0.54 }; });
    mount();
    const goals = within(await screen.findByTestId('strategy-goals'));
    expect(goals.getAllByTestId('goal-today')[1]).toHaveTextContent('0.5 posts a week today');
    expect(goals.getByText('Raise it above 0.5 by Feb 1, 2027')).toBeInTheDocument();
  });

  it('says what a goal with no reading yet measures, and prints no bare figure', () => {
    const g = { title: 't', why: '', platform: 'TikTok', metric: 'followers', direction: 'below', baseline: null, by: '2027-02-09' } as any;
    expect(goalFigure(g)).toEqual({ figure: '', measure: 'Followers today: No data', target: "Bring it below today's level by Feb 9, 2027" });
    expect(goalFigure({ ...g, metric: 'engagement_rate', direction: 'above', baseline: 0.031 })).toMatchObject({ figure: '3.1%', measure: 'engagement rate today', target: 'Raise it above 3.1% by Feb 9, 2027' });
  });

  it('prints No data for a number nobody has, and the words people read name no vendor', () => {
    expect(figure(null)).toBe('No data');
    expect(percentOf(undefined)).toBe('No data');
    for (const b of ['measured', 'public', 'thin', 'none']) expect(basisChip(b)).not.toMatch(/sprout|rivaliq|apify|claude/i);
    expect(writtenFrom(['competitors'])).toBe('the competitors we chose');
    expect(writtenFrom(['brief', 'competitors', 'posts'])).not.toMatch(/tracked/);
  });

  it('names the two per-week numbers apart and leaves a category pace out of the plan total', async () => {
    edit((s) => { s.platforms[1].cadence = { per_week: 5, source: 'all_tracked' }; });
    mount();
    const plan = within(await screen.findByTestId('strategy-goals').then(() => section('strategy-plan')));
    // 2.4 on Instagram and 1 on LinkedIn; the 5 a week that is the usual pace of other brands is not a plan.
    expect(plan.getByText('Planned a week').closest('div')!.parentElement).toHaveTextContent('3.4');
    expect(within(screen.getByTestId('strategy-platform-instagram')).getByText('Planned a week')).toBeInTheDocument();
    // The plan tile is the sum of the cards' own "Planned a week" values; the category pace sits under its own label.
    const cardPlanned = ['instagram', 'tiktok', 'linkedin'].flatMap((k) => {
      const card = within(screen.getByTestId(`strategy-platform-${k}`));
      const tile = card.queryByText('Planned a week');
      return tile ? [Number(tile.closest('div')!.parentElement!.textContent!.match(/\d+(\.\d+)?/)![0])] : [];
    });
    expect(cardPlanned.reduce((a, b) => a + b, 0)).toBeCloseTo(3.4, 5);
    const tiktok = within(screen.getByTestId('strategy-platform-tiktok'));
    expect(tiktok.queryByText('Planned a week')).toBeNull();
    expect(tiktok.getByText('Usual pace in this category')).toBeInTheDocument();
    expect(within(screen.getByTestId('strategy-start-instagram')).getByText('a week, last 90 days')).toBeInTheDocument();
  });

  it('shows no vendor or pipeline word anywhere on the page, the measures table included', async () => {
    mount();
    await screen.findByTestId('strategy-header');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/sprout|rivaliq|apify|openai|claude|supabase|trend profile/i);
    expect(within(screen.getByTestId('strategy-measures')).getByText('Impressions, reach and engagement from connected accounts')).toBeInTheDocument();
  });

  it('draws the planned shares of the pillars on one scale from 0 to 100', async () => {
    f.calendar = posts(2, 8);
    edit((s) => {
      s.sections['pillar:Beer League Truths'].planned_share = 10;
      s.sections['pillar:Captain Life'].planned_share = 40;
    });
    mount();
    const mix = await screen.findByTestId('strategy-mix');
    const a = widthOf(mix, 'Beer League Truths, Planned: 10');
    const b = widthOf(mix, 'Captain Life, Planned: 40');
    expect(a).toBe(10);
    expect(b / a).toBe(4);
    expect(widthOf(mix, 'Captain Life, Last 8 weeks: 80')).toBe(80);
  });

  it('draws no last-8-weeks bars for pillars that have no share, and never a 0 for a missing one', async () => {
    mount();
    const full = await screen.findByTestId('strategy-mix');
    expect(within(full).getByText('Last 8 weeks')).toBeInTheDocument();
    // Posts under a pillar the strategy no longer has: the mix cannot be told.
    cleanup();
    f.calendar = posts(4, 4, 2);
    mount();
    const partial = await screen.findByTestId('strategy-mix');
    expect(full).not.toBe(partial);
    expect(within(partial).queryByText('Last 8 weeks')).toBeNull();
    // Too few posts to say anything about the mix.
    cleanup();
    f.calendar = posts(2, 2);
    mount();
    expect(within(await screen.findByTestId('strategy-mix')).queryByText('Last 8 weeks')).toBeNull();
  });

  it('works the pillar shares out from the calendar posts as the page opens, not from the stored strategy', async () => {
    // The stored strategy says 50 and 50; the calendar says otherwise, and the calendar is what shows.
    f.calendar = posts(3, 7);
    const expected = pillarShares(['Beer League Truths', 'Captain Life'], f.calendar);
    expect(expected).toEqual([30, 70]);
    mount();
    const mix = await screen.findByTestId('strategy-mix');
    expect(widthOf(mix, `Beer League Truths, Last 8 weeks: ${expected[0]}`)).toBe(30);
    expect(widthOf(mix, `Captain Life, Last 8 weeks: ${expected[1]}`)).toBe(70);
    expect(mix.querySelector('[title$="Last 8 weeks: 50"]')).toBeNull();
  });

  it('shows no tile for a number nobody has, and today\'s followers and engagement once, in Where we start', async () => {
    mount();
    const li = within(await screen.findByTestId('strategy-start-linkedin'));
    expect(li.queryByText('Followers')).toBeNull();
    expect(li.getByText('Engagement')).toBeInTheDocument();
    const tiktok = within(screen.getByTestId('strategy-start-tiktok'));
    expect(tiktok.getByText('No posts yet')).toBeInTheDocument();
    expect(tiktok.queryByText('Rate')).toBeNull();
    expect(tiktok.queryByText('Engagement')).toBeNull();
    expect(tiktok.queryByText('Followers')).toBeNull();
    for (const key of ['instagram', 'tiktok', 'linkedin']) {
      const card = within(screen.getByTestId(`strategy-platform-${key}`));
      expect(card.queryByText('Followers')).toBeNull();
      expect(card.queryByText('Engagement')).toBeNull();
    }
    // A rate with no figure behind it gets no tile.
    cleanup();
    edit((s) => { s.platforms[0].figures = { ...s.platforms[0].figures, rate: null, rate_kind: 'impression' }; });
    mount();
    expect(within(await screen.findByTestId('strategy-start-instagram')).queryByText('Rate')).toBeNull();
  });

  it('says a platform has too few posts for a median in words', async () => {
    edit((s) => { s.platforms[2].figures = { ...s.platforms[2].figures, basis: 'thin', median_engagement: null }; });
    mount();
    expect(within(await screen.findByTestId('strategy-start-linkedin')).getByText('Not enough posts yet')).toBeInTheDocument();
  });

  it('draws a competitor read on enough posts only, by its display name, with the full name on hover', async () => {
    edit((s) => {
      s.platforms[0].competitors = [
        { company: 'BenchApp', platform: 'Instagram', posts: 60, posts_per_week: 4.67, median_engagement: 18, followers: 9100 },
        { company: 'TeamSnap', platform: 'Instagram', posts: 2, posts_per_week: 9, median_engagement: 37, followers: null },
        { company: 'reyeslaw.com', platform: 'Instagram', posts: 30, posts_per_week: 3, median_engagement: 12, followers: null },
        { company: 'Hero Cosmetics (Mighty Patch)', platform: 'Instagram', posts: 12, posts_per_week: 2, median_engagement: 9, followers: null },
      ];
    });
    mount();
    const bars = within(await screen.findByTestId('strategy-compare-instagram'));
    expect(bars.queryByText('TeamSnap')).toBeNull();
    expect(bars.queryByText('reyeslaw.com')).toBeNull();
    expect(bars.getAllByText('Reyes Law').length).toBeGreaterThan(0);
    expect(bars.getAllByText('Hero Cosmetics (Mighty Patch)')[0]).toHaveAttribute('title', 'Hero Cosmetics (Mighty Patch)');
    expect(bars.getByText('Competitor figures cover their latest public posts.')).toBeInTheDocument();
  });

  it('keeps the competitor minimum the same as the one the writer uses', () => {
    expect(COMPARABLE_MIN_POSTS).toBe(COMPETITOR_MIN_POSTS);
  });

  it('shows the client logo in the header on screen, and no bar is a tab stop', async () => {
    f.logo = 'https://cdn.example.com/pyper.png';
    mount();
    const brand = await screen.findByTestId('strategy-header-brand');
    expect(brand).not.toHaveClass('hidden');
    expect(brand.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/pyper.png');
    for (const id of ['strategy-mix', 'strategy-compare-instagram']) {
      expect(screen.getByTestId(id).querySelectorAll('[tabindex]')).toHaveLength(0);
    }
  });

  it('shows Updating while a new version is being written, and not otherwise', async () => {
    edit((s) => { s.updating = 'write'; });
    mount();
    expect(within(await screen.findByTestId('strategy-header')).getByText('Updating')).toBeInTheDocument();
    cleanup();
    edit((s) => { s.updating = null; });
    mount();
    expect(within(await screen.findByTestId('strategy-header')).queryByText('Updating')).toBeNull();
  });

  it('reads only a small value for an update under way, never the whole write', async () => {
    mount();
    await screen.findByTestId('strategy-header');
    const page = readFileSync(join(__dirname, '..', 'pages', 'ClientStrategy.tsx'), 'utf8');
    expect(page).toContain('updating:pending->>phase');
    expect(page).not.toMatch(/select\([^)]*\bpending\b(?!->>)/);
  });

  it('tells each card of the index when its strategy was written, and which one is being updated', async () => {
    f.strategy.updating = 'write';
    mount('/strategy', <StrategyIndex />, '/strategy');
    const card = await screen.findByRole('button', { name: 'View the strategy for Pay The Pyper' });
    expect(await within(card).findByText('Written Nov 3, 2026')).toBeInTheDocument();
    expect(within(card).getByText('Updating')).toBeInTheDocument();
    expect(within(screen.getByRole('button', { name: 'View the strategy for Bader Law' })).queryByText(/^Written/)).toBeNull();
  });

  it('describes the index in what it shows, and the empty page in what the person gets', async () => {
    mount('/strategy', <StrategyIndex />, '/strategy');
    expect(screen.getByTestId('description')).toHaveTextContent("Each client's 90-day social strategy.");
    expect(screen.getByTestId('description').textContent).not.toMatch(/trend profile/i);
    cleanup();
    f.strategy = null;
    mount();
    expect(await screen.findByText('The strategy appears here as soon as it is written.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/trend profile/i);
  });
});
