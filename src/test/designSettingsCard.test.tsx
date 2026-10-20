/* eslint-disable @typescript-eslint/no-explicit-any -- Partial query doubles. */
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DesignSettingsCard } from '@/components/onboarding/DesignSettingsCard';

// Design settings are derived automatically (Lital's decision 2, 19 Oct 2026)
// and in place from then on. Automatic designs are off for good (Lital, 20 Oct
// 2026), so the card offers no switch for them.

const f = vi.hoisted(() => ({ settings: null as any, writes: [] as any[] }));
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: 'person-1' } } }) },
  storage: { from: () => ({ createSignedUrls: async () => ({ data: [{ path: 'c/a.jpg', signedUrl: 'https://signed/a' }] }), getPublicUrl: (p: string) => ({ data: { publicUrl: `https://x/${p}` } }) }) },
  from: (table: string) => {
    const q: any = {
      select: () => q, eq: () => q,
      upsert: (row: any) => { f.writes.push(row); return Promise.resolve({ error: null }); },
      update: (row: any) => { f.writes.push(row); return q; },
      maybeSingle: async () => ({ data: table === 'design_brand_settings' ? f.settings : { design_references: [], harvested_design_references: [{ path: 'c/a.jpg' }] }, error: null }),
      then: (resolve: any) => Promise.resolve({ error: null }).then(resolve),
    };
    return q;
  },
} }));
afterEach(() => { cleanup(); f.writes = []; });

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={qc}><DesignSettingsCard clientId="c" /></QueryClientProvider>);
}

it('shows derived settings as in place, editable, with no automatic designs switch and no confirmation step', async () => {
  f.settings = { client_id: 'c', source: 'lifecycle', logo_path: 'c/brand/logo.png', background: '#0B0E1A', placement: { anchor: 'center', width: 0.25, top: 0.04 }, reference_paths: ['c/a.jpg'], auto_designs: false, confirmed_at: '2026-10-19T12:00:00Z',
    derived: { at: '2026-10-19T12:00:00Z', placement_from: 'client_posts', background_from: 'brand_color' } };
  mount();
  expect(await screen.findByText("Worked out automatically on Oct 19, 2026: the logo from the client's website, its place from where the client's own posts put it, the background from a brand color. You can change any of them here.")).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
  expect(screen.queryByText(/Confirm them once|not confirmed|Add some in the Brief tab/)).toBeNull();
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByText(/automatically/i, { selector: 'label' })).toBeNull();
  // Nothing to save until a person changes something.
  expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Background behind the logo'), { target: { value: '#FFFFFF' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(f.writes).toHaveLength(1));
  expect(f.writes.at(-1)).toMatchObject({ client_id: 'c', background: '#FFFFFF', confirmed_by: 'person-1' });
});

it('says a person set them, when they did', async () => {
  f.settings = { client_id: 'c', source: 'person', logo_path: 'c/logo.png', background: '#000000', placement: { anchor: 'left', width: 0.2, top: 0.05, left: 0.05 }, reference_paths: ['c/a.jpg'], auto_designs: false, updated_at: '2026-10-12T09:00:00Z' };
  mount();
  expect(await screen.findByText('Set by your team on Oct 12, 2026. The product keeps these as they are.')).toBeInTheDocument();
});
