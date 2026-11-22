/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P05-1): "Stop planning the week?" stays open after the poll shows the plan
// finished ("Planned"). Confirming sends stop_plan for a ready plan, which the
// server (calendar_stop_plan) treats as "Remove this week's plan": the posts
// just written that nobody touched leave the calendar.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WeekPlanBand } from '@/components/calendar/WeekPlanControls';
import type { CalendarPlanRow } from '@/lib/calendarPosts';

const f = vi.hoisted(() => ({ sent: [] as any[] }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/lib/calendarRequests', () => ({ queueCalendarWork: async (body: any) => { f.sent.push(body); return { plan: null }; } }));
afterEach(() => { cleanup(); f.sent = []; });

const plan = (over: Partial<CalendarPlanRow>): CalendarPlanRow => ({
  id: 'plan-9', client_id: 'c1', week_start: '2026-11-09', status: 'planning', trigger: 'button', error: null, pending_revision: null,
  revisions: [], ready_at: null, created_at: '2026-11-03T09:00:00Z', claimed_at: '2026-11-03T09:01:00Z', canceled_at: null, ...over,
} as CalendarPlanRow);

describe('P05 Stop planning confirmed after the plan finished', () => {
  it('does not send a stop (which removes the finished week) for a plan that is now ready', async () => {
    const { rerender } = render(<WeekPlanBand plan={plan({})} today="2026-11-03" canAct hasPosts onChanged={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop planning' }));
    await screen.findByText(/Stop planning the week of/);
    // The 10-second poll answers: the plan is done.
    rerender(<WeekPlanBand plan={plan({ status: 'ready', ready_at: '2026-11-03T09:05:00Z' })} today="2026-11-03" canAct hasPosts onChanged={() => {}} />);
    const confirm = screen.queryByRole('button', { name: 'Stop planning' });
    if (confirm) fireEvent.click(confirm);
    await new Promise((r) => setTimeout(r, 20));
    expect(f.sent.filter((b) => b.action === 'stop_plan')).toHaveLength(0);
  });
});
