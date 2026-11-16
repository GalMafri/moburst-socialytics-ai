/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NewPostDialog } from '@/components/calendar/NewPostDialog';
import { commonPostingTime } from '@/lib/calendarDate';

// New post (CAL-28): a post made here gets a time, prefilled with the time the
// client's planned posts on that platform use most, and its Open action moves
// inside the app instead of reloading it.

const f = vi.hoisted(() => ({ inserts: [] as any[], times: [] as Array<string | null>, toast: vi.fn(), navigate: vi.fn() }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: f.toast, error: vi.fn(), warning: vi.fn() } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => f.navigate }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) },
  functions: { invoke: async () => ({ data: { post: { platform: 'Instagram', caption_angle: 'Captains pay last.', concept: 'c', hashtags: [] } }, error: null }) },
  from: () => {
    const q: any = {
      select: () => q, eq: () => q, not: () => q, ilike: () => q, order: () => q,
      limit: async () => ({ data: f.times.map((posting_time) => ({ posting_time })), error: null }),
      insert: async (row: any) => { f.inserts.push(row); return { error: null }; },
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.inserts = []; f.times = []; vi.clearAllMocks(); });

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<MemoryRouter><QueryClientProvider client={qc}><NewPostDialog clientId="c1" platforms={['Instagram']} defaultDate="2026-11-05" /></QueryClientProvider></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: /New post/ }));
}

describe('commonPostingTime', () => {
  it('is the time most posts use as HH:MM, whatever form they are stored in, the newest winning a tie', () => {
    expect(commonPostingTime(['6:00 PM', '18:00', '10:00 PM'])).toBe('18:00');
    expect(commonPostingTime(['9:00 AM', '7:00 PM'])).toBe('09:00');
    expect(commonPostingTime([null, 'soon'])).toBeNull();
  });
});

describe('New post', () => {
  it('saves the time with the post, prefilled from the times the client plans on that platform', async () => {
    f.times = ['18:00', '6:00 PM', '10:00 AM'];
    open();
    fireEvent.click(await screen.findByRole('radio', { name: 'Story' }));
    const time = await screen.findByLabelText('Time');
    await waitFor(() => expect(time).toHaveValue('18:00'));
    fireEvent.change(screen.getByLabelText('Idea'), { target: { value: 'Captains pay last' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    await waitFor(() => expect(f.inserts).toHaveLength(1));
    expect(f.inserts[0].posting_time).toBe('18:00');
  });

  it('saves a time someone types over the suggestion, as HH:MM', async () => {
    f.times = ['18:00'];
    open();
    fireEvent.click(await screen.findByRole('radio', { name: 'Story' }));
    const time = await screen.findByLabelText('Time');
    await waitFor(() => expect(time).toHaveValue('18:00'));
    fireEvent.change(time, { target: { value: '07:30' } });
    fireEvent.change(screen.getByLabelText('Idea'), { target: { value: 'Captains pay last' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    await waitFor(() => expect(f.inserts[0]?.posting_time).toBe('07:30'));
  });

  it("opens the client's week with the router, not by reloading the app", async () => {
    f.times = ['18:00'];
    open();
    fireEvent.click(await screen.findByRole('radio', { name: 'Story' }));
    fireEvent.change(screen.getByLabelText('Idea'), { target: { value: 'Captains pay last' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    await waitFor(() => expect(f.toast).toHaveBeenCalled());
    const action = f.toast.mock.calls[0][1].action;
    action.onClick();
    expect(f.navigate).toHaveBeenCalledWith('/clients/c1/calendar?week=2026-11-02');
    expect(within(document.body).queryByText('Not on the calendar yet.', { exact: false })).toBeNull();
  });
});
