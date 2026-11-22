/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P06): ClientOverview.tsx:40-65,113. Each read's `error` is dropped: a reports read that did not
// answer becomes `report.data === null`, and the tile states "No monthly report yet." as fact for a client
// that has reports, instead of keeping to "Loading" / reading again (the app's true-state rule).
import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/integrations/supabase/client', () => {
  const from = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, gte: () => q, order: () => q, limit: () => q, is: () => q, not: () => q, range: () => q, in: () => q,
      maybeSingle: async () => table === 'reports'
        ? { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
        : { data: { id: 'c1', name: 'Acme', timezone: 'UTC' }, error: null },
      then: (ok: any, fail?: any) => Promise.resolve({ data: [], error: null }).then(ok, fail),
    };
    return q;
  };
  return { supabase: { from } };
});
vi.mock('@/lib/openTopics', () => ({ fetchOpenTopics: async () => [] }));
vi.mock('@/lib/nextRun', () => ({ fetchNextRun: async () => null }));
vi.mock('@/lib/newestReadyCompetitive', () => ({ fetchNewestReadyCompetitive: async () => ({ row: null, seen: true }) }));
import { ClientOverview } from '@/components/dashboard/ClientOverview';

it('does not say there is no monthly report when the reports read failed', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter><ClientOverview clientId="c1" isStaff /></MemoryRouter></QueryClientProvider>);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // The read has answered (with an error) once the overview has either filled in or gone to reading again.
  await waitFor(() => expect(screen.queryByText('No monthly report yet.') ?? (warn.mock.calls.some((c) => c[0] === '[load retry]') ? true : null)).not.toBeNull());
  // No claim that the client has no report (the read never answered): the overview keeps loading and reads again.
  expect(screen.queryByText('No monthly report yet.')).toBeNull();
  expect(screen.getByText(/Loading the overview/i)).toBeInTheDocument();
  warn.mockRestore();
});
