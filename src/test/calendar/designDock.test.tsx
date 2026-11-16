/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentIdeasTab } from '@/components/reports/calendar/ContentIdeasTab';

// Design progress stays on the calendar: a post being designed has its card in
// the bottom-right column with an Open button, whichever panel is showing.

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isMoburstStaff: true, isClient: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'me' } } } }), getUser: async () => ({ data: { user: { id: 'me' } } }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  from: (table: string) => {
    const rows = table === 'design_requests' ? [{
      id: 'r1', client_id: 'c1', calendar_post_key: 'a', platform: 'Instagram', post_copy: 'Monday on Instagram', status: 'preparing', stage: 'designing', kind: 'single',
      options_wanted: 1, options_ready: 0, requested_by: 'me', error: null, batch_id: null, created_at: '2026-11-03T10:00:00Z', updated_at: '2026-11-03T10:05:00Z', started_at: '2026-11-03T10:00:00Z',
    }] : [];
    const q: any = { select: () => q, eq: () => q, neq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, gte: () => q,
      maybeSingle: async () => ({ data: null, error: null }), then: (ok: any) => Promise.resolve({ data: rows, error: null }).then(ok) };
    return q;
  },
} }));
afterEach(cleanup);

describe('the calendar', () => {
  it('shows the card of a post being designed, and Open takes you to that post', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const week = [{ day: 'Monday', date_label: 'Nov 9', posts: [{ _calendarPostKey: 'a', platform: 'Instagram', copy: 'Monday on Instagram', format: 'Single Image' }] }];
    render(
      <QueryClientProvider client={qc}>
        <ContentIdeasTab mode="calendar" contentCalendar={week} aiAnalysis={null} sproutPerformance={null} clientId="c1" availablePlatforms={['Instagram']} availableLanguages={['en']} />
      </QueryClientProvider>,
    );
    const card = await screen.findByText(/Preparing your/);
    const dock = card.closest('[role="status"]') as HTMLElement;
    expect(dock).toBeTruthy();
    expect(dock.parentElement?.className).toContain('fixed');
    fireEvent.click(within(dock).getByRole('button', { name: /Open/ }));
    expect(await screen.findByRole('tab', { name: /Design/ })).toBeTruthy();
  });
});
