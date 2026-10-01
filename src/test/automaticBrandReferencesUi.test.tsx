import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AutomaticBrandReferences } from '../components/onboarding/AutomaticBrandReferences';
const f = vi.hoisted(() => ({ invoke: vi.fn(), signed: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: f.invoke }, storage: { from: () => ({ createSignedUrls: f.signed }) } } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('requires no upload and starts discovery automatically after a client is saved', async () => {
  f.invoke.mockResolvedValue({ data: { design_style_synthesis: { source_count: 3 }, harvested_design_references: [] } });
  const ready = vi.fn();
  const view = render(<AutomaticBrandReferences savedVersion={0} onReady={ready} />);
  expect(f.invoke).not.toHaveBeenCalled();
  expect(screen.getByText(/No uploads required/)).toBeInTheDocument();
  view.rerender(<AutomaticBrandReferences clientId="client-1" savedVersion={1} onReady={ready} />);
  await waitFor(() => expect(ready).toHaveBeenCalledWith({ source_count: 3 }, 0));
  expect(f.invoke).toHaveBeenCalledWith('synthesize-design-language', { body: { client_id: 'client-1', discover: true, force: false } });
});
it('shows the actual no-reference reason and permits an explicit retry', async () => {
  f.invoke.mockResolvedValue({ data: { error: 'No usable branded posts found' } });
  render(<AutomaticBrandReferences clientId="client-2" savedVersion={0} onReady={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No usable branded posts found'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh references' }));
  await waitFor(() => expect(f.invoke).toHaveBeenCalledWith('synthesize-design-language', { body: { client_id: 'client-2', discover: true, force: true } }));
});
