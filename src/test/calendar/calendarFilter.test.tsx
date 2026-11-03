/* eslint-disable @typescript-eslint/no-explicit-any -- Board posts are loosely typed, as the board itself takes them. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CalendarKanban, visibleBoard } from '@/components/reports/calendar/CalendarKanban';
import { CalendarFilters, type CalendarFilterState } from '@/components/reports/calendar/CalendarFilters';
import { ContentIdeasTab } from '@/components/reports/calendar/ContentIdeasTab';

// The calendar's filters hide what they leave out (Lital, 3 Nov 2026): a
// post another platform's filter leaves out is not on the board at all, a day
// left with nothing reads as an empty day, and every count beside the filter
// counts what it shows. The client calendar and a report's content ideas
// both draw this board; the all-clients calendar has no filter.

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock('@/hooks/useRealtimePostIterations', () => ({ useRealtimePostIterations: () => {} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: null } }), getUser: async () => ({ data: { user: null } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: () => {
    const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, gte: () => q,
      maybeSingle: async () => ({ data: null, error: null }), then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok) };
    return q;
  },
} }));
afterEach(cleanup);

const ALL: CalendarFilterState = { day: 'all', platform: 'all', status: 'all', language: 'all' };
const post = (key: string, platform: string, copy: string) => ({ _calendarPostKey: key, platform, copy, format: 'Single Image' });
const WEEK = [
  { day: 'Monday', date_label: 'Nov 9', posts: [post('a', 'Instagram', 'Monday on Instagram'), post('b', 'LinkedIn', 'Monday on LinkedIn')] },
  { day: 'Tuesday', date_label: 'Nov 10', posts: [post('c', 'LinkedIn', 'Tuesday on LinkedIn')] },
  { day: 'Wednesday', date_label: 'Nov 11', posts: [post('d', 'Instagram', 'Wednesday on Instagram')] },
];

const board = (filters: CalendarFilterState) => render(
  <CalendarKanban contentCalendar={WEEK} postIterations={[]} scheduledPosts={[]} filters={filters} onCardClick={() => {}} onToggleApproved={() => {}} />,
);
const day = (name: string) => screen.getByRole('region', { name });

describe('the platform filter', () => {
  it('leaves the posts it filters out off the board entirely', () => {
    board({ ...ALL, platform: 'Instagram' });
    expect(screen.getByText('Monday on Instagram')).toBeTruthy();
    expect(screen.getByText('Wednesday on Instagram')).toBeTruthy();
    expect(screen.queryByText('Monday on LinkedIn')).toBeNull();
    expect(screen.queryByText('Tuesday on LinkedIn')).toBeNull();
  });

  it('keeps a day it empties as an empty day, and counts each day as shown', () => {
    board({ ...ALL, platform: 'Instagram' });
    expect(within(day('Monday')).getByText('1 post')).toBeTruthy();
    expect(within(day('Tuesday')).getByText('No posts')).toBeTruthy();
    expect(within(day('Wednesday')).getByText('1 post')).toBeTruthy();
    // Every day of the week is still there.
    expect(screen.getAllByRole('region')).toHaveLength(7);
  });

  it('shows everything with no filter, as before', () => {
    board(ALL);
    expect(within(day('Monday')).getByText('2 posts')).toBeTruthy();
    expect(screen.getByText('Tuesday on LinkedIn')).toBeTruthy();
  });

  it('works out what the board shows once, for the board and the count beside the filter', () => {
    const shown = visibleBoard(WEEK, [], [], { ...ALL, platform: 'LinkedIn' });
    expect(shown.total).toBe(4);
    expect(shown.shown).toBe(2);
    expect(shown.days.map((d) => d.posts.length)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    // A day the day filter leaves out is not on the board, and its posts are not counted as shown.
    const monday = visibleBoard(WEEK, [], [], { ...ALL, day: 'Monday' });
    expect(monday.days.map((d) => d.day)).toEqual(['Monday']);
    expect(monday.shown).toBe(2);
    expect(monday.total).toBe(4);
  });
});

describe('the count beside the filter', () => {
  const filters = (state: CalendarFilterState, counts?: { shown: number; total: number }) => render(
    <CalendarFilters filters={state} onChange={() => {}} availablePlatforms={['Instagram', 'LinkedIn']} availableLanguages={['en']} {...(counts ?? {})} />,
  );

  it('says how many of the week\'s posts a filter shows', () => {
    filters({ ...ALL, platform: 'Instagram' }, { shown: 2, total: 4 });
    expect(screen.getByText('Showing 2 of 4 posts')).toBeTruthy();
  });

  it('says nothing with no filter on, or before the board has its counts', () => {
    filters(ALL, { shown: 4, total: 4 });
    expect(screen.queryByText(/Showing/)).toBeNull();
    cleanup();
    filters({ ...ALL, platform: 'Instagram' });
    expect(screen.queryByText(/Showing/)).toBeNull();
  });

  it('counts one post in the singular', () => {
    filters({ ...ALL, platform: 'LinkedIn' }, { shown: 0, total: 1 });
    expect(screen.getByText('Showing 0 of 1 post')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Clear filters/ }));
  });
});

describe('the client calendar and a report\'s content ideas', () => {
  it('hide what the platform filter leaves out and count what is left beside the filter', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <ContentIdeasTab mode="calendar" contentCalendar={WEEK} aiAnalysis={null} sproutPerformance={null} clientId="c1" availablePlatforms={['Instagram', 'LinkedIn']} availableLanguages={['en']} />
      </QueryClientProvider>,
    );
    await screen.findByText('Monday on LinkedIn');
    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));
    await waitFor(() => expect(screen.queryByText('Monday on LinkedIn')).toBeNull());
    expect(screen.getByText('Monday on Instagram')).toBeTruthy();
    expect(screen.getByText('Showing 2 of 4 posts')).toBeTruthy();
    expect(within(day('Tuesday')).getByText('No posts')).toBeTruthy();
  });
});
