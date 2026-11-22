/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P09): ApiAccessCard.tsx:121-136/191. While a "Create" press is being sent again quietly (waits 1 s,
// 3 s, 9 s), the button is enabled again (it is disabled only by create.isPending, which is false between
// tries) and shows no busy state, so a second press starts a second create: two keys can be made, and the
// first one's secret is never shown.
import React from 'react';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const f = vi.hoisted(() => ({ posts: 0, release: null as null | (() => void) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: '***' } } }) } } }));
vi.mock('@/lib/quietSend', async (original) => {
  const actual = await original<typeof import('@/lib/quietSend')>();
  // The quiet wait is held open so the test can look at the dialog during it.
  return { ...actual, sendQuietly: (send: any, opts: any = {}) => actual.sendQuietly(send, { ...opts, wait: () => new Promise<void>((r) => { f.release = r; }) }) };
});
globalThis.fetch = vi.fn(async (_url: any, init?: RequestInit) => {
  if (init?.method === 'POST') { f.posts++; throw new TypeError('Failed to fetch'); }
  return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as any;

import { ApiAccessCard } from '@/components/settings/ApiAccessCard';

it('keeps Create busy while the first press is being sent again', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ApiAccessCard clientSlugs={[]} /></QueryClientProvider>);
  fireEvent.click(await screen.findByRole('button', { name: /create key/i }));
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'gOS staging' } });
  fireEvent.click(screen.getByRole('button', { name: /^create$/i }));
  await waitFor(() => expect(f.posts).toBe(1));
  await waitFor(() => expect(f.release).not.toBeNull()); // now inside the 1 s quiet wait
  // Expected: Create stays disabled (or busy) until the quiet resends finish. Actual: it is clickable again.
  expect(screen.getByRole('button', { name: /^create$/i })).toBeDisabled();
});
