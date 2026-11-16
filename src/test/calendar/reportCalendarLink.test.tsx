/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReportCalendarLink } from '@/components/calendar/ReportCalendarLink';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => {
    const q: any = { select: () => q, eq: () => q, then: (ok: any) => Promise.resolve({ count: 0, error: null }).then(ok) };
    return q;
  },
} }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

const mount = (hasBoard = false) => render(
  <MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>
    <ReportCalendarLink clientId="c1" reportId="r1" hasBoard={hasBoard}><div>Own posts</div></ReportCalendarLink>
  </QueryClientProvider></MemoryRouter>,
);

describe('the report\'s link to the calendar', () => {
  it('carries no week, so the client page decides this week from the client\'s own zone', async () => {
    // Monday 00:30 UTC is still Sunday in New York: a week taken from UTC would point a week too far.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T00:30:00Z'));
    mount();
    const link = await screen.findByRole('link', { name: /Open the calendar/ });
    expect(link).toHaveAttribute('href', '/clients/c1/calendar');
  });

  it('says where the posts are, and nothing about when they are written', async () => {
    mount();
    expect(await screen.findByText("This report's findings feed the weekly plan. Each post's copy, design and schedule are in the Calendar.")).toBeInTheDocument();
    expect(screen.queryByText(/Monday before/)).toBeNull();
  });

  it('keeps showing its own posts for a report from before the calendar', async () => {
    mount(true);
    expect(await screen.findByText('Own posts')).toBeInTheDocument();
  });
});
