/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// A deck request that never gets through (QA 22 Nov 2026, P09) brings the button back for another press.
// No on-screen note says so (Lital, 26 Nov 2026: no user-facing notes).
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const f = vi.hoisted(() => ({ rpcs: [] as any[] }));
vi.mock('@/lib/quietSend', async (original) => {
  const actual = await original<typeof import('@/lib/quietSend')>();
  return { ...actual, sendQuietly: (send: any, opts: any = {}) => actual.sendQuietly(send, { ...opts, wait: async () => {} }) };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: async () => ({ data: { ready: true, connected: true }, error: null }) },
  // A connection that drops on every try (retryable), so all quiet resends run out.
  rpc: async (name: string, args: any) => { f.rpcs.push({ name, ...args }); return { data: null, error: { code: '08006', message: 'connection failure' } }; },
  from: () => { const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q, then: (r: any, j: any) => Promise.resolve({ data: [], error: null }).then(r, j) }; return q; },
} }));

import { StrategyExports } from '@/components/strategy/StrategyExports';
afterEach(cleanup);

it('brings the deck button back, with no note, once every quiet resend failed', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <StrategyExports clientId="c1" client="Acme" writtenAt="2026-11-03T10:00:00Z" newestEdit={null} contentRef={{ current: document.createElement('div') }} />
  </QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: /Google Slides deck/ }));
  await waitFor(() => expect(f.rpcs.length).toBe(4)); // first send + 3 quiet resends
  await waitFor(() => expect(screen.getByRole('button', { name: /Google Slides deck/ })).toBeEnabled());
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByText(/not asked/)).toBeNull();
});
