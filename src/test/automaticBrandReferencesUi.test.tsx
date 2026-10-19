import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AutomaticBrandReferences } from '../components/onboarding/AutomaticBrandReferences';

const f = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), signed: vi.fn(), client: null as unknown, step: null as unknown }));
vi.mock('@/integrations/supabase/client', () => {
  const query = (table: string) => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: table === 'clients' ? f.client : f.step, error: null }) };
    return q;
  };
  return { supabase: { functions: { invoke: f.invoke }, rpc: f.rpc, from: query, storage: { from: () => ({ createSignedUrls: f.signed }) } } };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const refs = [{ path: 'c/a.jpg', platform: 'INSTAGRAM', source_url: 'https://x/1' }, { path: 'c/b.jpg', platform: 'facebook', source_url: 'https://x/2' }];

it('shows the stored references and never starts paid discovery when the page opens or saves', async () => {
  f.client = { harvested_design_references: refs, design_style_synthesis: { source_count: 2 } };
  f.step = { status: 'done', done_at: '2026-10-13T11:35:00Z' };
  f.signed.mockResolvedValue({ data: refs.map((r) => ({ path: r.path, signedUrl: `https://signed/${r.path}` })) });
  const ready = vi.fn();
  const view = render(<AutomaticBrandReferences clientId="client-1" savedVersion={0} onReady={ready} />);
  await waitFor(() => expect(screen.getByText('2 branded references, learned Oct 13, 2026.')).toBeInTheDocument());
  expect(ready).toHaveBeenCalledWith({ source_count: 2 }, 2);
  expect(screen.getByText('View Instagram post')).toBeInTheDocument();
  view.rerender(<AutomaticBrandReferences clientId="client-1" savedVersion={1} onReady={ready} />);
  await waitFor(() => expect(f.signed).toHaveBeenCalledTimes(2));
  expect(f.invoke).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalled();
});

it('asks the lifecycle to refresh on request, and shows no setup instructions without references', async () => {
  f.client = { harvested_design_references: [], design_style_synthesis: null };
  f.step = null;
  f.rpc.mockResolvedValue({ error: null });
  render(<AutomaticBrandReferences clientId="client-2" savedVersion={0} onReady={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh references' })).toBeEnabled());
  expect(screen.queryByText(/assign|choose|save to start|upload/i)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh references' }));
  await waitFor(() => expect(f.rpc).toHaveBeenCalledWith('lifecycle_request', { p_client: 'client-2', p_step: 'design_refs' }));
  expect(await screen.findByText("Reviewing the client's published posts and learning its style.")).toBeInTheDocument();
  expect(f.invoke).not.toHaveBeenCalled();
});
