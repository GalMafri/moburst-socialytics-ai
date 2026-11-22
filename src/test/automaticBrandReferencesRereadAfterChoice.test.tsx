/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P06): AutomaticBrandReferences.tsx:122-147. A saved choice makes the server run the client's
// design_refs check (design_reference_choose -> lifecycle_enqueue), but the card never reads its state
// again after a choice: polling starts only if the step was already running when the card loaded.
// So the check the choice started, and the look it learns, are never shown until the page is reloaded.
import React from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const f = vi.hoisted(() => ({ rpc: vi.fn(), client: null as any, step: null as any, stepReads: 0 }));
vi.mock('@/integrations/supabase/client', () => {
  const query = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, in: () => q,
      maybeSingle: async () => { if (table !== 'clients') f.stepReads++; return { data: table === 'clients' ? f.client : f.step, error: null }; },
      then: (ok: any, fail?: any) => Promise.resolve({ data: [], error: null }).then(ok, fail),
    };
    return q;
  };
  return { supabase: { rpc: f.rpc, from: query, storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) } } };
});
import { AutomaticBrandReferences } from '@/components/onboarding/AutomaticBrandReferences';

it('reads the check again after a saved choice starts it', async () => {
  f.client = { harvested_design_references: [{ path: 'c/ig-1.jpg', platform: 'Instagram', posted_at: '2026-10-27T15:00:00Z' }], design_style_synthesis: null, social_voice: null, design_references: [] };
  f.step = { status: 'done', done_at: '2026-11-02T08:00:00Z', attempted_at: '2026-11-02T08:00:00Z', result: {} };
  f.rpc.mockImplementation(async () => {
    // The server enqueues the client's lifecycle; the design_refs step is now running.
    f.step = { status: 'running', done_at: '2026-11-02T08:00:00Z', attempted_at: new Date().toISOString(), result: {} };
    return { data: { path: 'c/ig-1.jpg', choice: 'kept' }, error: null };
  });
  render(<AutomaticBrandReferences clientId="client-1" savedVersion={0} onReady={() => {}} />);
  const ig = await screen.findByRole('group', { name: 'Instagram post, Oct 27' });
  const readsBefore = f.stepReads;
  fireEvent.click(within(ig).getByRole('button', { name: 'Keep' }));
  await waitFor(() => expect(f.rpc).toHaveBeenCalledTimes(1));
  // Expected: the card reads its state again and says it is checking. Actual: no read, no status.
  await waitFor(() => expect(f.stepReads).toBeGreaterThan(readsBefore), { timeout: 3000 });
  expect(await screen.findByText("Checking the client's posts for new designs.")).toBeInTheDocument();
});
