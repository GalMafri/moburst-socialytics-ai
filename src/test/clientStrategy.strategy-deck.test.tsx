/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The deck button and the PDF button say what happened in words: a deck that
// failed, a deck that could not be asked for, a PDF window the browser
// blocked, and a Google Slides that is unavailable (no instruction for an
// admin, no mention of Settings).

const f = vi.hoisted(() => ({
  exports: [] as any[],
  google: { ready: true, connected: true } as any,
  rpcs: [] as any[],
  rpcErrors: [] as any[],
  toasts: [] as any[],
  pdf: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: (t: any) => f.toasts.push(t) }) }));
vi.mock('@/lib/exportPdf', async (original) => {
  const actual = await original<typeof import('@/lib/exportPdf')>();
  return { ...actual, exportReportToPdf: (...a: any[]) => f.pdf(...a) };
});
vi.mock('@/lib/quietSend', async (original) => {
  const actual = await original<typeof import('@/lib/quietSend')>();
  return { ...actual, sendQuietly: (send: any, opts: any = {}) => actual.sendQuietly(send, { ...opts, wait: async () => {} }) };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: async () => ({ data: f.google, error: null }) },
  rpc: async (name: string, args: any) => {
    f.rpcs.push({ name, ...args });
    return { data: null, error: f.rpcErrors.shift() ?? null };
  },
  from: () => {
    const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q, then: (r: any, j: any) => Promise.resolve({ data: f.exports, error: null }).then(r, j) };
    return q;
  },
} }));

import { StrategyExports, deckState } from '@/components/strategy/StrategyExports';
import { PopupBlockedError } from '@/lib/exportPdf';

const failed = { id: 'e1', status: 'failed', url: null, strategy_written_at: '2026-11-03T10:00:00Z', edits_at: null, made_at: null, created_at: '2026-11-04T09:00:00Z' };
const done = { id: 'e0', status: 'done', url: 'https://docs.google.com/presentation/d/x/edit', strategy_written_at: '2026-11-03T10:00:00Z', edits_at: null, made_at: '2026-11-03T13:00:00Z', created_at: '2026-11-03T12:30:00Z' };

const mount = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <StrategyExports clientId="c1" client="Acme" writtenAt="2026-11-03T10:00:00Z" newestEdit={null} contentRef={{ current: document.createElement('div') }} />
  </QueryClientProvider>,
);

beforeEach(() => { f.exports = []; f.google = { ready: true, connected: true }; f.rpcs = []; f.rpcErrors = []; f.toasts = []; f.pdf.mockReset(); });
afterEach(cleanup);

describe('a deck that failed', () => {
  it('is its own state, with the earlier deck kept', () => {
    const ask = { connected: true, writtenAt: failed.strategy_written_at, newestEdit: null };
    expect(deckState({ ...ask, exports: [failed] }).kind).toBe('failed');
    expect(deckState({ ...ask, exports: [failed, done] })).toEqual({ kind: 'failed', url: done.url, on: 'made Nov 3' });
    // Google not connected is told as that, not as a failed deck.
    expect(deckState({ ...ask, connected: false, exports: [failed] }).kind).toBe('not_connected');
  });

  it('shows the true state with no failure copy: no deck yet, and the button asks for one', async () => {
    f.exports = [failed];
    const { container } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /Google Slides deck/ }));
    await waitFor(() => expect(f.rpcs).toContainEqual({ name: 'strategy_deck_request', p_client: 'c1' }));
    expect(container.textContent).not.toMatch(/could not|failed|Try again/i);
  });

  it('keeps the earlier deck one click away and offers a new one', async () => {
    f.exports = [failed, done];
    const { container } = mount();
    expect(await screen.findByRole('button', { name: /Make a new deck/ })).toBeEnabled();
    expect(screen.getByRole('link', { name: /Open the deck made Nov 3/ })).toHaveAttribute('href', done.url);
    expect(container.textContent).not.toMatch(/could not|failed|Try again/i);
  });
});

describe('a deck that could not be asked for', () => {
  it('leaves the button ready again and prints nothing about the refusal', async () => {
    f.rpcErrors = [{ code: '42501', message: 'Only Moburst staff can make a strategy deck.' }];
    const { container } = mount();
    fireEvent.click(await screen.findByRole('button', { name: /Google Slides deck/ }));
    await waitFor(() => expect(f.rpcs).toContainEqual({ name: 'strategy_deck_request', p_client: 'c1' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Google Slides deck/ })).toBeEnabled());
    expect(container.textContent).not.toMatch(/Moburst staff|could not|failed|Try again/i);
  });
});

describe('Google Slides unavailable', () => {
  it('says it is unavailable and that the PDF works, with no word to an admin', async () => {
    f.google = { ready: false, connected: false };
    const { container } = mount();
    expect(await screen.findByText('Google Slides is unavailable right now. The PDF works.')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/admin|Settings|connect/i);
    expect(screen.getByRole('button', { name: /Google Slides deck/ })).toBeDisabled();
  });
});

describe('the PDF button', () => {
  it('says the PDF is ready to save from the print dialog', async () => {
    f.pdf.mockResolvedValue(undefined);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Export PDF/ }));
    await waitFor(() => expect(f.toasts).toHaveLength(1));
    expect(JSON.stringify(f.toasts[0])).toContain('Your PDF is ready to save from the print dialog.');
    expect(JSON.stringify(f.toasts[0])).not.toContain('PDF export ready');
  });

  it('shows no failure message when the print window did not open, and the button is ready again', async () => {
    for (const err of [new PopupBlockedError(), new Error('No content to export')]) {
      f.pdf.mockRejectedValue(err);
      mount();
      fireEvent.click(screen.getByRole('button', { name: /Export PDF/ }));
      await waitFor(() => expect(f.pdf).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByRole('button', { name: /Export PDF/ })).toBeEnabled());
      expect(f.toasts).toHaveLength(0);
      cleanup();
      f.pdf.mockClear();
    }
  });
});
