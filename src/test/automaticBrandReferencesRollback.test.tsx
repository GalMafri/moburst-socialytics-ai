/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P06): AutomaticBrandReferences.tsx:134-146. `choose` captures `before = choices` at the press.
// When an earlier choice fails after a later one has saved, setChoices(before) puts back the state from
// before the FIRST press, so the later, saved choice is shown as not made.
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const f = vi.hoisted(() => ({ rpc: vi.fn(), client: null as any, step: null as any, clientFails: false, clientReads: 0 }));
vi.mock('@/integrations/supabase/client', () => {
  const query = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q,
      maybeSingle: async () => {
        if (table !== 'clients') return { data: f.step, error: null };
        f.clientReads++;
        return f.clientFails ? { data: null, error: { code: '57014', message: 'timeout' } } : { data: f.client, error: null };
      },
      then: (ok: any, fail?: any) => Promise.resolve({ data: [], error: null }).then(ok, fail),
    };
    return q;
  };
  return { supabase: { rpc: f.rpc, from: query, storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) } } };
});
import { AutomaticBrandReferences } from '@/components/onboarding/AutomaticBrandReferences';
afterEach(() => { cleanup(); f.clientFails = false; f.clientReads = 0; });

it('keeps a saved choice shown when an earlier, separate choice is refused', async () => {
  f.client = { harvested_design_references: [
    { path: 'c/ig-1.jpg', platform: 'Instagram', posted_at: '2026-10-27T15:00:00Z' },
    { path: 'c/li-1.jpg', platform: 'LinkedIn', posted_at: '2026-10-21T15:00:00Z' },
  ], design_style_synthesis: null, social_voice: null, design_references: [] };
  f.step = { status: 'done', done_at: '2026-11-02T08:00:00Z', result: {} };
  let refuseFirst: (v: any) => void = () => {};
  f.rpc.mockImplementationOnce(() => new Promise((r) => { refuseFirst = r; }))
    .mockResolvedValueOnce({ data: {}, error: null });
  render(<AutomaticBrandReferences clientId="client-1" savedVersion={0} onReady={() => {}} />);
  const ig = await screen.findByRole('group', { name: 'Instagram post, Oct 27' });
  const li = screen.getByRole('group', { name: 'LinkedIn post, Oct 21' });
  fireEvent.click(within(ig).getByRole('button', { name: 'Keep' }));   // held on the server
  fireEvent.click(within(li).getByRole('button', { name: 'Keep' }));   // saved
  await waitFor(() => expect(f.rpc).toHaveBeenCalledTimes(2));
  refuseFirst({ data: null, error: { code: '42501', message: 'refused' } });
  await screen.findByText('That choice is not saved yet.');
  // Expected: LinkedIn, whose choice WAS saved, still shows Keep pressed. Actual: it is reset to not kept.
  expect(within(li).getByRole('button', { name: 'Keep' })).toHaveAttribute('aria-pressed', 'true');
});

it('keeps the library shown when a later read of the client does not answer', async () => {
  f.client = { harvested_design_references: [{ path: 'c/ig-1.jpg', platform: 'Instagram', posted_at: '2026-10-27T15:00:00Z' }], design_style_synthesis: null, social_voice: null, design_references: [] };
  f.step = { status: 'done', done_at: '2026-11-02T08:00:00Z', result: {} };
  const { rerender } = render(<AutomaticBrandReferences clientId="client-1" savedVersion={0} onReady={() => {}} />);
  await screen.findByRole('group', { name: 'Instagram post, Oct 27' });
  f.clientFails = true;
  rerender(<AutomaticBrandReferences clientId="client-1" savedVersion={1} onReady={() => {}} />);
  await waitFor(() => expect(f.clientReads).toBeGreaterThan(1));
  await new Promise((r) => setTimeout(r, 20));
  expect(screen.getByRole('group', { name: 'Instagram post, Oct 27' })).toBeInTheDocument();
});
