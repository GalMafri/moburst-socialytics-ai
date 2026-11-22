/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P05-2): NewPostDialog can be closed while "Writing the post…". Closing
// resets every field; when the write then fails, the reopened dialog says the
// date, platform and idea "are kept here" over blank fields.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { NewPostDialog } from '@/components/calendar/NewPostDialog';

const f = vi.hoisted(() => ({ settle: null as null | ((v: any) => void) }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'me' } } }) },
  functions: { invoke: () => new Promise((resolve) => { f.settle = resolve; }) },
  from: () => {
    const q: any = { select: () => q, eq: () => q, not: () => q, ilike: () => q, order: () => q,
      limit: async () => ({ data: [], error: null }), insert: async () => ({ error: null }) };
    return q;
  },
} }));
afterEach(() => cleanup());

describe('P05 NewPostDialog closed while writing', () => {
  it('never claims the idea is kept when the fields were wiped', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(<MemoryRouter><QueryClientProvider client={qc}><NewPostDialog clientId="c1" platforms={['Instagram']} defaultDate="2026-11-05" /></QueryClientProvider></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /New post/ }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Story' })); // picks the only Story platform
    fireEvent.change(screen.getByLabelText('Idea'), { target: { value: 'Captains pay last' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to calendar' }));
    await screen.findByText('Writing the post…');
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); // close while busy
    await waitFor(() => expect(screen.queryByLabelText('Idea')).toBeNull());
    // The write is refused (a 4xx, not resent).
    await act(async () => { f.settle!({ data: null, error: { context: { status: 400 }, message: 'refused' } }); });
    fireEvent.click(screen.getByRole('button', { name: /New post/ }));
    const idea = await screen.findByLabelText('Idea');
    const line = screen.queryByText(/The date, platform and idea are kept here/);
    // The idea really is kept, as the line says.
    expect((idea as HTMLTextAreaElement).value).toBe('Captains pay last');
    expect(line).not.toBeNull();
  });
});
