/* eslint-disable @typescript-eslint/no-explicit-any -- Partial doubles. */
// QA 22 Nov 2026 (P09): EditSheet.tsx:61 calls e.cancel() whenever the sheet closes, even while a save is being sent
// again quietly. Cancel is disabled during a save (line 119), but Escape / the overlay / the X still close
// it. If the save then fails, "Your changes are kept here and are not saved yet" is set inside a closed
// sheet: the card shows the old text with no line at all, and reopening the pencil resets the form
// (start() rebuilds it), so the typed words are gone.
import React from 'react';
import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const f = vi.hoisted(() => ({ release: [] as Array<() => void>, saves: 0 }));
vi.mock('@/lib/quietSend', async (original) => {
  const actual = await original<typeof import('@/lib/quietSend')>();
  return { ...actual, sendQuietly: (send: any, opts: any = {}) => actual.sendQuietly(send, { ...opts, wait: () => new Promise<void>((r) => { f.release.push(r); }) }) };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  // A dropped connection on every try: resendable, so the quiet resends run and then run out.
  rpc: async () => { f.saves++; return { data: null, error: { code: '08006', message: 'connection failure' } }; },
  from: () => { const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: null, error: null }), then: (r: any) => Promise.resolve({ data: [], error: null }).then(r) }; return q; },
} }));

import { AvoidList } from '@/components/strategy/AvoidList';

it('does not lose a failed save because the sheet was closed while it was being sent', async () => {
  const product = { items: [{ pattern: 'Stock photos of handshakes', source: 'team' }] };
  render(<AvoidList clientId="c1" sectionKey="avoid" product={product} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit what we avoid' }));
  fireEvent.change(await screen.findByLabelText('Patterns we stop'), { target: { value: 'Long captions with no hook' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() => expect(f.release.length).toBe(1)); // first try failed, waiting to send again
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }); // the person tries to close the sheet
  await act(async () => {});
  expect(screen.getByRole('dialog')).toBeInTheDocument(); // it stays open while the save is sent
  for (let i = 0; i < 3; i++) { await act(async () => { f.release.shift()?.(); }); await waitFor(() => expect(f.saves).toBe(i + 2)); }
  // The save did not get through: the sheet says so, with the words typed still there.
  expect(await screen.findByText(/not saved yet/i)).toBeInTheDocument();
  expect(screen.getByLabelText('Patterns we stop')).toHaveValue('Long captions with no hook');
});

it('control: with the sheet left open, the same failed save says "not saved yet"', async () => {
  f.release = []; f.saves = 0;
  render(<AvoidList clientId="c1" sectionKey="avoid" product={{ items: [{ pattern: 'Stock photos of handshakes', source: 'team' }] }} onSaved={() => {}} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit what we avoid' }).at(-1)!);
  fireEvent.change(await screen.findByLabelText('Patterns we stop'), { target: { value: 'Long captions with no hook' } });
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  for (let i = 0; i < 3; i++) { await waitFor(() => expect(f.release.length).toBe(1)); await act(async () => { f.release.shift()?.(); }); }
  expect(await screen.findByText(/not saved yet/i)).toBeInTheDocument();
});
