/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { weekPlanView } from '@/lib/weekPlanStatus';
import { WeekPlanBand } from '@/components/calendar/WeekPlanControls';
import ClientCalendar from '@/pages/ClientCalendar';
import type { CalendarPlanRow } from '@/lib/calendarPosts';

// A status that stays (Lital, 3 Nov 2026). While a week is being planned or
// revised, the week's band says so, with where it stands, read from the plan
// on the server: across reloads and pages, polled quietly, until it turns into
// "Planned" or "Revised". While it is being planned it can be stopped, and a
// finished plan can be removed, each after a question.

const f = vi.hoisted(() => ({
  staff: true,
  plans: [] as any[],
  posts: [] as any[],
  invokes: [] as any[],
  failPlans: false,
  stopAnswer: null as any,
}));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: f.staff, isClient: !f.staff }) }));
vi.mock('@/hooks/useRealtimePostIterations', () => ({ useRealtimePostIterations: () => {} }));
vi.mock('@/components/layout/AppLayout', () => ({ AppLayout: ({ children, actions }: any) => <main><div>{actions}</div>{children}</main> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }), getUser: async () => ({ data: { user: { id: 'me' } } }) },
  functions: { invoke: async (name: string, opts: any) => {
    f.invokes.push({ name, ...opts.body });
    // Without an answer set, the server turns the request down (a week that is over, say).
    if (name === 'calendar-posts' && opts.body.action === 'stop_plan') return f.stopAnswer ?? { data: null, error: { message: 'Edge Function returned a non-2xx status code', context: { status: 409 } } };
    return { data: {}, error: null };
  } },
  from: (table: string) => {
    const rows = () => (table === 'calendar_plans' ? f.plans : table === 'calendar_posts' ? f.posts : table === 'clients' ? [{ id: 'c1', name: 'Pay The Pyper' }] : []);
    const q: any = {
      select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, not: () => q, order: () => q, limit: () => q, gte: () => q, lte: () => q, gt: () => q,
      maybeSingle: async () => ({ data: table === 'clients' ? { id: 'c1', name: 'Pay The Pyper', timezone: 'UTC', archived_at: null } : null, error: null }),
      then: (ok: any, fail: any) => Promise.resolve(table === 'calendar_plans' && f.failPlans ? { data: null, error: { message: 'offline' } } : { data: rows(), error: null }).then(ok, fail),
    };
    return q;
  },
} }));

const WEEK = '2026-11-09';
const TODAY = '2026-11-03';
const plan = (over: Partial<CalendarPlanRow> = {}): CalendarPlanRow => ({
  id: 'plan-9', client_id: 'c1', week_start: WEEK, status: 'queued', trigger: 'button', error: null, pending_revision: null, revisions: [],
  ready_at: null, created_at: '2026-11-03T09:00:00Z', claimed_at: null, canceled_at: null, ...over,
});

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-03T12:00:00Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); f.staff = true; f.plans = []; f.posts = []; f.invokes = []; f.failPlans = false; f.stopAnswer = null; });

describe('what the week says about its plan', () => {
  it('says the week is being planned, and where it stands: waiting to start, then writing the posts', () => {
    expect(weekPlanView(plan(), TODAY)).toEqual({ kind: 'planning', line: 'Planning the week of Nov 9…', steps: [{ label: 'Waiting to start', state: 'current' }, { label: 'Writing the posts', state: 'next' }] });
    expect(weekPlanView(plan({ status: 'planning' }), TODAY)).toMatchObject({ kind: 'planning', steps: [{ label: 'Waiting to start', state: 'done' }, { label: 'Writing the posts', state: 'current' }] });
  });

  it('says the week is being revised, with the note, and whether a run has it yet', () => {
    const revising = plan({ status: 'ready', ready_at: '2026-11-03T09:10:00Z', pending_revision: { note: 'Less formal', at: '2026-11-03T10:00:00Z' } });
    expect(weekPlanView(revising, TODAY)).toEqual({ kind: 'revising', line: 'Revising the week of Nov 9…', note: 'Less formal', steps: [{ label: 'Waiting to start', state: 'current' }, { label: 'Rewriting the posts', state: 'next' }] });
    expect(weekPlanView({ ...revising, claimed_at: '2026-11-03T10:01:00Z' }, TODAY)).toMatchObject({ steps: [{ state: 'done' }, { label: 'Rewriting the posts', state: 'current' }] });
  });

  it('turns into "Planned" once the plan is ready, and "Revised" once a revision since then is done', () => {
    const ready = plan({ status: 'ready', ready_at: '2026-11-03T09:10:00Z' });
    expect(weekPlanView(ready, TODAY)).toEqual({ kind: 'planned', line: 'Planned' });
    const revised = { ...ready, revisions: [{ note: 'Less formal', at: '2026-11-03T10:00:00Z', scope: 'untouched', done_at: '2026-11-03T10:03:00Z', rewritten: 6 }] };
    expect(weekPlanView(revised, TODAY)).toEqual({ kind: 'revised', line: 'Revised: 6 posts rewritten' });
    expect(weekPlanView({ ...revised, revisions: [{ ...revised.revisions[0], rewritten: 1 }] }, TODAY)?.line).toBe('Revised: 1 post rewritten');
    expect(weekPlanView({ ...revised, revisions: [{ ...revised.revisions[0], rewritten: 0 }] }, TODAY)?.line).toBe('Revised: nothing was left to rewrite');
    // The daily run writing posts that had no copy is not a revision anyone asked for.
    expect(weekPlanView({ ...ready, revisions: [{ note: 'x', at: '2026-11-03T10:00:00Z', scope: 'empty', done_at: '2026-11-03T10:03:00Z', rewritten: 2 }] }, TODAY)?.kind).toBe('planned');
    // A revision of an earlier plan for the week is not this plan's.
    expect(weekPlanView({ ...revised, ready_at: '2026-11-03T11:00:00Z' }, TODAY)?.kind).toBe('planned');
  });

  it('says planning was stopped, or the plan removed, and nothing for a week that is over or never planned', () => {
    expect(weekPlanView(plan({ status: 'canceled', canceled_at: '2026-11-03T09:05:00Z' }), TODAY)).toEqual({ kind: 'stopped', line: 'Planning was stopped for this week.' });
    expect(weekPlanView(plan({ status: 'canceled', ready_at: '2026-11-03T09:10:00Z', canceled_at: '2026-11-03T11:00:00Z' }), TODAY)).toEqual({ kind: 'removed', line: "This week's plan was removed." });
    expect(weekPlanView(plan({ status: 'ready', week_start: '2026-10-26', ready_at: '2026-10-20T09:00:00Z' }), TODAY)).toBeNull();
    expect(weekPlanView(plan({ status: 'expired' }), TODAY)).toBeNull();
    expect(weekPlanView(null, TODAY)).toBeNull();
  });
});

describe('the week band', () => {
  const band = (p: CalendarPlanRow, onChanged = vi.fn(), canAct = true) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<QueryClientProvider client={qc}><WeekPlanBand plan={p} today={TODAY} canAct={canAct} hasPosts={false} onChanged={onChanged} /></QueryClientProvider>);
    return onChanged;
  };

  it('shows the planning with its progress, and stops it after a question', async () => {
    f.stopAnswer = { data: { plan: plan({ status: 'canceled', canceled_at: '2026-11-03T12:00:00Z' }) }, error: null };
    const onChanged = band(plan({ status: 'planning' }));
    const status = screen.getByRole('status');
    expect(within(status).getByText('Planning the week of Nov 9…')).toBeTruthy();
    expect(within(status).getByText('Writing the posts').closest('li')?.getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: 'Stop planning' }));
    expect(await screen.findByText('Stop planning the week of Nov 9?')).toBeTruthy();
    expect(f.invokes).toEqual([]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop planning' }).at(-1)!);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled' })));
    expect(f.invokes).toEqual([{ name: 'calendar-posts', action: 'stop_plan', plan_id: 'plan-9' }]);
  });

  it('asks nothing of the server until the question is answered yes', async () => {
    band(plan());
    fireEvent.click(screen.getByRole('button', { name: 'Stop planning' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('Stop planning the week of Nov 9?')).toBeNull());
    expect(f.invokes).toEqual([]);
  });

  it('removes a finished plan after a question that says what stays', async () => {
    f.stopAnswer = { data: { plan: plan({ status: 'canceled', ready_at: '2026-11-03T09:10:00Z' }) }, error: null };
    const onChanged = band(plan({ status: 'ready', ready_at: '2026-11-03T09:10:00Z' }));
    expect(screen.getByText('Planned')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revise this week' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Remove this week's plan" }));
    expect(await screen.findByText("Remove this week's plan?")).toBeTruthy();
    expect(screen.getByText(/Posts nobody has edited, designed or scheduled leave the calendar\. Posts someone worked on stay/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove the plan' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ status: 'canceled' })));
    expect(f.invokes).toEqual([{ name: 'calendar-posts', action: 'stop_plan', plan_id: 'plan-9' }]);
  });

  it('shows a revision with its note and no stop', () => {
    band(plan({ status: 'ready', ready_at: '2026-11-03T09:10:00Z', pending_revision: { note: 'Less formal', at: '2026-11-03T10:00:00Z' } }));
    expect(within(screen.getByRole('status')).getByText('Revising the week of Nov 9…')).toBeTruthy();
    expect(screen.getByText('"Less formal"')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Stop|Remove/ })).toBeNull();
  });

  it('shows the state with no buttons to someone who cannot change the calendar', () => {
    band(plan(), vi.fn(), false);
    expect(screen.getByText('Planning the week of Nov 9…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the true state when the server turns the stop down, and says nothing failed', async () => {
    const onChanged = band(plan());
    fireEvent.click(screen.getByRole('button', { name: 'Stop planning' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop planning' }).at(-1)!);
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(null));
    expect(screen.queryByText(/fail|error|try again/i)).toBeNull();
  });
});

describe('the calendar page', () => {
  const page = () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    return { qc, ...render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[`/clients/c1/calendar?week=${WEEK}`]}>
          <Routes><Route path="/clients/:id/calendar" element={<ClientCalendar />} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ) };
  };
  /** This week's plan, ready, so "Plan next week" looks past it. */
  const thisWeek = plan({ id: 'plan-2', week_start: '2026-11-02', status: 'ready', ready_at: '2026-10-26T09:00:00Z' });

  it('shows the week being planned from the server, again after a reload', async () => {
    f.plans = [plan({ status: 'planning' })];
    page();
    expect(await screen.findByText('Planning the week of Nov 9…')).toBeTruthy();
    cleanup();
    page();
    expect(await screen.findByText('Planning the week of Nov 9…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop planning' })).toBeTruthy();
  });

  it('names another week being planned, and goes to it', async () => {
    f.plans = [plan({ week_start: '2026-11-16', id: 'plan-16' })];
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Planning the week of Nov 16…' }));
    expect(await screen.findByRole('button', { name: 'Stop planning' })).toBeTruthy();
  });

  it('goes back to no plan once stopped, and offers the week again', async () => {
    f.plans = [thisWeek, plan()];
    f.stopAnswer = { data: { plan: plan({ status: 'canceled', canceled_at: '2026-11-03T12:00:00Z' }) }, error: null };
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop planning' }));
    f.plans = [thisWeek, plan({ status: 'canceled', canceled_at: '2026-11-03T12:00:00Z' })];
    fireEvent.click(screen.getAllByRole('button', { name: 'Stop planning' }).at(-1)!);
    expect(await screen.findByText('Planning was stopped for this week. You can plan it again now.')).toBeTruthy();
    expect(screen.queryByText('Planning the week of Nov 9…')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Plan the week of Nov 9' }).length).toBeGreaterThan(0);
  });

  it('keeps showing what it had when a quiet look again does not answer', async () => {
    f.plans = [plan({ status: 'planning' })];
    const { qc, container } = page();
    expect(await screen.findByText('Planning the week of Nov 9…')).toBeTruthy();
    f.failPlans = true;
    // The page's own poll, run now rather than in ten seconds.
    await qc.refetchQueries({ queryKey: ['calendar-plans', 'c1'] });
    await waitFor(() => expect(qc.getQueryState(['calendar-plans', 'c1'])?.status).toBe('error'));
    expect(screen.getByText('Planning the week of Nov 9…')).toBeTruthy();
    expect(container.textContent).not.toMatch(/did not load|Try again/);
  });
});
