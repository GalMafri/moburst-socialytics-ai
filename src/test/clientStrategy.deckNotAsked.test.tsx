/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
// QA 22 Nov 2026 (P09): a deck request that never gets through leaves the deck button exactly as it was,
// with no "not asked yet" line, although StrategyExports.tsx:9-10 promises it is "said in words".
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

it('says the deck is not asked for yet once every quiet resend failed', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <StrategyExports clientId="c1" client="Acme" writtenAt="2026-11-03T10:00:00Z" newestEdit={null} contentRef={{ current: document.createElement('div') }} />
  </QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: /Google Slides deck/ }));
  await waitFor(() => expect(f.rpcs.length).toBe(4)); // first send + 3 quiet resends
  await waitFor(() => expect(screen.getByRole('button', { name: /Google Slides deck/ })).toBeEnabled());
  // Expected: a status line with the true state ("not asked for yet" / "not made yet"). Actual: none.
  expect(screen.getByRole('status')).toHaveTextContent('The deck is not asked for yet.');
});
